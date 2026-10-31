import type {
  Chapter,
  ExtensionClientConstructorOptions,
  GetChapterPages,
  GetFilterConfig,
  GetLatestSeries,
  GetMangaChapters,
  GetPopularSeries,
  GetSeries,
  GetSeriesStatus,
  Manga,
  SearchSeries,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import type { BrowseSeries, ChapterList, PageList, SeriesDetails } from "./dto";
import { TEMPLE_SCAN_ORDER_BY_FILTERS, TEMPLE_SCAN_STATUS_FILTERS } from "./filters";
import manifest from "./manifest.json";
import { extractNextJsRsc, inferredNextJsPredicate } from "@/utils/next-js";

export class TempleScan extends BaseMangaScraper {
  constructor(options?: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  private seriesCache: BrowseSeries[] = [];

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    const url = new URL("comics", this.baseUrl);

    const { data: html } = await this.client.get(url.toString(), {
      responseType: "text",
    });

    const $ = cheerio.load(html);

    const script = $('script:contains("allComics")').first().html();

    if (!script) throw new Error("Script containing comics not found");

    const cleaned = this.unescape(script);

    const raw = cleaned.match(/"allComics":(\[[\s\S]*?\](?=\s*[;}]))/)?.[1];

    if (!raw) throw new Error("No series found");

    this.seriesCache = JSON.parse(raw);

    const activeFilters = Object.entries(filters ?? {}).reduce(
      (acc, [key, value]) => {
        if (value === "All") return acc;

        acc[key] = value;
        return acc;
      },
      {} as Record<string, any>,
    );

    let result = [...this.seriesCache];

    if (activeFilters.status) {
      result = result.filter((s) => s.status === activeFilters.status);
    }

    if (activeFilters.orderBy) {
      result = this.sortSeries(result, activeFilters.orderBy);
    }

    if (query) {
      const lowerQuery = query.toLowerCase();

      result = result.filter((s) => {
        const titleMatch = s.title.toLowerCase().includes(lowerQuery);

        let altNamesMatch = false;

        if (s.alternative_names) {
          altNamesMatch = s.alternative_names.toLowerCase().includes(lowerQuery);
        }

        return titleMatch || altNamesMatch;
      });
    }

    const series: Manga[] = result.map((s) => ({
      coverImageUrl: s.thumbnail,
      url: `/comic/${s.series_slug}`,
      title: s.title,
      status: this.getSeriesStatus(s.status),
      isNsfw: null,
      lastUpdated: this.parseSeriesDate(s.created_at),
    }));

    const pageSize = 20;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const hasMore = end < series.length;

    return {
      data: series.slice(start, end),
      hasMore,
    };
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    return await this.searchSeries("", {
      ...options,
      filters: {
        ...options?.filters,
        orderBy: "total_views",
      },
    });
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    return await this.searchSeries("", {
      ...options,
      filters: {
        ...options?.filters,
        orderBy: "update_chapter",
      },
    });
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString(), {
      responseType: "text",
      headers: {
        rsc: "1",
      },
    });

    const predicate = inferredNextJsPredicate<SeriesDetails>(["id", "title", "series_slug"], {
      isArray: false,
      strict: true,
    });
    const series = extractNextJsRsc<SeriesDetails>(
      html,
      predicate,
      (payload) => payload as SeriesDetails,
    );

    if (!series) throw new Error("Series not found");

    const tags = new Set(series.tag_series?.map((t) => t.tag.name).filter(Boolean) || []);

    if (series.badge) tags.add(series.badge);

    let description = "";

    if (series.description) {
      description += `${series.description}<br/>`;
    }

    if (series.release_year) {
      description += `Release year: ${series.release_year}`;
    }

    return {
      id: String(series.id),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      url: `/comic/${series.series_slug}`,
      coverImageUrl: series.thumbnail,
      status: this.getSeriesStatus(series.status),
      title: series.title,
      description,
      authors:
        series.author
          ?.split("|")
          .map((a) => a.trim())
          .filter(Boolean) || [],
      artists:
        series.studio
          ?.split("/")
          .map((a) => a.trim())
          .filter(Boolean) || [],
      genres: Array.from(tags),
      isNsfw: series.adult,
      alternateTitles:
        series.alternative_names
          ?.split(",")
          .map((a) => a.trim())
          .filter(Boolean) || [],
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString(), {
      responseType: "text",
      headers: {
        rsc: "1",
      },
    });

    const predicate = inferredNextJsPredicate<ChapterList>(["Season[].Chapter[].chapter_slug"], {
      isArray: false,
      strict: true,
    });
    const chapterList = extractNextJsRsc<ChapterList>(
      html,
      predicate,
      (payload) => payload as ChapterList,
    );
    if (!chapterList) return [];

    const chapters: Chapter[] = [];

    chapterList.Season?.flatMap((s) => s.Chapter.filter((c) => c.price === 0)).forEach((c) => {
      let title = "";

      title = c.chapter_name;

      if (c.chapter_title?.trim()) {
        title += ` - ${c.chapter_title}`;
      }

      const chapterNumber = this.toNumberOrNull(c.index, true);

      chapters.push({
        title,
        url: new URL(`${query}/${c.chapter_slug}`, this.baseUrl).pathname,
        languageKey: "en",
        chapterNumber,
        lastUpdated: this.parseSeriesDate(c.created_at),
      });
    });

    return this.addChapterNavigation([...chapters]);
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString(), {
      responseType: "text",
      headers: {
        rsc: "1",
      },
    });

    const predicate = inferredNextJsPredicate<PageList>(["pages[]"], {
      isArray: false,
      strict: true,
    });

    const pages = extractNextJsRsc<PageList>(html, predicate, (payload) => payload as PageList);
    if (!pages) return [];

    return pages?.pages.map((page, index) => ({
      url: new URL(page, this.baseUrl).toString(),
      index,
    }));
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "status",
        label: "Status",
        type: "select",
        options: TEMPLE_SCAN_STATUS_FILTERS.map((s) => ({
          label: s,
          value: s,
        })),

        defaultValue: "All",
      },
      {
        key: "orderBy",
        label: "Order by",
        options: TEMPLE_SCAN_ORDER_BY_FILTERS,
        type: "select",

        defaultValue: "update_chapter",
      },
    ],
  });

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input) {
      case "Ongoing":
        return "ongoing";
      case "Completed":
        return "completed";
      case "Hiatus":
        return "hiatus";
      case "Dropped":
      case "Canceled":
        return "cancelled";
      default:
        return "unknown";
    }
  };

  private sortSeries(series: BrowseSeries[], orderBy: string): BrowseSeries[] {
    const sortKeyMap: Record<string, keyof BrowseSeries> = {
      update_chapter: "update_chapter",
      created_at: "created_at",
      total_views: "total_views",
    };

    const key = sortKeyMap[orderBy];
    if (!key) return series;

    return [...series].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (key === "total_views") {
        return (bVal as number) - (aVal as number);
      }

      if (key === "update_chapter" || key === "created_at") {
        const aDate = new Date(aVal as string).getTime();
        const bDate = new Date(bVal as string).getTime();

        if (Number.isNaN(aDate) && Number.isNaN(bDate)) return 0;
        if (Number.isNaN(aDate)) return 1;
        if (Number.isNaN(bDate)) return -1;

        return bDate - aDate;
      }

      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    });
  }

  private unescape(str: string): string {
    return str.replace(this.UNESCAPE_REGEX, "$1");
  }

  private readonly UNESCAPE_REGEX = /\\(.)/g;
  private readonly DETAILS_REGEX = /info\\":(\{.*\}).*userIsFollowed/;
  private readonly IMAGES_REGEX = /images\\":(\[.*?]).*/;
}
