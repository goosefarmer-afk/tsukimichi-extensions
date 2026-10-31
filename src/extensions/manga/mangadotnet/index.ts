import { BaseMangaScraper } from "@/generic/base-manga-scraper";
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
  type GetSeriesStatus,
  type GetSettingsFilters,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
  type TriStateFilterValue,
} from "@tsukimichi/common";
import type { ChapterItem, Data, Images, MangaData, MangaList, ViewAllData, Volume } from "./types";
import manifest from "./manifest.json" with { type: "json" };
import {
  BrowseFilter,
  SortFilter,
  StatusFilter,
  VolumeFilter,
  ContentRatingFilter,
  TypeFilter,
  MinRatingFilter,
  DemographicFilter,
  GenresFilter,
} from "./filters";

type Primitive = string | number | boolean | null;
type EncodedObject = Record<string, number>;
type EncodedValue = Primitive | number[] | EncodedObject;
type DecodedValue = Primitive | DecodedValue[] | { [key: string]: DecodedValue };

export class Mangadotnet extends BaseMangaScraper {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  private async getViewAllPage(mode: string, page: number): Promise<SeriesListResponse<Manga>> {
    page ??= 1;
    const routes = "pages/ViewAllPage";
    let url = new URL(`view-all/${mode}.data`, this.baseUrl);
    if (page > 1) url.searchParams.set("page", page.toString());
    url.searchParams.set("_routes", routes);
    url = this.addAdultParam(url);

    const { data: result } = await this.client.get(url.toString());
    const data = this.decodeRscAs<Data<ViewAllData>>(result, routes).data;

    return this.parseBrowseManga(data.data);
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    let { page } = options ?? {};
    page ??= 1;

    return this.getViewAllPage("most-tracked", page);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    let { page } = options ?? {};
    page ??= 1;

    return this.getViewAllPage("latest-updates", page);
  };

  private parseBrowseManga(data: Data<ViewAllData>["data"]["data"]): SeriesListResponse<Manga> {
    const mangaList: Manga[] = (data.results ?? data.manga_list ?? []).map((item) => {
      let coverImageUrl: string | null = null;
      if (item.photo) {
        if (item.photo.startsWith("/")) coverImageUrl = `${this.baseUrl}${item.photo}`;
        else if (item.photo.startsWith("http")) coverImageUrl = item.photo;
      }

      return {
        id: item.id.toString(),
        extensionId: this.extensionMetadata.id,
        source: this.extensionMetadata.name,
        url: item.id.toString(),
        title: item.title,
        coverImageUrl,
        isNsfw: this.toNumberOrNull(item.is_blurworthy) === 1,
        status: "unknown",
      };
    });

    const { pagination } = data;

    let hasMore = false;

    if (pagination?.current_page != null && pagination.total_pages != null)
      hasMore = pagination.current_page < pagination.total_pages;
    else if (pagination?.next_cursor != null) hasMore = true;

    return {
      data: mangaList,
      hasMore,
    };
  }

