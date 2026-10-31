import {
  resolveFilterEntries,
  type Anime,
  type AuxiliaryTrack,
  type Episode,
  type ExtensionClientConstructorOptions,
  type GetEpisodes,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type GetSettingsFilters,
  type GetVideos,
  type Preferences,
  type SearchSeries,
  type Segment,
  type SeriesListResponse,
  type SubtitleTrack,
  type Video,
} from "@tsukimichi/common";
import { AxiosHeaders, type AxiosResponse } from "axios";

import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import manifest from "./manifest.json";
import {
  toAnime,
  type AnimeDetailsResponse,
  type AnimeMeta,
  type DecFlixCloudStreamResponse,
  type DecFlixCloudTokenResponse,
  type EpisodeListResponse,
  type FlixcloudChapter,
  type FlixcloudEmbedData,
  type LatestResponse,
  type SearchResponse,
  type VideoResponse,
} from "./types";
import { LRUCache } from "@/utils/lru-cache";
import { StringUtils } from "@/utils/string";
import { parallelCatchingFlatMap } from "@/utils/map";
import { FlixProxyServer, type VideoChapters } from "./flix-proxy-server";
import {
  SortFilter,
  StatusFilter,
  FormatFilter,
  SeasonFilter,
  OriginFilter,
  YearFilter,
  GenreFilter,
  StudioFilter,
} from "./filters";

export class ReAnime extends BaseAnimeScraper {
  private apiUrl: string;
  private flixUrl: string;
  private readonly FLIX_CLOUD_URL = "https://flixcloud.cc";

  private encDecUrl = "https://enc-dec.app";
  private decApi = `${this.encDecUrl}/api`;

  private storedXorMask: Buffer | null = null;

  private animeMetaCache = new LRUCache<string, AnimeMeta>({
    maxSize: 64,
  });

  private proxyServer: FlixProxyServer | null = null;

  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();

