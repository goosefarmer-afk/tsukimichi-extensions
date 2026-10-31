import {
  resolveFilterEntries,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type GetSettingsFilters,
  type Manga,
  type Preferences,
  type SearchSeries,
  type Status,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import {
  type SearchResponse,
  type ComickChapterListResponse,
  type ComickChapterPagesResponse,
  toChapter,
  type BrowseComic,
  type PopularResponse,
} from "./dto";
import {
  ContentRatingFilter,
  DemographicsFilter,
  GenresFilter,
  SortFilter,
  StatusFilter,
} from "./filters";
import manifest from "./manifest.json";

export class ComickArt extends BaseMangaScraper {
  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();
  }

  private latestNextCursor: string | null = null;
  private searchNextCursor: string | null = null;

  override async init(): Promise<void> {
    await super.init();

    const mirror = await this.$preferences.getString(
      this.PREF_MIRROR_KEY,
      this.PREF_MIRROR_DEFAULT,
    );
    if (this.MIRRORS.includes(mirror)) this.baseUrl = mirror;
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    if (page === 1) this.searchNextCursor = null;

    const url = new URL("api/search", this.baseUrl);
    if (page > 1 && this.searchNextCursor) url.searchParams.set("cursor", this.searchNextCursor);

    if (query?.trim()) {
      url.searchParams.set("q", query.trim());
    }

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "text":
          if (value.trim()) {
            url.searchParams.set(filter.key, value);
          }
          break;

        case "sort": {
          const keys = filter.key.split("|");
          if (keys.length !== 2) continue;
          url.searchParams.set(keys[0]!, value.value);
          url.searchParams.set(keys[1]!, value.direction === "ascending" ? "asc" : "desc");
          break;
        }

        case "select":
          url.searchParams.set(filter.key, value);
          break;
        case "multi-select":
          if (value.length) {
            value.forEach((v) => {
              url.searchParams.append(filter.key, v);
            });
          }
          break;
        default:
          break;
      }
    }

    const { data: json } = await this.fetchWithRetry<SearchResponse>(url.toString());

    const result = json.data.map((comic) => this.browseComicToManga(comic));

    const hasMore = json.next_cursor != null;

    this.searchNextCursor = json.next_cursor || null;

    return {
      data: result,
      hasMore,
    };
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(`comic/${query}`, this.baseUrl);

    const { data: html } = await this.client.get(url.toString());

    const $ = cheerio.load(html);
    const $container = $('div[x-init="loadData()"]').first();

    if ($container.length === 0) throw new Error("Series not found");

    const title = $container.find("h1").first().text().trim();
    const coverImageUrl = $container.find("div.relative > a > img").attr("src") || null;
    const alternateTitles = $container
      .find("div.overflow-auto[style]")
      .first()
      .text()
      .trim()
      .split("•")
      .map((t) => t.trim())
      .filter(Boolean);

    const statusText = $container.find('div > span:contains("Status:")').next("span").text().trim();

    let description = $container.find('div > h3:contains("Description")').next("div").text().trim();

    const $moreInfo = $container.find("table").first();

    const artists = $moreInfo
      .find('td:contains("Artists:")')
      .next("td")
      .find("a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const authors = $moreInfo
      .find('td:contains("Authors:")')
      .next("td")
      .find("a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const genres = $moreInfo
      .find('td:contains("Genres:")')
      .next("td")
      .find("a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const themes = $moreInfo
      .find('td:contains("Theme:")')
      .next("td")
      .find("a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const formats = $moreInfo
      .find('td:contains("Format:")')
      .next("td")
      .find("a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const publishers = $moreInfo
      .find('td:contains("Publishers:")')
      .next("td")
      .find("a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    if (description.trim()) {
      description += "<br><br>";
    }

    if (themes.length > 0) {
      description += "Theme:<br>";

      for (const theme of themes) {
        description += `•${theme}<br>`;
      }
      description += "<br>";
    }

    if (formats.length > 0) {
      description += "Format:<br>";

      for (const format of formats) {
        description += `•${format}<br>`;
      }

      description += "<br>";
    }

    if (publishers.length > 0) {
      description += "Publisher:<br>";

      for (const publisher of publishers) {
        description += `•${publisher}<br>`;
      }

      description += "<br>";
    }

    return {
      id: this.slugify(title),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      coverImageUrl,
      url: query,
      isNsfw: null,
      alternateTitles,
      status: this.parseSeriesDetailsStatus(statusText),
      description,
      artists,
      authors,
      genres,
    };
  };

  private async getLanguageList() {
    try {
      const languageList = JSON.parse(
        await this.$preferences.getString(this.PREF_LANGUAGE_LIST_KEY, "[]"),
      );

      if (Array.isArray(languageList)) {
        const filteredList = languageList.filter(Boolean);
        return filteredList.length > 0 ? filteredList : ["en"];
      }

      return ["en"];
    } catch {
      return ["en"];
    }
  }

  override getChapters: GetMangaChapters = async (query) => {
    const languageList = await this.getLanguageList();
    const dedupeSameLangChapters = await this.$preferences.getBoolean(
      this.PREF_DEDUPE_SAME_LANG_CHAPTERS_KEY,
      true,
    );

    const parseDate = this.parseSeriesDate.bind(this);
    const languages = languageList.length > 0 ? languageList : [undefined];

    const fetchLanguageChapters = async (language?: string) => {
      const createChapterListUrl = (page: number) => {
        const url = new URL(`api/comics/${query}/chapter-list`, this.baseUrl);

        url.searchParams.set("page", page.toString());
        url.searchParams.set("chapOrder", "asc");

        if (language) {
          url.searchParams.set("lang", language);
        }

        return url.toString();
      };

      const { data: firstResponse } = await this.fetchWithRetry<ComickChapterListResponse>(
        createChapterListUrl(1),
      );

      if (!firstResponse?.data?.length) {
        return [];
      }

      const lastPage = firstResponse.pagination?.last_page ?? 1;

      const allResponses = await Promise.all(
        Array.from({ length: Math.max(0, lastPage - 1) }, (_, i) =>
          this.fetchWithRetry<ComickChapterListResponse>(createChapterListUrl(i + 2)),
        ),
      );

      return [...firstResponse.data, ...allResponses.flatMap((res) => res.data?.data ?? [])];
    };

    const allChapters = (await Promise.all(languages.map(fetchLanguageChapters))).flat();

    const chapters = allChapters.map((chapter) =>
      toChapter({
        chapter,
        parseDate,
        seriesSlug: query,
        toNumberOrNull: this.toNumberOrNull,
      }),
    );

    const dedupedChapters = dedupeSameLangChapters
      ? (() => {
          const seen = new Set<string>();

          return chapters.filter((chapter) => {
            // Keep chapters that don't have enough information to deduplicate.
            if (chapter.chapterNumber == null || !chapter.languageKey) {
              return true;
            }

            const key = `${chapter.chapterNumber}:${chapter.languageKey}`;

            if (seen.has(key)) {
              return false;
            }

            seen.add(key);
            return true;
          });
        })()
      : chapters;

    return dedupedChapters.toSorted((a, b) => {
      const aNum = a.chapterNumber ?? Number.POSITIVE_INFINITY;
      const bNum = b.chapterNumber ?? Number.POSITIVE_INFINITY;

      return aNum - bNum;
    });
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(`api/comics/${query}`, this.baseUrl);

    const { data } = await this.fetchWithRetry<ComickChapterPagesResponse>(url.toString());

    return data.chapter.images.map((img, index) => ({
      url: img.url,
      index,
    }));
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("api/comics/top", this.baseUrl);

    let days: number;
    switch (page) {
      case 1:
      case 4:
        days = 7;
        break;
      case 2:
      case 5:
        days = 30;
        break;
      case 3:
      case 6:
        days = 90;
        break;
      default:
        throw new Error("Unsupported page");
    }

    let type: string;
    switch (page) {
      case 1:
      case 2:
      case 3:
        type = "follow";
        break;
      case 4:
      case 5:
      case 6:
        type = "most_follow_new";
        break;
      default:
        throw new Error("Unsupported page");
    }

    url.searchParams.set("day", days.toString());
    url.searchParams.set("type", type);

    const { data: json } = await this.fetchWithRetry<PopularResponse>(url.toString());

    if (!json?.data?.length) {
      return this.emptyListResponse();
    }

    const result = json.data.map((comic) => this.browseComicToManga(comic));
    const hasMore = page < 6;

    return {
      data: result,
      hasMore,
    };
  };

  private browseComicToManga(comic: BrowseComic): Manga {
    return {
      title: comic.title,
      coverImageUrl: comic.default_thumbnail || null,
      isNsfw: null,
      status: "unknown",
      url: comic.slug,
    };
  }

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    if (page === 1) this.latestNextCursor = null;

    const url = new URL("api/chapters/latest", this.baseUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("order", "new");
    if (page > 1 && this.latestNextCursor) {
      url.searchParams.set("cursor", this.latestNextCursor);
    }

    const { data: json } = await this.fetchWithRetry<SearchResponse>(url.toString());

    if (!json?.data?.length) {
      return this.emptyListResponse();
    }

    const result = json.data.map((comic) => this.browseComicToManga(comic));

    this.latestNextCursor = json.next_cursor || null;

    const hasMore = json.next_cursor != null;

    return {
      data: result,
      hasMore,
    };
  };

  override getFilterConfig: GetFilterConfig = () => {
    return {
      // TODO: Add few more filters
      filters: [StatusFilter, SortFilter, DemographicsFilter, ContentRatingFilter, GenresFilter],
    };
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_MIRROR_KEY,
      label: "Preferred Mirror",
      options: this.MIRRORS.map((m) => ({
        label: new URL(m).hostname,
        value: m,
      })),
      type: "select",
      defaultValue: this.PREF_MIRROR_DEFAULT,
    },
    {
      key: this.PREF_LANGUAGE_LIST_KEY,
      label: "Chapter Languages",
      description: "Leave empty for all languages",
      options: this.LANGUAGE_OPTIONS,
      type: "multi-select",
      defaultValue: ["en"],
    },
    {
      key: this.PREF_DEDUPE_SAME_LANG_CHAPTERS_KEY,
      label: "Hide Duplicate Chapters",
      description: "When multiple chapters have the same number and language, keep only one.",
      type: "toggle",
      defaultValue: true,
    },
  ];

  private parseSeriesDetailsStatus(input: string | null): Status {
    const parsed = input?.trim().toLowerCase();
    switch (true) {
      case parsed?.includes("ongoing"):
        return "ongoing";
      case parsed?.includes("completed"):
        return "completed";
      case parsed?.includes("cancelled") || parsed?.includes("canceled"):
        return "cancelled";
      case parsed?.includes("hiatus"):
        return "hiatus";
      default:
        return "unknown";
    }
  }

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input) {
      case "1":
        return "ongoing";
      case "2":
        return "completed";
      case "3":
        return "cancelled";
      case "4":
        return "hiatus";
      default:
        return "unknown";
    }
  };

  private readonly PREF_MIRROR_KEY = "pref_mirror";
  private readonly MIRRORS = ["https://comick.art", "https://comick.live"];
  private readonly PREF_MIRROR_DEFAULT = this.MIRRORS[0]!;

  private readonly PREF_LANGUAGE_LIST_KEY = "pref_language_list";
  private readonly PREF_DEDUPE_SAME_LANG_CHAPTERS_KEY = "pref_dedupe_same_lang_chapters";

  private LANGUAGE_OPTIONS = [
    { label: "English", value: "en" },
    { label: "French", value: "fr" },
    { label: "German", value: "de" },
    { label: "Indonesian", value: "id" },
    { label: "Italian", value: "it" },
    { label: "Japanese", value: "ja" },
    { label: "Korean", value: "ko" },
    { label: "Malay", value: "ms" },
    { label: "Norwegian", value: "no" },
    { label: "Polish", value: "pl" },
    { label: "Romanian", value: "ro" },
    { label: "Russian", value: "ru" },
    { label: "Spanish", value: "es" },
    { label: "Swedish", value: "sv" },
    { label: "Thai", value: "th" },
    { label: "Turkish", value: "tr" },
    { label: "Ukrainian", value: "uk" },
    { label: "Vietnamese", value: "vi" },
  ];
}
