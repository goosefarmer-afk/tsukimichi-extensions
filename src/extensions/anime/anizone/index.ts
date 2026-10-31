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
  type Preferences,
  type SearchSeries,
  type SeriesListResponse,
  type SubtitleTrack,
  type Video,
} from "@tsukimichi/common";
import { type AxiosResponse, type Method } from "axios";
import * as cheerio from "cheerio";
import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import {
  deserializeAnimeXData,
  type AnimeXData,
  type ComponentDto,
  type EpisodeXData,
  type LivewireDto,
  type VidStackConfig,
} from "./dto";
import manifest from "./manifest.json";
import { StringUtils } from "@/utils/string";
import { HttpError } from "@/errors/http-error";

export class AniZone extends BaseAnimeScraper {
  private token = "";
  private snapShots: Map<string, string>;
  private seenUrls: Set<string> = new Set();
  private sessionInitialized = false;

  private nextCursor = "";
  private currentSlug = "/anime";

  private readonly SORT_KEY = "sort";

  private readonly ANIME_SNAPSHOT_KEY = "anime_snapshot_key";
  private readonly EPISODE_SNAPSHOT_KEY = "episode_snapshot_key";
  private readonly VIDEO_SNAPSHOT_KEY = "video_snapshot_key";

  private readonly PREF_TITLE_LANG_KEY = "pref_title_lang_key";
  private readonly PREF_TITLE_LANG_DEFAULT = "1";
  private readonly PREF_TITLE_LANG_OPTIONS = [
    { label: "English", value: "1" },
    { label: "Romanji", value: "5" },
  ];

