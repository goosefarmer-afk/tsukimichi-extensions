import {
  resolveFilterEntries,
  type Anime,
  type Episode,
  type GetEpisodes,
  type GetFilterConfig,
  type GetImage,
  type GetLatestSeries,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type MultiSelectFilter,
  type SearchSeries,
  type SelectFilter,
  type SeriesListResponse,
} from "@tsukimichi/common";
import { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import { parseSeriesDate } from "@/utils/date";
import {
  ZORO_THEME_CONTENT_RATINGS,
  ZORO_THEME_GENRES,
  ZORO_THEME_LANGUAGE_OPTIONS,
  ZORO_THEME_SCORES,
  ZORO_THEME_SEASON_OPTIONS,
  ZORO_THEME_SHOW_TYPES,
  ZORO_THEME_SORT_OPTIONS,
  ZORO_THEME_STATUS,
} from "./zoro-theme-filters";
import { substringAfterLast } from "@/utils/string";

export abstract class ZoroTheme extends BaseAnimeScraper {
  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { data } = await this.searchSeriesRequest(query, options);

    return this.parseAnimeListings(
      data,
      this.searchAnimeSelector,
      this.searchAnimeNextPageSelector,
    );
  };

  protected async searchSeriesRequest(
    query?: string,
    options?: Record<string, any>,
  ): Promise<AxiosResponse> {
    const { page, filters } = options ?? {};

    let endpoint = "search";

    if (query?.trim()) endpoint = "search";
    else endpoint = "filter";

    const url = new URL(endpoint, this.baseUrl);

    if (query?.trim()) {
      url.searchParams.set("keyword", query.trim());
    }

    url.searchParams.set("page", Math.max(page || 1, 1).toString());

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "text":
          if (value.trim()) {
            url.searchParams.set(filter.key, value);
          }
          break;
        case "select":
          if (value?.trim() !== "all" && value !== "default") {
            url.searchParams.set(filter.key, value?.toString());
          }
          break;
        case "multi-select":
          url.searchParams.set(filter.key, value.join(","));

          break;
        default:
          continue;
      }
    }

    return await this.client.get(url.toString());
  }

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data } = await this.client.get(url.toString(), {
      responseType: "text",
    });
    const $ = cheerio.load(data);

    const coverImageUrl = $("div.anisc-poster img").attr("src") || null;
    const promotions: any[] = [];
    $(".block_area-promotions-list > .screen-items > .item").each((_, el) => {
      promotions.push({
        title: $(el).attr("data-title"),
        url: $(el).attr("data-src"),
      });
    });

    const $info = $("div.anisc-info");
    const alternateTitles = $info
      .find('span:contains("Synonyms:")')
      .next()
      .text()
      .trim()
      .split(",")
      .map((t) => t.trim());
    const statusText = $info.find('span:contains("Status:")').next().text();
    const description = $info.find('span:contains("Overview:")').next().text();
    const genres: string[] = [];
    const studios: string[] = [];
    const producers: string[] = [];
    const $titleEl = $(".film-name.dynamic-name");
    const romajiTitle = $titleEl.attr("data-jname");
    const enTitle = $titleEl.text().trim();

    const titleLang = this.getTitleLang();

    const title = titleLang === "romaji" ? romajiTitle || enTitle : enTitle;
    const airedInfo = $info
      .find('span:contains("Aired:")')
      .next()
      .text()
      .split("to")
      .map((t) => t.trim());

    const rating = $info.find('span:contains("MAL Score:")').next().text();

    $info
      .find('span:contains("Genres:")')
      .nextAll("a")
      .each((_, el) => {
        genres.push($(el).text().trim());
      });

    $info
      .find('span:contains("Studios:")')
      .nextAll("a")
      .each((_, el) => {
        studios.push($(el).text().trim());
      });

    $info
      .find('span:contains("Producers:")')
      .nextAll("a")
      .each((_, el) => {
        producers.push($(el).text().trim());
      });

    return {
      id: this.slugify(title),
      extensionId: this.extensionMetadata.id,
      title,
      source: this.name,
      url: query,
      coverImageUrl,
      // promotions,
      alternateTitles,
      status: this.getSeriesStatus(statusText),
      genres,
      studios,
      producers,
      isNsfw: null,
      description,
      aired: {
        from: parseSeriesDate(airedInfo?.[0]),
        to: parseSeriesDate(airedInfo?.[1]),
      },
      rating: rating ? Number.parseFloat(rating) : null,
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    const { data } = await this.episodeListRequest(query);

    if (!("html" in data)) return [];

    const html = data.html;
    const $ = cheerio.load(html);

    const episodes: Episode[] = [];

    $(this.episodeListSelector).each((_, el) => {
      const $el = $(el);
      const url = $el.attr("href") || "";
      const episodeNumber = this.toNumberOrNull($el.attr("data-number"), true);
      const isFiller = $el.hasClass("ssl-item-filler");

      const title = `Episode ${episodeNumber}: ${$el.attr("title")}`;

      episodes.push({
        title,
        url,
        episodeNumber,
        isFiller,
      });
    });

    if (episodes.length > 0) {
      const episodesWithPreviousAndNext = episodes.map((episode) => {
        const index = episodes.indexOf(episode);
        const previousEpisode = episodes[index - 1]?.url;
        const nextEpisode = episodes[index + 1]?.url;
        return {
          ...episode,
          previousEpisode,
          nextEpisode,
        };
      });

      return episodesWithPreviousAndNext;
    }

    return [];
  };

  protected async episodeListRequest(query: string): Promise<AxiosResponse> {
    const id = substringAfterLast(query, "-");

    const ajaxUrl = new URL(`/ajax${this.ajaxRoute}/episode/list/${id}`, this.baseUrl);

    return await this.client.get(ajaxUrl.toString(), {
      headers: this.apiHeaders(this.baseUrl),
      responseType: "json",
    });
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { data } = await this.popularSeriesRequest(options);

    return this.parseAnimeListings(
      data,
      this.popularAnimeSelector,
      this.popularAnimeNextPageSelector,
    );
  };

  protected async popularSeriesRequest(options?: Record<string, any>): Promise<AxiosResponse> {
    const { page } = options ?? {};
    const url = new URL("most-popular", this.baseUrl);
    url.searchParams.set("page", page?.toString() || "1");

    return await this.client.get(url.toString());
  }

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { data } = await this.latestSeriesRequest(options);

    return this.parseAnimeListings(
      data,
      this.latestAnimeSelector,
      this.latestAnimeNextPageSelector,
    );
  };

  protected async latestSeriesRequest(options?: Record<string, any>): Promise<AxiosResponse> {
    const { page } = options ?? {};
    const url = new URL("recently-updated", this.baseUrl);
    url.searchParams.set("page", page?.toString() || "1");

    return await this.client.get(url.toString());
  }

  override getFilterConfig: GetFilterConfig = () => {
    return {
      filters: [
        {
          key: "genres",
          label: "Select Genres",
          description: "Multiple options can be selected",
          type: "multi-select",
          renderAs: "checkbox-group",
          options: ZORO_THEME_GENRES,
        } satisfies MultiSelectFilter,
        {
          key: "status",
          label: "Select Status",

          type: "select",
          options: ZORO_THEME_STATUS,
        } satisfies SelectFilter,
        {
          key: "type",
          label: "Select Type",
          type: "select",
          options: ZORO_THEME_SHOW_TYPES,
        } satisfies SelectFilter,
        {
          key: "score",
          label: "Select Score",

          type: "select",
          options: ZORO_THEME_SCORES,
        } satisfies SelectFilter,
        {
          key: "rated",
          label: "Select Content Rating",
          type: "select",
          options: ZORO_THEME_CONTENT_RATINGS,
        } satisfies SelectFilter,
        {
          key: "language",
          label: "Select Language",
          type: "select",
          options: ZORO_THEME_LANGUAGE_OPTIONS,
        } satisfies SelectFilter,
        {
          key: "season",
          label: "Select Season",
          type: "select",
          options: ZORO_THEME_SEASON_OPTIONS,
        } satisfies SelectFilter,
        {
          key: "sort",
          label: "Sort By",
          type: "select",
          options: ZORO_THEME_SORT_OPTIONS,
        } satisfies SelectFilter,
      ],
    };
  };

  override getImage: GetImage = async (url) => {
    const response = await this.client.get(url, {
      headers: {
        Referer: `${this.baseUrl}/`,
      },
      responseType: "arraybuffer",
    });
    const buffer = await response.data;
    return {
      data: buffer,
      contentType: (response.headers?.["Content-Type"] as string) || "image/jpeg",
    };
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    if (input?.includes("Finished Airing")) return "completed";
    if (input?.includes("Currently Airing")) return "ongoing";
    return "unknown";
  };

  protected async getEpisodeServers(episodeId: string) {
    const parsed = Number.parseInt(episodeId, 10);

    if (Number.isNaN(parsed)) {
      throw new Error("Invalid episode ID");
    }

    const url = new URL(`/ajax${this.ajaxRoute}/episode/servers?episodeId=${parsed}`, this.baseUrl);

    const { data } = await this.client.get<{ html: string }>(url.toString(), {
      headers: this.apiHeaders(this.baseUrl),
      responseType: "json",
    });

    if (!("html" in data)) {
      throw new Error("Failed to fetch episode servers");
    }

    const html = data.html;
    const $ = cheerio.load(html);

    const servers = ["servers-sub", "servers-dub", "servers-mixed", "servers-raw"];

    const embedLinks = await Promise.all(
      servers.flatMap((selector) => {
        return $(`div.${selector} div.item`)
          .map(async (_, el) => {
            const name = $(el).find("a").text().trim();
            const id = $(el).attr("data-id") || null;
            const indexText = $(el).attr("data-server-id") ?? "";
            const index = Number.parseInt(indexText, 10) || null;
            const type = $(el).attr("data-type");
            const url = `${this.baseUrl}/ajax${this.ajaxRoute}/episode/sources?id=${id}`;

            try {
              const { data } = await this.client.get(url, {
                headers: this.apiHeaders(this.baseUrl),
                responseType: "json",
              });
              const link = (data?.link || "") as string;
              return { id, name, type, index, link };
            } catch (error) {
              console.error("Error fetching link:", error);
              return { id, name, type, index, link: "" };
            }
          })
          .get();
      }),
    );

    const groupBy = embedLinks
      .filter((item) => item.id !== null)
      .reduce(
        (acc: Record<string, any[]>, item) => {
          if (item.type === "sub") {
            acc.subs?.push(item);
          } else if (item.type === "dub") {
            acc.dubs?.push(item);
          } else if (item.type === "mixed") {
            acc.mixed?.push(item);
          } else if (item.type === "raw") {
            acc.raw?.push(item);
          }
          return acc;
        },
        {
          subs: [],
          dubs: [],
          mixed: [],
          raw: [],
        },
      );

    return groupBy;
  }

  async sendRequest(url: string, options?: AxiosRequestConfig): Promise<AxiosResponse> {
    const response = await this.client.request({
      url,
      ...options,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    return response;
  }

  protected getTitleLang(): string {
    return this.settings?.[this.PREFERRED_TITLE_LANG_KEY] || "english";
  }

  protected parseAnimeListings(
    html: string,
    selector = this.popularAnimeSelector,
    nextPageSelector = this.popularAnimeNextPageSelector,
  ): SeriesListResponse<Anime> {
    const $ = cheerio.load(html);

    const animeList: Anime[] = [];

    $(selector).each((_, el) => {
      const $el = $(el);
      const coverImageUrl = $el.find(".film-poster > img").attr("data-src") || null;
      const $anchor = $el.find(".film-detail a");
      const title = $anchor.attr("title")
        ? $anchor.attr("title")
        : $anchor.attr("data-jname")
          ? $anchor.attr("data-jname")
          : $anchor.text();
      const url = $anchor.attr("href") || "";

      animeList.push({
        title: title || "",
        coverImageUrl,
        url,
        isNsfw: null,
        status: "unknown",
      });
    });

    const hasMore = $(nextPageSelector).length > 0;

    return {
      data: animeList,
      hasMore,
    };
  }

  protected apiHeaders(referrer?: string): AxiosHeaders {
    const headers = new AxiosHeaders();
    headers.set("Referer", referrer || this.baseUrl);
    headers.set("X-Requested-With", "XMLHttpRequest");
    headers.set("Accept", "*/*");
    headers.set("Host", new URL(this.baseUrl).host);
    return headers;
  }

  protected PREFERRED_TITLE_LANG_KEY = "preferred-title-lang";

  protected popularAnimeSelector = ".film_list div.flw-item";
  protected popularAnimeNextPageSelector = 'li.page-item a[title="Next"]';

  protected latestAnimeSelector = this.popularAnimeSelector;
  protected latestAnimeNextPageSelector = this.popularAnimeNextPageSelector;

  protected searchAnimeSelector = this.popularAnimeSelector;
  protected searchAnimeNextPageSelector = this.popularAnimeNextPageSelector;

  protected episodeListSelector = "a.ep-item";

  protected ajaxRoute = "";
}

// const src1 = "https://megacloud.blog/embed-2/v3/e-1/ugJgX5WkYRrl?k=1";
// const src2 = "https://megacloud.blog/embed-2/v3/e-1/zqgO9lD7fsRc?k=1";

// client.getStreamingData(src2).then((data) => console.log(data.files.length));