    this.apiUrl = `${this.baseUrl}/api/v1`;
    this.flixUrl = `${this.baseUrl}/api/flix`;
  }

  override async init(): Promise<void> {
    await super.init();

    this.baseUrl = await this.$preferences.getString(
      this.PREF_MIRROR_KEY,
      this.PREF_DEFAULT_MIRROR,
    );
    this.apiUrl = `${this.baseUrl}/api/v1`;
    this.flixUrl = `${this.baseUrl}/api/flix`;
  }

  private static readonly SEARCH_ANIME_LIMIT = 36;

  private async getProxyServer(
    headers: Record<string, string>,
    segmentMask: Buffer,
  ): Promise<FlixProxyServer> {
    if (this.proxyServer === null || !this.proxyServer.isAlive) {
      await this.proxyServer?.stop();
      this.proxyServer = new FlixProxyServer(headers, segmentMask);

      await this.proxyServer.start();
    } else {
      this.proxyServer.updateSegmentMask(segmentMask);
    }

    return this.proxyServer;
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL(`${this.apiUrl}/search`);
    url.searchParams.set("sort", "popularity_desc");
    url.searchParams.set("limit", ReAnime.SEARCH_ANIME_LIMIT.toString());
    url.searchParams.set("offset", String((page - 1) * ReAnime.SEARCH_ANIME_LIMIT));

    const { data } = await this.client.get<SearchResponse>(url.toString());

    return this.parseSearchResponse(data, page);
  };

  private nextLatestCursor: string | null = null;

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    if (page === 1) this.nextLatestCursor = null;

    const url = new URL(`${this.apiUrl}/home/latest-aired`);
    url.searchParams.set("limit", "12");
    if (page > 1 && this.nextLatestCursor !== null) {
      url.searchParams.set("cursor", this.nextLatestCursor);
    }

    const { data } = await this.client.get<LatestResponse>(url.toString());

    const animeList: Anime[] = [];

    data.data.forEach((anime) => {
      animeList.push(toAnime(anime));
    });

    this.nextLatestCursor = data.next_cursor || null;
    return {
      data: animeList,
      hasMore: data.has_more ?? false,
    };
  };

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    const url = new URL(`${this.apiUrl}/search`);
    url.searchParams.set("limit", ReAnime.SEARCH_ANIME_LIMIT.toString());
    url.searchParams.set("offset", String((page - 1) * ReAnime.SEARCH_ANIME_LIMIT));

    if (query?.trim()) url.searchParams.set("q", query.trim());

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (value === "any") {
        continue;
      }

      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value);
          break;

        case "multi-select":
          if (value.length) {
            value.forEach((v) => {
              url.searchParams.append(filter.key, v);
            });
          }
          break;

        default:
          break;
      }
    }

    const { data } = await this.client.get<SearchResponse>(url.toString());

    return this.parseSearchResponse(data, page);
  };

  private parseSearchResponse(
    response: SearchResponse,
    currentPage: number,
  ): SeriesListResponse<Anime> {
    const seriesList: Anime[] = [];

    response.results.forEach((anime) => {
      seriesList.push(toAnime(anime));
    });

    const hasMore = response.total > ReAnime.SEARCH_ANIME_LIMIT * currentPage;

    return {
      data: seriesList,
      hasMore,
    };
  }

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(`api/v1/anime/${query}`, this.baseUrl);

    const { data } = await this.client.get<AnimeDetailsResponse>(url.toString());

    return {
      ...toAnime(data),
      status: this.getSeriesStatus(data.status),
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    let offset = 0;
    const limit = 2000;

    const episodes: Episode[] = [];
    const url = new URL(`api/v1/anime/${query}/episodes`, this.baseUrl);

    const segments = url.pathname.split("/").filter(Boolean);
    const animeIdx = segments.indexOf("anime");
    const animeSlug =
      animeIdx !== -1 && animeIdx + 1 < segments.length ? segments[animeIdx + 1]! : "";
    const meta = this.animeMetaCache.get(animeSlug) || (await this.fetchAnimeMeta(animeSlug));
    const maxSub = meta?.subbed ?? 0;
    const maxDub = meta?.dubbed ?? 0;

    while (true) {
      url.searchParams.set("limit", limit.toString());
      url.searchParams.set("offset", offset.toString());

      const { data: result } = await this.client.get<EpisodeListResponse>(url.toString());

      offset += limit;
      result.data.forEach((episode) => {
        let title = "";
        if (episode.episode_number != null) title = `Episode ${episode.episode_number}`;
        if (episode.title && !title.includes(episode.title)) title += `: ${episode.title}`;
        if (episode.is_recap) title += " [Recap]";
        if (episode.is_filler) title += " [Filler]";

        const safeEpisodeId = episode.episodeId || `ep-${episode.episode_number}`;

        // const episodeUrl = new URLSearchParams({
        //     episodeId: episode.episodeId.toString(),
        //     animeUrl: query,
        //     episodeNumber: String(episode.episode_number || '')
        // })

        const hasSub = episode.episode_number ?? 0 <= maxSub;
        const hasDub = episode.episode_number ?? 0 <= maxDub;

        let scanlator: string | null = null;
        if (hasDub && hasSub) {
          scanlator = "Sub & Dub";
        } else if (hasSub) {
          scanlator = "Sub";
        } else if (hasDub) {
          scanlator = "Dub";
        }

        episodes.push({
          title,
          episodeNumber: this.toNumberOrNull(episode.episode_number),
          isFiller: episode.is_filler ?? false,
          url: `${animeSlug}/${safeEpisodeId}`,
          scanlator,
          lastUpdated: this.parseSeriesDate(episode.aired),
        });
      });

      if (offset >= result.total || result.data.length === 0) break;
    }

    return episodes;
  };

  private apiHeaders(referer = `${this.baseUrl}/home`) {
    const headers = this.headersBuilders();
    headers.set("Accept", "application/json, text/plain, */*");
    headers.set("Accept-Language", "en-US,en;q=0.9");
    headers.set("Referer", referer);
    headers.set("Sec-Fetch-Dest", "empty");
    headers.set("Sec-Fetch-Mode", "cors");
    headers.set("Sec-Fetch-Site", "same-origin");
    return headers;
  }

  private async fetchAnimeMeta(animeSlug: string): Promise<AnimeMeta | undefined> {
    if (this.animeMetaCache.has(animeSlug)) return this.animeMetaCache.get(animeSlug);

    try {
      const { data } = await this.client.get<AnimeDetailsResponse>(
        `${this.apiUrl}/anime/${animeSlug}`,
        {
          headers: this.apiHeaders(`${this.baseUrl}/${animeSlug}`),
        },
      );

      this.animeMetaCache.set(animeSlug, {
        anilistId: data.anilist_id ?? 0,
        tmdbId: data.themoviedb_id ?? 0,
        seasonNumber:
          data.format?.toLowerCase() === "movie"
            ? 0
            : data.external_seasons?.tmdb != null && data.external_seasons.tmdb > 0
              ? data.external_seasons?.tmdb
              : 1,
        subbed: data.subbed ?? 0,
        dubbed: data.dubbed ?? 0,
      });

      return this.animeMetaCache.get(animeSlug);
    } catch {
      return undefined;
    }
  }

  override getVideos: GetVideos = async (query) => {
    const [slug = "", epId = ""] = query.split("/").filter(Boolean);
    const epNumber = StringUtils.removePrefix(epId, "ep-");

    const meta = this.animeMetaCache.get(slug) || (await this.fetchAnimeMeta(slug));

    if (meta && meta.anilistId > 0) {
      const url = new URL(`${this.flixUrl}/${meta.anilistId}/${epNumber}`);
      const referer = `${this.baseUrl}/watch/${slug}?ep=${epNumber}`;

      const { data } = await this.client.get<VideoResponse>(url.toString(), {
        headers: this.apiHeaders(referer),
      });

      return await this.parseFlixServers(data, referer);
    }

    const { data: html } = await this.client.get<string>(`
        ${this.baseUrl}/watch/${slug}?ep=${epNumber}
      `);

    return await this.handleAnimePageResponse(html, slug, epNumber);
  };

  private async handleAnimePageResponse(
    html: string,
    slug: string,
    epNumber: string,
  ): Promise<Video[]> {
    const anilistId = this.toNumberOrNull(html.match(this.ANILIST_ID_REGEX)?.[1]) ?? 0;
    const tmdbId = this.toNumberOrNull(html.match(this.TMDB_ID_REGEX)?.[1]) ?? 0;
    const isMovie = this.isMovieRecord(html, slug);
    let seasonNumber = 0;

    if (!isMovie) {
      const tmdbSeason = this.TMDB_SEASON_REGEX.exec(html)?.[1];
      const season = this.SEASON_REGEX.exec(html)?.[1];

      seasonNumber =
        (tmdbSeason && Number(tmdbSeason) > 0 ? Number(tmdbSeason) : null) ??
        (season && Number(season) > 0 ? Number(season) : null) ??
        1;
    }

    const subbed = this.toNumberOrNull(html.match(this.SUBBED_REGEX)?.[1]) ?? 0;
    const dubbed = this.toNumberOrNull(html.match(this.DUBBED_REGEX)?.[1]) ?? 0;

    if (anilistId > 0 || tmdbId > 0) {
      this.animeMetaCache.set(slug, {
        anilistId,
        tmdbId,
        seasonNumber,
        subbed,
        dubbed,
      });
    }

    const referer = `${this.baseUrl}/watch/${slug}?ep=${epNumber}`;

    let flixRes: AxiosResponse<VideoResponse>;

    if (anilistId > 0) {
      flixRes = await this.client.get<VideoResponse>(`${this.flixUrl}/${anilistId}/${epNumber}`, {
        headers: this.apiHeaders(referer),
      });
    } else if (tmdbId > 0) {
      flixRes = await this.client.get(`${this.flixUrl}/0/${epNumber}`, {
        params: {
          tmdb: String(tmdbId),
          season: String(seasonNumber),
        },
        headers: this.apiHeaders(referer),
      });
    } else {
      return [];
    }

    return await this.parseFlixServers(flixRes.data, referer);
  }

  private async parseFlixServers(response: VideoResponse, referer: string): Promise<Video[]> {
    if (!response.success || !Array.isArray(response.servers) || !response.servers.length)
      return [];

    return await parallelCatchingFlatMap(response.servers, async (server) => {
      const dataLink = server.dataLink;
      if (!dataLink) return [];

      let label = this.audioTagOf(server.dataType);
      if (server.serverName) label += ` ${server.serverName}`;
      if (server.softsub) label += " [Softsub]";

      return this.extractFromServer(dataLink, label, referer);
    });
  }

  private async extractFromServer(
    dataLink: string,
    label: string,
    _referer: string,
  ): Promise<Video[]> {
    const flixCloudUrl = "https://flixcloud.cc";
    const flixHeaders = this.headersBuilders();
    flixHeaders.set("Accept", "*/*");
    flixHeaders.set("Origin", flixCloudUrl);
    flixHeaders.set("Referer", `${flixCloudUrl}/`);

    const decHeaders = new AxiosHeaders();
    decHeaders.set("Accept", "*/*");

    try {
      // Step 1: Fetch embed page; has XOR key in HEX format
      const { data: html } = await this.client.get<string>(dataLink, { headers: flixHeaders });

      const xorMask = await this.getXorMask(html, flixHeaders);

      const dataMatch = html.match(this.EMBED_DATA_REGEX)?.[1];
      if (!dataMatch) return [];

      const rawJson = this.json5ToJson(dataMatch);

      let embedDataObj: FlixcloudEmbedData;
      try {
        embedDataObj = JSON.parse(rawJson);
      } catch {
        embedDataObj = {
          subtitles: [],
          intro_chapter: null,
          outro_chapter: null,
          chapters: [],
        };
      }

      const subtitles: SubtitleTrack[] = [];
      if (Array.isArray(embedDataObj.subtitles)) {
        embedDataObj.subtitles.forEach((sub) => {
          subtitles.push({
            kind: "subtitles",
            label: sub.language || "Unknown",
            lang: this.labelToLang(sub.language || "") || sub.language || "und",
            url: sub.url,
          });
        });
      }

      let embedData: any;

      try {
        const obj = JSON.parse(rawJson);
        delete obj.subtitles;
        delete obj.intro_chapter;
        delete obj.outro_chapter;
        embedData = obj;
      } catch {
        embedData = JSON.parse(rawJson);
      }

      // Step 2: Get token
      const tokenResponse = await this.requestToken(embedData, decHeaders);
      if (!tokenResponse) return [];

      // Step 3: Fetch encrypted stream
      const m3u8Json = await this.fetchM3u8(tokenResponse.token, flixHeaders);

      // Step 4: Decrypt Stream
      const streamPayload = {
        data: {
          context: tokenResponse.context,
          stream_response: m3u8Json,
        },
      };

      const { data: streamResult } = await this.client.post<DecFlixCloudStreamResponse>(
        `${this.decApi}/dec-flixcloud`,
        streamPayload,
        {
          headers: decHeaders,
          params: {
            type: "stream",
          },
          validateStatus: () => true,
        },
      );

      if (streamResult.status !== 200 || !streamResult.result) return [];

      const streamUrl = streamResult.result.stream;
      const wPayload = streamResult.result.context["w_payload"];
      if (!wPayload || typeof wPayload !== "string") {
        return [];
      }

      const headersObj: Record<string, string> = {
        Referer: `${flixCloudUrl}/`,
      };
      const server = await this.getProxyServer(headersObj, xorMask);

      return this.buildVideoResult({
        label,
        streamUrl,
        embedDataObj,
        subtitles,
        wPayload,
        proxyServer: server,
      });
    } catch (error) {
      console.error("Error extracting from server", error);
      return [];
    }
  }

  private isMovieRecord(html: string, slug: string): boolean {
    const index = html.indexOf(slug);
    if (index === -1) return false;
    const start = Math.max(index - 500, 0);
    const end = Math.min(index + 500, html.length);
    const snippet = html.substring(start, end);

    return (
      this.FORMAT_MOVIE_REGEX.test(snippet) || snippet.toLowerCase().includes('"format":"movie"')
    );
  }

  private async getXorMask(html: string, headers: AxiosHeaders): Promise<Buffer> {
    /**
     * FlixCloud segment XOR mask (16bytes)
     *
     * This mask is fetched DYNAMICALLY from hls.js on every episode load.
     * If the dynamic fetch fails, the extension falls back to the value below.
     *
     * How to manually update the fallback:
     *  1. Open a Re:ANIME video in a browser.
     *  2. In network tab, search the loaded scripts for `for (var f = [`.
     *  3. Copy the 16 numbers and paste them into `hardcodedFallback` below.
     *
     * Last verified at: 03-09-2026
     */
    const hardcodedFallback = Buffer.from([
      157, 42, 241, 71, 179, 142, 92, 112, 166, 25, 228, 59, 216, 98, 15, 197,
    ]);

    const scriptPath = html.match(this.HLS_SCRIPT_REGEX)?.[1];
    if (scriptPath) {
      try {
        const scriptUrl = scriptPath.startsWith("http")
          ? scriptPath
          : `https://flixcloud.cc${scriptPath}`;
        const { data: jsContent } = await this.client.get<string>(scriptUrl, { headers });
        const maskMatch = jsContent.match(this.XOR_MASK_REGEX)?.[1];
        if (maskMatch) {
          const mask = Buffer.from(
            maskMatch.split(",").map((x) => Number.parseInt(x.trim(), 10) & 0xff),
          );
          this.storedXorMask = mask;
          return mask;
        }
      } catch {
        // fall through
      }
    }

    return this.storedXorMask ?? hardcodedFallback;
  }

  private async requestToken(embedData: any, headers: AxiosHeaders) {
    const response = await this.client.post<DecFlixCloudTokenResponse>(
      `${this.decApi}/dec-flixcloud`,
      { data: embedData },
      { headers, params: { type: "token" }, validateStatus: () => true },
    );

    if (response.data.status !== 200 || !response.data.result) return null;
    return {
      token: response.data.result.token,
      context: response.data.result.context,
    };
  }

  private async fetchM3u8(token: string, headers: AxiosHeaders) {
    const { data: m3u8Body } = await this.client.get<string>(
      `${this.FLIX_CLOUD_URL}/api/m3u8/${token || ""}`,
      { headers, responseType: "text" },
    );

    try {
      return JSON.parse(m3u8Body);
    } catch {
      console.error("Failed to parse m3u8Body JSOn");
      return [];
    }
  }

  private buildVideoResult({
    label,
    streamUrl,
    wPayload,
    subtitles,
    embedDataObj,
    proxyServer,
  }: {
    label: string;
    streamUrl: string;
    wPayload: string;
    subtitles: SubtitleTrack[];
    embedDataObj: FlixcloudEmbedData;
    proxyServer: FlixProxyServer;
  }): Video[] {
    const proxiedSubtitles = subtitles.map((s) => ({
      ...s,
      url: proxyServer.createSubtitleProxyUrl(s.url),
    }));

    const tracks: AuxiliaryTrack[] = [];
    const chapterData: VideoChapters = {};

    const addChapter = (key: "intro" | "outro", data: FlixcloudChapter | null) => {
      if (data?.start != null && data?.end != null) {
        chapterData[key] = {
          start: data.start,
          end: data.end,
          title: data.title || key.charAt(0).toUpperCase() + key.slice(1),
        };
      }
    };

    addChapter("intro", embedDataObj.intro_chapter);
    addChapter("outro", embedDataObj.outro_chapter);

    let intro: Segment | undefined;
    if (
      embedDataObj.intro_chapter?.start != null &&
      embedDataObj.intro_chapter?.end != null &&
      embedDataObj.intro_chapter.end > embedDataObj.intro_chapter.start
    ) {
      intro = {
        start: embedDataObj.intro_chapter.start,
        end: embedDataObj.intro_chapter.end,
      };
    }
    let outro: Segment | undefined;
    if (
      embedDataObj.outro_chapter?.start != null &&
      embedDataObj.outro_chapter?.end != null &&
      embedDataObj.outro_chapter.end > embedDataObj.outro_chapter.start
    ) {
      outro = {
        start: embedDataObj.outro_chapter.start,
        end: embedDataObj.outro_chapter.end,
      };
    }

    if (Array.isArray(embedDataObj.chapters) && embedDataObj.chapters.length > 0) {
      chapterData.chapters = embedDataObj.chapters
        .filter((c) => c?.start != null && c?.end != null)
        .map((c) => ({
          start: c.start,
          end: c.end,
          title: c.title || "Chapter",
        }));
    }

    if (chapterData.intro || chapterData.outro || chapterData.chapters) {
      tracks.push({
        kind: "chapters",
        label: "Chapters",
        url: proxyServer.createChaptersProxyUrl(streamUrl, chapterData),
      });
    }

    return [
      {
        label,
        subtitleTracks: proxiedSubtitles,
        url: proxyServer.createProxyUrl(streamUrl, wPayload),
        headers: { Referer: `${this.FLIX_CLOUD_URL}/` },
        type: "application/vnd.apple.mpegurl",
        tracks,
        intro,
        outro,
      },
    ];
  }

  private audioTagOf(dataType: string | null) {
    switch (dataType) {
      case "sub":
        return "[Sub]";
      case "dub":
        return "[Dub]";
      default:
        return dataType && dataType?.trim() !== "" ? `[${dataType}]` : "";
    }
  }

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      SortFilter,
      StatusFilter,
      FormatFilter,
      SeasonFilter,
      OriginFilter,
      YearFilter,
      GenreFilter,
      StudioFilter,
    ],
  });

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input) {
      case "Finished":
      case "FINISHED":
        return "completed";
      case "Releasing":
      case "RELEASING":
        return "ongoing";
      case "Not Yet Released":
        return "upcoming";
      case "Cancelled":
      case "CANCELLED":
        return "cancelled";
      default:
        return "unknown";
    }
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_MIRROR_KEY,
      label: "Preferred mirror",
      options: this.MIRRORS.map((m) => ({
        label: new URL(m).hostname,
        value: m,
      })),
      type: "select",
      defaultValue: this.PREF_DEFAULT_MIRROR,
    },
  ];

  private json5ToJson(json5: string) {
    return json5
      .replace(this.JSON5_KEY_REGEX, '$1"$2"$3')
      .replace(this.JSON5_TRAILING_COMMA_REGEX, "$1")
      .replace(this.JSON5_UNDEFINED_REGEX, ": null");
  }

  private readonly MIRRORS = ["https://reanime.to", "https://reanime.cz"];

  private readonly PREF_MIRROR_KEY = "preferred_mirror";
  private readonly PREF_DEFAULT_MIRROR = this.MIRRORS[0]!;

  private readonly HLS_SCRIPT_REGEX = /href="([^"]*hls\.js[^"]*)/;
  private readonly XOR_MASK_REGEX = /for\(var f=\[(\d{1,3}(?:,\d{1,3}){15})]/;

  private readonly BR_REGEX = /<br\s*\/?>/i;
  private readonly HTML_TAG_REGEX = /<\/?(i|b|em)>/i;
  private readonly ANILIST_ID_REGEX = /(?<!\w)"?anilist_id"?\s*:\s*(\d+)/;
  private readonly TMDB_ID_REGEX = /(?<!\w)"?themoviedb_id"?\s*:\s*(\d+)/;
  private readonly TMDB_SEASON_REGEX = /(?<!\w)"?tmdb"?\s*:\s*(\d+)/;
  private readonly SEASON_REGEX = /(?<!\w)"?season"?\s*:\s*(\d+)/;
  private readonly FORMAT_MOVIE_REGEX = /(?<!\w)"?format"?\s*:\s*"MOVIE"/i;
  private readonly SUBBED_REGEX = /,\s*subbed:\s*(\d+)/;
  private readonly DUBBED_REGEX = /,\s*dubbed:\s*(\d+)/;
  private readonly EMBED_DATA_REGEX = /type:\s*"data",\s*data:\s*(\{.*?\})\s*,\s*uses:/s;
  private readonly JSON5_KEY_REGEX = /([{,]\s*)([\w_]+)(\s*:)/;
  private readonly JSON5_TRAILING_COMMA_REGEX = /,\s*([}\]])/;
  private readonly JSON5_UNDEFINED_REGEX = /:\s*undefined\b/;
}
