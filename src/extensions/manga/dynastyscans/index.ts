import {
  resolveFilterEntries,
  type Chapter,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetImage,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type GetSettingsFilters,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
  type Status,
} from "@tsukimichi/common";
import type { AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import {
  ANTHOLOGIES_DIR,
  ANTHOLOGY_TYPE,
  AUTHOR_FILTER_KEY,
  AUTHORS_UPPER_LIMIT,
  BEST_MATCH,
  CHAPTER_FETCH_LIMIT_PREF_KEY,
  CHAPTER_SLUG_REGEX,
  CHAPTER_TYPE,
  CHAPTERS_DIR,
  CHAPTERS_FETCH_LIMITS,
  COVER_URL_FRAGMENT,
  DOUJIN_TYPE,
  DOUJINS_DIR,
  ISSUE_TYPE,
  ISSUES_DIR,
  MANGA_TYPES,
  PAIRING_FILTER_KEY,
  RELEASED_ON,
  SCANLATOR_FILTER_KEY,
  SEARCH_SERIES_SELECTOR_REGEX,
  SERIES_DIR,
  SERIES_TYPE,
  SMART_SORT,
  SORT_FILTER_KEY,
  TYPE_FILTER_KEY,
} from "./constants";
import {
  type BrowseResponse,
  type ChapterResponse,
  type DynastyScansChapter,
  type MangaResponse,
  type TagSuggest,
  transformTaggings,
} from "./dto";
import { DYNASTY_SCANS_SORT_OPTIONS, DYNASTY_SCANS_TYPE_OPTIONS } from "./filters";
import manifest from "./manifest.json";
import { StringUtils } from "@/utils/string";

export class DynastyScans extends BaseMangaScraper {
  private seriesSelected = false;
  private doujinSelected = false;
  private chapterSelected = false;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters = {} } = options ?? {};
    const url = new URL("search", this.baseUrl);

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          if (value === SMART_SORT) {
            const sort = query?.trim() ? BEST_MATCH : RELEASED_ON;
            url.searchParams.set(filter.key, sort);
          } else url.searchParams.set(filter.key, value?.toString());
          break;

        case "multi-select":
          if (Array.isArray(value) && value.length > 0 && filter.key === TYPE_FILTER_KEY) {
            value.forEach((v: string) => {
              this.seriesSelected = this.seriesSelected || v === SERIES_TYPE;
              this.doujinSelected = this.doujinSelected || v === DOUJIN_TYPE;
              this.chapterSelected = this.chapterSelected || v === CHAPTER_TYPE;

              url.searchParams.append("classes[]", v);
            });
          }
          break;

        case "text":
          if (typeof value === "string" && value.trim()) {
            if (filter.key === AUTHOR_FILTER_KEY) {
              const authors: string[] = value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);

              const authorIds = (
                await Promise.all(authors.map((a) => this.fetchTagId(a, "Author")))
              ).filter((id): id is number => id != null);

              authorIds.forEach((id) => {
                url.searchParams.append("with[]", id.toString());
              });
            }

            if (filter.key === SCANLATOR_FILTER_KEY) {
              const scanlators: string[] = value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);

              const scanlatorIds = (
                await Promise.all(scanlators.map((s) => this.fetchTagId(s, "Scanlator")))
              ).filter((id): id is number => id != null);

              scanlatorIds.forEach((id) => {
                url.searchParams.append("with[]", id.toString());
              });
            }

            if (filter.key === PAIRING_FILTER_KEY) {
              const pairings: string[] = value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);

              const pairingIds = (
                await Promise.all(pairings.map((p) => this.fetchTagId(p, "Pairing")))
              ).filter((id): id is number => id != null);

              pairingIds.forEach((id) => {
                url.searchParams.append("with[]", id.toString());
              });
            }
          }
          break;

        default:
          break;
      }
    }

    if (page > 1) url.searchParams.set("page", page.toString());

    // Series and Doujin results are best when chapters are included
    if ((this.seriesSelected || this.doujinSelected) && !this.chapterSelected) {
      url.searchParams.append("classes[]", CHAPTER_TYPE);
    }

    if (query?.trim()) url.searchParams.set("q", query.trim());

    const { data: html } = await this.client.get(url.toString());

    return this.parseSearchResult(html);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL(`${CHAPTERS_DIR}/added.json`, this.baseUrl);
    url.searchParams.set("page", page.toString());

    const { data } = await this.client.get<BrowseResponse>(url.toString());

    const entries = new Map<string, Manga>();

    for (const chapter of data.chapters) {
      let isSeries = false;

      for (const tag of chapter.tags) {
        if (MANGA_TYPES.includes(tag.type)) {
          const directory = this.getDirectory(tag.type);
          const seriesUrl = new URL(`${directory}/${tag.permalink}`, this.baseUrl);
          seriesUrl.searchParams.set("type", tag.type);

          const coverImageUrl = new URL(seriesUrl);
          coverImageUrl.hash = COVER_URL_FRAGMENT;

          const manga: Manga = {
            title: tag.name,
            coverImageUrl: coverImageUrl.toString(),
            isNsfw: null,
            url: `${seriesUrl.pathname}${seriesUrl.search}`,
            status: "unknown",
          };

          entries.set(manga.url, manga);

          if (tag.type === SERIES_TYPE) {
            isSeries = true;
          }
        }
      }

      if (!isSeries) {
        const manga: Manga = {
          title: chapter.title,
          coverImageUrl: `${this.baseUrl}/${CHAPTERS_DIR}/${chapter.permalink}?type=${CHAPTER_TYPE}#${COVER_URL_FRAGMENT}`,
          isNsfw: null,
          url: `/${CHAPTERS_DIR}/${chapter.permalink}?type=${CHAPTER_TYPE}`,
          status: "unknown",
        };

        entries.set(manga.url, manga);
      }
    }

    const hasMore = data.current_page < data.total_pages;

    return {
      data: Array.from(entries.values()),
      hasMore,
    };
  };

  override getPopularSeries: GetPopularSeries<Manga> = async () => {
    const { data } = await this.client.get<string>(this.baseUrl);

    const $ = cheerio.load(data, { baseURI: this.baseUrl });

    const mangaMap = new Map<string, Manga>();

    $('h4:contains("Most Popular of Past 7 Days") ~ ul.cover-list a.thumbnail').each((_, el) => {
      const $el = $(el);
      const permaLink = $el.attr("href")?.split("/").pop();
      if (!permaLink) return;

      const [directory, resolvedPermalink] = this.resolveEntryPath(CHAPTERS_DIR, permaLink);

      const title = this.permalinkToTitle(resolvedPermalink);
      let type = directory === CHAPTERS_DIR ? CHAPTER_TYPE : this.getType(directory);
      const url = `/${directory}/${resolvedPermalink}?type=${type}`;
      mangaMap.set(url, {
        title,
        isNsfw: null,
        status: "unknown",
        url: `/${directory}/${resolvedPermalink}?type=${type}`,
        coverImageUrl: `${this.baseUrl}/${directory}/${resolvedPermalink}?type=${type}#${COVER_URL_FRAGMENT}`,
      });
    });

    return {
      data: Array.from(mangaMap.values()),
      hasMore: false,
    };
  };

  private resolveEntryPath(directory: string, permalink: string): [string, string] {
    if (directory !== CHAPTERS_DIR) {
      return [directory, permalink];
    }

    const seriesPermalink = CHAPTER_SLUG_REGEX.exec(permalink)?.[1];
    if (!seriesPermalink) return [directory, permalink];
    return [SERIES_DIR, seriesPermalink];
  }

  private parseSearchResult(html: string): SeriesListResponse<Manga> {
    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    let firstEntry: any = null;

    const entries = new Map<string, Manga>();

    const elements = $(
      `.chapter-list a.name[href*="/${SERIES_DIR}/"],
   .chapter-list a.name[href*="/${ANTHOLOGIES_DIR}/"],
   .chapter-list a.name[href*="/${CHAPTERS_DIR}/"],
   .chapter-list a.name[href*="/${DOUJINS_DIR}/"],
   .chapter-list a.name[href*="/${ISSUES_DIR}/"],
   .chapter-list .doujin_tags a[href*="/${DOUJINS_DIR}/"]`,
    );
    elements
      .filter((_, el) => SEARCH_SERIES_SELECTOR_REGEX.test($(el).attr("href") || ""))
      .each((_, el) => {
        const $el = $(el);

        const href = $el.prop("href");
        if (!href) return;

        const urlObj = new URL(href, this.baseUrl);

        let [directory, permalink] = urlObj.pathname.split("/").filter(Boolean);
        let title = $el.text().trim();
        let type: string | null = null;

        if (directory === CHAPTERS_DIR) {
          const seriesPermalink = CHAPTER_SLUG_REGEX.exec(permalink!)?.[1];
          type = CHAPTER_TYPE;

          if (seriesPermalink != null) {
            directory = SERIES_DIR;
            type = SERIES_TYPE;
            permalink = seriesPermalink;
            title = this.permalinkToTitle(permalink);
          }
        }

        if (directory?.trim() && directory.trim() !== CHAPTERS_DIR) {
          type = this.getType(directory);
        }

        const seriesUrl = new URL(`${directory}/${permalink}`, this.baseUrl);
        seriesUrl.searchParams.set("type", type!);
        const coverImageUrl = new URL(seriesUrl);
        coverImageUrl.hash = COVER_URL_FRAGMENT;

        const entry: Manga = {
          url: `${seriesUrl.pathname}${seriesUrl.search}`,
          title,
          coverImageUrl: coverImageUrl.href,
          isNsfw: null,
          status: "unknown",
        };

        if (firstEntry === null) firstEntry = entry;

        if (
          (!this.seriesSelected && directory === SERIES_DIR) ||
          (!this.chapterSelected && directory === CHAPTERS_DIR) ||
          (!this.doujinSelected && directory === DOUJINS_DIR)
        )
          return;

        entries.set(entry.url, entry);
      });

    if (entries.size === 0 && firstEntry !== null) {
      entries.set(firstEntry.url, firstEntry);
    }

    const hasMore = $(".pagination [rel=next]").length > 0;

    return {
      data: Array.from(entries.values()),
      hasMore,
    };
  }

  override getSeries: GetSeries<Manga> = async (query) => {
    const { data, config } = await this.mangaDetailsRequest(query);

    const segments = new URL(config.url!).pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .filter(Boolean);

    const [directory, permalink] = segments;

    if (segments[0] === CHAPTERS_DIR) {
      return this.getMangaDetailsFromChapterReq(data as ChapterResponse);
    }

    const mangaData = data as MangaResponse;

    const authors: Set<string> = new Set();
    const tags: Set<string> = new Set();
    const others: Map<string, Set<string>> = new Map();
    const publishingStatus: Set<string> = new Set();

    mangaData.tags?.forEach((tag) => {
      switch (tag.type) {
        case "Author":
          authors.add(tag.name);
          break;

        case "General":
          tags.add(tag.name);
          break;

        case "Status":
          publishingStatus.add(tag.name);
          if (!others.has(tag.type)) others.set(tag.type, new Set());
          others.get(tag.type)?.add(tag.name);
          break;

        default:
          if (!others.has(tag.type)) others.set(tag.type, new Set());
          others.get(tag.type)?.add(tag.name);
          break;
      }
    });

    mangaData.taggings?.forEach((tagging) => {
      if ("tags" in tagging) {
        tagging.tags?.forEach((tag) => {
          switch (tag.type) {
            case "Author":
              authors.add(tag.name);
              break;
            case "General":
              tags.add(tag.name);
              break;
            case SERIES_TYPE:
            case DOUJIN_TYPE:
            case ANTHOLOGY_TYPE:
            case ISSUE_TYPE:
            case "Scanlator":
              break;
            default:
              if (!others.has(tag.type)) others.set(tag.type, new Set());
              others.get(tag.type)?.add(tag.name);
              break;
          }
        });
      }
    });

    let coverImageUrl: string | null = null;

    const genres = Array.from(tags);

    if (data.cover) {
      coverImageUrl = new URL(data.cover, this.baseUrl).href;
    } else {
      const { data: chaptersData } = await this.client.get<ChapterResponse>(
        new URL(`${CHAPTERS_DIR}/${permalink}.json`, this.baseUrl).toString(),
        { validateStatus: () => true },
      );

      if (chaptersData.pages?.[0]?.url) {
        coverImageUrl = new URL(chaptersData.pages[0].url, this.baseUrl).href;
      }
    }

    let description = "";

    if (data.description) {
      const decoded = this.decodeUnicode(data.description);
      const $ = cheerio.load(decoded);
      $("a").remove();

      const text = $.root().text().trim();

      if (text) description += `${text}<br/><br/>`;
    }

    description += `Type: ${data.type}<br/><br/>`;

    if (authors.size > AUTHORS_UPPER_LIMIT) {
      if (!others.has("Author")) others.set("Author", new Set());

      const authorSet = others.get("Author")!;
      authors.forEach((author) => {
        authorSet.add(author);
      });
    }

    for (const [type, values] of others.entries()) {
      if (values.size === 0) continue;

      description += `${type}:<br/>`;

      for (const value of values) {
        description += `• ${value}<br/>`;
      }

      description += "<br/>";
    }

    if (data.aliases && data.aliases.length > 0) {
      description += "Aliases:<br/>";

      for (const alias of data.aliases) {
        description += `• ${alias}<br/>`;
      }

      description += "<br/>";
    }

    description = description.trim();

    return {
      title: data.name,
      coverImageUrl,
      authors:
        authors.size > AUTHORS_UPPER_LIMIT
          ? Array.from(authors).slice(0, AUTHORS_UPPER_LIMIT)
          : Array.from(authors),
      description,
      status: this.parseStatus(publishingStatus),
      genres,
      isNsfw: this.detectNsfw(data.name, "", genres),
      url: `/${directory}/${StringUtils.substringBeforeLast(permalink!, ".")}?type=${data.type}`,
    };
  };

  private getMangaDetailsFromChapterReq(data: ChapterResponse): Manga {
    const authors: Set<string> = new Set();
    const tags: Set<string> = new Set();
    const others: Map<string, Set<string>> = new Map();

    data.tags.forEach((tag) => {
      switch (tag.type) {
        case "Author":
          authors.add(tag.name);
          break;

        case "General":
          tags.add(tag.name);
          break;

        default:
          if (!others.has(tag.type)) others.set(tag.type, new Set());
          others.get(tag.type)?.add(tag.name);
          break;
      }
    });

    const genres = Array.from(tags);

    const cover = data.pages?.[0]?.url;

    let description = "";

    description += `Type: ${CHAPTER_TYPE}<br/>`;

    for (const [type, values] of others.entries()) {
      if (values.size === 0) continue;

      description += `${type}:<br/>`;

      for (const value of values) {
        description += `• ${value}<br/>`;
      }

      description += `Released: ${data.released_on}<br/>`;

      description += "<br/>";
    }

    let coverImageUrl: string | null = null;

    if (cover) {
      const urlObj = new URL(cover, this.baseUrl);
      urlObj.searchParams.set("type", CHAPTER_TYPE);

      coverImageUrl = urlObj.toString();
    }

    return {
      title: data.title.replace(/\s+/g, " ").trim(),
      description,
      authors: Array.from(authors),
      genres,
      isNsfw: null,
      coverImageUrl,
      status: "completed",
      url: `/${CHAPTERS_DIR}/${StringUtils.substringBeforeLast(data.permalink, ".")}?type=${CHAPTER_TYPE}`,
    };
  }

  private mangaDetailsRequest<T = any>(query: string): Promise<AxiosResponse<T>> {
    const url = new URL(query, this.baseUrl);

    const segments = url.pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .filter(Boolean);

    const type = url.searchParams.get("type");
    url.searchParams.delete("type");

    if (segments[0] === CHAPTERS_DIR) {
      url.pathname = `/${segments[0]}/${segments[1]}.json`;
      return this.client.get<T>(url.toString());
    }

    if (!type) throw new Error("Series type not found in the URL");

    segments[0] = this.getDirectory(type);
    const [directory, permalink] = segments;
    url.pathname = `/${directory}/${permalink}.json`;
    return this.client.get<T>(url.toString());
  }

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(query, this.baseUrl);

    const segments = url.pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .filter(Boolean);

    if (segments[0] === CHAPTERS_DIR) {
      const { data } = await this.mangaDetailsRequest<ChapterResponse>(query);
      return [this.parseChapter(data)];
    }

    const { data: seriesData } = await this.mangaDetailsRequest<MangaResponse>(query);

    const chapters: Chapter[] = [];
    const limit = this.getChapterFetchLimit();
    const totalPages = seriesData.total_pages ?? 1;

    const transformedTaggings = transformTaggings(seriesData.taggings);
    let header: string | null = null;

    for (const tagging of transformedTaggings) {
      if (tagging.type === "header" && "header" in tagging) {
        header = tagging.header;
        continue;
      }
      const parsed = this.parseChapter(tagging as DynastyScansChapter);
      if (header) parsed.title = `${header} - ${parsed.title}`;
      chapters.push(parsed);
    }

    let page = 2;

    while (page <= totalPages && page <= limit) {
      const newUrl = new URL(url);
      newUrl.searchParams.set("page", page.toString());

      const { data: pageData } = await this.client.get<MangaResponse>(newUrl.toString());

      const transformedPageTaggings = transformTaggings(pageData.taggings);
      for (const tagging of transformedPageTaggings) {
        if (tagging.type === "header" && "header" in tagging) {
          header = tagging.header;
          continue;
        }

        const parsed = this.parseChapter(tagging as DynastyScansChapter);
        if (header) parsed.title = `${header} - ${parsed.title}`;
        chapters.push(parsed);
      }

      page++;
    }

    const authors = seriesData.tags?.filter((tag) => tag.type === "Author") ?? [];
    const scanlators = seriesData.tags?.filter((tag) => tag.type === "Scanlator") ?? [];

    chapters.forEach((chapter) => {
      if (seriesData.type !== SERIES_TYPE && authors.length) {
        chapter.title += ` by ${authors.map((a) => a.name).join(" and ")}`;
      }

      if (scanlators.length) {
        chapter.groupName = scanlators.map((s) => s.name).join(", ");
      }
    });

    if (seriesData.type === DOUJIN_TYPE) {
      return this.addChapterNavigation([...chapters].reverse());
    }

    return this.addChapterNavigation(chapters);
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const chapterUrl = new URL(query, this.baseUrl);

    const [_, permalink] = chapterUrl.pathname.split("/").filter(Boolean)!;

    const url = new URL(`${CHAPTERS_DIR}/${permalink}.json`, this.baseUrl);

    const { data } = await this.client.get<ChapterResponse>(url.toString());

    return data.pages?.map((page, index) => ({
      index,
      url: new URL(page.url, this.baseUrl).toString(),
    }));
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: CHAPTER_FETCH_LIMIT_PREF_KEY,
      label: "Chapters fetch limit",
      description: `
          Limits how many pages of an entry are fetched for chapter list. Mostly applies to Doujins.
          More pages mean slower loading for chapter list.
        `,
      options: CHAPTERS_FETCH_LIMITS.map((limit) => ({
        label: `${limit.charAt(0).toUpperCase() + limit.slice(1)} pages`,
        value: limit,
      })),
      type: "select",
      defaultValue: CHAPTERS_FETCH_LIMITS[0]!,
    },
  ];

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: TYPE_FILTER_KEY,
        label: "Type",
        description: "Note: May not always work as expected",
        type: "multi-select",
        renderAs: "select",
        options: DYNASTY_SCANS_TYPE_OPTIONS,
        multiple: true,
      },
      {
        key: SORT_FILTER_KEY,
        label: "Sort",
        description: "Note: May not always work as expected",
        type: "select",
        options: DYNASTY_SCANS_SORT_OPTIONS,

        defaultValue: DYNASTY_SCANS_SORT_OPTIONS[0]?.value,
      },
      {
        key: AUTHOR_FILTER_KEY,
        label: "Author",
        type: "text",
        description: `
          Separate by comma. 

          Note: Require exact match
        `,
        placeholder: "Author Name",
        defaultValue: "",
      },
      {
        key: SCANLATOR_FILTER_KEY,
        label: "Scanlator",
        type: "text",
        description: `
          Separate by comma. 

          Note: Require exact match
        `,
        placeholder: "Scanlator Name",
        defaultValue: "",
      },
      {
        key: PAIRING_FILTER_KEY,
        label: "Pairing",
        type: "text",
        description: `
          Separate by comma. 

          Note: Require exact match
        `,
        placeholder: "e.g. PairA x PairB, PairC x PairD",
        defaultValue: "",
      },
    ],
  });

  override getImage: GetImage = async (url) => {
    if (url.endsWith(COVER_URL_FRAGMENT)) {
      const series = await this.getSeries(
        url.replace(this.baseUrl, "").replace(`#${COVER_URL_FRAGMENT}`, ""),
      );

      if (!series?.coverImageUrl) {
        throw new Error("Cover image not found");
      }

      const { data, headers } = await this.client.get(series.coverImageUrl, {
        headers: this.getImageHeaders(),
        responseType: "arraybuffer",
      });

      return {
        data,
        contentType: (headers["content-type"] || "image/jpeg") as string,
      };
    }

    const { data, headers } = await this.client.get(url, {
      headers: this.getImageHeaders(),
      responseType: "arraybuffer",
    });

    return {
      data,
      contentType: (headers["content-type"] || "image/jpeg") as string,
    };
  };

  private parseChapter(chapter: DynastyScansChapter | ChapterResponse): Chapter {
    let title = "";
    title += chapter.title;
    return {
      title,
      chapterNumber: null,
      languageKey: "multi",
      url: `/${CHAPTERS_DIR}/${chapter.permalink}`,
      lastUpdated: this.parseSeriesDate(chapter.released_on),
    };
  }

  private getDirectory(type: string): string {
    switch (type) {
      case SERIES_TYPE:
        return SERIES_DIR;
      case DOUJIN_TYPE:
        return DOUJINS_DIR;
      case ANTHOLOGY_TYPE:
        return ANTHOLOGIES_DIR;
      case ISSUE_TYPE:
        return ISSUES_DIR;
      default:
        throw new Error(`Unsupported Type for directory: ${type}`);
    }
  }

  private getType(directory: string): string {
    switch (directory) {
      case SERIES_DIR:
        return SERIES_TYPE;
      case DOUJINS_DIR:
        return DOUJIN_TYPE;
      case ANTHOLOGIES_DIR:
        return ANTHOLOGY_TYPE;
      case ISSUES_DIR:
        return ISSUE_TYPE;
      default:
        throw new Error(`Unsupported directory: ${directory}`);
    }
  }

  private parseStatus(status: Set<string>): Status {
    switch (true) {
      case status.has("Ongoing"):
        return "ongoing";
      case status.has("Completed"):
        return "completed";
      case status.has("On Hiatus"):
        return "hiatus";
      case ["Dropped", "Cancelled", "Not Updated", "Abandoned", "Removed"].some((s) =>
        status.has(s),
      ):
        return "cancelled";
      default:
        return "unknown";
    }
  }

  private async fetchTagId(query: string, type: string): Promise<number | null> {
    try {
      const url = new URL("tags/suggest", this.baseUrl);

      const formBody = new URLSearchParams();
      formBody.set("query", query);

      const { data } = await this.client.post<TagSuggest[]>(url.toString(), formBody.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        validateStatus: () => true,
      });

      return data.find((tag) => tag.type === type && tag.name === query.trim())?.id ?? null;
    } catch {
      return null;
    }
  }

  private permalinkToTitle(permalink: string): string {
    return permalink
      .split("_")
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" ");
  }

  private decodeUnicode(str: string): string {
    return str.replace(/\\u[\dA-Fa-f]{4}/g, (match) =>
      String.fromCharCode(Number.parseInt(match.replace("\\u", ""), 16)),
    );
  }

  private getChapterFetchLimit(): number {
    const limit = this.settings?.[CHAPTER_FETCH_LIMIT_PREF_KEY];

    if (limit === "all") return Number.MAX_SAFE_INTEGER;

    return this.toNumberOrNull(limit) ?? 2;
  }
}
