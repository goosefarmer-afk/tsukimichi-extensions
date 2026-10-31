import {
  resolveFilterEntries,
  type Anime,
  type Episode,
  type ExtensionClientConstructorOptions,
  type GetEpisodes,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type GetVideos,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import type { AxiosHeaders, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import { SortFilter } from "./filters";
import manifest from "./manifest.json";
import type { SearchResponse } from "./types";
import { StringUtils } from "@/utils/string";
import { ErrorNormalizer } from "@/lib/network/interceptors/error-normalizer";

export class HentaiHaven extends BaseAnimeScraper {
  #apiUrl = `${this.baseUrl}/api`;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.client = this.network.newBuilder().addInterceptor(new ErrorNormalizer()).build();
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL(`/browse/trending`, this.baseUrl);
    if (page > 1) {
      url.pathname += `/page/${page}/`;
    }
    const { data } = await this.client.get(url.toString(), { headers: this.headersBuilders() });

    const $ = cheerio.load(data, { baseURI: this.baseUrl });

    const animeList: Anime[] = [];

    $("a[href^='/watch/']:has(img)").each((_, el) => {
      const $el = $(el);

      const urlFromElement = $el.attr("href");
      if (!urlFromElement) return;

      const $img = $el.find("img").first();
      if (!$img.length) return;
      const coverImageUrl = $img.prop("src")?.replace(" ", "%20") || null;

      const title = $img.attr("alt");
      if (!title) return;

      animeList.push({
        url: this.setUrlWithoutDomain(urlFromElement),
        isNsfw: true,
        status: "unknown",
        coverImageUrl: this.toAbsoluteUrl(coverImageUrl),
        title,
      });
    });

    const hasMore =
      $("nav[aria-label='Archive pages'] a[rel=next]:not([aria-disabled=true])").length > 0;

    return {
      data: animeList,
      hasMore,
    };
  };

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const page = options?.page || 1;
    const { data } = await this.searchSeriesRequest<SearchResponse>("", {
      ...options,
      filters: {
        [SortFilter.key]: "latest",
      },
    });

    return this.parseSearchResponse(data, page);
  };

  private parseSearchResponse(
    response: SearchResponse,
    currentPage: number,
  ): SeriesListResponse<Anime> {
    console.log(response);
    const animeList = response.data
      .map((item) => {
        if (!item.slug) return null;

        return {
          id: item.slug,
          extensionId: this.extensionMetadata.id,
          source: this.name,
          url: `/watch/${item.slug}`,
          isNsfw: true,
          status: "unknown",
          title: item.title?.rendered || "",
          coverImageUrl: item.meta?.vraven_remote_thumbnail || null,
        };
      })
      .filter(Boolean) as Anime[];

    const hasMore = response.totalPages != null && currentPage < response.totalPages;

    return {
      data: animeList,
      hasMore,
    };
  }

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const page = options?.page || 1;
    const { data } = await this.searchSeriesRequest<SearchResponse>(query, options);

    return this.parseSearchResponse(data, page);
  };

  private async searchSeriesRequest<T>(
    query?: string,
    options?: Record<string, any>,
  ): Promise<AxiosResponse<T>> {
    const { page = 1, filters } = options ?? {};

    const url = new URL(`${this.#apiUrl}/manga`);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("per_page", "20");

    if (query?.trim()) {
      url.searchParams.set("search", query.trim());

      return await this.client.get<T>(url.toString(), {
        headers: this.headersBuilders(),
      });
    }

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value);
          break;
        default:
          break;
      }
    }

    return await this.client.get<T>(url.toString(), {
      headers: this.headersBuilders(),
    });
  }

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data } = await this.client.get<string>(url.toString(), {
      headers: this.headersBuilders(),
    });
    const $ = cheerio.load(data);

    const title = $("div.grid > h1").text().trim();
    const coverImageUrl = $("div.flex > div.relative > img.object-cover").attr("src") || null;

    const genres = new Set(
      $("div.flex > span:contains('Genres')")
        .parent()
        .children("a[href*='/series/']")
        .map((_, el) => $(el).text())
        .get()
        .filter(Boolean),
    );
    const studios = new Set(
      $("div.flex > span:contains('Studio')")
        .parent()
        .children("a[href*='/studio/']")
        .map((_, el) => $(el).text())
        .get()
        .filter(Boolean),
    );

    const ratingText = $("span[aria-label^='Average rating'] > span").text().trim();
    const rating = this.toNumberOrNull(ratingText, true);

    let description = $("div.relative > p").text().trim().replace(/\n/g, "").replace(/\s+/g, " ");
    const views = $('span[aria-label$="total views"] > span').text().trim();

    if (views) {
      description += `<br>Views: ${views}`;
    }

    return {
      id: this.slugify(title),
      extensionId: this.extensionMetadata.id,
      source: this.name,
      title,
      coverImageUrl,
      isNsfw: true,
      status: "unknown",
      url: query,
      description,
      genres: Array.from(genres),
      studios: Array.from(studios),
      rating,
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data } = await this.client.get<string>(url.toString(), {
      headers: this.headersBuilders(),
    });
    const $ = cheerio.load(data);

    const episodes: Episode[] = [];

    $(`a[data-episode-preview-hover][href^="${query}/episode-"]`).each((_, el) => {
      const $el = $(el);
      const urlFromElement = $el.attr("href");
      const slug = urlFromElement?.split("/").filter(Boolean).at(-1);
      if (!urlFromElement || !slug?.startsWith("episode-")) return;

      const title = $el.find("p.font-bold").first().text().trim();
      const numMatch = this.EPISODE_NUMBER_REGEX.exec(StringUtils.removePrefix(slug, "episode-"));
      const number = numMatch?.[1] ? this.toNumberOrNull(numMatch?.[1], true) : null;
      const hasSuffix = Boolean(numMatch?.[2]);

      const lastUpdatedText = $el.find("div:nth-child(2) > p:nth-child(2)").text().trim();
      const lastUpdated = this.parseSeriesDate(lastUpdatedText);

      episodes.push({
        title,
        url: this.setUrlWithoutDomain(urlFromElement),
        episodeNumber: number === null ? null : hasSuffix ? number + 0.5 : number,
        lastUpdated,
      });
    });

    return episodes.toReversed();
  };

  override getVideos: GetVideos = async (episodeUrl) => {
    const url = new URL(episodeUrl, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString(), {
      responseType: "text",
      headers: this.headersBuilders(),
    });
    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    const playlistUrl =
      $('video source[type="application/vnd.apple.mpegurl"]').first().prop("src") ||
      $("source[data-hhaven-indexable-source]").first().prop("src") ||
      this.extractContentUrlFromJsonLd($);

    if (!playlistUrl) return [];
    return [
      {
        label: "Video",
        url: playlistUrl,
        headers: {
          Referer: url.toString(),
          Origin: this.baseUrl,
          "Accept-Encoding": "identity",
          Accept: "application/x-mpegURL, application/vnd.apple.mpegurl, */*;q=0.8",
        },
        type: "application/vnd.apple.mpegurl",
      },
    ];
  };

  private extractContentUrlFromJsonLd($: cheerio.CheerioAPI): string | null {
    const json = $('script[type="application/ld+json"]:contains("VideoObject")').first().text();

    try {
      return JSON.parse(json).contentUrl || null;
    } catch {
      return null;
    }
  }

  override getSeriesStatus: GetSeriesStatus = () => "unknown";

  override getFilterConfig: GetFilterConfig = () => {
    return {
      header: "Note: Filters are ignored if search query is provided",
      filters: [SortFilter],
    };
  };

  protected override headersBuilders(): AxiosHeaders {
    const headers = super.headersBuilders();
    headers.set("User-Agent", "Tsukimichi/1.0.0");
    return headers;
  }

  private EPISODE_NUMBER_REGEX = /^(\d+(?:\.\d+)?)(-.+)?$/;
}
