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
import { WATCH_HENTAI_GENRES } from "./filters";
import manifest from "./manifest.json";

export class WatchHentai extends BaseAnimeScraper {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    let hasFilters = false;

    const url = new URL(this.baseUrl);
    if (page > 1) url.pathname = `/page/${page}/`;

    const q = query?.trim() || "";
    // Without `s` parameter site redirects to the homepage
    url.searchParams.set("s", q);

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "radio":
          // Only apply filter if search query is not provided, as the website ignores filters when search query is present
          if (filter.key === "genre" && typeof value === "string" && value !== "any" && !q) {
            url.pathname = page > 1 ? `/genre/${value}/page/${page}/` : `/genre/${value}/`;
            url.searchParams.delete("s");
            hasFilters = true;
          }
          break;

        default:
          break;
      }
    }

    const { data: html } = await this.client.get(url.toString(), {
      responseType: "text",
    });

    const $ = cheerio.load(html);

    if (hasFilters) {
      return this.parsePopularSeries({
        html,
        selector: this.popularSeriesSelector,
        nextPageSelector: this.popularSeriesNextPageSelector,
      });
    }

    const series: Anime[] = [];

    $(this.searchSeriesSelector).each((_, el) => {
      const $el = $(el);

      const coverImageUrl =
        $el.find(".image img").attr("data-src") || $el.find(".image img").attr("src") || null;

      const $anchor = $el.find(".details a").first();

      const title = $anchor.text().trim();

      series.push({
        title,
        coverImageUrl,
        status: "unknown",
        url: new URL($anchor.attr("href")!, this.baseUrl).pathname,
        isNsfw: true,
      });
    });

    const hasMore = $(this.searchSeriesNextPageSelector).length > 0;

    return {
      data: series,
      hasMore,
    };
  };

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL(`trending/page/${page}/`, this.baseUrl);

    const { data: html } = await this.client.get(url.toString(), {
      responseType: "text",
    });

    return this.parsePopularSeries({
      html,
      selector: this.popularSeriesSelector,
      nextPageSelector: this.popularSeriesNextPageSelector,
    });
  };

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const year = new Date().getFullYear() - 1;
    const url = new URL(`release/${year}/page/${page}/`, this.baseUrl);

    const { data: html } = await this.client.get(url.toString(), {
      responseType: "text",
    });

    return this.parsePopularSeries({
      html,
      selector: this.latestSeriesSelector,
      nextPageSelector: this.latestSeriesNextPageSelector,
    });
  };

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get(url.toString(), {
      responseType: "text",
    });

    const $ = cheerio.load(html);

    const coverImageUrl = $(".poster img").attr("data-src") || $(".poster img").attr("src") || null;
    const title = $(".data > h1").first().text().trim();
    const genres = $("div.sgeneros a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const rating = this.toNumberOrNull($("div.dt_rating_data > div").attr("data-rating"), true);

    const container = $("div.sbox > div.wp-content");

    const children = container.children();

    const ulIndex = children.index(children.filter("ul").first());

    const paragraphs =
      ulIndex === -1 ? children.filter("p") : children.slice(0, ulIndex).filter("p");

    const description = paragraphs
      .map((index, el) => {
        let text = $(el).text().trim();

        if (index > 0) {
          text = `<br>${text}`;
        }

        return text;
      })
      .get()
      .join("");

    const studios = $('div.sbox > .custom_fields > b:contains("Studio")')
      .next("span")
      .find("a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    return {
      id: this.slugify(url.pathname),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      coverImageUrl,
      url: url.pathname,
      status: "unknown",
      isNsfw: true,
      genres,
      rating,
      description,
      studios,
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    const url = new URL(query, this.baseUrl);

    const episodes: Episode[] = [];

    const { data: html } = await this.client.get(url.toString(), {
      responseType: "text",
    });

    const $ = cheerio.load(html);

    $("#episodes ul.episodios > li").each((_, el) => {
      const $el = $(el);

      // Skip if episode is not released yet
      if ($el.hasClass("none")) return;

      const $anchor = $el.find(".episodiotitle a").first();
      const urlFromElement = $anchor.attr("href");
      if (!urlFromElement) return;

      const title = $anchor.text().trim();

      episodes.push({
        title,
        url: this.setUrlWithoutDomain(urlFromElement),
        episodeNumber: this.extractEpisodeNumFromTitle(title),
      });
    });

    return this.addEpisodeNavigation(episodes);
  };

  override getSeriesStatus: GetSeriesStatus = () => "unknown";

  override getVideos: GetVideos = async (episodeUrl) => {
    const url = new URL(episodeUrl, this.baseUrl);

    const { data: html } = await this.client.get(url.toString(), {
      responseType: "text",
    });

    const $doc = cheerio.load(html);

    const iframeSrc =
      $doc("iframe").first().attr("data-litespeed-src") ||
      $doc("iframe").first().attr("data-src") ||
      $doc("iframe").first().attr("src");
    if (!iframeSrc) throw new Error("Hoster URL not found");

    const { data: playerHtml } = await this.client.get(iframeSrc);

    const $player = cheerio.load(playerHtml);

    let sourcesString = $player.html().match(this.SOURCES_REGEX)?.[1];
    if (!sourcesString) {
      throw new Error("No video sources not found");
    }

    sourcesString = sourcesString.replace(/([{,\n]\s*)(\w+)\s*:/g, '$1"$2":');
    sourcesString = sourcesString.replace(/,(\s*[}\]])/g, "$1");

    let sources: {
      file: string;
      label: string;
      type: string;
    }[] = [];

    sources = JSON.parse(sourcesString) as {
      file: string;
      label: string;
      type: string;
    }[];

    const videos: Video[] = [];

    sources.forEach((s) => {
      videos.push({
        label: s.label,
        url: s.file,
        type: s.type,
        headers: {
          Referer: `${this.baseUrl}/`,
        },
      });
    });

    return videos;
  };

  override getFilterConfig: GetFilterConfig = () => ({
    header: "Ignored if search query is provided.",
    filters: [
      {
        key: "genre",
        type: "radio",
        label: "Genre",
        options: WATCH_HENTAI_GENRES,
      },
    ],
  });

  private extractEpisodeNumFromTitle(title: string): number | null {
    const regex = /(\d+)/;
    const match = title.match(regex);
    return this.toNumberOrNull(match?.[1]);
  }

  private readonly popularSeriesSelector = ".items > article.item";
  private readonly popularSeriesNextPageSelector = ".resppages > a";

  private readonly latestSeriesSelector = this.popularSeriesSelector;
  private readonly latestSeriesNextPageSelector = this.popularSeriesNextPageSelector;

  private readonly searchSeriesSelector = ".result-item > article";
  private readonly searchSeriesNextPageSelector = this.popularSeriesNextPageSelector;

  private readonly SOURCES_REGEX = /sources\s*:\s*(\[[\s\S]*?\])/;

  private parsePopularSeries(options: {
    html: string;
    selector: string;
    nextPageSelector: string;
  }): SeriesListResponse<Anime> {
    const { html, nextPageSelector } = options;

    const $ = cheerio.load(html);

    const series: Anime[] = [];

    $(".items > article.item").each((_, el) => {
      const $el = $(el);

      const $anchor = $el.find(".data a").first();
      const urlFromElement = $anchor.attr("href");
      if (!urlFromElement) return;

      const coverImageUrl =
        $el.find(".poster img").attr("data-src") || $el.find(".poster img").attr("src") || null;

      const title = $anchor.text().trim();

      series.push({
        title,
        coverImageUrl,
        status: "unknown",
        url: this.setUrlWithoutDomain(urlFromElement),
        isNsfw: true,
      });
    });

    const hasMore = $(nextPageSelector).length > 0;

    return {
      data: series,
      hasMore,
    };
  }
}
