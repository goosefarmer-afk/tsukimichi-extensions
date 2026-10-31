import { app } from "electron";
import {
  resolveFilterEntries,
  type Chapter,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type GetSettingsFilters,
  type Manga,
  type MultiSelectFilter,
  type SearchSeries,
  type SelectFilter,
  type SeriesListResponse,
  type SortDirection,
  type SortFilterValue,
} from "@tsukimichi/common";

import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import { getLanguageKey } from "@/utils/language";
import {
  MANGA_DEX_CONTENT_RATINGS,
  MANGA_DEX_DEMOGRAPHICS,
  MANGA_DEX_FORMATS,
  MANGA_DEX_GENRES,
  MANGA_DEX_SORT_BY_OPTIONS,
  MANGA_DEX_STATUSES,
  MANGA_DEX_TAG_SEARCH_OPTIONS,
  MANGA_DEX_THEMES,
} from "./filters";
import type {
  MangaDexChapterResponse,
  MangaDexChaptersResponse,
  MangaDexListingResponse,
  MangaDexSeries,
  MangaDexSeriesResponse,
} from "./manga-dex-dto";
import manifest from "./manifest.json";
import { ErrorNormalizer } from "@/lib/network/interceptors/error-normalizer";
import { RateLimiter } from "@/lib/network/interceptors/rate-limiter";
import { seconds } from "@/lib/network/network-helper";
import { substringAfterLast } from "@/utils/string";

export class MangaDex extends BaseMangaScraper {
  private rateLimiter = new RateLimiter({
    maxRequests: 3,
    perMilliseconds: seconds(1),
  });

  constructor(options?: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.client = this.network
      .newBuilder()
      .addInterceptor(this.rateLimiter)
      .addInterceptor(new ErrorNormalizer())
      .build();

    this.client.defaults.headers.common["Referer"] = `${this.baseUrl}/`;
    this.client.defaults.headers.common["Origin"] = this.baseUrl;

    const extra = `Electron/${process.env.ELECTRON_VERSION ?? "38.8.6"} Tsukimichi/${app.getVersion()} MangaDex/1.0.0`;

    // `userAgentFallback` is usually same as default ua unless changed in the app
    this.client.defaults.headers.common["User-Agent"] = app.userAgentFallback;
    this.client.defaults.headers.common["Extra"] = extra;
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};
    const url = new URL("manga", this.API_URL);

    url.searchParams.append("includes[]", "cover_art");

    if (query?.trim()) {
      if (query.startsWith(this.PREFIX_ID_SEARCH)) {
        const mangaId = query.slice(this.PREFIX_ID_SEARCH.length);
        if (!this.containsUuid(mangaId)) {
          throw new Error("Invalid manga id");
        }
        url.pathname = "manga";
        url.searchParams.set("ids[]", mangaId);
        MANGA_DEX_CONTENT_RATINGS.forEach((r) => {
          url.searchParams.append(this.CONTENT_RATINGS_KEY, r.value);
        });

        const { data } = await this.fetchWithRetry<MangaDexListingResponse>(url.toString(), {
          options: {
            config: {
              responseType: "json",
            },
          },
        });
        return this.parseSearchResults(data);
      }
      url.searchParams.set("title", query);
    }
    url.searchParams.set("offset", ((page - 1) * this.MANGA_LIMIT).toString());
    url.searchParams.set("limit", this.MANGA_LIMIT.toString());

    const sortMap: Record<SortDirection, string> = {
      ascending: "asc",
      descending: "desc",
    };

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          if (value !== "any") {
            url.searchParams.set(filter.key, value);
          }
          break;
        case "sort":
          if (filter.key === "order") {
            const val = value as SortFilterValue;
            url.searchParams.set(
              `${filter.key}[${val.value}]`,
              sortMap[val.direction || "descending"],
            );
          }
          break;
        case "multi-select":
          value.forEach((v) => {
            if (v !== "any") {
              url.searchParams.append(filter.key, v?.toString());
            }
          });

