import type {
  Chapter,
  ExtensionClientConstructorOptions,
  GetChapterPages,
  GetLatestSeries,
  GetMangaChapters,
  GetPopularSeries,
  GetSeries,
  Manga,
  SearchSeries,
  SeriesListResponse,
} from "@tsukimichi/common";
import type { AxiosResponse } from "axios";
import * as cheerio from "cheerio";

import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import manifest from "./manifest.json";
import { RateLimiter } from "@/lib/network/interceptors/rate-limiter";
import { seconds } from "@/lib/network/network-helper";
import { ErrorNormalizer } from "@/lib/network/interceptors/error-normalizer";
import { ComposedImageInterceptor } from "./composed-image-interceptor";

export class FlameComics extends BaseMangaScraper {
  private readonly CDN_URL = "https://cdn.flamecomics.xyz";
  private readonly BUILD_ID_CACHE_TTL = 5 * 60 * 1000;
  private readonly COVER_IMAGE_WIDTH = 384;
  private readonly IMAGE_QUALITY = 75;
  private readonly SEARCH_PER_PAGE = 20;

  private buildIdCache: { id: string; timestamp: number } | null = null;

  private rateLimiter = new RateLimiter({
    maxRequests: 2,
    perMilliseconds: seconds(2),
    shouldLimit: (url) => {
      try {
        const isCover = new URL(url).searchParams.get("cover") === "1";
        return !isCover;
      } catch {
        return false;
      }
    },
  });

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.client = this.network
      .newBuilder()
      .addInterceptor(this.rateLimiter)
      .addInterceptor(new ComposedImageInterceptor())
      .addInterceptor(new ErrorNormalizer())
      .build();
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1 } = options ?? {};
    const buildId = await this.getBuildId();
    const url = this.buildSearchUrl(buildId, query!, page);

    const response = await this.fetchWithRetry(url);
    return this.parseSearchResult(response);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    return this.getIndexSeries(options, "latest");
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    return this.getIndexSeries(options, "popular");
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const buildId = await this.getBuildId();
    const url = this.buildSeriesUrl(buildId, query);

    const response = await this.fetchWithBuildIdRetry(url);

    if (!this.isValidSeriesResponse(response.data)) {
      throw new Error("Invalid series response structure");
    }

    return this.parseSeriesData(response.data, query);
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const buildId = await this.getBuildId();
    const url = new URL(`_next/data/${buildId}${query}.json`, this.baseUrl);

    const response = await this.fetchWithBuildIdRetry(url.toString());
    const chapter = await this.parseChapterData(response.data);

    if (!chapter) return [];

    return chapter.imageUrls.map((url, index) => ({
      index,
      url,
    }));
  };

  override getChapters: GetMangaChapters = async (query) => {
    const buildId = await this.getBuildId();
    const url = `${this.baseUrl}/_next/data/${buildId}${query}.json`;

    const response = await this.fetchWithBuildIdRetry(url);
    if (!response.data?.pageProps?.chapters) return [];

    return this.parseChapters(response.data.pageProps.chapters);
  };

  private async getIndexSeries(
    options: Record<string, any> = {},
    type: "popular" | "latest",
  ): Promise<SeriesListResponse<Manga>> {
    const buildId = await this.getBuildId();
    const url = `${this.baseUrl}/_next/data/${buildId}/index.json`;
    const response = await this.fetchWithRetry(url, {
      options: {
        config: {
          responseType: "json",
        },
      },
    });

    return this.processSeriesList(response.data, options, type);
  }

  // Helpers
  private isValidSeriesResponse(json: any): boolean {
    return Boolean(json?.pageProps?.series);
  }

  private buildSearchUrl(buildId: string, query: string, page: number): string {
    const url = new URL(`/_next/data/${buildId}/browse.json`, this.baseUrl);
    url.searchParams.set("q", this.sanitizeQuery(query));
    url.searchParams.set("page", String(Math.max(1, page)));
    return url.toString();
  }

  private buildSeriesUrl(buildId: string, query: string): string {
    return `${this.baseUrl}/_next/data/${buildId}${query}.json`;
  }

  private parseSearchResult(response: AxiosResponse): SeriesListResponse<Manga> {
    const json = response.data;
    const searchParams = new URL(response.config.url!).searchParams;
    const query = searchParams.get("q") || "";
    const page = Math.max(Number.parseInt(searchParams.get("page") || "1", 10), 1);

    const seriesList = json?.pageProps?.series || [];

    const filtered = this.filterSeries(seriesList, query);
    const totalItems = filtered.length;

    const startIndex = (page - 1) * this.SEARCH_PER_PAGE;
    const endIndex = Math.min(startIndex + this.SEARCH_PER_PAGE, totalItems);
    const paginated = filtered.slice(startIndex, endIndex);

    const mapped = paginated.map((series) => this.mapSeriesListItem(series));
    const hasMore = endIndex < mapped.length;
    return {
      data: mapped,
      hasMore,
    };
  }

  private processSeriesList(
    json: any,
    options: Record<string, any> = {},
    type: "popular" | "latest",
  ): SeriesListResponse<Manga> {
    const { page = 1, limit = 20 } = options ?? {};

    const seriesPath =
      type === "popular"
        ? json?.pageProps?.popularEntries?.blocks?.[0]?.series
        : json?.pageProps?.latestEntries?.blocks?.[0]?.series;

    const seriesList = seriesPath || [];
    const mappedSeries = seriesList.map((series: any) => this.mapSeriesListItem(series));
    const paginatedData = this.paginateResults(mappedSeries, page, limit as number);

    const totalItems = seriesList.length;

    return {
      data: paginatedData as unknown as SeriesListResponse<Manga>["data"],

      hasMore: page * (limit as number) < totalItems,
    };
  }

  private mapSeriesListItem(series: any): SeriesListResponse<Manga>["data"][number] {
    return {
      title: series.title,
      status: this.getSeriesStatus(series.status),
      coverImageUrl: this.buildCoverImageUrl(series.series_id, series.cover, series.last_edit),
      url: `/series/${series.series_id}`,
      isNsfw: this.detectNsfw(series.title, series.description, series.categories),
    };
  }

  private filterSeries(seriesList: any[], query: string): any[] {
    const normalizedQuery = this.sanitizeQuery(query);
    if (!normalizedQuery) return seriesList;

    return seriesList.filter((series) => {
      const title = this.sanitizeQuery(series.title);
      const altTitles = this.parseAltTitles(series.altTitles).map((t) => this.sanitizeQuery(t));

      return title.includes(normalizedQuery) || altTitles.some((t) => t.includes(normalizedQuery));
    });
  }

  private paginateResults<T>(items: T[], page: number, perPage: number): T[] {
    const startIndex = (page - 1) * perPage;
    return items.slice(startIndex, startIndex + perPage);
  }

  private async parseChapterData(json: any): Promise<(Chapter & { imageUrls: string[] }) | null> {
    try {
      const { chapter } = json?.pageProps || {};

      if (!chapter) {
        return null;
      }

      const images = this.extractChapterImages(chapter);

      if (images.length === 0) {
        return null;
      }

      return {
        imageUrls: images,
        title: chapter?.chapter ? `Chapter ${chapter.chapter}` : "",
        url: `/series/${chapter?.series_id}/${chapter?.token}`,
        languageKey: "en",
        chapterNumber: this.toNumberOrNull(chapter.chapter, true),
      };
    } catch (error) {
      console.error("Failed to parse chapter data", { error });
      return null;
    }
  }

  private parseSeriesData(json: any, query: string): Manga {
    const { series } = json.pageProps;

    return {
      title: series.title,
      alternateTitles: this.parseAltTitles(series.altTitles),
      description: series.description || "",
      genres: series.tags || [],
      authors: series.author,
      artists: series.artist,
      status: this.getSeriesStatus(series.status),
      coverImageUrl: this.buildCoverImageUrl(series.series_id, series.cover, series.last_edit),
      isNsfw: this.detectNsfw(series.title, series.description, series.tags),
      url: `${query}`,
    };
  }

  private parseChapters(chaptersList: any[]): Chapter[] {
    const chapters: Chapter[] = [];

    chaptersList?.forEach((chapter, i) => {
      const url = `/series/${chapter.series_id}/${chapter.token}`;

      chapters.push({
        title: chapter?.chapter ? `Chapter ${chapter.chapter}` : `Chapter ${i + 1}`,
        url,
        languageKey: "en",
        chapterNumber: this.toNumberOrNull(chapter.chapter, true),
      });
    });
    return this.addChapterNavigation(chapters?.reverse()) || [];
  }

  private extractChapterImages(chapter: any): string[] {
    return Object.values(chapter?.images || []).map((image: any) =>
      this.buildChapterImageUrl(chapter.series_id, chapter.token, image.name),
    );
  }

  private parseAltTitles(altTitles: string): string[] {
    try {
      const parsed = JSON.parse(altTitles || "[]");
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  private buildCoverImageUrl(id: string, cover: string, lastEdit: string): string | null {
    if (!(id && cover)) return null;

    const base = new URL("_next/image", this.baseUrl);
    const imageUrl = `${this.CDN_URL}/uploads/images/series/${id}/${cover}?/${lastEdit}`;
    base.searchParams.set("cover", "1");
    base.searchParams.set("url", imageUrl);
    base.searchParams.set("w", String(this.COVER_IMAGE_WIDTH));
    base.searchParams.set("q", String(this.IMAGE_QUALITY));

    return base.toString();
  }

  private buildChapterImageUrl(seriesId: string, token: string, imageName: string): string {
    const imageUrl = new URL(
      `uploads/images/series/${seriesId}/${token}/${imageName}`,
      this.CDN_URL,
    );
    return imageUrl.toString();
  }

  private async fetchBuildId(html?: string): Promise<string> {
    let content: string = html || "";
    if (!content) {
      content = await this.client.get<string>(this.baseUrl).then((res) => res.data);
    }
    const $ = cheerio.load(content);
    const scriptContent = $("script#__NEXT_DATA__").text();

    if (!scriptContent) {
      throw new Error("__NEXT_DATA__ script not found");
    }

    const json = JSON.parse(scriptContent);
    const buildId = json.buildId;

    if (!buildId) {
      throw new Error("Build ID not found in __NEXT_DATA__");
    }

    return buildId;
  }

  private async getBuildId(): Promise<string> {
    if (this.buildIdCache) {
      const isExpired = Date.now() - this.buildIdCache.timestamp > this.BUILD_ID_CACHE_TTL;
      if (!isExpired) return this.buildIdCache.id;
    }

    const buildId = await this.fetchBuildId();
    this.buildIdCache = {
      id: buildId,
      timestamp: Date.now(),
    };

    return buildId;
  }

  private sanitizeQuery(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim();
  }

  private async fetchWithBuildIdRetry(url: string, retryCount = 3): Promise<AxiosResponse> {
    const response = await this.fetchWithRetry(url, {
      retryCount,
    });

    if (this.shouldRetryWithNewBuildId(response, url)) {
      return this.handleBuildIdRetry(response, url);
    }

    return response;
  }

  private shouldRetryWithNewBuildId(response: AxiosResponse, url: string): boolean {
    const urlObj = new URL(url);
    const status = response.status;
    return !!(
      status >= 500 &&
      urlObj.hostname === new URL(this.baseUrl).hostname &&
      urlObj.pathname.startsWith("/_next/data/") &&
      !urlObj.hash.includes("DO_NOT_RETRY") &&
      (response.headers["Content-Type"] as string)?.includes("text/html")
    );
  }

  private async handleBuildIdRetry(
    response: AxiosResponse,
    originalUrl: string,
  ): Promise<AxiosResponse> {
    try {
      const html = await response.data;
      const newBuildId = await this.fetchBuildId(html);

      // Update cache with new build ID
      this.buildIdCache = {
        id: newBuildId,
        timestamp: Date.now(),
      };

      const url = new URL(originalUrl);
      const segments = url.pathname.split("/");
      segments[3] = newBuildId;
      url.pathname = segments.join("/");
      url.hash = "#DO_NOT_RETRY";

      return this.fetchWithRetry(url.toString(), {
        retryCount: 2,
      });
    } catch (error) {
      console.error("Build ID retry failed", { originalUrl, error });
      throw new Error("Failed to retry with new build ID");
    }
  }
}
