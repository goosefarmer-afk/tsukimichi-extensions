import {
  resolveFilterEntries,
  type Chapter,
  type GetChapterPages,
  type GetImage,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import type { AxiosHeaders, AxiosRequestConfig, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import { substringAfter, substringBefore } from "@/utils/string";
import CryptoJS from "crypto-js";

const NUMBER_EXTRACT_REGEX = /\d+(\.\d+)?/;

export class Madara extends BaseMangaScraper {
  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { data: html } = await this.searchMangaRequest<string>(query!, options);
    return this.parseSearchResult(
      html,
      this.searchSeriesSelector,
      this.searchSeriesNextPageSelector,
    );
  };

  protected async searchMangaRequest<T>(
    query?: string,
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1, filters } = options ?? {};
    const url = new URL(`page/${page}`, this.baseUrl);
    url.searchParams.set("s", query?.trim() || "");
    url.searchParams.set("post_type", "wp-manga");

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          if (value !== "all" && value !== "any") url.searchParams.set(filter.key, value);
          break;
        default:
          break;
      }
    }

    return await this.client.get(url.toString(), {
      headers: this.headersBuilders({
        searchOptions: options,
      }),
      ...requestConfig,
    });
  }

  protected mangaDetailsRequest<T = string>(query: string): Promise<AxiosResponse<T>> {
    const url = new URL(query, this.baseUrl);
    return this.client.get(url.toString(), {
      headers: {
        ...this.headersBuilders(),
      },
    });
  }

  override getSeries: GetSeries<Manga> = async (query) => {
    const { data: html, config } = await this.mangaDetailsRequest(query);

    return this.parseSeriesDetails(html, new URL(config.url!), query);
  };

  protected parseSeriesDetails(html: string, url: URL, query: string): Manga {
    const $ = cheerio.load(html);

    const title = $(this.seriesDetailsTitleSelector).text().trim();

    const alternateTitleText = $(this.seriesDetailsAlternateTitleSelector).text().trim();

    const alternateTitles = this.getAlternateTitlesFromText(alternateTitleText);

    const authors = $(this.seriesDetailsAuthorSelector)
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);

    const artists = $(this.seriesDetailsArtistSelector)
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);
    const genres = $(this.seriesDetailsGenreSelector)
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);

    const mangaUrl = url.toString();

    const statusText = $(this.seriesDetailsStatusSelector).text().trim();

    const tags = $(this.seriesDetailsTagSelector)
      .map((_, el) => $(el).text()?.trim().replace("#", ""))
      .get();
    const description = $(this.seriesDetailsDescriptionSelector).text().trim();
    const ratingText = $(this.seriesDetailsRatingSelector).text().trim();

    const coverImageUrl = this.getImageFromElement($(this.seriesDetailsCoverSelector));

    const manga: Manga = {
      title,
      alternateTitles,
      rating: this.toNumberOrNull(ratingText, true),
      coverImageUrl,
      authors,
      artists,
      genres,
      tags,
      status: this.getSeriesStatus(statusText),
      description,
      isNsfw: genres.length > 0 ? this.detectNsfw(title, description, genres, tags) : null,
      url: this.setUrlWithoutDomain(mangaUrl || query),
    };

    return manga;
  }

  override getChapters: GetMangaChapters = async (query) => {
    const { data } = await this.chaptersRequest<string>(query);
    return await this.parseChapters(data, query);
  };

  protected async parseChapters(
    html: string,
    mangaUrl: string,
    addNavigation = true,
  ): Promise<Chapter[]> {
    const $ = cheerio.load(html);

    const chaptersWrapper = $("div[id^=manga-chapters-holder]");

    let chapterElements = $(this.chapterListItemSelector);

    if (chapterElements.length === 0 && chaptersWrapper.length > 0) {
      const mangaUrlClean = mangaUrl.replace(/\/$/, "");
      const mangaId = chaptersWrapper.attr("data-id")!;

      let xhrRequest =
        this.useNewChapterEndpoint || this.oldChapterEndpointDisabled
          ? this.xhrChaptersRequest(mangaUrlClean, {
              validateStatus: (status) => (status >= 200 && status < 300) || status === 400,
            })
          : this.oldXhrChapterRequest(mangaId, {
              validateStatus: (status) => (status >= 200 && status < 300) || status === 400,
            });
      let xhrResponse = await xhrRequest;

      if (!this.useNewChapterEndpoint && xhrResponse.status === 400) {
        this.oldChapterEndpointDisabled = true;

        xhrRequest = this.xhrChaptersRequest(mangaUrlClean);
        xhrResponse = await xhrRequest;
      }

      chapterElements = $(xhrResponse.data).find(this.chapterListItemSelector);
    }

    const chapters = chapterElements
      .map((_, el) => this.chapterFromElement($(el)))
      .get()
      .filter((chapter) => !!chapter);

    if (addNavigation) {
      return this.addChapterNavigation(chapters?.reverse()) || [];
    }

    return chapters;
  }

  protected chapterFromElement($el: cheerio.Cheerio<any>): Chapter | null {
    const $anchor = $el.find("a");
    const title = $anchor.text().trim();
    const urlFromElement = $anchor.attr("href");

    const lastUpdated = this.parseSeriesDate($el.find("span.chapter-release-date").text().trim());

    if ($anchor.length === 0 || !urlFromElement) {
      return null;
    }

    const url = this.setUrlWithoutDomain(urlFromElement);

    return {
      title,
      url,
      lastUpdated,
      languageKey: title.toLowerCase().includes("raw") ? "multi" : "en",
      chapterNumber: this.toNumberOrNull(title.match(NUMBER_EXTRACT_REGEX)?.[0], true),
      groupName: null,
      volumeNumber: null,
    };
  }

  protected useNewChapterEndpoint = false;

  protected oldChapterEndpointDisabled = false;

  protected async chaptersRequest<T>(query: string): Promise<AxiosResponse<T>> {
    const url = new URL(`${query}/ajax/chapters`, this.baseUrl);

    const response = await this.client.get(url.toString(), {
      headers: this.headersBuilders(),
      responseType: "text",
      // validateStatus: () => true,
    });

    return response;
  }

  protected oldXhrChapterRequest<T = any>(
    mangaId: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const form = new URLSearchParams();
    form.set("action", "manga_get_chapters");
    form.set("manga", mangaId);

    return this.client.post<T>(`${this.baseUrl}/wp-admin/admin-ajax.php`, form.toString(), {
      ...config,
      headers: this.xhrHeaders(),
    });
  }

  protected xhrChaptersRequest<T = any>(
    mangaUrl: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const url = new URL(mangaUrl, this.baseUrl);
    const apiUrl = new URL(`${url.pathname}/ajax/chapters`, this.baseUrl);
    return this.client.post<T>(apiUrl.toString(), config?.data, {
      ...config,
      headers: this.xhrHeaders(),
    });
  }

  protected xhrHeaders(): AxiosHeaders {
    const headers = this.headersBuilders();
    headers.set("X-Requested-With", "XMLHttpRequest");
    return headers;
  }

  protected chapterPageRequest<T = any>(query: string): Promise<AxiosResponse<T>> {
    const url = new URL(query, this.baseUrl);

    return this.client.get(url.toString(), { headers: this.headersBuilders() });
  }

  protected chapterProtectorPasswordPrefix = "wpmangaprotectornonce='";
  protected chapterProtectorDataPrefix = "chapter_data='";
  protected chapterProtectorSelector = "#chapter-protector-data";

  override getChapterPages: GetChapterPages = async (query) => {
    const { data: html } = await this.chapterPageRequest<string>(query);
    const $ = cheerio.load(html);

    const chapterProtector = $(this.chapterProtectorSelector).first();
    if (chapterProtector.length === 0) {
      const imageUrls = $(this.chapterImageSelector)
        .map((_, el) => {
          const $el = $(el);
          const imageUrl = this.getImageFromElement($el.find("img").first());
          return imageUrl;
        })
        .get()
        .filter(Boolean) as string[];

      return imageUrls.map((url, index) => ({
        index,
        url,
      }));
    }

    let chapterProtectorHtml: string;

    const src = chapterProtector.attr("src");

    if (src?.startsWith("data:text/javascript;base64,")) {
      const encoded = src.substring("data:text/javascript;base64,".length);

      chapterProtectorHtml = Buffer.from(encoded, "base64").toString("utf8");
    } else {
      chapterProtectorHtml = chapterProtector.html() ?? "";
    }

    const password = substringBefore(
      substringAfter(chapterProtectorHtml, this.chapterProtectorPasswordPrefix),
      "';",
    );

    const chapterData = JSON.parse(
      substringBefore(
        substringAfter(chapterProtectorHtml, this.chapterProtectorDataPrefix),
        "';",
      ).replace(/\\\//g, "/"),
    );

    const unsaltedCiphertext = Buffer.from(chapterData.ct, "base64");
    const salt = Buffer.from(chapterData.s, "hex");
    const salted = Buffer.from("Salted__", "utf-8");

    const cipherText = Buffer.concat([salted, salt, unsaltedCiphertext]);

    const rawImgArray = this.decryptAES(cipherText.toString("base64"), password);

    const imgArrayString = JSON.parse(rawImgArray);
    const imgArray = JSON.parse(imgArrayString) as string[];

    return imgArray.map((url, index) => ({
      index,
      url,
    }));
  };

  private decryptAES(cipherTextBase64: string, password: string): string {
    const decrypted = CryptoJS.AES.decrypt(cipherTextBase64, password);
    return decrypted.toString(CryptoJS.enc.Utf8);
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { data: html } = await this.popularMangaRequest<string>(options, {
      headers: this.headersBuilders({
        searchOptions: options,
      }),
    });
    return this.parseSearchResult(
      html,
      this.popularSeriesSelector,
      this.popularSeriesNextPageSelector,
    );
  };

  protected async popularMangaRequest<T>(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1 } = options ?? {};

    const url = new URL(`${this.mangaSubString}/page/${page}`, this.baseUrl);
    url.searchParams.set("s", "");
    url.searchParams.set("post_type", "wp-manga");
    url.searchParams.set("m_orderby", "views");
    return await this.client.get(url.toString(), requestConfig);
  }

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { data: html } = await this.latestMangaRequest<string>(options, {
      headers: {
        ...this.headersBuilders({
          searchOptions: options,
        }),
      },
    });

    return this.parseSearchResult(
      html,
      this.latestSeriesSelector,
      this.latestSeriesNextPageSelector,
    );
  };

  protected async latestMangaRequest<T>(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1 } = options ?? {};

    const url = new URL(`${this.mangaSubString}/page/${page}`, this.baseUrl);
    url.searchParams.set("s", "");
    url.searchParams.set("post_type", "wp-manga");
    url.searchParams.set("m_orderby", "latest");

    return await this.client.get(url.toString(), requestConfig);
  }

  protected parseSearchResult = (
    html: string,
    selector = this.searchSeriesSelector,
    nextPageSelector = this.searchSeriesNextPageSelector,
  ): SeriesListResponse<Manga> => {
    const $ = cheerio.load(html);

    const mangaLists: Manga[] = [];

    $(selector).each((_, element) => {
      const $el = $(element);
      const $anchor = $el.find(this.searchSeriesUrlSelector);
      const urlFromElement = $anchor.attr("href");

      if (!urlFromElement) return;

      const title = $anchor.text().trim();

      const coverImageUrl = this.processThumbnail(
        this.getImageFromElement($el.find(this.popularSeriesUrlSelectorImg).first()),
        true,
      );

      const statusText = $el.find(this.statusSelector).text();

      const url = this.setUrlWithoutDomain(urlFromElement);

      mangaLists.push({
        title,
        url,
        coverImageUrl,
        isNsfw: null,
        status: this.getSeriesStatus(statusText),
      });
    });

    return {
      data: mangaLists,
      hasMore: $(nextPageSelector).length > 0,
    };
  };

  protected getChapterNameFromTitle(title: string): string {
    return title.match(/\bChapter\s+\d+\b/i)?.[0] || title;
  }

  override getImage: GetImage = async (url) => {
    const imageHeaders = this.getImageHeaders();

    const { data, headers } = await this.client.get(url, {
      responseType: "arraybuffer",
      headers: imageHeaders,
    });

    const contentType =
      ((headers["Content-Type"] || headers["content-type"]) as string) || "image/jpeg";
    return {
      contentType,
      data,
    };
  };

  protected override headersBuilders(options?: {
    headers?: AxiosHeaders;
    searchOptions?: Record<string, any>;
  }): AxiosHeaders {
    const headers = super.headersBuilders(options);
    headers.set("User-Agent", "Tsukimichi/1.0.0");
    return headers;
  }

  protected get searchSeriesSelector(): string {
    return `div.page-item-detail:not(:has(a[href*='bilibilicomics.com']))${this.mangaEntrySelector}, .manga__item`;
  }
  protected get searchSeriesNextPageSelector(): string {
    return '.wp-pagenavi a[rel="next"], div.nav-previous a';
  }

  protected get mangaEntrySelector() {
    if (this.filterNonMangaItems) return ".manga";
    return "";
  }

  protected get popularSeriesSelector(): string {
    return this.searchSeriesSelector;
  }
  protected get popularSeriesNextPageSelector(): string {
    return this.searchSeriesNextPageSelector;
  }

  protected get latestSeriesSelector(): string {
    return this.popularSeriesSelector;
  }
  protected get latestSeriesNextPageSelector(): string {
    return this.popularSeriesNextPageSelector;
  }

  protected get filterNonMangaItems() {
    return true;
  }

  protected get searchSeriesUrlSelector(): string {
    return "h3 a";
  }

  protected get popularSeriesUrlSelectorImg(): string {
    return "img";
  }

  /**
   * The path used in the URL for the manga pages.
   * Can be changed if needed as some sites use different paths.
   */
  protected get mangaSubString(): string {
    return "manga";
  }

  protected tagSelector = "a[href*='/tags/']";
  protected statusSelector = ".mg_status .summary-content";

  /**
   * Series details selector.
   */
  protected seriesSelector = ".container .tab-summary";

  protected seriesDetailsTitleSelector = "div.post-title h3, div.post-title h1, #manga-title > h1";

  /**
   * Tag selector in the manga details page
   */
  protected seriesDetailsTagSelector = "a[href*='/tags/']";

  /**
   * Genre selector in the manga details page
   */
  protected seriesDetailsGenreSelector = "a[href*='/webtoon-genre/']";

  /**
   * Artist selector in the manga details page
   */
  protected seriesDetailsArtistSelector = "a[href*='/artists/']";

  /**
   * Author selector in the manga details page
   */
  protected seriesDetailsAuthorSelector = "a[href*='/authors/']";

  /**
   * Status selector in the manga details page
   */
  protected seriesDetailsStatusSelector = ".post-content_item:contains('Status') .summary-content";

  /**
   * Alternate title selector in the manga details page
   */
  protected seriesDetailsAlternateTitleSelector =
    ".post-content_item:contains('Alt') .summary-content";

  /**
   * Description selector in the manga details page
   */
  protected seriesDetailsDescriptionSelector =
    "div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt";

  /**
   * Rating selector in the manga details page
   */
  protected seriesDetailsRatingSelector = "#averagerate";

  protected chapterImageSelector =
    "div.page-break, li.blocks-gallery-item, .reading-content .text-left:not(:has(.blocks-gallery-item)) img";

  protected seriesDetailsCoverSelector = ".summary_image img";

  protected chapterListItemSelector = "li.wp-manga-chapter";

  protected getImageFromElement($el: cheerio.Cheerio<any>) {
    const getAttr = (name: string) => $el.attr(name)?.trim() || null;
    const dataSrc = getAttr("data-src");
    const dataLazySrc = getAttr("data-lazy-src");
    const srcset = getAttr("srcset");
    const dataCfsrc = getAttr("data-cfsrc");
    const dataMangaSrc = getAttr("data-manga-src");
    const src = getAttr("src");

    return (
      dataSrc ||
      dataLazySrc ||
      this.getSrcSetImage(srcset) ||
      dataCfsrc ||
      dataMangaSrc ||
      src ||
      null
    );
  }

  protected getSrcSetImage(srcset?: string | null): string | null {
    return (
      srcset
        ?.split(" ")
        .filter((item) => this.URL_REGEX.test(item))
        .sort()
        .pop() || null
    );
  }

  protected processThumbnail(url: string | null, _fromSearch?: boolean): string | null {
    return url;
  }

  protected getAlternateTitlesFromText(text: string): string[] {
    return (
      text
        ?.split(this.alternateTitleDelimiter)
        .map((t) => t.trim())
        ?.filter(Boolean) || []
    );
  }

  /**
   * The delimiter to be used when splitting alternate titles
   */
  protected alternateTitleDelimiter = ",";

  private readonly URL_REGEX = /^(https?:\/\/[^\s/$.?#].[^\s]*)$/;
}
