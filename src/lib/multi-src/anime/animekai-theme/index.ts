import {
  resolveFilterEntries,
  type Anime,
  type Episode,
  type ExtensionClientConstructorOptions,
  type ExtensionMetadata,
  type GetEpisodes,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type GetSettingsFilters,
  type GetVideos,
  type SearchSeries,
  type SeriesListResponse,
  type TriStateFilterValue,
} from "@tsukimichi/common";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import { MegaUpExtractor } from "@/lib/extractors/megaup";
import {
  ANIME_KAI_THEME_COUNTRY_OPTIONS,
  ANIME_KAI_THEME_GENRE_OPTIONS,
  ANIME_KAI_THEME_LANGUAGE_OPTIONS,
  ANIME_KAI_THEME_RATING_OPTIONS,
  ANIME_KAI_THEME_SEASON_OPTIONS,
  ANIME_KAI_THEME_SERIES_TYPE_OPTIONS,
  ANIME_KAI_THEME_SORT_OPTIONS,
  ANIME_KAI_THEME_STATUS_OPTIONS,
  ANIME_KAI_THEME_YEAR_OPTIONS,
} from "./filters";

interface AnimeKaiThemeConstructorOptions extends ExtensionClientConstructorOptions {
  mirrors: string[];
  metadata: ExtensionMetadata;
}

export abstract class AnimeKaiTheme extends BaseAnimeScraper {
  private MIRRORS: string[];
  private DEFAULT_MIRROR: string;

  constructor(options: AnimeKaiThemeConstructorOptions) {
    super({
      ...options,
    });

    this.MIRRORS = options.mirrors;
    this.DEFAULT_MIRROR = this.MIRRORS[0]!;

    this.baseUrl = this.getPreferredMirror();
  }

  protected popularMangaRequest<T = any>(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1 } = options ?? {};

    const url = new URL("trending", this.baseUrl);
    url.searchParams.set("page", page.toString());

    return this.client.get<T>(url.toString(), requestConfig);
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { data: html } = await this.popularMangaRequest(options);

