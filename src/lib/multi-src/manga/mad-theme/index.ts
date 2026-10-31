import {
  resolveFilterEntries,
  type Chapter,
  type ExtensionClientConstructorOptions,
  type ExtensionMetadata,
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
import { type AxiosInstance, type AxiosResponse, isAxiosError } from "axios";
import * as cheerio from "cheerio";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import { ErrorNormalizer } from "@/lib/network/interceptors/error-normalizer";

export class MadTheme extends BaseMangaScraper {
  private imageClient: AxiosInstance;

  constructor(options: ExtensionClientConstructorOptions & { metadata: ExtensionMetadata }) {
    super(options);

    this.imageClient = this.network
      .newBuilder()
      .addInterceptor({
        name: "image-fallback-interceptor",
        onResponseError: (error) => this.handleImageResponseError(error),
      })
      .addInterceptor(new ErrorNormalizer())
      .build();
  }

  private async handleImageResponseError(error: unknown): Promise<AxiosResponse> {
    if (isAxiosError(error) && error.response) {
      const { response, config } = error;

      if (!config || !config.url) {
        return Promise.reject(error);
      }

      const url = new URL(config.url);

      if (
        !response.status.toString().startsWith("2") &&
        url.hash === "#image-request" &&
        !(config as any)._retried
      ) {
        (config as any)._retried = true;

        url.hostname = "sb.mbcdn.xyz";
        url.pathname = url.pathname.replace(/^\/res\//, "/");
        url.hash = "";

        config.url = url.toString();

        return this.imageClient(config);
      }
    }

    return Promise.reject(error);
  }

  protected searchMangaRequest(
    query?: string,
    options?: Record<string, any>,
  ): Promise<AxiosResponse> {
    const { page = 1, filters } = options ?? {};

    const url = new URL("search", this.baseUrl);
    if (query?.trim()) url.searchParams.set("q", query);
    url.searchParams.set("page", page.toString());

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (value === "any") continue;

      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value);
          break;
        default:
          break;
      }
    }

    return this.client.get(url.toString());
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { data: html } = await this.searchMangaRequest(query, options);

    return this.parseSeriesList({
      html,
      selector: this.searchSeriesSelector,
      nextPageSelector: this.searchSeriesNextPageSelector,
    });
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("popular", this.baseUrl);
    url.searchParams.set("page", page.toString());

    const { data: html } = await this.client.get<string>(url.toString());

    return this.parseSeriesList({
      html,
      selector: this.popularSeriesSelector,
      nextPageSelector: this.popularSeriesNextPageSelector,
    });
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("latest", this.baseUrl);
    url.searchParams.set("page", page.toString());

    const { data: html } = await this.client.get<string>(url.toString());

    return this.parseSeriesList({
      html,
      selector: this.latestSeriesSelector,
      nextPageSelector: this.latestSeriesNextPageSelector,
    });
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const manga = this.parseSeriesDetails(html);
    manga.url = url.pathname;

    return manga;
  };

  protected async chapterListRequest<T>(query: string): Promise<AxiosResponse<T>> {
    if (this.useLegacyApi) {
      const mangaId = this.MANGA_ID_REGEX.exec(query)?.[1];
      const url = new URL(this.baseUrl);
      if (mangaId) {
        url.pathname = "service/backend/chaplist/";
        url.searchParams.set("manga_id", mangaId);
        return this.client.get(url.toString());
      }

      url.pathname = query;

      return this.client.get(url.toString());
    }

    const url = new URL(query, this.baseUrl);

    return await this.client.get(url.toString());
  }

  override getChapters: GetMangaChapters = async (query) => {
    const { data } = await this.chapterListRequest<string>(query);

    const $ = cheerio.load(data);

    const bookIdScript = $("script:contains(bookId = )").first().text().trim();

    const bookId = bookIdScript.match(/bookId\s*=\s*([\d]+)/)?.[1];
    const bookSlug = bookIdScript.match(/bookSlug\s*=\s*"([^"]+)"/)?.[1];

    const hasMore = $("div#show-more-chapters > span").attr("onclick") === "getChapters()";

    if (hasMore) {
      const { data } = await this.client.get(
        `${this.baseUrl}/api/manga/${this.useSlugSearch ? bookSlug : bookId}/chapters`,
        {
          params: {
            source: "detail",
          },
          responseType: "text",
          headers: {
            Referer: `${this.baseUrl}/`,
          },
        },
      );
      const chapters = this.chaptersFromHtml(data);

      return this.addChapterNavigation(chapters);
    }

    const chapters = this.chaptersFromHtml(data);

    return this.addChapterNavigation(chapters);
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data } = await this.client.get<string>(url.toString());

    let content: string | null = null;

    const mangaId = this.MANGA_ID_REGEX.exec(data)?.[1];
    const chapterId = this.CHAPTER_ID_REGEX.exec(data)?.[1];

    if (mangaId && chapterId) {
      const { data: chapterData } = await this.client.get(
        `${this.baseUrl}/service/backend/chapterServer/`,
        {
          params: {
            server_id: "1",
            chapter_id: chapterId,
          },
          headers: {
            Referer: `${this.baseUrl}/`,
          },
        },
      );
      content = chapterData;
    } else {
      content = data;
    }

    const $ = cheerio.load(content || "");

    if (!content?.includes('var mainServer = "')) {
      const chapterImagesFromHtml = $("#chapter-images img, .chapter-image[data-src]");

      if (content?.includes("var chapImages =")) {
        const chapterImagesFromJs =
          content.match(/var chapImages = '([^']+)';/)?.[1]?.split(",") || [];
        const allHaveHost = chapterImagesFromJs.every(
          (img) => img.startsWith("https://") || img.startsWith("http://"),
        );
        if (allHaveHost && chapterImagesFromHtml.length < chapterImagesFromJs.length) {
          console.log("allHaveHost", allHaveHost);
          return chapterImagesFromJs.map((img, index) => ({
            index,
            url: img,
          }));
        }
      }

      return chapterImagesFromHtml.get().map((el, index) => {
        const $el = $(el);
        const url = this.resolveImageUrl($el);

        return {
          url,
          index,
        };
      });
    }

    const mainServer = content.slice(content.indexOf('var mainServer = "') + 18).split('"')[0];
    const schemePrefix = mainServer?.startsWith("//") ? "https:" : "";

    const chapImages = content
      ?.slice(content.indexOf("var chapImages = '") + 18)
      .split("'")?.[0]
      ?.split(",");

    return (
      chapImages?.map((path, index) => ({
        index,
        url: `${schemePrefix}${mainServer}${path}`,
      })) || []
    );
  };

  override getImage: GetImage = async (url) => {
    if (!url.endsWith("#image-request")) url += "#image-request";

    const { data, headers } = await this.imageClient.get(url, {
      headers: this.getImageHeaders(),
      responseType: "arraybuffer",
    });

    return {
      data,
      contentType: ((headers["content-type"] || headers["Content-Type"]) as string) || "image/jpeg",
    };
  };

  private resolveImageUrl($el: cheerio.Cheerio<any>): string {
    const dataSrc = $el.attr("data-src");
    let raw = $el.attr("onerror");
    raw = raw?.split("this.src='")[1]?.split("'")[0];

    const fallback = () => {
      if (raw?.startsWith("https://") || raw?.startsWith("http://")) return raw;
      if (raw?.startsWith("//")) return `https:${raw}`;
      return dataSrc;
    };

    if (dataSrc?.includes("://s20.")) return fallback()!;

    return `${dataSrc}#${fallback()}`;
  }

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "status",
        label: "Status",
        type: "select",
        options: [
          {
            value: "any",
            label: "All",
          },
          {
            value: "ongoing",
            label: "Ongoing",
          },
          {
            value: "completed",
            label: "Completed",
          },
        ],
      },
      {
        key: "sort",
        label: "Order by",
        options: [
          {
            value: "any",
            label: "All",
          },
          {
            label: "Views",
            value: "views",
          },
          {
            label: "Updated at",
            value: "updated_at",
          },
          {
            label: "Created at",
            value: "created_at",
          },
          {
            label: "Alphabetical(A-Z)",
            value: "name",
          },
          {
            label: "Rating",
            value: "rating",
          },
        ],
        type: "select",
      },
    ],
  });

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "ongoing":
        return "ongoing";
      case "completed":
        return "completed";
      case "on-hold":
        return "hiatus";
      case "canceled":
      case "cancelled":
        return "cancelled";
      default:
        return "unknown";
    }
  };

  protected parseSeriesDetails(html: string): Manga {
    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    const title = $(".detail h1").text().trim();
    const authors = $('.detail .meta a[href*="/authors/"]')
      .map((_, el) => $(el).text().replace(",", "").trim())
      .get()
      .filter(Boolean);
    const genres = $('.detail .meta a[href*="/genres/"]')
      .map((_, el) => $(el).text().replace(",", "").trim())
      .get()
      .filter(Boolean);
    let coverImageUrl = $("#cover img").attr("data-src") || null;
    if (coverImageUrl?.trim()) coverImageUrl += "#image-request";

    const description = $(".summary .content, .summary .content ~ p").text().trim();
    const alternateTitles = $(".detail h2")
      .text()
      .trim()
      .split(",")
      .map((el) => el.trim())
      .filter(Boolean);

    const statusText = $(".detail .meta > p > strong:contains(Status) ~ a").text().trim();

    const lastUpdatedText = $(".detail .meta > p > strong:contains('Last update') ~ span")
      .text()
      .trim();

    return {
      title,
      authors,
      genres,
      coverImageUrl,
      url: "",
      alternateTitles,
      isNsfw: this.detectNsfw(title, description, genres),
      status: this.getSeriesStatus(statusText),
      description,
      lastUpdated: this.parseSeriesDate(lastUpdatedText),
    };
  }

  protected chaptersFromHtml(html: string): Chapter[] {
    const $ = cheerio.load(html);
    const chapters: Chapter[] = [];

    $("ul#chapter-list li").each((_, el) => {
      const $el = $(el);

      const $anchor = $el.find("a").first();
      const chapterUrlFromHtml = $anchor.attr("href")!;
      const title = $anchor.find(".chapter-title").text().trim();

      const chapterUrl = new URL(chapterUrlFromHtml, this.baseUrl).pathname;

      chapters.push({
        title,
        url: `${chapterUrl}`,
        languageKey: "multi",
        lastUpdated: this.parseSeriesDate($anchor.find(".chapter-update").text()),
      });
    });

    return chapters.reverse();
  }

  protected parseSeriesList(options: {
    html: string;
    selector?: string;
    nextPageSelector: string;
  }): SeriesListResponse<Manga> {
    const { html, selector = this.searchSeriesSelector, nextPageSelector } = options;
    const data: Manga[] = [];

    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    $(selector).each((_, el) => {
      const $el = $(el);
      const $anchor = $el.find("a").first();

      const title = $anchor.attr("title")?.trim() || "";
      let coverImageUrl = $el.find("img").first().attr("data-src") || null;
      if (coverImageUrl?.trim()) {
        coverImageUrl += "#image-request";
      }

      const url = $anchor.attr("href")!;
      const genres = $el
        .find(".genres span")
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean);
      const description = $el.find(".summary").text().trim();

      data.push({
        title,
        coverImageUrl,
        url,
        status: "unknown",
        isNsfw: this.detectNsfw(title, description, genres),
      });
    });

    return {
      data,
      hasMore: $(nextPageSelector).length > 0,
    };
  }

  protected seriesListPagination(options: {
    html: string;
    currentPage: number;
    selector?: string;
  }) {
    const { html, currentPage, selector = this.searchSeriesNextPageSelector } = options;
    const $ = cheerio.load(html);
    const hasMore = $(selector).length > 0;

    return {
      hasMore,
      nextPage: hasMore ? currentPage + 1 : null,
    };
  }

  protected searchSeriesSelector = ".book-detailed-item";
  protected searchSeriesNextPageSelector = ".paginator > a.active + a:not([rel=next])";

  protected popularSeriesSelector = this.searchSeriesSelector;
  protected popularSeriesNextPageSelector = this.searchSeriesNextPageSelector;

  protected latestSeriesSelector = this.searchSeriesSelector;
  protected latestSeriesNextPageSelector = this.searchSeriesNextPageSelector;

  protected useLegacyApi = false;

  protected useSlugSearch = false;

  private readonly MANGA_ID_REGEX = /\/manga\/(\d+)-/;
  private readonly CHAPTER_ID_REGEX = /chapterId\s*=\s*(\d+)/;
}
