import {
  resolveFilterEntries,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetMangaChapters,
  type GetSeries,
  type Manga,
  type MultiSelectFilter,
  type SelectFilter,
  type TextFilter,
} from "@tsukimichi/common";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { Madara } from "@/lib/multi-src/manga/madara";
import {
  HENTAI_READ_CATEGORY_OPTIONS,
  HENTAI_READ_KEYWORD_MODE,
  HENTAI_READ_SORT_BY_OPTIONS,
} from "./filters";
import manifest from "./manifest.json";
import type { Pages, TagResults } from "./types";

export class HentaiRead extends Madara {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    let authors = $("a[href*=/circle/] span:first-of-type")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    let artists = $("a[href*=/artist/] span:first-of-type")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    if (!authors.length) authors = artists;
    if (!artists.length) artists = authors;

    const genres = $("a[href*=/tag/] span:first-of-type")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const parodies = $("a[href*=/parody/] span:first-of-type")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const characters = $("a[href*=/characters/] span:first-of-type")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const alternateTitles = $(".manga-titles h2")
      .text()
      .trim()
      .split("|")
      .map((t) => t.trim())
      .filter(Boolean);
    const scanlators = $("a[href*=/scanlator/] span:first-of-type")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const conventions = $("a[href*=/convention/] span:first-of-type")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const languages = $("a[href*=/language/] span:first-of-type")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const title = $(".manga-titles h1").text().trim();
    const coverImageUrl = this.getImageFromElement($("#mangaSummary img").first());

    const lastUpdatedText = $('div.grid > div.text-md:contains("Uploaded:") + div').text().trim();
    const lastUpdated = this.parseSeriesDate(lastUpdatedText);

    const ratingText = $(".rating__current").text().trim();
    const rating = this.toNumberOrNull(ratingText, true);

    const pages = $(".items-center > div:contains(Pages:) + div span > span").text().trim();

    let description = "";

    if (languages.length > 0) {
      description += `Languages: ${languages.join(", ")}<br><br>`;
    }

    if (characters.length > 0) {
      description += `Characters: ${characters.join(", ")}<br><br>`;
    }

    if (parodies.length > 0) {
      description += `Parodies: ${parodies.join(", ")}<br><br>`;
    }

    const circles = $("a[href*=/circle/] span:first-of-type")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join(", ");
    if (circles) {
      description += `Circles: ${circles}<br><br>`;
    }

    if (scanlators.length > 0) {
      description += `Scanlators: ${scanlators.join(", ")}<br><br>`;
    }

    if (conventions.length > 0) {
      description += `Conventions: ${conventions.join(", ")}<br><br>`;
    }

    if (pages) {
      description += `Pages: ${pages}<br>`;
    }

