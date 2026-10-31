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
  type GetSeriesStatus,
  type GetSettingsFilters,
  type Manga,
  type Preferences,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import type { AxiosInstance } from "axios";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import type {
  ApiResponse,
  BrowseManga,
  MangaFireChapter,
  MangaFireVolume,
  MangaDetailsResponse,
  TagResponse,
  PagesResponse,
} from "./dto";
import {
  MANGA_FIRE_CONTENT_RATING_OPTIONS,
  MANGA_FIRE_GENRE_OPTIONS,
  MANGA_FIRE_SERIES_TYPE,
  MANGA_FIRE_SORT_OPTIONS,
  MANGA_FIRE_STATUS_OPTIONS,
} from "./filters";
import manifest from "./manifest.json";
import { ImageInterceptor } from "./image-interceptor";
import { ErrorNormalizer } from "@/lib/network/interceptors/error-normalizer";
import { RateLimiter } from "@/lib/network/interceptors/rate-limiter";
import { seconds } from "@/lib/network/network-helper";
import { VrfSignerInterceptor } from "./vrf-signer";
import { substringAfterLast, substringBefore } from "@/utils/string";
import { getLanguageKey } from "@/utils/language";
import { CloudflareInterceptor } from "@/lib/cloudflare-interceptor";

export class MangaFire extends BaseMangaScraper {
  private authorIdCache = new Map<string, string>();

  private imageClient: AxiosInstance;

  private rateLimiter = new RateLimiter({
    maxRequests: 2,
    perMilliseconds: seconds(2),
  });

  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();

    this.client = this.network
      .newBuilder()
      .addInterceptor(this.rateLimiter)
      .addInterceptor(new VrfSignerInterceptor())
      .addInterceptor(
        new CloudflareInterceptor(this.network.nonCloudflareClient, {
          extensionId: this.extensionMetadata.id,
        }),
      )
      .addInterceptor(new ErrorNormalizer())
      .build();