  override searchSeries: SearchSeries<Manga> = async (query = "", options) => {
    let { page, filters } = options ?? {};
    page ??= 1;

    let url = new URL("api/search", this.baseUrl);
    if (query?.trim()) url.searchParams.set("search", query.trim());
    url.searchParams.set("page", page.toString());
    url.searchParams.set("limit", "56");
    url = this.addAdultParam(url);

    const genres: string[] = [];

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "sort":
          if (value.value === "any" && query?.trim() === "") {
            url.searchParams.set(filter.key, "latest");
          } else if (value.value !== "any") {
            url.searchParams.set(filter.key, value.value);
          }
          url.searchParams.set("sortOrder", value.direction === "ascending" ? "asc" : "desc");
          break;

        case "select":
          if (value !== "any") {
            url.searchParams.set(filter.key, value);
          }
          break;

        case "multi-select":
          if (value.length > 0) {
            url.searchParams.set(filter.key, value.join(","));
          }
          break;

        case "tri-state-checkbox":
          if (filter.key === ContentRatingFilter.key) {
            const ratings: string[] = [];
            if (Array.isArray(value) && value.length > 0) {
              (value as TriStateFilterValue[]).forEach((v) => {
                if (v.state === "include") ratings.push(v.value);
                else if (v.state === "exclude") ratings.push(`-${v.value}`);
              });
              if (ratings.length > 0) {
                url.searchParams.set(filter.key, ratings.join(","));
              }
            }
          } else if ([GenresFilter.key, DemographicFilter.key].includes(filter.key)) {
            if (Array.isArray(value) && value.length > 0) {
              (value as TriStateFilterValue[]).forEach((v) => {
                if (v.state === "include") genres.push(v.value);
                else if (v.state === "exclude") genres.push(`-${v.value}`);
              });
            }
          }
          break;

        default:
          break;
      }
    }

    if (genres.length > 0) {
      url.searchParams.set("genres", genres.join(","));
    }

    const { data } = await this.client.get<MangaList>(url.toString());
    return this.parseBrowseManga(data);
  };

  override getSeries: GetSeries<Manga> = async (url) => {
    const urlObj = new URL(`manga/${url}.data`, this.baseUrl);
    urlObj.searchParams.set("_routes", "pages/MangaDetailPage");

    const { data: result } = await this.client.get(urlObj.toString());
    const { manga: mangaData } = this.decodeRscAs<Data<MangaData>>(result, "pages/MangaDetailPage")
      .data.mangaData;

    let artists: string[] = [];
    let authors: string[] = [];
    if (mangaData.artists) {
      try {
        const parsed = JSON.parse(mangaData.artists);
        if (Array.isArray(parsed)) artists = parsed;
      } catch {}
    }

    if (mangaData.authors) {
      try {
        const parsed = JSON.parse(mangaData.authors);
        if (Array.isArray(parsed)) authors = parsed;
      } catch {}
    }

    const manga: Manga = {
      title: mangaData.title,
      coverImageUrl: null,
      status: mangaData.hiatus === "Yes" ? "hiatus" : this.getSeriesStatus(mangaData.status),
      isNsfw: mangaData.is_adult ?? false,
      url: mangaData.id.toString(),
      artists,
      authors,
      genres: mangaData.genres ?? [],
      alternateTitles: mangaData.alt_titles ?? [],
      rating: mangaData.avg_rating ?? null,
    };

    const photo = mangaData.photo;

    if (photo?.startsWith("/")) manga.coverImageUrl = `${this.baseUrl}${photo}`;
    else if (photo?.startsWith("http")) manga.coverImageUrl = photo;

    let description = "";
    if (mangaData.year) description += `Year: ${mangaData.year}`;
    if (mangaData.content_rating)
      description += `<br/>Content Rating: ${mangaData.content_rating.charAt(0).toUpperCase() + mangaData.content_rating.slice(1)}`;

    if (mangaData.description) {
      description += "<br/><br/>";
      description += mangaData.description
        .replace(/\r\n/g, "\n")
        .replace(/\n\n(?=-|•|\d+\.\s)/g, "\n")
        .replace(/\n{2,}/g, "<br/><br/>")
        .replace(/\n/g, "<br/>")
        .trim();
    }

    manga.description = description;

    return manga;
  };

  override getChapters: GetMangaChapters = async (query) => {
    return this.fetchChaptersInternal(query);
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      BrowseFilter,
      SortFilter,
      StatusFilter,
      VolumeFilter,
      ContentRatingFilter,
      TypeFilter,
      MinRatingFilter,
      DemographicFilter,
      GenresFilter,
    ],
  });

  private async fetchChaptersInternal(query: string): Promise<Chapter[]> {
    const mode = this.preferences.getChapterMode();
    const dedup = this.preferences.deduplicateChapters();

    const chapters = mode !== "volumes" ? await this.fetchChapters(query) : [];

    const volumes = mode !== "chapters" ? await this.fetchVolumes(query) : [];

    let all =
      mode === "volumes" && !volumes.length
        ? chapters.length
          ? chapters
          : await this.fetchChapters(query)
        : [...chapters, ...volumes];

    if (!dedup) return all;

    return this.deduplicateChapters(all);
  }

  private async fetchVolumes(query: string): Promise<Chapter[]> {
    const url = new URL(`api/manga/${query}/volumes`, this.baseUrl);
    url.searchParams.set("lang", "en");

    const { data } = await this.client.get<Volume[]>(url.toString());

    return data
      .filter((v) => !v.language || v.language === "en")
      .map((v) => ({
        id: v.id.toString(),
        extensionId: this.extensionMetadata.id,
        source: this.extensionMetadata.name,
        url: new URLSearchParams({
          id: v.id.toString(),
          source: v.source || "user",
          isVolume: "true",
        }).toString(),
        title: `Volume ${v.volume_number ?? 0}`,
        chapterNumber: 0,
        volumeNumber: v.volume_number ?? null,
        groupName: v.group_name || v.scanlator_name || null,
        lastUpdated: this.parseSeriesDate(v.date_added),
      }));
  }

  private deduplicateChapters(chapters: Chapter[]): Chapter[] {
    const groups = Map.groupBy(chapters, (c) => c.chapterNumber ?? 0);

    return [...groups]
      .flatMap(([number, group]) => {
        if (number <= 0 || group.length === 1) return group;

        return [
          group.find((c) =>
            this.officialPriorityPatterns.some((p) => c.groupName && p.test(c.groupName)),
          ) ?? group[0],
        ];
      })
      .filter(Boolean) as Chapter[];
  }

  private async fetchChapters(query: string): Promise<Chapter[]> {
    const url = new URL(`api/manga/${query}/chapters/list`, this.baseUrl);
    url.searchParams.set("lang", "en");

    const { data } = await this.client.get<ChapterItem[]>(url.toString());

    return data
      .filter((chapter) => !chapter.language || chapter.language === "en")
      .map((chapter) => {
        const number =
          chapter.chapter_number != null ? String(chapter.chapter_number).replace(/\.0$/, "") : "0";
        const rawTitle = chapter.chapter_title ? chapter.chapter_title.trim() : "";

        let title: string;
        if (!rawTitle) {
          title = `Chapter ${number}`;
        } else if (
          rawTitle.toLowerCase().includes(`chapter ${number.toLowerCase()}`) ||
          rawTitle.includes(number)
        ) {
          title = rawTitle;
        } else {
          title = `Chapter ${number}: ${rawTitle}`;
        }

        return {
          title,
          url: new URLSearchParams({
            id: chapter.id.toString(),
            source: chapter.source || "user",
            isVolume: "false",
          }).toString(),
          chapterNumber: chapter.chapter_number ?? null,
          volumeNumber: chapter.volume_number ?? null,
          groupName: chapter.group_name || chapter.scanlator_name || null,
          lastUpdated: this.parseSeriesDate(chapter.date_added),
        };
      });
  }

  private officialPriorityPatterns = [
    "manga plus",
    "mangaplus",
    "viz media",
    "viz manga",
    "webtoon",
    "tapas",
    "mangadex",
    "k manga",
    "kmanga",
    "mangaup",
    "manga up",
    "comikey",
    "shonen jump",
    "shounen jump",
    "shonenjump",
    "official",
  ].map((pattern) => new RegExp(`\\b${pattern}\\b`, "i"));

  private getChapterUrl(params: { id: string; source: string; isVolume: boolean }): string {
    if (params.isVolume) return `${this.baseUrl}/volume/${params.id}`;

    const url = new URL(`chapter/${params.id}`, this.baseUrl);
    if (params.source === "user") url.searchParams.set("source", "user");

    return url.toString();
  }

  override getChapterPages: GetChapterPages = async (query) => {
    const params = new URLSearchParams(query);
    const id = params.get("id")!;
    const source = params.get("source")!;

    const segment = source === "user" ? "uploads" : "chapters";
    const apiUrl = `${this.baseUrl}/api/${segment}/${id}/images`;

    const { data } = await this.client.get<Images>(apiUrl);

    return data.images.map((image, index) => {
      const imageUrl = new URL(image.url, this.baseUrl).toString();

      return {
        index,
        url: imageUrl,
      };
    });
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "one shot":
        return "completed";
      case "ongoing":
        return "ongoing";
      case "completed":
        return "completed";
      default:
        return "unknown";
    }
  };

  private decodeRscAs<T>(json: readonly EncodedValue[], route: string): T {
    const decoded = this.decodeRsc(json);
    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("Expected decoded RSC root to be an object");
    }

    const value = decoded[route];
    if (value === undefined) throw new Error(`Route ${route} not found in RSC response`);
    return value as T;
  }

  private isPrimitive(value: unknown): value is Primitive {
    return (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  }

  private decodeRsc(json: readonly EncodedValue[]): DecodedValue {
    const NULL = Symbol("null");
    // oxlint-disable-next-line unicorn/no-new-array
    const cache: (DecodedValue | typeof NULL | undefined)[] = new Array(json.length);

    const resolve = (i: number): DecodedValue => {
      if (i < 0) return null;

      const cached = cache[i];
      if (cached !== undefined) return cached === NULL ? null : cached;

      const value = json[i];
      let decoded: DecodedValue;

      if (this.isPrimitive(value)) decoded = value;
      else if (Array.isArray(value)) decoded = value.map(resolve);
      else {
        const obj: Record<string, DecodedValue> = {};

        for (const encodedKey in value) {
          const keyIndex = Number(encodedKey.slice(1));
          obj[json[keyIndex] as string] = resolve(value[encodedKey]!);
        }

        decoded = obj;
      }

      cache[i] = decoded === null ? NULL : decoded;
      return decoded;
    };

    return resolve(0);
  }

  private addAdultParam(url: URL): URL {
    switch (this.preferences.getAdultMode()) {
      case "none":
        url.searchParams.set("adult", "0");
        break;
      case "1":
        url.searchParams.set("adult", "1");
        break;
      case "both":
        url.searchParams.set("adult", "both");
        break;
    }
    return url;
  }

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_ADULT_MODE_KEY,
      label: "NSFW (18+) Content",
      type: "select",
      options: this.PREF_ADULT_MODE_OPTIONS,
      defaultValue: this.PREF_ADULT_MODE_DEFAULT,
    },
    {
      key: this.PREF_DEDUPLICATE_CHAPTERS_KEY,
      label: "Deduplicate Chapters",
      type: "toggle",
      defaultValue: this.PREF_DEDUPLICATE_CHAPTERS_DEFAULT,
      description: "Keep only one version of each chapter",
    },
    {
      key: this.PREF_CHAPTER_MODE_KEY,
      label: "Chapter List Mode",
      type: "select",
      options: this.PREF_CHAPTER_MODE_OPTIONS,
      defaultValue: this.PREF_CHAPTER_MODE_DEFAULT,
      description:
        "Note: Most titles don't have volumes. 'Volumes Only' falls back to chapters if none are found",
    },
  ];

  private preferences = {
    getAdultMode: (): string => {
      const pref = this.settings?.[this.PREF_ADULT_MODE_KEY];
      if (pref && this.PREF_ADULT_MODE_OPTIONS.map((o) => o.value).includes(pref)) return pref;
      return this.PREF_ADULT_MODE_DEFAULT;
    },
    deduplicateChapters: (): boolean => {
      const pref = this.settings?.[this.PREF_DEDUPLICATE_CHAPTERS_KEY];
      return typeof pref === "boolean" ? pref : this.PREF_DEDUPLICATE_CHAPTERS_DEFAULT;
    },
    getChapterMode: (): string => {
      const pref = this.settings?.[this.PREF_CHAPTER_MODE_KEY];
      if (pref && this.PREF_CHAPTER_MODE_OPTIONS.map((o) => o.value).includes(pref)) return pref;
      return this.PREF_CHAPTER_MODE_DEFAULT;
    },
  };

  private readonly PREF_ADULT_MODE_KEY = "pref_adult_mode";
  private readonly PREF_ADULT_MODE_OPTIONS = [
    { label: "No 18+", value: "none" },
    { label: "18+ Only", value: "1" },
    { label: "Both", value: "both" },
  ];
  private readonly PREF_ADULT_MODE_DEFAULT = this.PREF_ADULT_MODE_OPTIONS[0]!.value;

  private readonly PREF_DEDUPLICATE_CHAPTERS_KEY = "pref_deduplicate_chapters";
  private readonly PREF_DEDUPLICATE_CHAPTERS_DEFAULT = true;

  private readonly PREF_CHAPTER_MODE_KEY = "pref_chapter_mode";
  private readonly PREF_CHAPTER_MODE_OPTIONS = [
    { label: "Chapters Only", value: "chapters" },
    { label: "Volumes Only", value: "volumes" },
    { label: "Chapters + Volumes", value: "both" },
  ];
  private readonly PREF_CHAPTER_MODE_DEFAULT = this.PREF_CHAPTER_MODE_OPTIONS[0]!.value;
}