          break;
        default:
          break;
      }
    }

    const { data } = await this.fetchWithRetry<MangaDexListingResponse>(url.toString(), {
      options: {
        config: {
          responseType: "json",
        },
      },
    });
    return this.parseSearchResults(data);
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const url = new URL("manga", this.API_URL);
    const searchParams = this.buildSearchListingParams("popular", options);
    const finalUrl = `${url.toString()}?${searchParams.toString()}`;

    const { data } = await this.fetchWithRetry<MangaDexListingResponse>(finalUrl, {
      options: {
        config: {
          responseType: "json",
        },
      },
    });
    return this.parseSearchResults(data);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const url = new URL("manga", this.API_URL);
    const searchParams = this.buildSearchListingParams("latest", options);
    const finalUrl = `${url.toString()}?${searchParams.toString()}`;

    const { data } = await this.fetchWithRetry<MangaDexListingResponse>(finalUrl, {
      options: {
        config: {
          responseType: "json",
        },
      },
    });
    return this.parseSearchResults(data);
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.API_URL);
    ["artist", "author", "cover_art"].forEach((name) => {
      url.searchParams.append("includes[]", name);
    });

    const { data: result } = await this.fetchWithRetry<MangaDexSeriesResponse>(url.toString(), {
      options: {
        config: {
          responseType: "json",
        },
      },
    });
    if (!("data" in result) || result.data == null) {
      throw new Error("Manga not found");
    }
    return this.parseManga(result.data);
  };

  private parseManga(item: MangaDexSeries): Manga {
    const titleLang = this.preferences.getTitleLang();

    const titles = item.attributes.title ?? {};
    const altTitles = item.attributes.altTitles ?? [];

    let title: string | undefined;

    if (titleLang === "romaji") {
      title = titles["ja-ro"] ?? this.getTitleFromAltTitles("ja-ro", altTitles);
    } else {
      title = titles["en"] ?? this.getTitleFromAltTitles("en", altTitles);
    }

    if (!title) {
      title = Object.values(titles)[0] as string;
    }

    const alternateTitles = item?.attributes?.altTitles?.flatMap((t) => Object.values(t));

    const description = item?.attributes?.description?.en;

    const coverRelationship = item.relationships.find(
      (r) => r.type === "cover_art" && r.attributes !== undefined,
    );
    const coverImageUrl = coverRelationship
      ? `https://uploads.mangadex.org/covers/${item.id}/${coverRelationship.attributes?.fileName}`
      : null;

    const authors = item.relationships
      .filter(
        (relationship) => relationship.type === "author" && relationship.attributes !== undefined,
      )
      .map((relationship) => relationship.attributes.name);

    const artists = item.relationships
      .filter(
        (relationship) => relationship.type === "artist" && relationship.attributes !== undefined,
      )
      .map((relationship) => relationship.attributes.name);

    const tags = item.attributes.tags
      .filter((tag) => tag?.attributes?.group !== "genre")
      .map((tag) => tag.attributes.name.en)
      .filter(Boolean) as string[];

    const genres = item.attributes.tags
      .filter((tag) => tag?.attributes?.group === "genre")
      .map((tag) => tag?.attributes?.name?.en)
      .filter(Boolean) as string[];

    return {
      title,
      alternateTitles,
      description,
      tags,
      genres,
      coverImageUrl,
      isNsfw:
        item.attributes?.contentRating === "erotica" ||
        item.attributes?.contentRating === "pornographic",
      status: this.getSeriesStatus(item.attributes.status),
      url: `/manga/${item.id}`,
      lastUpdated: this.parseSeriesDate(item.attributes.updatedAt),
      authors,
      artists,
    };
  }

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(`${query}/feed`, this.API_URL);
    url.searchParams.set("includes[]", "scanlation_group");
    url.searchParams.set("includes[]", "user");
    url.searchParams.set("limit", "500");
    MANGA_DEX_CONTENT_RATINGS.forEach((r) => {
      url.searchParams.append("contentRating[]", r.value.toString());
    });
    ["order[chapter]", "order[volume]"].forEach((item) => {
      url.searchParams.append(item, "asc");
    });
    url.searchParams.set("includeFuturePublishAt", "0");
    url.searchParams.set("includeEmptyPages", "0");

    const chaptersList: Chapter[] = [];

    let offset = 0;
    let foundAllChapters = false;

    while (!foundAllChapters) {
      url.searchParams.set("offset", offset.toString());
      const { data: json } = await this.fetchWithRetry<MangaDexChaptersResponse>(url.toString());

      if (!("data" in json) || json.data == null) return [];

      for (const chapter of json.data) {
        const attr = chapter.attributes;
        if (attr?.isUnavailable || attr?.externalUrl) continue;

        const groups = chapter.relationships
          .filter((relationship) => relationship.type === "scanlation_group")
          .filter((r) => r.id !== this.LEGACY_NO_GROUP_ID)
          .map((r) => r.attributes?.name)
          .filter(Boolean)!;

        if (groups.length === 0) {
          const users = chapter.relationships
            .filter((relationship) => relationship.type === "user")
            .map((r) => r.attributes?.username)
            .filter(Boolean)!;
          groups.push(...users);
        }

        let chapterName: string = "";
        if (attr.volume?.trim()) chapterName = `Volume ${attr.volume}`;
        if (attr.chapter?.trim()) chapterName = `Chapter ${attr.chapter}`;
        if (attr.title?.trim()) {
          if (chapterName.length > 0) chapterName += `: `;
          chapterName += attr.title;
        }

        // If volume, chapter and title are empty, default to "Oneshot"
        if (!chapterName.trim()) chapterName = "Oneshot";

        let language = attr.translatedLanguage;
        if (language === "es-la")
          language = "es-419"; // Latin American Spanish
        else if (language === "pt-br")
          language = "pt-BR"; // Brazilian Portuguese
        else if (language === "tl")
          language = "fil"; // Tagalog -> Filipino
        else if (language === "zh")
          language = "zh-Hans"; // Simplified Chinese
        else if (language === "zh-hk") language = "zh-Hant"; // Traditional Chinese

        const languageKey = getLanguageKey(language || "multi");

        chaptersList.push({
          title: chapterName,
          chapterNumber: this.toNumberOrNull(attr.chapter, true),
          volumeNumber: this.toNumberOrNull(attr.volume),
          languageKey,
          url: `/chapter/${chapter.id}`,
          groupName: groups.join(" & "),
          lastUpdated: attr.updatedAt ? this.parseSeriesDate(attr.updatedAt) : null,
        });
      }

      if (json.total > offset + 500) {
        offset += 500;
      } else {
        foundAllChapters = true;
      }
    }

    return chaptersList;
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(`at-home/server/${substringAfterLast(query, "/")}`, this.API_URL);

    const { data: imagesJson } = await this.fetchWithRetry<MangaDexChapterResponse>(url.toString());

    if (!("chapter" in imagesJson)) return [];

    const imageUrls: string[] = [];

    if (this.preferences.useLowQualityPageImage()) {
      imagesJson.chapter.dataSaver?.forEach((item) => {
        imageUrls.push(`${imagesJson.baseUrl}/data-saver/${imagesJson.chapter.hash}/${item}`);
      });
    } else {
      imagesJson.chapter.data?.forEach((item) => {
        imageUrls.push(`${imagesJson.baseUrl}/data/${imagesJson.chapter.hash}/${item}`);
      });
    }

    if (!imageUrls.length) {
      throw new Error("No images found for this chapter");
    }

    return imageUrls.map((url, index) => ({
      url,
      index,
    }));
  };

  override getFilterConfig: GetFilterConfig = () => {
    return {
      header: `Tip: You can use "${this.PREFIX_ID_SEARCH}<uuid>" to search for a specific series`,
      filters: [
        {
          key: "status[]",
          label: "Status",
          multiple: true,
          options: MANGA_DEX_STATUSES,
          type: "multi-select",
          renderAs: "select",
        } as MultiSelectFilter,
        {
          key: this.CONTENT_RATINGS_KEY,
          label: "Content Rating",
          multiple: true,
          options: MANGA_DEX_CONTENT_RATINGS,
          type: "multi-select",
          renderAs: "select",
          defaultValue: MANGA_DEX_CONTENT_RATINGS.slice(0, 2).map((option) => option.value),
        } as MultiSelectFilter,
        {
          key: "publicationDemographic[]",
          label: "Demographics",
          multiple: true,
          options: MANGA_DEX_DEMOGRAPHICS,
          type: "multi-select",
          renderAs: "select",
        } as MultiSelectFilter,
        {
          key: "order",
          label: "Sort By",
          options: MANGA_DEX_SORT_BY_OPTIONS,
          type: "sort",
          defaultValue: "relevance",
          defaultDirection: "descending",
        },
        {
          key: "includedTagsMode",
          label: "Tag Search Mode",
          options: MANGA_DEX_TAG_SEARCH_OPTIONS,
          type: "select",
          defaultValue: MANGA_DEX_TAG_SEARCH_OPTIONS[0]?.value,
        } as SelectFilter,
        {
          key: "includedTags[]",
          label: "Genres",
          options: MANGA_DEX_GENRES,
          type: "multi-select",
          renderAs: "checkbox-group",
        } as MultiSelectFilter,
        {
          key: "includedTags[]",
          label: "Themes",
          options: MANGA_DEX_THEMES,
          type: "multi-select",
          renderAs: "checkbox-group",
        } as MultiSelectFilter,
        {
          key: "includedTags[]",
          label: "Formats",
          options: MANGA_DEX_FORMATS,
          type: "multi-select",
          renderAs: "checkbox-group",
        } as MultiSelectFilter,
      ],
    };
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_TITLE_LANG_KEY,
      label: "Preferred Title Language",
      type: "select",
      defaultValue: "english",
      options: this.PREF_TITLE_LANG_OPTIONS,
      description: "Preferred language to use for the title. English by default.",
    },
    {
      key: this.PREF_CONTENT_RATING_KEY,
      label: "Content Ratings",
      defaultValue: MANGA_DEX_CONTENT_RATINGS.slice(0, 2).map((r) => r.value),
      options: MANGA_DEX_CONTENT_RATINGS,
      type: "multi-select",
    },
    {
      key: this.PREF_USE_LOW_QUALITY_PAGE_IMAGE_KEY,
      label: "Use Low Quality Page Image",
      type: "toggle",
      defaultValue: false,
      description:
        "Enable this for faster chapter image loading, but may result in lower quality images",
    },
  ];

  private buildSearchListingParams(
    type: "popular" | "latest",
    options?: Parameters<SearchSeries<Manga>>[1],
  ): URLSearchParams {
    const { page = 1 } = options ?? {};
    const searchParams = new URLSearchParams();
    searchParams.set("offset", ((page - 1) * this.MANGA_LIMIT).toString());
    searchParams.set("limit", this.MANGA_LIMIT.toString());
    searchParams.append("includes[]", "cover_art");

    searchParams.set(
      `order[${type === "popular" ? "followedCount" : "latestUploadedChapter"}]`,
      "desc",
    );

    this.preferences.contentRatings().forEach((r) => {
      searchParams.append("contentRating[]", r);
    });

    return searchParams;
  }

  private getTitleFromAltTitles(lang: string, altTitles: Array<{ [key: string]: string }> = []) {
    return altTitles?.find((t) => t[lang])?.[lang];
  }

  private parseSearchResults(json: MangaDexListingResponse): SeriesListResponse<Manga> {
    if (!("data" in json) || json.data == null || !json.data.length) {
      return this.emptyListResponse();
    }

    const mangaList: Manga[] = json.data.map((item: any) => this.parseManga(item));

    const hasMore = json.total > json.offset + mangaList.length;

    return {
      data: mangaList,
      hasMore,
    };
  }

  private containsUuid(id: string): boolean {
    return /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/.test(id);
  }

  private preferences = {
    getTitleLang: (): string => {
      const pref = this.settings?.[this.PREF_TITLE_LANG_KEY];
      if (pref && this.PREF_TITLE_LANG_OPTIONS.map((o) => o.value).includes(pref)) return pref;
      return this.PREF_TITLE_LANG_OPTIONS[0]!.value;
    },
    contentRatings: (): string[] => {
      const defaults = MANGA_DEX_CONTENT_RATINGS.map((r) => r.value);
      const pref = this.settings?.[this.PREF_CONTENT_RATING_KEY];
      if (!Array.isArray(pref) || pref.length === 0) return defaults;
      const filtered = defaults.filter((r) => pref?.includes(r));
      return filtered.length ? filtered : defaults;
    },
    useLowQualityPageImage: (): boolean => {
      const pref = this.settings?.[this.PREF_USE_LOW_QUALITY_PAGE_IMAGE_KEY];
      return typeof pref === "boolean" ? pref : false;
    },
  };

  private readonly CONTENT_RATINGS_KEY = "contentRating[]";

  private readonly PREF_TITLE_LANG_KEY = "pref_title_lang";
  private PREF_TITLE_LANG_OPTIONS = [
    {
      label: "English",
      value: "english",
    },
    {
      label: "Romaji",
      value: "romaji",
    },
  ];

  private readonly PREF_CONTENT_RATING_KEY = "pref_content_rating";
  private readonly PREF_USE_LOW_QUALITY_PAGE_IMAGE_KEY = "pref_use_low_quality_page_image";

  private readonly MANGA_LIMIT = 20;
  private readonly LATEST_CHAPTER_LIMIT = 100;

  private readonly LEGACY_NO_GROUP_ID = "00e03853-1b96-4f41-9542-c71b8692033b";

  private readonly CDN_URL = "https://uploads.mangadex.org";
  private readonly API_URL = "https://api.mangadex.org";

  private readonly PREFIX_ID_SEARCH = "id:";
}
