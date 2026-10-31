import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import { parallelCatchingFlatMap } from "@/utils/map";
import { StringUtils } from "@/utils/string";

import {
  resolveFilterEntries,
  type Anime,
  type Episode,
  type GetEpisodes,
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

export class AnimeStream extends BaseAnimeScraper {
  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { page = 1, filters } = options ?? {};
    const url: URL = new URL("/", this.baseUrl);

    if (query?.trim()) {
      url.pathname = `page/${page}/`;
      url.searchParams.set("s", query.trim());
    } else {
      for (const { type, value, filter } of resolveFilterEntries(
        filters,
        this.getFilterConfig().filters,
      )) {
        switch (type) {
          case "multi-select": {
            if (value.length > 0) {
              value.forEach((v) => {
                url.searchParams.append(filter.key, v);
              });
            }
            break;
          }
          case "select": {
            url.searchParams.set(filter.key, value);
            break;
          }
          default:
            break;
        }
      }
    }

    const { data: html } = await this.client.get<string>(url.toString());

    return this.parseSeriesList({
      html,
      selector: this.searcAnimeSelector,
      nextPageSelector: this.searchAnimeNextPageSelector,
    });
  };

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = `${this.baseUrl}/anime/?page=${page}&order=popular`;

    const { data: html } = await this.client.get<string>(url);

    return this.parseSeriesList({
      html,
      selector: this.popularAnimeSelector,
      nextPageSelector: this.popularAnimeNextPageSelector,
    });
  };

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = `${this.baseUrl}/anime/?page=${page}&order=latest`;

    const { data: html } = await this.client.get<string>(url);

    return this.parseSeriesList({
      html,
      selector: this.latestAnimeSelector,
      nextPageSelector: this.latestAnimeNextPageSelector,
    });
  };

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const coverImageUrl = this.getImageUrl($(this.animeCoverImageSelector).first());
    const title = $(this.animeTitleSelector).first().text().trim();
    const alternateTitles = $(this.animeAltTitleSelector)
      .first()
      .text()
      .trim()
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const $details = $(this.animeDetailsSelector);

    const genres = $details
      .find(this.animeGenreSelector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const description = $details.find(this.animeDescriptionSelector).text().trim();
    const statusText = $details.find(this.animeStatusSelector).text().trim();

    const lastUpdatedText =
      $details.find(this.animeLastUpdatedSelector).attr("datetime") ||
      $details.find(this.animeLastUpdatedSelector).text().trim();

    return {
      id: this.slugify(title),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      alternateTitles,
      coverImageUrl,
      genres,
      description,
      status: this.getSeriesStatus(statusText),
      isNsfw: genres.length > 0 ? this.detectNsfw({ title, description, genres }) : null,
      url: this.setUrlWithoutDomain(url.toString()),
      lastUpdated: this.parseSeriesDate(lastUpdatedText),
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const episodes: Episode[] = [];

    $(this.episodeListSelector).each((_, el) => {
      const $el = $(el);

      const urlFromElement = $el.attr("href");
      if (!urlFromElement) return;

      const episodeNumberText = $el.find(".epl-num").first().text().trim();
      const title = `Episode ${episodeNumberText}`;
      const episodeUpdateText = $el.find(".epl-date").first().text().trim();

      episodes.push({
        title,
        url: this.setUrlWithoutDomain(urlFromElement),
        lastUpdated: this.parseSeriesDate(episodeUpdateText),
        episodeNumber: this.toNumberOrNull(
          StringUtils.substringBefore(episodeNumberText, " "),
          true,
        ),
      });
    });

    return episodes.toReversed();
  };

  protected videoListSelector = "select.mirror > option[data-index], ul.mirror a[data-em]";

  override getVideos: GetVideos = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const elements = $(this.videoListSelector).toArray();

    return parallelCatchingFlatMap(elements, async (el) => {
      const $el = $(el);
      const name = $el.text().trim();
      let url = await this.getHosterUrlFromElement($el);
      if (url.startsWith("//")) url = `https:${url}`;
      console.log(name, ":", url);
      return this.getVideoList(url, name);
    });
  };

  protected getVideoList(_url: string, _name: string): Promise<Video[]> {
    return Promise.resolve([]);
  }

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "completed":
      case "completeo":
        return "completed";
      case "ongoing":
      case "lançamento":
        return "ongoing";
      default:
        return "unknown";
    }
  };

  private async getHosterUrlFromElement($el: cheerio.Cheerio<any>) {
    let encodedData: string;
    switch ($el[0].tagName) {
      case "option":
        encodedData = $el.attr("value")!;
        break;
      case "a":
        encodedData = $el.attr("data-em")!;
        break;
      default:
        throw new Error("Unsupported element type");
    }

    return await this.getHosterUrl(encodedData);
  }

  private async getHosterUrl(encodedData: string) {
    let $: cheerio.CheerioAPI;

    try {
      new URL(encodedData);

      $ = await this.client.get<string>(encodedData).then((res) => cheerio.load(res.data));
    } catch {
      const decoded = Buffer.from(encodedData, "base64").toString("utf-8");
      $ = cheerio.load(decoded);
    }

    const iframeSrc = $("iframe[src]").first().attr("src");
    if (iframeSrc) {
      return iframeSrc.trim();
    }

    const metaEmbed = $('meta[itemprop="embedUrl"]').attr("content");
    if (metaEmbed) {
      return metaEmbed.trim();
    }

    throw new Error("Hoster URL not found");
  }

  private parseSeriesList(options: {
    html: string;
    selector?: string;
    nextPageSelector?: string;
  }): SeriesListResponse<Anime> {
    const {
      html,
      selector = this.searcAnimeSelector,
      nextPageSelector = this.searchAnimeNextPageSelector,
    } = options;

    const $ = cheerio.load(html);

    const data: Anime[] = [];

    $(selector).each((_, el) => {
      const $el = $(el);

      const title = $el
        .find("div.tt, div.ttl")
        .contents()
        .filter(function () {
          return this.nodeType === 3;
        })
        .text()
        .trim();
      const url = $el.attr("href")!;

      const $coverImage = $el.find("img").first();
      const coverImageUrl = this.getImageUrl($coverImage);

      data.push({
        title,
        url: this.setUrlWithoutDomain(url),
        coverImageUrl,
        isNsfw: null,
        status: "unknown",
      });
    });

    const hasMore = $(nextPageSelector).length > 0;

    return {
      data,
      hasMore,
    };
  }

  private getImageUrl($coverImage: cheerio.Cheerio<any>) {
    let coverImageUrl: string | null = null;

    if ($coverImage.attr("data-src") !== undefined) {
      coverImageUrl = this.toAbsoluteUrl($coverImage.attr("data-src"));
    }

    if ($coverImage.attr("data-lazy-src") !== undefined) {
      coverImageUrl = this.toAbsoluteUrl($coverImage.attr("data-lazy-src"));
    }

    if ($coverImage.attr("srcset") !== undefined) {
      coverImageUrl = this.toAbsoluteUrl($coverImage.attr("srcset")!.split(",")[0]?.split(" ")[0]);
    }

    if ($coverImage.attr("src") !== undefined) {
      coverImageUrl = this.toAbsoluteUrl($coverImage.attr("src"));
    }

    return coverImageUrl?.split("?resize=")[0] || null;
  }

  protected animeDetailsSelector = "div.info-content, div.right ul.data";
  protected animeTitleSelector = "h1.entry-title";
  protected animeAltTitleSelector = ".alter";
  protected animeCoverImageSelector = "div.thumb > img, div.limage > img";
  protected animeGenreSelector = "div.genxed > a[href*=/genres/], li:contains(Genre:) a";
  protected animeDescriptionSelector = ".entry-content[itemprop=description], .desc";
  protected animeStatusSelector = ".info-content span > b:contains(Status:)";
  protected animeLastUpdatedSelector = "time[itemprop=dateModified]";

  protected episodeListSelector = "div.eplister > ul > li > a";

  protected get searcAnimeSelector() {
    return "div.listupd article a.tip";
  }
  protected get searchAnimeNextPageSelector() {
    return "div.pagination a.next, div.hpage > a.r";
  }

  protected get popularAnimeSelector() {
    return this.searcAnimeSelector;
  }
  protected get popularAnimeNextPageSelector() {
    return this.searchAnimeNextPageSelector;
  }

  protected get latestAnimeSelector() {
    return this.searcAnimeSelector;
  }
  protected get latestAnimeNextPageSelector() {
    return this.searchAnimeNextPageSelector;
  }
}