    return {
      id: this.slugify(title),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      url: this.setUrlWithoutDomain(query),
      isNsfw: true,
      status: "completed",
      alternateTitles,
      genres,
      artists,
      authors,
      coverImageUrl,
      description,
      rating,
      lastUpdated,
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    return [
      {
        id: this.slugify(query),
        extensionId: this.extensionMetadata.id,
        source: this.extensionMetadata.name,
        title: "Chapter",
        url: query,
        languageKey: "en",
        nextChapter: null,
        previousChapter: null,
      },
    ];
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(`${query}/english/p/1`, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const singleChapterScript = $("script#single-chapter-js-extra").text();

    const singleChapterMatch = singleChapterScript.match(/= ([^;]+)/);

    let baseImageCdnUrl: string | null = null;

    if (singleChapterMatch?.[1]) {
      const chapterData = JSON.parse(singleChapterMatch[1]);
      if (chapterData.baseUrl) {
        baseImageCdnUrl = chapterData.baseUrl;
      }
    }

    if (!baseImageCdnUrl) {
      throw new Error("Could not find base image CDN URL");
    }

    const pagesDataRegex = /.(ey\S+).\s/;
    const singleChapterBefore = $("script#single-chapter-js-before").text();
    const pagesData = singleChapterBefore.match(pagesDataRegex)?.[1];

    const imageUrls: string[] = [];

    if (pagesData) {
      const decodedPagesData = this.base64ToUtf8(pagesData);
      const parsedPagesData = JSON.parse(decodedPagesData) as Pages;

      parsedPagesData.data.chapter.images.forEach((image) => {
        imageUrls.push(image.src);
      });
    }

    return imageUrls.map((img, index) => ({
      index,
      url: new URL(img, baseImageCdnUrl).toString(),
    }));
  };

  protected override async searchMangaRequest(
    query?: string,
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    const { page = 1, filters } = options ?? {};
    const pageNumStr = Math.max(page, 1).toString();
    const url = new URL(`page/${pageNumStr}`, this.baseUrl);
    url.searchParams.set("s", query?.trim() || "");
    url.searchParams.set("post_type", "wp-manga");

    const tagsMap = new Map<string, { values: string[]; paramKey: string }>([]);
    const excludingTags: string[] = [];
    const includingTags: string[] = [];

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (typeof value === "string" && value.trim() === "any") continue;

      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value);

          break;
        case "multi-select":
          value.forEach((v) => {
            url.searchParams.append(filter.key, v);
          });

          break;
        case "text": {
          if (value?.trim()) {
            if (filter.key === "pages") {
              const { min, max } = this.parsePageRange(value);
              url.searchParams.set(filter.key, `${min}-${max}`);
            } else if (filter.key === "release") {
              const type = value.startsWith("<")
                ? "before"
                : value.startsWith(">")
                  ? "after"
                  : "in";
              const num = this.toNumberOrNull(value.replace(/[^0-9]/g, ""));
              if (num !== null) {
                url.searchParams.set("release-type", type);
                url.searchParams.set(filter.key, num?.toString() || "");
              }
            } else {
              const values = value.split(",").filter(Boolean);
              if (values.length > 0) {
                if (filter.key === "manga_tag") {
                  values.forEach((v) => {
                    const trimmed = v.trim();
                    if (trimmed.startsWith("-")) excludingTags.push(trimmed.slice(1));
                    else includingTags.push(trimmed);
                  });
                } else {
                  tagsMap.set(filter.key, { values, paramKey: `${filter.key}s[]` });
                }
              }
            }
          }
          break;
        }
        default:
          break;
      }
    }

    const tagPromises: Promise<{ paramKey: string; ids: number[] }>[] = [];

    if (includingTags.length > 0) {
      tagPromises.push(
        Promise.all(includingTags.map((tag) => this.getTagId(tag, "manga_tag"))).then((ids) => ({
          paramKey: "including[]",
          ids: ids,
        })),
      );
    }

    if (excludingTags.length > 0) {
      tagPromises.push(
        Promise.all(excludingTags.map((tag) => this.getTagId(tag, "manga_tag"))).then((ids) => ({
          paramKey: "excluding[]",
          ids,
        })),
      );
    }

    for (const [key, { values, paramKey }] of tagsMap) {
      tagPromises.push(
        Promise.all(values.map((v) => this.getTagId(v, key))).then((ids) => ({
          ids,
          paramKey,
        })),
      );
    }

    const tagResults = await Promise.all(tagPromises);

    for (const { ids, paramKey } of tagResults) {
      for (const id of ids) {
        url.searchParams.append(paramKey, id.toString());
      }
    }

    return this.client.get(url.toString(), requestConfig);
  }

  private async getTagId(tag: string, type: string): Promise<number> {
    const ajaxUrl = new URL("wp-admin/admin-ajax.php", this.baseUrl);
    ajaxUrl.searchParams.set("action", "search_manga_terms");
    ajaxUrl.searchParams.set("search", tag);
    ajaxUrl.searchParams.set("taxonomy", type.replace("artist", "manga_artist"));
    const { data } = await this.client.get<TagResults>(ajaxUrl.toString());
    const items = data.results;

    const item = items.find((i) => i.text.toLowerCase() === tag.toLowerCase());
    if (item) return item.id;

    throw new Error(`${type.charAt(0).toUpperCase() + type.slice(1)} not found: ${tag}`);
  }

  protected override async popularMangaRequest(
    options?: Record<string, any>,
  ): Promise<AxiosResponse> {
    const { page = 1 } = options ?? {};
    const pageNumStr = Math.max(page, 1).toString();
    const url = new URL(`${this.mangaSubString}/page/${pageNumStr}`, this.baseUrl);
    // url.searchParams.set("s", "");
    url.searchParams.set("sortby", "views");
    return await this.client.get(url.toString());
  }

  protected override async latestMangaRequest(
    options?: Record<string, any>,
  ): Promise<AxiosResponse> {
    const { page = 1 } = options ?? {};
    const pageNumStr = Math.max(page, 1).toString();
    const url = new URL(`${this.mangaSubString}/page/${pageNumStr}`, this.baseUrl);
    url.searchParams.set("sortby", "new");
    return await this.client.get(url.toString());
  }

  override getFilterConfig: GetFilterConfig = () => {
    return {
      filters: [
        {
          key: "sortby",
          label: "Sort By",
          options: HENTAI_READ_SORT_BY_OPTIONS,
          type: "select",

          defaultValue: "new",
        } as SelectFilter,
        {
          key: "order",
          label: "Sort Order",
          options: [
            { label: "Ascending", value: "asc" },
            { label: "Descending", value: "desc" },
          ],
          type: "select",

          defaultValue: "desc",
        } as SelectFilter,
        {
          key: "categories[]",
          label: "Categories",
          options: HENTAI_READ_CATEGORY_OPTIONS,
          type: "multi-select",
          multiple: true,
          renderAs: "select",
          defaultValue: HENTAI_READ_CATEGORY_OPTIONS.map((o) => o.value),
        } as MultiSelectFilter,
        {
          key: "title-type",
          label: "Keyword Mode",
          description:
            "Select how the keyword should match the title (anywhere, beginning, or end).",
          options: HENTAI_READ_KEYWORD_MODE,
          type: "select",

          defaultValue: "contains",
        } as SelectFilter,
        {
          key: "manga_tag",
          type: "text",
          label: "Tags",
          description: "Separated by comma. Prepend with (-) to exclude.",
          placeholder: "tag1, tag2",
          defaultValue: "",
        },
        {
          key: "artist",
          type: "text",
          label: "Artists",
          description: "Separated by comma.",
          placeholder: "artist1, artist2",
          defaultValue: "",
        },
        {
          key: "circle",
          type: "text",
          label: "Circles",
          description: "Separated by comma.",
          placeholder: "circle1, circle2",
          defaultValue: "",
        },
        {
          key: "character",
          type: "text",
          label: "Characters",
          description: "Separated by comma.",
          placeholder: "character1, character2",
          defaultValue: "",
        },
        {
          key: "release",
          type: "text",
          label: "Uploaded",
          description:
            "Filter by upload year. Enter any valid year, or use > / < to filter before or after a specific year (e.g., 2024, >2020, <2018).",
          placeholder: "2020",
          defaultValue: "",
        } as TextFilter,
        {
          key: "pages",
          type: "text",
          label: "Pages",
          description: "Pages range (e.g., 100-200, >100, <100, =100, <=50, >=80)",
          placeholder: "100-200",
          defaultValue: "",
        } as TextFilter,
      ],
    };
  };

  private parsePageRange(query: string, minPages = 1, maxPages = 9999) {
    const rangeMatch = query.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
    if (rangeMatch) {
      const min = Math.min(Math.max(Number(rangeMatch[1]), minPages), maxPages);
      const max = Math.min(Math.max(Number(rangeMatch[2]), minPages), maxPages);

      return {
        min: Math.min(min, max),
        max: Math.max(min, max),
      };
    }

    const numStr = query.match(/\d+(\.\d+)?/)?.[0];
    const num = this.toNumberOrNull(numStr) ?? -1;

    const clamp = (number = num) => Math.min(Math.max(number, minPages), maxPages);

    if (num < 0) {
      return {
        min: minPages,
        max: maxPages,
      };
    }

    const [first, second] = query;

    switch (first) {
      case "<":
        return {
          min: 1,
          max: second === "=" ? clamp() : clamp(num + 1),
        };
      case ">":
        return {
          min: clamp(second === "=" ? num : num + 1),
          max: maxPages,
        };
      case "=":
        switch (second) {
          case ">":
            return { min: clamp(num), max: maxPages };
          case "<":
            return { min: 1, max: clamp(num) };
          default:
            return { min: clamp(num), max: clamp(num) };
        }
      default:
        return {
          min: clamp(),
          max: clamp(),
        };
    }
  }

  private base64ToUtf8(base64String: string): string {
    return Buffer.from(base64String, "base64").toString("utf-8");
  }

  protected override get searchSeriesSelector(): string {
    return ".manga-grid .manga-item__wrapper";
  }
  protected override get mangaSubString(): string {
    return "hentai";
  }
}
