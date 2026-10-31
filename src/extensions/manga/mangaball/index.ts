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
  type SortFilterValue,
} from "@tsukimichi/common";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import { getLanguageKey } from "@/utils/language";
import type {
  ChapterDetailResponse,
  ChapterListResponse,
  ImageDto,
  SearchResponse,
  TitleResponse,
} from "./dto";
import {
  SortFilter,
  TypeFilter,
  DemographicFilter,
  StatusFilter,
  TagModeFilter,
  ContentFilter,
  FormatFilter,
  GenreFilter,
  ThemeFilter,
} from "./filters";
import manifest from "./manifest.json";

export class MangaBall extends BaseMangaScraper {
  private $preferences: Preferences;
  constructor(options: ExtensionClientConstructorOptions) {
    super({ ...options, metadata: manifest });

    this.$preferences = options.$context!.createPreferences!();
  }

  private hideNsfw() {
    return this.$preferences.getBoolean(this.PREF_HIDE_NSFW_KEY, this.PREF_HIDE_NSFW_DEFAULT);
  }

  private async getChapterLanguages() {
    try {
      const pref = JSON.parse(await this.$preferences.getString(this.PREF_CHAPTER_LANGS_KEY, "[]"));

      const allLangs = this.PREF_CHAPTER_LANGUAGE_OPTIONS.map(({ value }) => value);

      if (!Array.isArray(pref)) {
        return [...this.PREF_CHAPTER_LANGS_DEFAULT];
      }

      const selectedLangs = pref.length ? pref.filter((lang) => allLangs.includes(lang)) : allLangs;

      return selectedLangs.flatMap((lang) => this.getSiteLangs(lang));
    } catch {
      return [...this.PREF_CHAPTER_LANGS_DEFAULT];
    }
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    return await this.searchMangaRequest(query || "", options);
  };