    this.imageClient = this.network
      .newBuilder()
      .addInterceptor(new ImageInterceptor())
      .addInterceptor(new ErrorNormalizer())
      .build();
  }

  private async getContentRatings() {
    try {
      const pref = JSON.parse(
        await this.$preferences.getString(
          this.PREF_CONTENT_RATING_KEY,
          JSON.stringify(this.CONTENT_RATINGS),
        ),
      );
      if (!Array.isArray(pref) || pref.length === 0) return this.CONTENT_RATINGS;
      const filtered = this.CONTENT_RATINGS.filter((r) => pref?.includes(r));
      return filtered.length ? filtered : this.CONTENT_RATINGS;
    } catch {
      return this.CONTENT_RATINGS;
    }
  }
  private async preferVolumes() {
    return await this.$preferences.getBoolean(this.PREF_VOLUME_KEY, false);
  }

  private async mergeDuplicateChapters() {
    return await this.$preferences.getBoolean(this.PREF_MERGE_DUPLICATE_CHAPTERS_KEY, true);
  }
  private async preferOfficialChapters() {
    return await this.$preferences.getBoolean(this.PREF_OFFICIAL_CHAPTERS_KEY, true);
  }

  private async preferredLanguage() {
    const defaultLang = this.LANGUAGE_OPTIONS[0]!.value;
    const pref = await this.$preferences.getString(this.PREF_LANGUAGE_KEY, defaultLang);
    if (pref && this.LANGUAGE_OPTIONS.map((o) => o.value).includes(pref)) return pref;
    return defaultLang;
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    const url = new URL("api/titles", this.baseUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("limit", "50");

    if (query?.trim()) url.searchParams.set("keyword", query.trim());

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "multi-select":
          if (Array.isArray(value) && value.length) {
            value.forEach((v) => {
              url.searchParams.append(filter.key, v);
            });
          }
          break;

        case "tri-state-checkbox":
          if (filter.key === "genres" && Array.isArray(value) && value.length) {
            value.forEach((v) => {
              if (v.state === "include") {
                url.searchParams.append("genres_in[]", v.value);
              } else if (v.state === "exclude") {
                url.searchParams.append("genres_ex[]", v.value);
              }
            });
          }
          break;

        case "select":
          if (filter.key === "sort") {
            const parts = (value as string).split(":");
            url.searchParams.set(`order[${parts[0]}]`, parts[1]!);
          }
          break;

        case "text":
          if (filter.key !== "author") {
            const num = this.toNumberOrNull(value);
            if (num !== null) url.searchParams.set(filter.key, num.toString());
          } else if (filter.key === "author" && typeof value === "string" && value.trim()) {
            const cached = this.authorIdCache.get(value as string);
            if (cached) url.searchParams.set(filter.key, cached);
            else {
              try {
                const tagUrl = `${this.baseUrl}/api/tags?keyword=${value.trim()}`;
                const { data: tags } = await this.client.get<TagResponse>(tagUrl);
                const tag = tags.data?.[0];
                if (tag?.type === "author" || tag?.type === "artist") {
                  this.authorIdCache.set(value, tag.id.toString());
                  url.searchParams.set(filter.key, tag.id.toString());
                }
              } catch {}

              if (!this.authorIdCache.has(value)) {
                return this.emptyListResponse();
              }
            }
          }
          break;

        default:
          break;
      }
    }

    const { data } = await this.client.get<ApiResponse<BrowseManga>>(url.toString());
    return this.parseMangaList(data);
  };

  private async addContentRatingToUrl(url: URL): Promise<URL> {
    const ratings = await this.getContentRatings();
    for (const rating of ratings) {
      url.searchParams.append("content_rating[]", rating);
    }

    return url;
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};
    let url = new URL("/api/titles", this.baseUrl);
    url.searchParams.set("order[views_30d]", "desc");
    url.searchParams.set("page", page.toString());
    url.searchParams.set("limit", "50");
    url = await this.addContentRatingToUrl(url);
    const { data } = await this.client.get<ApiResponse<BrowseManga>>(url.toString());

    return this.parseMangaList(data);
  };

  private parseMangaList(data: ApiResponse<BrowseManga>): SeriesListResponse<Manga> {
    const result: Manga[] = [];
    for (const item of data.items) {
      result.push({
        title: item.title,
        url: `/title/${item.hid}${item.slug ? `-${item.slug}` : ""}`,
        isNsfw: null,
        coverImageUrl: item.poster?.large || item.poster?.medium || item.poster?.small || null,
        status: "unknown",
      });
    }

    const hasMore = data.meta?.hasNext ?? false;

    return {
      data: result,
      hasMore,
    };
  }

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};
    let url = new URL("/api/titles", this.baseUrl);
    url.searchParams.set("order[chapter_updated_at]", "desc");
    url.searchParams.set("page", page.toString());
    url.searchParams.set("limit", "50");
    url = await this.addContentRatingToUrl(url);

    const { data } = await this.client.get<ApiResponse<BrowseManga>>(url.toString());

    return this.parseMangaList(data);
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const hid = this.getHid(query);
    const url = new URL(`api/titles/${hid}`, this.baseUrl);

    const { data: result } = await this.client.get<MangaDetailsResponse>(url.toString());
    const details = result.data;

    const genres: string[] = [];
    if (details.type) genres.push(details.type.toUpperCase());

    if (details.genres) {
      details.genres.forEach((g) => {
        genres.push(g.title);
      });
    }
    if (details.themes) {
      details.themes.forEach((t) => {
        genres.push(t.title);
      });
    }

    return {
      id: details.hid,
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title: details.title,
      url: `/title/${details.hid}${details.slug ? `-${details.slug}` : ""}`,
      coverImageUrl:
        details.poster?.large || details.poster?.medium || details.poster?.small || null,
      genres: genres.filter(Boolean),
      status: this.getSeriesStatus(details.status),
      isNsfw: ["erotica", "pornographic"].includes(details.contentRating?.toLowerCase() || ""),
      authors: details.authors?.map((a) => a.title).filter(Boolean) ?? [],
      artists: details.artists?.map((a) => a.title).filter(Boolean) ?? [],
      alternateTitles: details.altTitles?.map((t) => t.trim()).filter(Boolean) ?? [],
      description: details.synopsisHtml,
      rating: details.rating,
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    const hid = this.getHid(query);
    const preferVolumes = await this.preferVolumes();
    const langCode = await this.preferredLanguage();

    if (preferVolumes) {
      const volumes = await this.tryFetchVolumes(hid, query, langCode);
      if (volumes.length > 0) return volumes;
      // Fall back to chapters
    }

    let chapters = await this.fetchAllChapters(hid, query, langCode);

    const prefOfficials = await this.preferOfficialChapters();

    if (await this.mergeDuplicateChapters()) {
      chapters = this.mergeAndSortChapters(chapters, prefOfficials);
    }

    return chapters;
  };

  private async fetchAllChapters(
    hid: string,
    mangaUrl: string,
    langCode: string,
  ): Promise<Chapter[]> {
    const baseUrl = new URL(`api/titles/${hid}/chapters`, this.baseUrl);

    const params = {
      sort: "number",
      order: "asc",
      limit: "200",
      language: langCode,
    };

    const firstUrl = new URL(baseUrl.toString());
    Object.entries(params).forEach(([key, value]) => {
      firstUrl.searchParams.set(key, value);
    });
    firstUrl.searchParams.set("page", "1");

    const firstData = (await this.client.get<ApiResponse<MangaFireChapter>>(firstUrl.toString()))
      .data;
    const lastPage = firstData.meta?.lastPage ?? 1;
    const chapters = firstData.items.map((c) =>
      this.mangaFireChapterToChapter(c, mangaUrl, langCode),
    );

    if (lastPage > 1) {
      const pageUrls = Array.from({ length: lastPage - 1 }, (_, i) => {
        const url = new URL(baseUrl.toString());
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.set(key, value);
        });
        url.searchParams.set("page", String(i + 2));
        return url.toString();
      });
      const responses = await Promise.all(
        pageUrls.map((url) => this.client.get<ApiResponse<MangaFireChapter>>(url)),
      );

      const additionalChapters = responses.flatMap((r) =>
        r.data.items.map((c) => this.mangaFireChapterToChapter(c, mangaUrl, langCode)),
      );

      chapters.push(...additionalChapters);
    }

    return chapters;
  }

  private async tryFetchVolumes(hid: string, query: string, langCode: string): Promise<Chapter[]> {
    try {
      const url = new URL(`api/titles/${hid}/volumes`, this.baseUrl);
      const { data } = await this.client.get<ApiResponse<MangaFireVolume>>(url.toString());
      return data.items
        .filter((v) => v.language === langCode)
        .reverse()
        .map((v) => ({
          id: v.id.toString(),
          extensionId: this.extensionMetadata.id,
          source: this.extensionMetadata.name,
          title: v.name ? `Volume ${v.number}: ${v.name}` : `Volume ${v.number}`,
          url: `${query}/volume/${v.id}`,
          chapterNumber: v.number,
          languageKey: getLanguageKey(v.language),
        }));
    } catch {
      return [];
    }
  }

  private mergeAndSortChapters(chapters: Chapter[], preferOfficial: boolean): Chapter[] {
    const sortedByOfficial = [...chapters].sort((a, b) => {
      const aIsOfficial = a.groupName?.toLowerCase() === "official";
      const bIsOfficial = b.groupName?.toLowerCase() === "official";
      if (aIsOfficial === bIsOfficial) return 0;
      return preferOfficial ? (aIsOfficial ? -1 : 1) : aIsOfficial ? 1 : -1;
    });

    const seen = new Set<number>();
    const merged = sortedByOfficial.filter((chapter) => {
      const num = chapter.chapterNumber ?? 0;
      if (seen.has(num)) return false;
      seen.add(num);
      return true;
    });

    return merged.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
  }

  private mangaFireChapterToChapter(
    chapter: MangaFireChapter,
    mangaUrl: string,
    langCode: string,
  ): Chapter {
    let title = `Chapter ${chapter.number}`;
    if (chapter.name) title += `: ${chapter.name}`;

    let date: Date | null = null;
    if (chapter.createdAt) date = new Date(chapter.createdAt * 1000);

    return {
      title,
      url: `${mangaUrl}/${chapter.id}-chapter-${chapter.number}-${langCode}`,
      chapterNumber: chapter.number,
      lastUpdated: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      groupName: chapter.type || "Unknown",
    };
  }

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments.at(-1);

    const pageUrl = new URL(this.baseUrl);
    if (segments.includes("volume")) {
      pageUrl.pathname = `/api/volumes/${last}`;
    } else {
      const chapterId = this.toNumberOrNull(substringBefore(last || "", "-"));
      if (chapterId === null) throw new Error("Invalid chapter ID");
      pageUrl.pathname = `/api/chapters/${chapterId}`;
    }
    const { data } = await this.client.get<PagesResponse>(pageUrl.toString());

    return data.data.pages.map((page, index) => ({
      index,
      url: page.url,
    }));
  };

  override getImage: GetImage = async (url) => {
    const { data, headers } = await this.imageClient.get(url, {
      headers: this.getImageHeaders(),
      responseType: "arraybuffer",
    });

    const contentType = (headers["Content-Type"] as string | undefined) || "image/jpeg";

    return { data, contentType };
  };

  override getSeriesStatus: GetSeriesStatus = (text) => {
    switch (text?.toLowerCase()) {
      case "releasing":
        return "ongoing";
      case "finished":
        return "completed";
      case "on_hiatus":
        return "hiatus";
      case "discontinued":
        return "cancelled";
      default:
        return "unknown";
    }
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_CONTENT_RATING_KEY,
      type: "multi-select",
      label: "Content Rating (All by default)",
      options: this.CONTENT_RATINGS.map((r) => ({
        label: r.charAt(0).toUpperCase() + r.slice(1),
        value: r,
      })),
    },
    {
      key: this.PREF_LANGUAGE_KEY,
      type: "select",
      label: "Language for chapter & volume",
      options: this.LANGUAGE_OPTIONS,
      defaultValue: "en",
    },
    {
      key: this.PREF_VOLUME_KEY,
      type: "toggle",
      defaultValue: false,
      label: "Prefer Volume Releases",
      description: "Requires chapter list refresh to take effect",
    },
    {
      key: this.PREF_MERGE_DUPLICATE_CHAPTERS_KEY,
      type: "toggle",
      defaultValue: true,
      label: "Merge Duplicate Chapters",
      description: "Requires chapter list refresh to take effect",
    },
    {
      key: this.PREF_OFFICIAL_CHAPTERS_KEY,
      type: "toggle",
      defaultValue: true,
      label: "Prefer Official Chapters",
    },
  ];

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "content_rating[]",
        options: MANGA_FIRE_CONTENT_RATING_OPTIONS,
        type: "multi-select",
        renderAs: "select",
        multiple: true,
        label: "Content Rating",
      },
      {
        key: "statuses[]",
        options: MANGA_FIRE_STATUS_OPTIONS,
        type: "multi-select",
        renderAs: "select",
        multiple: true,
        label: "Status",
      },
      {
        key: "types[]",
        options: MANGA_FIRE_SERIES_TYPE,
        type: "multi-select",
        renderAs: "select",
        multiple: true,
        label: "Type",
      },
      {
        key: "sort",
        options: MANGA_FIRE_SORT_OPTIONS,
        type: "select",

        label: "Sort",
      },
      {
        key: "year_from",
        type: "text",
        label: "Release year (From)",
        defaultValue: "",
      },
      {
        key: "year_to",
        type: "text",
        label: "Release year (To)",
        defaultValue: "",
      },
      {
        key: "min_chap",
        type: "text",
        label: "Minimum chapters",
        defaultValue: "",
      },
      {
        key: "author",
        type: "text",
        label: "Author / Artist",
        defaultValue: "",
      },
      {
        key: "genres",
        options: MANGA_FIRE_GENRE_OPTIONS,
        type: "tri-state-checkbox",
        multiple: true,
        label: "Genres",
      },
    ],
  });

  private getHid(url: string): string {
    const lastPart = url.endsWith("/") ? url.slice(0, -1) : url.split("/").pop()!;

    if (lastPart.includes(".")) return substringAfterLast(lastPart, ".");
    if (lastPart.includes("-")) return substringBefore(lastPart, "-");
    return lastPart;
  }

  private CONTENT_RATINGS = ["safe", "suggestive", "erotica", "pornographic"];

  private LANGUAGE_OPTIONS = [
    {
      label: "English",
      value: "en",
    },
    {
      label: "French",
      value: "fr",
    },
    {
      label: "Spanish",
      value: "es",
    },
    {
      label: "Spanish (LATAM)",
      value: "es-la",
    },
    {
      label: "Portuguese",
      value: "pt",
    },
    {
      label: "Portuguese (BR)",
      value: "pt-br",
    },
    {
      label: "Japanese",
      value: "ja",
    },
  ];

  private readonly PREF_CONTENT_RATING_KEY = "pref_content_rating";
  private readonly PREF_VOLUME_KEY = "pref_volume";
  private readonly PREF_MERGE_DUPLICATE_CHAPTERS_KEY = "pref_merge_duplicate_chapters";
  private readonly PREF_OFFICIAL_CHAPTERS_KEY = "pref_official_chapters";
  private readonly PREF_LANGUAGE_KEY = "pref_language";
}
