import { Mutex } from "async-mutex";
import {
  resolveFilterEntries,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetImage,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { AxiosHeaders, isAxiosError } from "axios";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import { FILTERS } from "./filters";
import manifest from "./manifest.json";
import {
  type DrmResponse,
  type OpenResponse,
  type PageKeys,
  type PhiliaChapterResponse,
  type PhiliaMangaDetailsResponse,
  type PhiliaSeriesResponse,
  toChapter,
  type TokenResponse,
  toManga,
  type ViewerResponse,
} from "./types";
import { ImageInterceptor } from "./image-interceptor";
import { ErrorNormalizer } from "@/lib/network/interceptors/error-normalizer";

// TODO: add webview integration
export class PhiliaScans extends BaseMangaScraper {
  private readonly apiUrl = `${this.baseUrl}/api`;
  private tokenMutex = new Mutex();

  private imageClient: AxiosInstance;

  private cachedToken: string | null = null;
  private cachedExpiresAtMs = 0;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.imageClient = this.network
      .newBuilder()
      .addInterceptor(new ImageInterceptor())
      .addInterceptor(new ErrorNormalizer())
      .build();
  }

  private searchMangaRequest(
    query?: string,
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<PhiliaSeriesResponse>> {
    const { page = 1, filters } = options ?? {};

    const url = new URL(`${this.apiUrl}/manga`, this.apiUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("perPage", "20");

    if (query?.trim()) url.searchParams.set("q", query.trim());

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (value === "any") continue;

      switch (type) {
        case "select": {
          url.searchParams.set(filter.key, value);
          break;
        }

        case "multi-select": {
          value.forEach((v) => {
            url.searchParams.append(filter.key, v);
          });

          break;
        }
        default:
          break;
      }
    }

    return this.client.get(url.toString(), requestConfig);
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { data } = await this.searchMangaRequest(query, options);

    return this.parsePopularManga(data);
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { data } = await this.searchMangaRequest("", {
      ...options,
      filters: {
        orderby: "views",
        order: "desc",
      },
    });

    return this.parsePopularManga(data);
  };

  private parsePopularManga(response: PhiliaSeriesResponse): SeriesListResponse<Manga> {
    const mangaList: Manga[] = [];

    response.items.forEach((item) => {
      mangaList.push({
        title: item.title,
        url: item.slug,
        isNsfw: null,
        coverImageUrl: item.coverImageUrl?.startsWith("http")
          ? item.coverImageUrl
          : item.coverImageUrl
            ? `${this.baseUrl}/${item.coverImageUrl}`
            : null,
        status: "unknown",
      });
    });

    const hasMore = response.page < response.totalPages;

    return {
      data: mangaList,
      hasMore,
    };
  }

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { data } = await this.searchMangaRequest("", {
      ...options,
      filters: {
        orderby: "any",
        order: "desc",
      },
    });

    return this.parsePopularManga(data);
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(`${this.apiUrl}/manga/${query}`, this.apiUrl);

    const { data } = await this.client.get<PhiliaMangaDetailsResponse>(url.toString());

    return toManga({
      manga: data,
      metadata: this.extensionMetadata,
      query,
      toNumberOrNull: this.toNumberOrNull,
    });
  };

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(`${this.apiUrl}/manga/${query}/chapters`);

    const { data } = await this.client.get<PhiliaChapterResponse>(url.toString());

    const chapters = data.items
      .map((chapter) =>
        chapter.coinPrice !== null && chapter.coinPrice > 0
          ? null
          : {
              ...toChapter(chapter, query),
              chapterNumber: this.toNumberOrNull(chapter.number, true),
            },
      )
      .filter((chapter) => chapter != null)
      .reverse();

    return chapters;
  };

  private chapterPagesRequest(query: string): Promise<AxiosResponse<ViewerResponse>> {
    const [mangaSlug, chapterSlug] = query.split("/").filter(Boolean);

    const url = new URL(`${this.apiUrl}/manga/${mangaSlug}/chapters/${chapterSlug}`);
    return this.client.get<ViewerResponse>(url.toString());
  }

  private getReaderAccessToken(forceRefresh = false) {
    return this.tokenMutex.runExclusive(async () => {
      const now = Date.now();

      if (!forceRefresh && this.cachedToken && this.cachedExpiresAtMs - now > this.TOKEN_SKEW_MS) {
        return this.cachedToken;
      }

      const { data, status } = await this.client.post<TokenResponse>(
        `${this.apiUrl}/reader/access-token`,
        null,
        {
          headers: this.tokenHeaders(),
          validateStatus: () => true,
        },
      );

      this.assertSuccessfulStatus(status, "Failed to get reader token");

      this.cachedToken = data.token;
      this.cachedExpiresAtMs = data.expiresAt * 1000;

      return data.token;
    });
  }

  private assertSuccessfulStatus(status: number, operation: string): void {
    if (status === 200) {
      return;
    }

    switch (status) {
      case 401:
        throw new Error("Log in via BrowserWindow to renew access.");
      case 429:
        throw new Error("Rate limited by Philia Scans. Wait a moment and try again.");
      default:
        throw new Error(`${operation} (HTTP ${status}).`);
    }
  }

  private async fetchPageKeys(chapterId: number, token: string) {
    const requestPageKeys = (accessToken: string) =>
      this.client.get<PageKeys>(`${this.apiUrl}/chapters/${chapterId}/page-keys`, {
        headers: this.readerHeaders(accessToken),
        validateStatus: () => true,
      });

    let activeToken = token;
    let response = await requestPageKeys(activeToken);

    if (response.status === 404) {
      activeToken = await this.getReaderAccessToken(true);
      response = await requestPageKeys(activeToken);
    }

    this.assertSuccessfulStatus(response.status, "Failed to get page keys");

    return {
      token: activeToken,
      pageKeys: response.data,
    };
  }

  override getChapterPages: GetChapterPages = async (query) => {
    const { data: result } = await this.chapterPagesRequest(query);

    if (!result.hasAccess) {
      throw new Error("Log in via BrowserWindow and purchase this chapter to read.");
    }

    const { chapter } = result;

    const { token, pageKeys } = await this.fetchPageKeys(
      chapter.id,
      await this.getReaderAccessToken(),
    );

    let payloadA: string | null = null;
    let payloadB: string | null = null;

    if (pageKeys.sessionDefault) {
      const { data: openResult } = await this.client.post<OpenResponse>(
        `${this.apiUrl}/chapters/${result.chapter.id}/open`,
        null,
        { headers: this.readerHeaders(token) },
      );
      payloadA = openResult.payloadA;

      try {
        const { data: drmResult } = await this.client.get<DrmResponse>(
          `${this.apiUrl}/chapters/${result.chapter.id}/get-drm`,
          {
            headers: this.readerHeaders(token),
            params: { session: openResult.sessionId },
          },
        );
        payloadB = drmResult.payloadB || null;
      } catch (error) {
        if (!isAxiosError(error) || !error.response) {
          throw error;
        }

        // Preserve the existing behavior for HTTP DRM failures.
        payloadB = null;
      }
    }

    const isScrambled = chapter.scrambled ? "1" : "0";

    return chapter.pages
      .toSorted((a, b) => a.position - b.position)
      .map((page, index) => {
        const imageUrl = new URL(page.url, this.baseUrl);

        imageUrl.searchParams.set("isScrambled", isScrambled);
        imageUrl.searchParams.set("mime", page.mime);
        imageUrl.searchParams.set("chapterKeyB64", encodeURIComponent(pageKeys.chapterKeyB64));
        imageUrl.searchParams.set("gridSize", String(pageKeys.gridSize));
        if (payloadA) {
          imageUrl.searchParams.set("payloadA", payloadA);
        }

        if (payloadB) {
          imageUrl.searchParams.set("payloadB", payloadB);
        }
        imageUrl.searchParams.set("pageIndex", String(index));

        return {
          index,
          url: imageUrl.toString(),
        };
      });
  };

  private tokenHeaders(): AxiosHeaders {
    const headers = new AxiosHeaders();
    headers.set("Accept", "application/json");
    headers.set("Accept-Language", "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6");
    headers.set("Sec-Fetch-Mode", "cors");
    headers.set("X-Requested-With", "XMLHttpRequest");
    return headers;
  }

  private readerHeaders(token: string) {
    return this.tokenHeaders().set("X-Reader-Access-Token", token);
  }

  override getImage: GetImage = async (url) => {
    const { data, headers } = await this.imageClient.get(url, {
      headers: this.getImageHeaders(),
      responseType: "arraybuffer",
    });

    const contentType =
      ((headers["Content-Type"] || headers["content-type"]) as string | undefined) || "image/jpeg";

    return { data, contentType };
  };

  private findPagesInJson(element: any, pagesMap: Map<number, string>) {
    if (!element) return;

    if (typeof element === "object" && !Array.isArray(element)) {
      const src = element["src"] ?? element["url"];
      const pageNumber = element["pageNumber"] ?? element["page"] ?? element["data-page"];

      if (typeof src === "string" && typeof pageNumber === "number" && src.includes("media")) {
        const cleaned = this.cleanImageUrl(src);
        pagesMap.set(pageNumber, cleaned);
      }

      for (const key in element) {
        if (Object.hasOwn(element, key)) {
          this.findPagesInJson(element[key], pagesMap);
        }
      }
    } else if (Array.isArray(element)) {
      for (const item of element) {
        this.findPagesInJson(item, pagesMap);
      }
    }
  }

  override getFilterConfig: GetFilterConfig = () => ({
    filters: FILTERS,
  });

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "releasing":
      case "ongoing":
      case "on going":
        return "ongoing";
      case "completed":
        return "completed";
      case "on hold":
        return "hiatus";
      case "canceled":
      case "cancelled":
        return "cancelled";
      default:
        return "unknown";
    }
  };

  private cleanImageUrl(url: string): string {
    let cleanUrl = url;

    if (cleanUrl.startsWith("//")) {
      cleanUrl = `https:${cleanUrl}`;
    }

    cleanUrl = cleanUrl.replace(/\\u0026/g, "&").replace(/\\u002F/g, "/");

    if (cleanUrl.includes("/_next/image")) {
      const encodedUrl = cleanUrl.split("url=")[1]?.split("&")[0];
      if (encodedUrl) {
        cleanUrl = decodeURIComponent(encodedUrl);
      }
    }

    if (cleanUrl.startsWith("/")) cleanUrl = `${this.baseUrl}${cleanUrl}`;

    cleanUrl = cleanUrl.replace(/\\$/, "");

    try {
      const parsed = new URL(cleanUrl);
      parsed.searchParams.delete("w");
      return parsed.toString();
    } catch {
      return cleanUrl;
    }
  }

  protected override headersBuilders(options?: {
    headers?: AxiosHeaders;
    searchOptions?: Record<string, any>;
  }): AxiosHeaders {
    const headers = new AxiosHeaders(options?.headers);
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    return headers;
  }

  private readonly TOKEN_SKEW_MS = 60_000;

  private readonly MEDIA_URL_REGEX =
    /["']((?:https?:\/\/[^"'/]*)?\/api\/media\/[a-f0-9]{2}\/[a-f0-9]+(?:\.webp|\.jpg|\.png)[^"']*)["']/g;
  private readonly NEXT_FLIGHT_REGEX = /self\.__next_f\.push\(\s*(\[.*])\s*\)\s*;?\s*$/s;
}