  private async searchMangaRequest(
    query: string,
    options?: Record<string, any>,
  ): Promise<SeriesListResponse<Manga>> {
    const { page = 1, filters } = options ?? {};
    const url = new URL("/api/v1/title/search-advanced", this.baseUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("limit", "24");

    const sort = filters?.[SortFilter.key] as SortFilterValue | undefined;

    let effectiveSortBy: string | null = sort?.value ?? (query.trim() === "" ? "lastupdate" : null);
    if (effectiveSortBy != null) {
      url.searchParams.set(SortFilter.key, effectiveSortBy);
      url.searchParams.set("sort_order", sort?.direction === "ascending" ? "asc" : "desc");
    }

    const includedTags: string[] = [];
    const excludedTags: string[] = [];

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (typeof value === "string" && value.trim() === "any") continue;

      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value);
          break;

        case "tri-state-checkbox":
          value.forEach((v) => {
            if (v.state === "include") {
              includedTags.push(v.value);
            } else if (v.state === "exclude") {
              excludedTags.push(v.value);
            }
          });

          break;

        default:
          break;
      }
    }

    if (includedTags.length) {
      url.searchParams.set("included_tags", includedTags.join(","));
    }
    if (excludedTags.length) {
      url.searchParams.set("excluded_tags", excludedTags.join(","));
    }
    if (!url.searchParams.has(TagModeFilter.key)) {
      url.searchParams.set(TagModeFilter.key, "AND");
    }

    const hideNsfw = await this.hideNsfw();
    url.searchParams.set("adult_mode", hideNsfw ? "no_18" : "all");
    const response = await this.client.get<SearchResponse>(url.toString());

    return this.parseSearchResponse(response.data, page);
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    return await this.searchMangaRequest("", {
      ...options,
      filters: {
        [SortFilter.key]: { value: "views", direction: "descending" },
      },
    });
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    return await this.searchMangaRequest("", {
      ...options,
      filters: {
        [SortFilter.key]: { value: "lastupdate", direction: "descending" },
      },
    });
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const params = new URLSearchParams(query);
    const id = params.get("id")!;
    const url = new URL(`api/v1/title/detail/${id}`, this.baseUrl);

    const { data: result } = await this.client.get<TitleResponse>(url.toString());
    const data = result.data;
    return {
      id: data.id,
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title: data.name,
      coverImageUrl: this.getCoverImage(data.image),
      isNsfw: data.is18plus ?? null,
      status: this.getSeriesStatus(data.status),
      url: query,
      alternateTitles: data.alternateName?.filter(Boolean) ?? [],
      authors: data.author?.map((a) => a.name)?.filter(Boolean) ?? [],
      genres: data.tags?.map((t) => t.name)?.filter(Boolean) ?? [],
      lastUpdated: this.parseSeriesDate(data.updated_at),
      description: data.description?.join("\n").replaceAll("\n", "<br>") ?? null,
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    const id = new URLSearchParams(query).get("id")!;

    const url = new URL("api/v1/chapter/chapter-listing-by-title-id", this.baseUrl);

    const langs = await this.getChapterLanguages();

    const { data } = await this.client.post<ChapterListResponse>(url.toString(), { title_id: id });

    return data.data
      .map((item) => {
        if (!langs.includes(item.lang)) return null;

        const chapterName = item.name ?? "";

        let title = "";
        if (item.volume != null && item.volume > 0) {
          title = `Vol. ${item.volume} `;
        }
        if (item.number != null) {
          if (chapterName.includes(item.number.toString())) {
            title += chapterName;
          } else {
            title += `Chapter ${item.number}`;
            if (chapterName) {
              title += ` - ${chapterName}`;
            }
          }
        }

        return {
          id: item.id,
          extensionId: this.extensionMetadata.id,
          source: this.extensionMetadata.name,
          title,
          url: item.id,
          chapterNumber: this.toNumberOrNull(item.number, true),
          volumeNumber: this.toNumberOrNull(item.volume, true),
          groupName: item.group?.name,
          lastUpdated: this.parseSeriesDate(item.created_at),
          languageKey: getLanguageKey(item.lang),
        };
      })
      .filter(Boolean)
      .toReversed() as Chapter[];
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL("api/v1/chapter-detail", this.baseUrl);
    url.searchParams.set("chapter_id", query);
    const { data } = await this.client.get<ChapterDetailResponse>(url.toString());
    if (!Array.isArray(data.data.chapter?.pages)) return [];

    return data.data.chapter.pages.map((page, index) => ({
      index,
      url: page,
    }));
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      SortFilter,
      TypeFilter,
      DemographicFilter,
      StatusFilter,
      TagModeFilter,
      ContentFilter,
      FormatFilter,
      GenreFilter,
      ThemeFilter,
    ],
  });

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_HIDE_NSFW_KEY,
      label: "Hide NSFW Content",
      description: "Hide titles marked as 18+",
      type: "toggle",
      defaultValue: this.PREF_HIDE_NSFW_DEFAULT,
    },
    {
      key: this.PREF_CHAPTER_LANGS_KEY,
      label: "Preferred Chapter Languages",
      description: "Leave empty to get chapters for all languages",
      type: "multi-select",
      options: this.PREF_CHAPTER_LANGUAGE_OPTIONS,
      defaultValue: this.PREF_CHAPTER_LANGS_DEFAULT,
    },
  ];

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "ongoing":
        return "ongoing";
      case "completed":
        return "completed";
      case "hiatus":
        return "hiatus";
      case "cancelled":
        return "cancelled";
      default:
        return "unknown";
    }
  };

  override getImage: GetImage = async (url) => {
    const { data, headers } = await this.client.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      headers: {
        Referer: `${this.baseUrl}/`,
        "User-Agent": "Tsukimichi/1.0.0",
        Origin: this.baseUrl,
      },
    });
    const contentType =
      (headers["content-type"] as string | undefined) ?? "application/octet-stream";
    return {
      data,
      contentType,
    };
  };

  private parseSearchResponse(
    response: SearchResponse,
    currentPage: number,
  ): SeriesListResponse<Manga> {
    const { data } = response;
    const mangaList: Manga[] = [];

    data.forEach((item) => {
      const params = new URLSearchParams({
        id: item.id,
        slug: item.slug,
      });
      mangaList.push({
        title: item.name,
        url: decodeURIComponent(params.toString()),
        isNsfw: item.is18plus,
        coverImageUrl: this.getCoverImage(item.image),
        status: this.getSeriesStatus(item.status),
      });
    });

    const hasMore = response.pagination.total_pages > currentPage;

    return {
      data: mangaList,
      hasMore,
    };
  }

  private getCoverImage(image: ImageDto | null): string | null {
    let coverImageUrl: string | null = null;
    if (image) {
      if (image.cover?.path && image.cover.path.trim()) {
        const sanitized = image.cover.path.trim().replaceAll("\\", "/").trim();
        coverImageUrl = sanitized
          ? sanitized.startsWith("http")
            ? sanitized
            : `${this.COVER_BASE_URL}${sanitized}`
          : null;
      } else {
        coverImageUrl =
          [image.file, image.cdn_mangadex, image.cdn_mangaupdates, image.cdn_mangaupdate]
            .filter(Boolean)
            .find(Boolean) ?? null;
      }
    }

    if (!coverImageUrl) {
    }

    return coverImageUrl;
  }

  private COVER_BASE_URL = "https://bulbasaur.poke-black-and-white.net/covers/";

  private readonly SITE_LANG_MAP: Record<string, string[]> = {
    ar: ["ar"],
    bg: ["bg"],
    bn: ["bn"],
    ca: ["ca", "ca-ad", "ca-es", "ca-fr", "ca-it", "ca-pt"],
    cs: ["cs"],
    da: ["da"],
    de: ["de"],
    el: ["el"],
    en: ["en"],
    es: ["es", "es-ar", "es-mx", "es-es", "es-la", "es-419"],
    fa: ["fa"],
    fi: ["fi"],
    fr: ["fr"],
    he: ["he"],
    hi: ["hi"],
    hu: ["hu"],
    id: ["id"],
    it: ["it", "it-it"],
    is: ["ib", "ib-is", "is"],
    ja: ["ja", "jp"],
    ko: ["ko", "kr"],
    kn: ["kn", "kn-in", "kn-my", "kn-sg", "kn-tw"],
    ml: ["ml", "ml-in", "ml-my", "ml-sg", "ml-tw"],
    ms: ["ms"],
    ne: ["ne"],
    nl: ["nl", "nl-be"],
    no: ["no"],
    pl: ["pl"],
    "pt-BR": ["pt-br", "pt-pt"],
    ro: ["ro"],
    ru: ["ru"],
    sk: ["sk"],
    sl: ["sl"],
    sq: ["sq"],
    sr: ["sr", "sr-cyrl"],
    sv: ["sv"],
    ta: ["ta"],
    th: ["th", "th-hk", "th-kh", "th-la", "th-my", "th-sg"],
    tr: ["tr"],
    uk: ["uk"],
    vi: ["vi"],
    zh: ["zh", "zh-cn", "zh-hk", "zh-mo", "zh-sg", "zh-tw", "cn"],
  };

  private getSiteLangs(lang: string): string[] {
    return this.SITE_LANG_MAP[lang] || [lang];
  }

  private readonly PREF_HIDE_NSFW_KEY = "pref_hide_nsfw";
  private readonly PREF_HIDE_NSFW_DEFAULT = true;

  private readonly PREF_CHAPTER_LANGS_KEY = "pref_chapter_langs";
  private readonly PREF_CHAPTER_LANGS_DEFAULT = ["en"];
  private readonly PREF_CHAPTER_LANGUAGE_OPTIONS = [
    { label: "Arabic", value: "ar" },
    { label: "Bulgarian", value: "bg" },
    { label: "Bengali", value: "bn" },
    { label: "Catalan", value: "ca" },
    { label: "Czech", value: "cs" },
    { label: "Danish", value: "da" },
    { label: "German", value: "de" },
    { label: "Greek", value: "el" },
    { label: "English", value: "en" },
    { label: "Spanish", value: "es" },
    { label: "Persian", value: "fa" },
    { label: "Finnish", value: "fi" },
    { label: "French", value: "fr" },
    { label: "Hebrew", value: "he" },
    { label: "Hindi", value: "hi" },
    { label: "Hungarian", value: "hu" },
    { label: "Indonesian", value: "id" },
    { label: "Italian", value: "it" },
    { label: "Icelandic", value: "is" },
    { label: "Japanese", value: "ja" },
    { label: "Korean", value: "ko" },
    { label: "Kannada", value: "kn" },
    { label: "Malayalam", value: "ml" },
    { label: "Malay", value: "ms" },
    { label: "Nepali", value: "ne" },
    { label: "Dutch", value: "nl" },
    { label: "Norwegian", value: "no" },
    { label: "Polish", value: "pl" },
    { label: "Portuguese", value: "pt-BR" },
    { label: "Romanian", value: "ro" },
    { label: "Russian", value: "ru" },
    { label: "Slovak", value: "sk" },
    { label: "Slovenian", value: "sl" },
    { label: "Albanian", value: "sq" },
    { label: "Serbian", value: "sr" },
    { label: "Swedish", value: "sv" },
    { label: "Tamil", value: "ta" },
    { label: "Thai", value: "th" },
    { label: "Turkish", value: "tr" },
    { label: "Ukrainian", value: "uk" },
    { label: "Vietnamese", value: "vi" },
    { label: "Chinese", value: "zh" },
  ];
}