    return this.parsePopularAnime({
      html,
      selector: this.popularAnimeSelector,
      nextPageSelector: this.popularAnimeNextPageSelector,
    });
  };

  protected popularAnimeFromElement($el: cheerio.Cheerio<any>): Anime | null {
    const urlFromElement = $el.find("a.poster").first().attr("href");
    if (!urlFromElement) return null;

    const title = this.getTitles($el.find("a.title").first()).main;
    const coverImageUrl = $el.find("a.poster img").attr("data-src") ?? null;

    return {
      title,
      url: this.setUrlWithoutDomain(urlFromElement),
      isNsfw: null,
      status: "unknown",
      coverImageUrl,
    };
  }

  protected parsePopularAnime(options: {
    html: string;
    selector: string;
    nextPageSelector: string;
  }): SeriesListResponse<Anime> {
    const { html, selector, nextPageSelector } = options;
    const $ = cheerio.load(html);

    const series: Anime[] = [];

    $(selector).each((_, el) => {
      const $el = $(el);
      const anime = this.popularAnimeFromElement($el);
      if (!anime) return;
      series.push(anime);
    });

    const hasMore = $(nextPageSelector).length > 0;

    return {
      data: series,
      hasMore,
    };
  }

  protected latestAnimeRequest<T = any>(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1 } = options ?? {};

    const url = new URL("updates", this.baseUrl);
    url.searchParams.set("page", page.toString());

    return this.client.get<T>(url.toString(), requestConfig);
  }

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { data: html } = await this.latestAnimeRequest(options);

    return this.parsePopularAnime({
      html,
      selector: this.latestAnimeSelector,
      nextPageSelector: this.latestAnimeNextPageSelector,
    });
  };

  protected searchAnimeRequest<T = any>(
    query?: string,
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1, filters } = options ?? {};

    const url = new URL("browser", this.baseUrl);
    url.searchParams.set("page", page.toString());

    if (query?.trim()) {
      url.searchParams.set("keyword", query.trim());
    }

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (value === "any") continue;

      switch (type) {
        case "multi-select":
          value.forEach((val) => {
            url.searchParams.append(filter.key, val);
          });
          break;

        case "select":
          if (value !== " any") {
            url.searchParams.set(filter.key, value);
          }
          break;

        case "tri-state-checkbox":
          for (const val of value as TriStateFilterValue[]) {
            let state = "";
            if (val.state === "include") state = "";
            else if (val.state === "exclude") state = "-";
            url.searchParams.append(filter.key, `${state}${val.value}`);
          }

          break;

        default:
          break;
      }
    }

    return this.client.get(url.toString(), {
      ...requestConfig,
      headers: {
        ...requestConfig?.headers,
        ...this.headersBuilders(),
      },
    });
  }

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { data: html } = await this.searchAnimeRequest(query, options);

    return this.parsePopularAnime({
      html,
      selector: this.searchAnimeSelector,
      nextPageSelector: this.searchAnimeNextPageSelector,
    });
  };

  protected animeDetailsRequest<T = any>(url: string): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, { headers: this.headersBuilders() });
  }

  protected parseAnimeDetails(html: string, url: string): Anime {
    const $ = cheerio.load(html);

    const $titleEl = $('h1[itemprop="name"].title');

    const title = this.getTitles($titleEl).main;

    const coverImageUrl = $(".poster img").attr("src") || null;

    const contentRatingText = $("div.info span.rating").text().trim();
    const isNsfw = this.isNsfw(contentRatingText);

    let description = $("div.desc").text().trim();
    const genres = $('div.detail a[href^="/genres/"]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const producers = $('div.detail a[href^="/producers/"]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const studios = $('div.detail a[href^="/studios/"]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const rating = $("div#anime-rating").attr("data-score") || "";
    const alternateTitles = $(".al-title")
      .text()
      .trim()
      .split(";")
      .map((title) => title.trim())
      .filter(Boolean);

    const $airedEl = $('div.detail > div:contains("Date aired:")').first();
    const airedFrom = $airedEl.find('span[itemprop="dateCreated"]').text().trim();

    const airedToRaw = $airedEl.text().trim().split("to")[1];
    const airedTo = airedToRaw
      ? airedToRaw.trim().match(/^[A-Z][a-z]{2}\s+\d{2},\s+\d{4}/)?.[0] || ""
      : "";

    if (airedFrom) description += `<br>Aired: ${airedFrom} to ${airedTo || "?"}`;
    const statusText =
      $("div.detail div:contains('Status: ')").find("span:nth-of-type(1)").first().text().trim() ||
      "";

    const status = this.getSeriesStatus(statusText);

    return {
      title,
      status,
      coverImageUrl,
      isNsfw,
      description,
      genres,
      rating: rating ? Number.parseFloat(rating) : null,
      producers,
      studios,
      alternateTitles,
      url: this.setUrlWithoutDomain(url, this.baseUrl),
    };
  }

  protected getTitles($el: cheerio.Cheerio<any>) {
    const titleLang = this.getTitleLang();

    const enTitle = $el.attr("title")?.trim() || $el.text().trim();
    const romajiTitle = $el.attr("data-jp")?.trim();

    return {
      main: titleLang === "romaji" ? romajiTitle || enTitle : enTitle,
      en: enTitle,
    };
  }

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(query, this.baseUrl);
    const html = await this.client
      .get(url.toString(), { responseType: "text" })
      .then((res) => res.data);

    return this.parseAnimeDetails(html, url.toString());
  };

  protected async getEpisodeAnimeId(url: string): Promise<string> {
    const { data: html } = await this.animeDetailsRequest(new URL(url, this.baseUrl).toString());

    const $ = cheerio.load(html);

    const animeId = $("div[data-id]").first().attr("data-id");

    if (!animeId) {
      throw new Error("Anime ID not found");
    }

    return animeId;
  }

  protected parseEpisodeList(html: string, animeUrl: string): Episode[] {
    const $ = cheerio.load(html);

    const episodes: Episode[] = [];

    const items = $(this.episodeListSelector).toArray();

    for (const el of items) {
      const $el = $(el);
      const episodeNumber = this.toNumberOrNull($el.attr("num"), true);
      const token = $el.attr("token");

      if (!token || episodeNumber == null) {
        continue;
      }

      const namePrefix = `Episode ${episodeNumber}`;

      const rawTitle = $el.find("span").first().text().trim();
      const title =
        rawTitle.trim() && rawTitle !== namePrefix ? `${namePrefix} - ${rawTitle}` : namePrefix;

      const subdubType = this.toNumberOrNull($el.attr("langs"));
      const subdub = subdubType === 1 ? "Sub" : subdubType === 3 ? "Sub & Dub" : "";

      episodes.push({
        title,
        episodeNumber,
        url: `${token}?animeUrl=${this.setUrlWithoutDomain(animeUrl)}`,
        scanlator: subdub,
      });
    }

    return this.addEpisodeNavigation(episodes);
  }

  override getEpisodes: GetEpisodes = async (query) => {
    const animeId = await this.getEpisodeAnimeId(query);

    const tempUrl = new URL(query, this.baseUrl);

    const enc = await this.encDecEndpoint(animeId);
    const apiUrl = new URL("ajax/episodes/list", this.baseUrl);
    apiUrl.searchParams.set("ani_id", animeId);
    apiUrl.searchParams.set("_", enc);
    console.log(apiUrl.toString());
    const { data } = await this.client.get(apiUrl.toString(), {
      headers: this.headersBuilders(),
      responseType: "json",
    });

    const html = data.result;

    return this.parseEpisodeList(html, tempUrl.toString());
  };

  override getVideos: GetVideos = async (_url) => {
    return [];
  };

  protected megaupExtractor = new MegaUpExtractor(this.client, this.headersBuilders());

  override getSeriesStatus: GetSeriesStatus = (text) => {
    switch (text?.trim()) {
      case "Completed":
      case "Finished Airing":
        return "completed";
      case "Releasing":
        return "ongoing";
      default:
        return "unknown";
    }
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: this.FILTER_KEYS.status,
        label: "Status",
        type: "multi-select",
        multiple: true,
        options: ANIME_KAI_THEME_STATUS_OPTIONS,
        renderAs: "select",
      },
      {
        key: this.FILTER_KEYS.type,
        label: "Type",
        type: "multi-select",
        multiple: true,
        options: ANIME_KAI_THEME_SERIES_TYPE_OPTIONS,
        renderAs: "select",
      },
      {
        key: this.FILTER_KEYS.sort,
        label: "Sort By",
        type: "select",

        options: ANIME_KAI_THEME_SORT_OPTIONS,
        defaultValue: ANIME_KAI_THEME_SORT_OPTIONS[0]?.value,
      },
      {
        key: this.FILTER_KEYS.rating,
        label: "Rating",
        type: "multi-select",
        multiple: true,
        options: ANIME_KAI_THEME_RATING_OPTIONS,
        renderAs: "select",
      },
      {
        key: this.FILTER_KEYS.country,
        label: "Country",
        type: "multi-select",
        multiple: true,
        options: ANIME_KAI_THEME_COUNTRY_OPTIONS,
        renderAs: "select",
      },
      {
        key: this.FILTER_KEYS.language,
        label: "Language",
        type: "multi-select",
        multiple: true,
        options: ANIME_KAI_THEME_LANGUAGE_OPTIONS,
        renderAs: "select",
      },
      {
        key: this.FILTER_KEYS.season,
        label: "Season",
        type: "multi-select",
        multiple: true,
        options: ANIME_KAI_THEME_SEASON_OPTIONS,
        renderAs: "select",
      },
      {
        key: this.FILTER_KEYS.year,
        label: "Year",
        type: "multi-select",
        multiple: true,
        options: ANIME_KAI_THEME_YEAR_OPTIONS,
        renderAs: "select",
      },
      {
        key: this.FILTER_KEYS.genre,
        label: "Genres",
        type: "tri-state-checkbox",
        multiple: true,
        options: ANIME_KAI_THEME_GENRE_OPTIONS,
      },
    ],
  });

  private readonly FILTER_KEYS = {
    type: "type[]",
    genre: "genre[]",
    status: "status[]",
    sort: "sort",
    country: "country[]",
    rating: "rating[]",
    language: "language[]",
    season: "season[]",
    year: "year[]",
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREFERRED_TITLE_LANG_KEY,
      label: "Preferred title language",
      type: "select",
      defaultValue: "english",
      options: [
        {
          label: "English",
          value: "english",
        },
        {
          label: "Romaji",
          value: "romaji",
        },
      ],
      description: "Preferred language to use for the title. English by default.",
    },
    {
      key: this.PREFERRED_MIRROR_KEY,
      label: "Preferred mirror",
      options: this.MIRRORS.map((m) => ({
        label: new URL(m).hostname,
        value: m,
      })),
      type: "select",
      defaultValue: this.DEFAULT_MIRROR,
    },
  ];

  protected async fetchEncodedLink(lid: string, enc: string): Promise<string> {
    return await this.client
      .get(`${this.baseUrl}/ajax/links/view`, {
        headers: this.headersBuilders(),
        params: {
          id: lid,
          _: enc,
        },
      })
      .then((res) => res.data)
      .then((data) => data.result);
  }

  protected async extractIframe(lid: string): Promise<string> {
    const enc = await this.encDecEndpoint(lid);
    const encodedLink = await this.fetchEncodedLink(lid, enc);

    const headers = this.headersBuilders();
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");

    const iframeRes = await this.client
      .post(
        "https://enc-dec.app/api/dec-kai",
        {
          text: encodedLink,
        },
        {
          headers,
        },
      )
      .then((res) => res.data);
    return iframeRes.result.url;
  }

  protected get episodeListSelector() {
    return "div.eplist a";
  }

  protected get popularAnimeSelector() {
    return "div.aitem-wrapper div.aitem";
  }
  protected get popularAnimeNextPageSelector() {
    return "nav > ul.pagination > li.active ~ li";
  }

  protected get latestAnimeSelector() {
    return this.popularAnimeSelector;
  }
  protected get latestAnimeNextPageSelector() {
    return this.popularAnimeNextPageSelector;
  }

  protected get searchAnimeSelector() {
    return this.popularAnimeSelector;
  }
  protected get searchAnimeNextPageSelector() {
    return this.popularAnimeNextPageSelector;
  }

  protected PREFERRED_MIRROR_KEY = "preferredMirror";
  protected PREFERRED_TITLE_LANG_KEY = "preferredTitleLang";

  protected async encDecEndpoint(enc: string): Promise<string> {
    return await this.client
      .get(`https://enc-dec.app/api/enc-kai?text=${enc}`, {
        headers: this.headersBuilders(),
        responseType: "json",
      })
      .then((res) => res.data)
      .then((data) => data.result);
  }

  protected getTitleLang(): string {
    return this.settings?.[this.PREFERRED_TITLE_LANG_KEY] || "english";
  }

  protected getPreferredMirror(): string {
    const preferredDomain = this.settings?.[this.PREFERRED_MIRROR_KEY];

    // Return default baseUrl from the manifest
    if (!this.MIRRORS.length) return this.baseUrl;

    if (preferredDomain && this.MIRRORS.includes(preferredDomain)) {
      return preferredDomain;
    }

    return this.DEFAULT_MIRROR;
  }

  protected isNsfw(text: string): boolean | null {
    switch (text) {
      case "PG 13":
        return false;
      case "R":
        return true;
      case "Rx":
        return true;
      default:
        return null;
    }
  }
}