  private readonly MAX_PAGINATION_ITERATIONS = 50;
  private readonly HEX_ESCAPE_REGEX = /\\x([0-9a-fA-F]{2})/g;
  private readonly INVALID_BACKSLASH_REGEX = /\\(?!["\\/bfnrtu]|u[0-9a-fA-F]{4})/g;
  private readonly JSON_PARSE_REGEX = /([a-zA-Z0-9_]+):\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/g;
  private readonly VIDSTACK_REGEX = /JSON\.parse\('(.*?)'\)/;
  private readonly NEXT_CURSOR_REGEX = /nextCursor:\s*'([^']+)'/;
  private readonly FALLBACK_TITLE_REGEX = /getTitle\([^,]+,\s*'([^']+)'\)/;
  private readonly EPISODE_NUMBER_REGEX = /\d+(\.\d+)?/g;
  private readonly SLUG_REGEX = /anmSlug:\s*'([^']+)'/;
  private readonly SET_VIDEO_REGEX = /setVideo\('(\d+)'\)/;

  private $preferences: Preferences;

  private preferences = {
    preferredTitleLang: async (): Promise<string> => {
      const pref = await this.$preferences.getString(
        this.PREF_TITLE_LANG_KEY,
        this.PREF_TITLE_LANG_DEFAULT,
      );
      return pref && this.PREF_TITLE_LANG_OPTIONS.map((o) => o.value).includes(pref)
        ? pref
        : this.PREF_TITLE_LANG_DEFAULT;
    },
  };

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
    this.snapShots = new Map<string, string>([
      [this.ANIME_SNAPSHOT_KEY, ""],
      [this.EPISODE_SNAPSHOT_KEY, ""],
      [this.VIDEO_SNAPSHOT_KEY, ""],
    ]);

    this.$preferences = options.$context!.createPreferences!();
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const response = await this.popularSeriesRequest(options);
    return this.popularAnimeParse(response);
  };

  private async popularSeriesRequest(options?: Record<string, any>): Promise<AxiosResponse> {
    const page = options?.page ?? 1;

    if (page === 1) {
      this.resetAnimeListState("/anime");
      return await this.client.get(`${this.baseUrl}/anime`, {
        params: { sort: "title-asc" },
        validateStatus: () => true,
      });
    }

    console.log("page", page);
    console.log("nextCursor", this.nextCursor);

    return await this.createLivewireReq({
      mapKey: this.ANIME_SNAPSHOT_KEY,
      updates: {},
      calls: this.buildPageCalls(this.nextCursor),
      initialSlug: this.currentSlug,
    });
  }

  private async popularAnimeParse(response: AxiosResponse): Promise<SeriesListResponse<Anime>> {
    const res = await this.retryOn419(response);

    const isLivewire = res.config.url?.includes("/livewire/update");

    let dispatchedHasMore: boolean | null = null;
    let dispatchedItems: AnimeXData[] | null = null;
    let dispatchedCursor: string | null = null;

    let $: cheerio.CheerioAPI;
    let $html: cheerio.Cheerio<any>;

    const prefTitle = await this.preferences.preferredTitleLang();

    // Parse the response based on whether it's a Livewire request
    if (isLivewire) {
      console.log("livewire");
      const itemsLoaded = (res.data as LivewireDto).components?.[0]?.effects.dispatches.find(
        (item) => item.name === "items-loaded",
      );

      dispatchedItems = itemsLoaded?.params?.items as AnimeXData[];
      dispatchedCursor = itemsLoaded?.params?.nextCursor || null;
      dispatchedHasMore = itemsLoaded?.params?.hasMore || null;

      $ = cheerio.load(
        this.getHtml((res.data as LivewireDto).components, this.ANIME_SNAPSHOT_KEY),
        {
          baseURI: this.baseUrl,
        },
      );
      $html = $.root();
    } else {
      $ = cheerio.load(res.data as string, { baseURI: this.baseUrl });
      $html = this.updateState($, this.ANIME_SNAPSHOT_KEY);
    }

    // Determine pagination state
    const xData = this.extractXData($html);
    const itemsJson = this.extractAndParseJson<unknown[]>("items", xData);
    const items =
      dispatchedItems ||
      (() => {
        const jsonListFromXData = this.extractJsonListFromXData<AnimeXData>(xData, "items");
        if (jsonListFromXData?.length) return jsonListFromXData;
        return Array.isArray(itemsJson) ? (itemsJson as AnimeXData[]) : null;
      })();

    // Extract anime items from the HTML
    const rawAnimeList = this.extractAnimeItems($, $html, items, prefTitle);

    // Deduplicate by URL
    const animeList = rawAnimeList?.filter((anime) => {
      if (this.seenUrls.has(anime.url)) return false;
      this.seenUrls.add(anime.url);
      return true;
    });

    // Fallback only: this regex reads the *initial* SSR'd Alpine state,
    // which is usually blank/null — not a reliable live cursor. Real
    // pagination data should come from dispatchedCursor above.
    this.nextCursor = dispatchedCursor || this.NEXT_CURSOR_REGEX.exec(xData)?.[1] || "";

    // If Livewire returns duplicates and we
    const hasMore = !animeList?.length
      ? false
      : this.nextCursor.trim()
        ? (dispatchedHasMore ?? true)
        : $html.find('div[x-intersect*="loadMore()"]').length > 0;

    return {
      data: animeList ?? [],
      hasMore,
    };
  }

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const page = options?.page ?? 1;

    if (page === 1) {
      this.resetAnimeListState("/");
      const response = await this.client.get(`${this.baseUrl}`);
      return this.popularAnimeParse(response);
    }

    const response = await this.createLivewireReq({
      mapKey: this.ANIME_SNAPSHOT_KEY,
      updates: {},
      calls: this.buildPageCalls(this.nextCursor),
      initialSlug: this.currentSlug,
    });

    return this.popularAnimeParse(response);
  };

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    let { page, filters } = options ?? {};
    page ??= 1;

    if (page === 1) {
      const url = this.buildSearchUrl(query, filters);
      const response = await this.client.get(url.toString(), { validateStatus: () => true });
      if (response.config.url) {
        this.resetAnimeListState(new URL(response.config.url).pathname);
      }
      return this.popularAnimeParse(response);
    }

    const response = await this.popularSeriesRequest(options);
    return this.popularAnimeParse(response);
  };

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString());
    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    const $xDataEl = $('[x-data*="anmTitles"]').first();
    const xData = $xDataEl.attr("x-data") || "";

    const titleLang = await this.preferences.preferredTitleLang();

    const fallbackText =
      $("h1").first().text().trim() ||
      StringUtils.substringBefore($("title").first().text().trim(), " - AniZone");

    const title = this.getPreferredTitle(xData, fallbackText, true, null, titleLang);
    if (!title) throw new Error("Could not find title");

    const coverImageUrl = $("div.flex.items-start img").prop("src") || null;
    let description = $("div:has(> h3:contains(Synopsis)) > div")
      .first()
      .text()
      .trim()
      .replaceAll("\n", "<br>");

    const type = $("span.inline-block").eq(0).text().trim();
    if (type) {
      description += `${description.length > 0 ? "<br><br>" : "<br>"}Type: ${type}`;
    }

    const statusText = $("span.inline-block").eq(1).text().trim();
    const status = this.getSeriesStatus(statusText);

    const genres = $("a[href*='/tag/']")
      .map((_, el) => $(el).text().trim())
      .get();

    return {
      id: this.slugify(title),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      description,
      status,
      genres,
      url: this.setUrlWithoutDomain(url.pathname),
      isNsfw: null,
      coverImageUrl,
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    this.snapShots.set(this.EPISODE_SNAPSHOT_KEY, "");

    // First try to get episodes from watch page directly,
    // because watch page usually contains all episodes at once
    // and it's faster than getting them from the server
    const url = new URL(query, this.baseUrl);
    const seenEpisodeUrls = new Set<string>();

    const prefTitle = await this.preferences.preferredTitleLang();

    try {
      const watchPageUrl = new URL(`${query}/1`, this.baseUrl);
      const [{ data: animePageHtml }, { data: watchPageHtml }] = await Promise.all([
        this.client.get<string>(url.toString()),
        this.client.get<string>(watchPageUrl.toString()),
      ]);

      const $animeDoc = cheerio.load(animePageHtml);
      const totalEpisodesText = $animeDoc("div.flex.justify-center.flex-wrap")
        .find("span.inline-block")
        .eq(2)
        .text()
        .trim()
        .toLowerCase();
      let totalEpisodes: number | null = null;

      if (totalEpisodesText.includes("episodes")) {
        totalEpisodes = this.toNumberOrNull(totalEpisodesText.split(" ")[0], true);
      }

      if (totalEpisodes != null) {
        const $ = cheerio.load(watchPageHtml, { baseURI: this.baseUrl });
        const container = $('div[x-init*="$nextTick"]').first();
        if (!container.length) throw new Error("Could not find episodes container");

        const episodes: Episode[] = [];

        container.find("a[x-data]").each((_, el) => {
          const $el = $(el);
          const urlFromElement = $el.attr("href");
          if (!urlFromElement) return;

          const xData = $el.attr("x-data") || "";

          const epNum = this.toNumberOrNull($el.find("div > div").first().text().trim(), true);
          let title = epNum !== null ? `Episode ${epNum}` : "";
          const episodeTitle = this.getPreferredTitle(xData, title, false, null, prefTitle);

          if (episodeTitle && episodeTitle !== "Unknown" && episodeTitle !== title)
            title = `${title} - ${episodeTitle}`;

          seenEpisodeUrls.add(this.setUrlWithoutDomain(urlFromElement));
          episodes.push({
            url: this.setUrlWithoutDomain(urlFromElement),
            title,
            episodeNumber: epNum,
          });
        });

        // If we already have all episodes, return
        if (episodes.length >= totalEpisodes) return episodes;
      }
    } catch {
      // Fall through
    }

    const response = await this.client.get(url.toString());
    const res = await this.retryOn419(response);
    const finalUrl = (res.request?.res?.responseUrl as string | undefined) || url.toString();
    const isLivewire = finalUrl.includes("/livewire/update");

    const { $, $html, dispatchedData } = this.prepareEpisodeParsing(res.data, isLivewire);
    const xData = this.extractXData($html);
    const items =
      dispatchedData.items ??
      this.extractJsonListFromXData<EpisodeXData>(xData, "items", ["summary"]);

    const episodes: Episode[] = [];

    if (Array.isArray(items)) {
      for (const item of items) {
        const episode = this.episodeFromXData(item, prefTitle);
        if (episode) episodes.push(episode);
      }
    } else {
      $html.find("ul > li").each((_, el) => {
        const episode = this.episodeFromElement($(el), prefTitle);
        if (episode) episodes.push(episode);
      });
    }

    // Populate seen URLs
    episodes.forEach((e) => seenEpisodeUrls.add(e.url));

    // Load remaining pages
    await this.loadRemainingEpisodes(
      episodes,
      seenEpisodeUrls,
      url,
      $html,
      dispatchedData,
      prefTitle,
    );

    return episodes;
  };

  override getVideos: GetVideos = async (episodeUrl) => {
    const url = new URL(episodeUrl, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString());
    return await this.videoListParse(html, url);
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: this.SORT_KEY,
        label: "Sort",
        type: "select",
        options: this.SORT_FILTER_OPTIONS,
      },
    ],
  });

  private SORT_FILTER_OPTIONS = [
    { label: "First Added", value: "added-asc" },
    { label: "Last Added", value: "added-desc" },
    { label: "Earliest Release", value: "release-asc" },
    { label: "Latest Release", value: "release-desc" },
    { label: "A-Z", value: "title-asc" },
    { label: "Z-A", value: "title-desc" },
  ];

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "completed":
        return "completed";
      case "ongoing":
        return "ongoing";
      case "cancelled":
        return "cancelled";
      default:
        return "unknown";
    }
  };

  // ===========================================================================
  // Private Methods - State Management
  // ===========================================================================

  private resetAnimeListState(slug: string) {
    this.snapShots.set(this.ANIME_SNAPSHOT_KEY, "");
    this.token = "";
    this.nextCursor = "";
    this.seenUrls.clear();
    this.currentSlug = slug;
  }

  private buildPageCalls(cursor: string) {
    return [
      {
        path: "",
        method: "loadPage",
        params: [cursor],
      },
    ];
  }

  private async retryOn419(response: AxiosResponse): Promise<AxiosResponse> {
    if (response.status === 419) {
      this.token = "";
      if (response.config.url?.includes("/livewire/update")) {
        return this.newLivewireCall(
          this.ANIME_SNAPSHOT_KEY,
          {},
          this.buildPageCalls(this.nextCursor),
          this.currentSlug,
        );
      }

      return this.client.request({
        method: response.config.method,
        url: response.config.url,
        headers: response.config.headers,
        data: response.config.data,
      });
    }

    if (response.status < 200 || response.status >= 300) {
      throw new HttpError({
        method: response.config.method as Method,
        status: response.status,
        statusText: response.statusText,
      });
    }

    return response;
  }

  // ===========================================================================
  // Private Methods - Anime Extraction
  // ===========================================================================

  private extractAnimeItems(
    $: cheerio.CheerioAPI,
    $html: cheerio.Cheerio<any>,
    dispatchedItems: AnimeXData[] | null,
    prefTitle: string,
  ): Anime[] | null {
    const xData = this.extractXData($html);
    const itemsJson = this.extractAndParseJson("items", xData);
    const itemsJsonList = this.extractJsonListFromXData<AnimeXData>(xData, "items");

    const items = dispatchedItems?.length
      ? dispatchedItems
      : Array.isArray(itemsJsonList) && itemsJsonList.length > 0
        ? itemsJsonList
        : itemsJson && Array.isArray(itemsJson)
          ? itemsJson
          : null;

    let rawAnimeList: Anime[] = [];

    if (Array.isArray(items)) {
      rawAnimeList = this.parseAnimeItems(items, prefTitle);
    } else {
      const json = this.extractAndParseJson<unknown[]>("items", xData);
      if (Array.isArray(json)) {
        rawAnimeList = this.parseAnimeJsonItems(json, prefTitle);
      } else {
        return this.parseAnimeFromElement($html, $, prefTitle);
      }
    }

    return rawAnimeList;
  }

  private parseAnimeItems(items: AnimeXData[], prefTitle: string): Anime[] {
    return items
      .map((item) => deserializeAnimeXData(item))
      .map((anime) => {
        const url = new URL(anime.url, this.baseUrl).pathname;
        if (url === "/") return null;
        return {
          id: anime.slug,
          extensionId: this.extensionMetadata.id,
          source: this.extensionMetadata.name,
          title: this.resolveTitle(anime.title_set, anime.main_title, prefTitle),
          url: this.setUrlWithoutDomain(url),
          isNsfw: null,
          status: "unknown" as const,
          coverImageUrl: anime.cover ? new URL(anime.cover, this.baseUrl).href : null,
        };
      })
      .filter(Boolean) as Anime[];
  }

  private parseAnimeJsonItems(items: unknown[], prefTitle: string): Anime[] {
    return items
      .map((item: any) => {
        if (!item) return null;
        const animeObj = (item as any)["anime"] as Record<string, any>;
        if (!animeObj || !animeObj.url) return null;

        const titleListMap: Record<string, string> = Object.fromEntries(
          Object.entries(animeObj["title_list"] ?? {})
            .filter(([, value]) => typeof value === "string")
            .map(([key, value]) => [key, value as string]),
        );

        const coverImageUrl = item["snapshot"] || item["teaser"] || null;

        return {
          id: animeObj.slug,
          extensionId: this.extensionMetadata.id,
          source: this.extensionMetadata.name,
          title: this.resolveTitle(titleListMap, animeObj.main_title, prefTitle),
          url: this.setUrlWithoutDomain(new URL(animeObj.url, this.baseUrl).pathname),
          isNsfw: null,
          status: "unknown" as const,
          coverImageUrl: typeof coverImageUrl === "string" ? coverImageUrl : null,
        };
      })
      .filter(Boolean) as Anime[];
  }

  private parseAnimeFromElement(
    $html: cheerio.Cheerio<any>,
    $: cheerio.CheerioAPI,
    titleLang: string,
  ): Anime[] | null {
    const animeDictStr = $html.attr("x-data")?.includes("animeDict")
      ? $html.attr("x-data")!
      : $html.find('[x-data*="animeDict"]').first().attr("x-data") || "";
    const animeDict = this.extractAnimeDict(animeDictStr);

    const rawAnimeList: Anime[] = [];
    $html.find(".grid > div, .grid > li, li.space-y-3.pb-6").each((_, el) => {
      if (!$(el).find('a[href*="/anime/"]').first().attr("href")) return;

      const animeFromElement = this.animeFromElement($(el), animeDict, titleLang);
      if (animeFromElement) rawAnimeList.push(animeFromElement);
    });

    return rawAnimeList.length > 0 ? rawAnimeList : null;
  }

  private animeFromElement(
    $el: cheerio.Cheerio<any>,
    animeDict: Record<string, Record<string, string>>,
    titleLang: string,
  ): Anime | null {
    {
      const allLinks = $el.find('a[href*="/anime/"]');
      const titleLink = allLinks
        .filter((_, el) => {
          const path = (el.attribs.href || "")
            .split("/anime/")[1]
            ?.replace(/^\/|\/$/g, "")
            .trim();
          return !path?.includes("/");
        })
        .first();

      const finalLink = titleLink.length ? titleLink : allLinks.first();
      if (!finalLink.length) return null;

      const xData = $el.attr("x-data") || "";

      const rawUrl = titleLink.prop("href") || "";
      const afterAnime = StringUtils.substringAfter(rawUrl, "/anime/");
      const trimmed = afterAnime.replace(/^\/+|\/+$/g, "").trim();

      const animeUrl = trimmed.includes("/")
        ? StringUtils.substringBeforeLast(trimmed, "/")
        : trimmed;

      const seriesTitleEl = titleLink.find('span[x-text*="AnimeTitle"]').first().length
        ? titleLink.find('span[x-text*="AnimeTitle"]').first()
        : $el.find('span[x-text*="AnimeTitle"]').first();
      const fallbackTitle =
        seriesTitleEl.text().trim() || titleLink.attr("title")?.trim() || titleLink.text().trim();

      const anmSlug = this.SLUG_REGEX.exec(xData)?.[1]?.trim();
      const titlesFromDict = anmSlug ? animeDict[anmSlug] : null;
      const title = this.getPreferredTitle(
        xData,
        fallbackTitle,
        true,
        titlesFromDict ?? null,
        titleLang,
      );
      if (!title) return null;

      return {
        url: this.setUrlWithoutDomain(animeUrl),
        title,
        isNsfw: null,
        status: "unknown",
        coverImageUrl: $el.find("img").first().prop("src") || null,
      };
    }
  }

  private resolveTitle(
    titleMap: Record<string, string> | null,
    fallbackTitle: string | null,
    prefTitle: string,
  ): string {
    return titleMap?.[prefTitle] || this.cleanTitle(fallbackTitle || "") || "Unknown";
  }

  // ===========================================================================
  // Private Methods - Episode Extraction
  // ===========================================================================

  private prepareEpisodeParsing(
    data: any,
    isLivewire: boolean,
  ): {
    $: cheerio.CheerioAPI;
    $html: cheerio.Cheerio<any>;
    dispatchedData: {
      items: EpisodeXData[] | null;
      hasMore: boolean | null;
      cursor: string | null;
    };
  } {
    let dispatchedItems: EpisodeXData[] | null = null;
    let dispatchedHasMore: boolean | null = null;
    let dispatchedCursor: string | null = null;
    let $: cheerio.CheerioAPI;
    let $html: cheerio.Cheerio<any>;

    if (isLivewire) {
      const result = data as LivewireDto;
      const itemsLoaded = result.components?.[0]?.effects.dispatches.find(
        (item) => item.name === "items-loaded",
      );
      dispatchedItems = itemsLoaded?.params?.items as EpisodeXData[];
      dispatchedHasMore = itemsLoaded?.params?.hasMore ?? null;
      dispatchedCursor = itemsLoaded?.params?.nextCursor || null;

      $ = cheerio.load(this.getHtml(result.components, this.EPISODE_SNAPSHOT_KEY), {
        baseURI: this.baseUrl,
      });
      $html = $.root();
    } else {
      $ = cheerio.load(data as string, { baseURI: this.baseUrl });
      $html = this.updateState($, this.EPISODE_SNAPSHOT_KEY);
    }

    return {
      $,
      $html,
      dispatchedData: {
        items: dispatchedItems,
        hasMore: dispatchedHasMore,
        cursor: dispatchedCursor,
      },
    };
  }

  private async loadRemainingEpisodes(
    episodes: Episode[],
    seenEpisodeUrls: Set<string>,
    url: URL,
    $html: cheerio.Cheerio<any>,
    dispatchedData: {
      items: EpisodeXData[] | null;
      hasMore: boolean | null;
      cursor: string | null;
    },
    prefTitle: string,
  ) {
    const xData = this.extractXData($html);
    let hasMore = dispatchedData.hasMore ?? $html.find('div[x-intersect~="loadMore()"]').length > 0;
    let cursor = dispatchedData.cursor || this.NEXT_CURSOR_REGEX.exec(xData)?.[1]?.trim() || "";

    const updates: Record<string, any> = {};
    let iterations = 0;

    while (hasMore && cursor) {
      if (++iterations > this.MAX_PAGINATION_ITERATIONS) break;

      const calls = this.buildPageCalls(cursor);
      const { data } = await this.newLivewireCall(
        this.EPISODE_SNAPSHOT_KEY,
        updates,
        calls,
        url.pathname,
      );

      const liveHtml = this.getHtml(data.components, this.EPISODE_SNAPSHOT_KEY);
      const liveDispatch = data.components?.[0]?.effects.dispatches.find(
        (item) => item.name === "items-loaded",
      );
      const newItems = (liveDispatch?.params?.items as EpisodeXData[]) || [];

      const newEpisodes = this.parseNewEpisodes(newItems, liveHtml, prefTitle);

      for (const episode of newEpisodes) {
        if (seenEpisodeUrls.has(episode.url)) continue;
        seenEpisodeUrls.add(episode.url);
        episodes.push(episode);
      }

      const newCursor = liveDispatch?.params?.nextCursor || "";
      hasMore =
        (liveDispatch?.params?.hasMore ?? false) && newCursor !== cursor && newCursor.trim() !== "";
      cursor = newCursor;
    }
  }

  private parseNewEpisodes(
    newItems: EpisodeXData[],
    liveHtml: string,
    prefTitle: string,
  ): Episode[] {
    const newEpisodes: Episode[] = [];

    if (newItems.length > 0) {
      for (const item of newItems) {
        const episode = this.episodeFromXData(item, prefTitle);
        if (episode) newEpisodes.push(episode);
      }
    } else {
      const $live = cheerio.load(liveHtml, { baseURI: this.baseUrl });
      $live("ul > li").each((_, el) => {
        const episode = this.episodeFromElement($live(el), prefTitle);
        if (episode) newEpisodes.push(episode);
      });
    }

    return newEpisodes;
  }

  private episodeFromXData(item: EpisodeXData, prefTitle: string): Episode | null {
    if (!item.url) return null;
    const url = new URL(item.url, this.baseUrl).pathname;
    if (!url || url === "/") return null;

    const baseTitle = `Episode ${item.slug}`;

    const title = item.title_list[prefTitle] || item.title_list["1"] || item.title_list["5"];

    return {
      url: this.setUrlWithoutDomain(url),
      title: title && baseTitle !== title ? `${baseTitle} - ${title}` : baseTitle,
      episodeNumber: this.toNumberOrNull(item.slug, true),
      lastUpdated: this.parseSeriesDate(item.air_date),
    };
  }

  private episodeFromElement($el: cheerio.Cheerio<any>, titleLang: string): Episode | null {
    const url =
      $el.find('a[href*="/anime/"]').first().prop("href") ||
      $el.find("a[href]").first().prop("href");
    if (!url) return null;

    const xData = $el.attr("x-data") || "";

    const $h3 = $el.find("h3").first();
    const baseTitle = this.cleanTitle($h3.text().trim()) || "Episode";

    const fallbackTitle = StringUtils.substringAfter(
      this.getOwnText($h3.find("span").first()),
      ":",
    );

    const episodeTitle = this.getPreferredTitle(xData, fallbackTitle, false, null, titleLang);

    let title =
      episodeTitle?.trim() && episodeTitle !== "Unknown"
        ? `${baseTitle} - ${episodeTitle}`
        : baseTitle;

    return {
      url: this.setUrlWithoutDomain(url),
      title,
      episodeNumber: this.toNumberOrNull(baseTitle.match(this.EPISODE_NUMBER_REGEX)?.at(-1), true),
    };
  }

  // ===========================================================================
  // Private Methods - Video Extraction
  // ===========================================================================

  private async videoListParse(html: string, url: URL): Promise<Video[]> {
    const $ = cheerio.load(html);

    const serverSelects = $("button[wire\\:click]").filter(
      (_, el) => !!$(el).attr("wire:click")?.includes("setVideo"),
    );

    const vidStack = this.getVidstackData(html);
    const headers = {
      referer: `${this.baseUrl}/`,
    };

    const videoUrl = vidStack?.src || $("media-player").first().attr("src");

    const subtitles: SubtitleTrack[] =
      vidStack?.subtitles?.map((s) => ({
        kind: "subtitles",
        label: s.title.replaceAll("\\/", "").split(" ").filter(Boolean).join(" "),
        lang: s.language || s.title,
        url: s.file.replaceAll("\\/", "/"),
      })) ?? [];

    const videos: Video[] = [];

    // Add the default/initial video
    if (videoUrl) {
      videos.push({
        label: serverSelects.first().find("div").eq(1).text().trim() || "Default",
        url: videoUrl.replaceAll("\\/", "/"),
        type: "application/vnd.apple.mpegurl",
        subtitleTracks: subtitles,
        poster: vidStack?.snapshot?.replaceAll("\\/", "/") || undefined,
        headers,
        tracks: vidStack?.chapter?.endsWith(".vtt")
          ? [
              {
                kind: "chapters",
                label: "Chapters",
                url: vidStack.chapter.replaceAll("\\/", "/"),
              },
            ]
          : [],
      });
    }

    // Fetch videos from alternative servers
    for (const server of serverSelects.slice(1)) {
      const video = await this.fetchServerVideo($(server), $, url.pathname, headers);
      if (video) videos.push(video);
    }

    return videos;
  }

  private async fetchServerVideo(
    $server: cheerio.Cheerio<any>,
    $: cheerio.CheerioAPI,
    pathname: string,
    headers: Record<string, string>,
  ): Promise<Video | null> {
    const videoId = this.SET_VIDEO_REGEX.exec($server.attr("wire:click")!)?.[1] ?? "0";

    const updates = {};
    const calls = [
      {
        path: "",
        method: "setVideo",
        params: [Number.parseInt(videoId, 10)],
      },
    ];

    const { data } = await this.createLivewireReq({
      updates,
      calls,
      mapKey: this.VIDEO_SNAPSHOT_KEY,
      initialSlug: pathname,
    });

    const livewireHtml = this.getHtml(data.components, this.VIDEO_SNAPSHOT_KEY);
    const $doc = cheerio.load(livewireHtml);
    const wireVidstack = this.getVidstackData(livewireHtml);

    const subtitles: SubtitleTrack[] =
      wireVidstack?.subtitles?.map((s) => ({
        kind: "subtitles",
        label: s.title.replaceAll("\\/", ""),
        lang: s.language || s.title,
        url: s.file.replaceAll("\\/", "/"),
      })) ??
      ($doc('track[kind="subtitles"]')
        .map((_, el) => {
          const $el = $(el);
          if (!$el.attr("src")) return null;
          return {
            url: $el.attr("src")?.replaceAll("\\/", "/"),
            label: $el.attr("label") || $el.attr("srclang") || "",
            lang: $el.attr("srclang") || $el.attr("label") || "und",
            kind: "subtitles" as const,
          };
        })
        .get()
        .filter(Boolean) as SubtitleTrack[]);

    const videoUrl = wireVidstack?.src || $doc("media-player").first().attr("src");

    if (!videoUrl) return null;

    return {
      label: $server.text().trim(),
      url: videoUrl.replaceAll("\\/", "/"),
      type: "application/vnd.apple.mpegurl",
      subtitleTracks: subtitles,
      poster: wireVidstack?.snapshot || undefined,
      headers,
    };
  }

  private getVidstackData(html: string): VidStackConfig | null {
    const $ = cheerio.load(html);

    const xData = $('[x-data*="vidstackPlayer"]').first().attr("x-data");
    if (!xData?.trim()) return null;

    const jsonString = this.VIDSTACK_REGEX.exec(xData)?.[1];
    if (!jsonString?.trim()) return null;

    const normalizedJson = jsonString
      .replace(/\\u0022/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\'/g, "'")
      .replace(/\\\//g, "/");

    try {
      return JSON.parse(normalizedJson);
    } catch {
      console.error("Failed to parse vidstack data");
      return null;
    }
  }

  // ===========================================================================
  // Private Methods - Title Extraction
  // ===========================================================================

  private getPreferredTitle(
    xData: string,
    fallbackText: string | null = null,
    isAnime = true,
    titlesFromDict: Record<string, string> | null,
    prefTitleLang: string,
  ): string | null {
    const titleFromXData = this.FALLBACK_TITLE_REGEX.exec(xData)?.[1]?.trim();
    const fallbackTitle = titleFromXData ? this.cleanTitle(titleFromXData) : fallbackText;
    if (!fallbackTitle) return null;

    const titlesMap =
      titlesFromDict ||
      (() => {
        const targetKey = isAnime ? "anmTitles" : "epsTitles";
        return this.extractJsonFromXData<Record<string, string>>(xData, targetKey);
      })();

    const title = titlesMap
      ? titlesMap[prefTitleLang] || titlesMap["1"] || titlesMap["5"]
      : fallbackTitle;

    return title ? this.cleanTitle(title) : null;
  }

  private buildSearchUrl(query: string | undefined, filters: Record<string, any> | undefined): URL {
    const url = new URL("/anime", this.baseUrl);
    if (query?.trim()) url.searchParams.set("search", query.trim());

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select": {
          url.searchParams.set(filter.key, value);
          break;
        }
        default:
          break;
      }
    }

    return url;
  }

  // ===========================================================================
  // Private Methods - Livewire Integration
  // ===========================================================================

  private async initializeSession(
    initialSlug = "/anime",
    mapKey: string = this.ANIME_SNAPSHOT_KEY,
  ): Promise<void> {
    if (this.sessionInitialized) return;

    const { data, headers } = await this.client.get(`${this.baseUrl}${initialSlug}`);

    // Extract cookies from the response
    const cookies = headers["set-cookie"];
    if (cookies) {
      // Store cookies for subsequent requests
      this.client.defaults.headers.Cookie = cookies
        .map((cookie: string) => cookie.split(";")?.[0])
        .join("; ");
    }

    const $ = cheerio.load(data, { baseURI: this.baseUrl });
    const snapshot = this.getSnapShot($);
    this.snapShots.set(mapKey, snapshot);

    const token = $("script[data-csrf]").attr("data-csrf");
    console.log('token from "script[data-csrf]"', token);
    if (!token) {
      throw new Error("Failed to get csrf token");
    }

    this.token = token;
    this.sessionInitialized = true;
  }

  private async createLivewireReq(options: {
    mapKey: string;
    updates: Record<string, any>;
    calls: Record<string, any>[];
    initialSlug?: string;
  }): Promise<AxiosResponse<LivewireDto>> {
    const { mapKey, updates, calls, initialSlug = "/anime" } = options;

    const firstSnapShot = this.snapShots.get(mapKey) || "";

    if (!this.token) {
      await this.initializeSession(initialSlug, mapKey);
    }

    const body = {
      _token: this.token,
      components: [
        {
          calls,
          snapshot: firstSnapShot,
          updates,
        },
      ],
    };

    return this.client.post(`${this.baseUrl}/livewire/update`, body, {
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "X-Livewire": "",
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}${initialSlug}`,
      },
      validateStatus: () => true,
    });
  }

  private async newLivewireCall(
    mapKey: string,
    updates: Record<string, any>,
    calls: Record<string, any>[],
    initialSlug = "/anime",
  ) {
    return await this.createLivewireReq({ mapKey, updates, calls, initialSlug });
  }

  private getHtml(components: ComponentDto[], mapKey: string) {
    const data = components?.[0];
    if (!data) return "";
    this.snapShots.set(mapKey, data.snapshot.replace(/\\"/g, '"'));
    return data.effects.html.replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }

  private updateState($: cheerio.CheerioAPI, mapKey: string): cheerio.Cheerio<any> {
    const csrf = $("script[data-csrf]").attr("data-csrf");
    if (csrf) this.token = csrf;
    const snapshot = this.getSnapShot($);
    if (snapshot) this.snapShots.set(mapKey, snapshot);

    return $("main > div[wire\\:snapshot], main > ul[wire\\:snapshot]").first().length
      ? $("main > div[wire\\:snapshot], main > ul[wire\\:snapshot]").first()
      : $("body");
  }

  private getSnapShot($: cheerio.CheerioAPI): string {
    const element = $("main > div[wire\\:snapshot]");

    if (element.length === 0) throw new Error("No wire:snapshot element found");

    const snapshotAttr = element.attr("wire:snapshot") || element.attr("wire\\:snapshot");

    if (!snapshotAttr) throw new Error("No wire:snapshot attribute found");

    const decoded = snapshotAttr.replace(/&quot;/g, '"');

    return decoded;
  }

  // ===========================================================================
  // Private Methods - JSON & String Utilities
  // ===========================================================================

  private extractXData($html: cheerio.Cheerio<any>): string {
    return $html.is('[x-data*="items:"]')
      ? $html.attr("x-data") || ""
      : $html.find('[x-data*="items:"]').first().attr("x-data") || "";
  }

  private stripXDataTextField(value: string, key: string) {
    const fieldRegex = new RegExp(
      `(\\\\u0022${this.escapeRegExp(key)}\\\\u0022:\\\\u0022).*?(\\\\u0022,\\\\u0022|\\\\u0022\\})`,
      "gs",
    );

    return value.replace(fieldRegex, "$1$2");
  }

  private unescapeXDataJson(value: string): string {
    return value
      .replace(/\\u0022/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\'/g, "'")
      .replace(/\\\//g, "/")
      .replace(/\\\\/g, "\\");
  }

  private sanitizeInvalidEscapes(value: string): string {
    return value
      .replace(/\\&/g, "&")
      .replace(/\\'/g, "'")
      .replace(/\\0/g, "\\u0000")
      .replace(
        this.HEX_ESCAPE_REGEX,
        (_, hex: string) => `\\u${Number.parseInt(hex, 16).toString(16).padStart(4, "0")}`,
      )
      .replace(this.INVALID_BACKSLASH_REGEX, "");
  }

  private splitTopLevelJsonObjects(rawArray: string): string[] {
    const body = StringUtils.removeSuffix(StringUtils.removePrefix(rawArray.trim(), "["), "]");
    const chunks: string[] = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < body.length; i++) {
      switch (body[i]) {
        case "{":
          if (depth === 0) start = i;
          depth++;
          break;

        case "}":
          depth--;
          if (depth === 0 && start !== -1) {
            chunks.push(body.substring(start, i + 1));
            start = -1;
          }
          break;

        default:
          continue;
      }
    }

    return chunks;
  }

  private cleanTitle(str: string) {
    return str
      .replace(/\\u0022/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\\//g, "/")
      .replace("\\/", "/")
      .replace("`", "'");
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private extractJsonListFromXData<T>(
    xData: string,
    key: string,
    stripFields: string[] = [],
  ): T[] | null {
    const rawArray = this.rawJsonParseArg(xData, key);
    if (!rawArray) return null;

    return this.splitTopLevelJsonObjects(rawArray)
      .map((raw) => {
        const cleaned = stripFields.reduce(
          (str, field) => this.stripXDataTextField(str, field),
          raw,
        );

        const sanitized = this.sanitizeInvalidEscapes(this.unescapeXDataJson(cleaned));

        try {
          return JSON.parse(sanitized);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as T[];
  }

  private extractAnimeDict(xData: string): Record<string, Record<string, string>> {
    return (
      this.extractJsonFromXData<Record<string, Record<string, string>>>(xData, "animeDict") ?? {}
    );
  }

  private extractJsonFromXData<T>(xData: string, key: string): T | null {
    const raw = this.rawJsonParseArg(xData, key);
    if (!raw) return null;

    try {
      return JSON.parse(this.unescapeXDataJson(raw)) as T;
    } catch {
      return null;
    }
  }

  private rawJsonParseArg(str: string, key: string): string | null {
    const match = [...str.matchAll(this.JSON_PARSE_REGEX)].find((m) => m[1] === key);
    return match?.[2] ?? null;
  }

  private extractAndParseJson<T = any>(prefix: string, jsonStr: string): T | null {
    const str = StringUtils.substringBefore(
      StringUtils.substringAfter(jsonStr, `${prefix}: JSON.parse('`),
      "')",
    );
    if (!str) return null;

    const cleaned = str
      .replace(/\\u0022/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\\//g, "/");

    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}
