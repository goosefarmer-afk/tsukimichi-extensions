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
  type Video,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";
import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import { HAHO_MOE_ORDER_BY_OPTIONS, HAHO_MOE_ORDER_OPTIONS } from "./filters";
import manifest from "./manifest.json";

export class HahoMoe extends BaseAnimeScraper {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.client.interceptors.request.use((config) => {
      config.headers = config.headers || {};
      config.headers.Cookie = "loop-view=thumb";
      return config;
    });
  }

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("anime", this.baseUrl);
    url.searchParams.set("page", page.toString());

    const { query: q, orderBy, order } = this.getSearchParams(query, options?.filters);

    url.searchParams.set("s", `${orderBy}${order}`);
    url.searchParams.set("q", q);

    const { data } = await this.client.get<string>(url.toString());

    return this.parseAnimeFromListing(data);
  };

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("anime", this.baseUrl);
    url.searchParams.set("s", "vdy-d");
    url.searchParams.set("page", page.toString());

    const { data } = await this.client.get<string>(url.toString());

    return this.parseAnimeFromListing(data);
  };

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("anime", this.baseUrl);
    url.searchParams.set("s", "rel-d");
    url.searchParams.set("page", page.toString());

    const { data } = await this.client.get<string>(url.toString());

    return this.parseAnimeFromListing(data);
  };

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(data);

    const title = $("header.entry-header > h1").text().trim();
    const statusText = $("li.status span.value").text().trim();
    const producers = $('li.production span.value > a[href*="/production/"]')
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);
    const lastUpdatedText = $("li.release-date span.value")
      .text()
      .trim()
      .replace(this.dateRegex, "");

    const description = $("div.card-body").text().trim();
    const coverImageUrl = $("img.cover-image.img-thumbnail").attr("src");

    const alternateTitles: string[] = [];

    const selectors = ["li.official-title span.value", "li.synonym span.value"];

    for (const selector of selectors) {
      alternateTitles.push($(selector).text().trim());
    }

    const genres = $("li.genre span.value, div.genre-tree ul > li > a")
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);
    const ratingText = $("button#rating span.rtg_avg").text().trim();

    return {
      id: this.slugify(title),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      coverImageUrl: this.toAbsoluteUrl(coverImageUrl),
      status: this.getSeriesStatus(statusText),
      isNsfw: true,
      url: url.pathname,
      producers,
      description,
      lastUpdated: this.parseSeriesDate(lastUpdatedText),
      alternateTitles,
      genres,
      rating: this.toNumberOrNull(ratingText, true),
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(data);

    const episodes: Episode[] = [];

    $("ul.episode-loop > li > a").each((_, el) => {
      const $el = $(el);
      const urlFromElement = $el.attr("href");
      if (!urlFromElement) return;

      const episodeNumberStr = $el
        .find(".episode-number, .episode-slug")
        .text()
        .trim()
        .replace("Episode ", "");

      const episodeNumber = this.toNumberOrNull(episodeNumberStr, true);
      const titleStr = $el.find("div.episode-label, div.episode-title").first().text().trim();
      const title =
        titleStr?.toLowerCase() === "no title"
          ? `Episode ${episodeNumber}`
          : `Episode ${episodeNumber}: ${titleStr}`;

      episodes.push({
        title,
        url: this.setUrlWithoutDomain(urlFromElement),
        episodeNumber,
      });
    });

    return this.addEpisodeNavigation(episodes);
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "ongoing":
        return "ongoing";
      case "completed":
        return "completed";
      default:
        return "unknown";
    }
  };

  override getVideos: GetVideos = async (episodeUrl) => {
    const url = new URL(episodeUrl, this.baseUrl);
    const { data } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(data);

    const iframeUrl = $("iframe:first-of-type").attr("src");

    if (!iframeUrl) {
      throw new Error("No servers found");
    }

    const headers = this.headersBuilders().set("Referer", `${url.toString()}/`);

    const { data: iframeData } = await this.client.get<string>(iframeUrl, {
      headers,
    });

    const $iframe = cheerio.load(iframeData);

    const videos: Video[] = [];

    for (const el of $iframe("source").toArray()) {
      const $el = $(el);

      const url = $el.attr("src");
      if (!url) continue;

      videos.push({
        url,
        label: $el.attr("title") || "",
        headers: {
          referer: `${this.baseUrl}/`,
        },
        type: $el.attr("type"),
      });
    }

    return videos;
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "orderBy",
        label: "Order By",
        type: "select",
        options: HAHO_MOE_ORDER_BY_OPTIONS,
      },
      {
        key: this.orderByKey,
        label: "Order",
        type: "select",
        options: HAHO_MOE_ORDER_OPTIONS,
      },
      {
        key: "includeGenres",
        label: "Include Genres",
        description: "Genres to include. Separate multiple genres with a comma.",
        type: "text",
        placeholder: "e.g. action,adventure",
        defaultValue: "",
      },
      {
        key: "excludeGenres",
        label: "Exclude Genres",
        description: "Genres to exclude. Separate multiple genres with a comma.",
        type: "text",
        placeholder: "e.g. action,adventure",
        defaultValue: "",
      },
    ],
  });

  private parseAnimeFromListing(html: string): SeriesListResponse<Anime> {
    const data: Anime[] = [];

    const $ = cheerio.load(html);

    $("ul.anime-loop.loop > li > a").each((_, el) => {
      const $el = $(el);

      const title = $el.find("div.label > span, div span.thumb-title").text().trim();
      const url = $el.attr("href")!;
      const coverImageUrl = $el.find("img").attr("src");

      data.push({
        title,
        coverImageUrl: this.toAbsoluteUrl(coverImageUrl),
        url: new URL(url, this.baseUrl).pathname,
        isNsfw: true,
        status: "unknown",
      });
    });

    const hasMore = $("ul.pagination li.page-item a[rel=next]").length > 0;

    return {
      data,
      hasMore,
    };
  }

  private getSearchParams(query?: string, filters?: Record<string, any>) {
    let finalQuery = "";
    let orderBy = "az-";
    let order = "d";

    if (query?.trim()) {
      finalQuery += query.trim();
    }

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "text":
          {
            if (filter.key === this.includeGenresKey && value?.trim()) {
              const values: string[] = value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);
              values.forEach((v) => {
                finalQuery += ` genre:${v}`;
              });
            }

            if (filter.key === this.excludeGenresKey && value?.trim()) {
              const values: string[] = value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);
              values.forEach((v) => {
                finalQuery += ` -genre:${v}`;
              });
            }
          }
          break;
        case "select":
          {
            if (filter.key === this.orderByKey) {
              orderBy = value;
            }

            if (filter.key === this.orderKey) {
              order = value;
            }
          }
          break;
        default:
          break;
      }
    }

    return {
      query: finalQuery,
      orderBy,
      order,
    };
  }

  private includeGenresKey = "includeGenres";
  private excludeGenresKey = "excludeGenres";
  private orderByKey = "orderBy";
  private orderKey = "order";
  private dateRegex = /(?<=\d)(st|nd|rd|th)|\bof\b\s*/gi;
}
