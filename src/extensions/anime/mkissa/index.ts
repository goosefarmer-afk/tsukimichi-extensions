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
  type GetSettingsFilters,
  type GetVideos,
  type Preferences,
  type SearchSeries,
  type SeriesListResponse,
  type Video,
} from "@tsukimichi/common";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import { DoodExtractor } from "@/lib/extractors/dood-extractor";
import { FilemoonExtractor } from "@/lib/extractors/filemoon";
import { GogoStreamExtractor } from "@/lib/extractors/gogo-stream-extractor";
import { Mp4UploadExtractor } from "@/lib/extractors/mp4-upload-extractor";
import { OkruExtractor } from "@/lib/extractors/okru";
import { StreamWishExtractor } from "@/lib/extractors/stream-wish";
import { StreamlareExtractor } from "@/lib/extractors/streamlare";
import { parallelCatchingFlatMap } from "@/utils/map";
import { AllAnimeExtractor } from "./extractors/all-anime-extractor";
import {
  ALL_ANIME_COUNTRY_ORIGIN_FILTER,
  ALL_ANIME_GENRE_FILTER,
  ALL_ANIME_RELEASE_YEAR_FILTER,
  ALL_ANIME_SEASON_FILTER,
  ALL_ANIME_SORT_BY_FILTER,
  ALL_ANIME_TYPE_FILTER,
} from "./filters";
import manifest from "./manifest.json";
import type {
  AnimeDetails,
  DecryptedEpisodeResult,
  EncryptedEpisodeResult,
  EpisodeResult,
  PopularResult,
  SearchResult,
  SeriesResult,
  SourceUrl,
} from "./types";
import { MKissaKeyManager, Material } from "./mkissa-key-manager";
import {
  ANIME_DETAILS_QUERY,
  EPISODES_QUERY,
  POPULAR_SERIES_QUERY,
  SEARCH_SERIES_QUERY,
  STREAM_HASH,
  STREAM_QUERY,
} from "./queries";

export class MKissa extends BaseAnimeScraper {
  private readonly apiUrl = "https://api.mkissa.net";
  private readonly siteUrl = "https://mkissa.to";

  private allAnimeExtractor: AllAnimeExtractor;
  private okruExtractor: OkruExtractor;
  private gogoStreamExtractor: GogoStreamExtractor;
  private doodExtractor: DoodExtractor;
  private mp4UploadExtractor: Mp4UploadExtractor;
  private streamlareExtractor: StreamlareExtractor;
  private streamwishExtractor: StreamWishExtractor;
  private filemoonExtractor: FilemoonExtractor;

  private keyManager: MKissaKeyManager;

  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();

    this.allAnimeExtractor = new AllAnimeExtractor(this.client);
    this.okruExtractor = new OkruExtractor(this.client);
    this.gogoStreamExtractor = new GogoStreamExtractor(this.client);
    this.doodExtractor = new DoodExtractor(this.client);
    this.mp4UploadExtractor = new Mp4UploadExtractor(this.client);
    this.streamlareExtractor = new StreamlareExtractor(this.client);
    this.filemoonExtractor = new FilemoonExtractor(this.client);
    this.streamwishExtractor = new StreamWishExtractor(this.client);

    this.keyManager = new MKissaKeyManager(
      this.client,
      this.headersBuilders(),
      this.settings ?? {},
      this.siteUrl,
      this.apiUrl,
    );
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const body = {
      variables: {
        page,
        type: "anime",
        size: this.PAGE_SIZE,
        dateRange: 7,
      },
      query: POPULAR_SERIES_QUERY,
    };

    const { data } = await this.makeGQLRequest<PopularResult>(body);

    const pref = await this.$preferences.getString(
      this.SETTING_KEYS.preferredTitle,
      this.TITLE_OPTIONS[0]!,
    );

    return this.parsePopularSeries(data, pref);
  };

  private parsePopularSeries(
    result: PopularResult,
    prefTitleLang: string,
  ): SeriesListResponse<Anime> {
    const animeList: Anime[] = [];

    result.data.queryPopular.recommendations.forEach((item) => {
      const card = item.anyCard;

      if (card) {
        const title = this.getProperTitle(
          card.name,
          card.englishName,
          card.nativeName,
          prefTitleLang,
        );

        const params = new URLSearchParams({
          id: card._id,
          slugTime: card.slugTime || "",
          title: this.slugifyTitle(card.name),
        }).toString();

        animeList.push({
          title,
          url: params.toString(),
          coverImageUrl: card.thumbnail,
          isNsfw: null,
          status: "unknown",
        });
      }
    });

    const hasMore = animeList.length === this.PAGE_SIZE;

    return {
      data: animeList,
      hasMore,
    };
  }

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { page = 1, filters } = options ?? {};

    const sub = await this.$preferences.getString(this.SETTING_KEYS.preferredSubKey, "sub");

    const payloadObj = {
      variables: {
        search: {
          allowAdult: filters?.includeNsfw ?? true,
          allowUnknown: true,
        },
        limit: this.PAGE_SIZE,
        page,
        translationType: sub,
        countryOrigin: "ALL",
      },
      query: SEARCH_SERIES_QUERY,
    };

    const { data } = await this.makeGQLRequest<SearchResult>(payloadObj);
    const pref = await this.$preferences.getString(
      this.SETTING_KEYS.preferredTitle,
      this.TITLE_OPTIONS[0]!,
    );
    return this.parseSearchResult(data, pref);
  };

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    const search: Record<string, any> = {
      allowAdult: filters?.includeNsfw ?? true,
      allowUnknown: true,
    };

    if (query?.trim()) search.query = query.trim();

    if (!query?.trim() && filters) {
      for (const { type, value, filter } of resolveFilterEntries(
        filters,
        this.getFilterConfig().filters,
      )) {
        switch (type) {
          case "select":
            if (value === "any") continue;
            search[filter.key] = value;
            break;

          case "multi-select":
            search[filter.key] = value;

            break;

          case "tri-state-checkbox":
            if (filter.key === "genres") {
              const include = new Set<string>();
              const exclude = new Set<string>();

              for (const val of value) {
                if (val.state === "include") include.add(val.value.toString());
                else if (val.state === "exclude") exclude.add(val.value.toString());
              }

              search.genres = Array.from(include);
              search.excludeGenres = Array.from(exclude);
            }
            break;

          default:
            break;
        }
      }
    }

    const sub = await this.$preferences.getString(this.SETTING_KEYS.preferredSubKey, "sub");

    const payloadObj: Record<string, any> = {
      query: SEARCH_SERIES_QUERY,
      variables: {
        search,
        limit: this.PAGE_SIZE,
        page,
        countryOrigin: "ALL",
        translationType: sub,
      },
    };

    const { data } = await this.makeGQLRequest<SearchResult>(payloadObj);
    const pref = await this.$preferences.getString(
      this.SETTING_KEYS.preferredTitle,
      this.TITLE_OPTIONS[0]!,
    );
    return this.parseSearchResult(data, pref);
  };

  private parseSearchResult(
    result: SearchResult,
    prefTitleLang: string,
  ): SeriesListResponse<Anime> {
    const animeList: Anime[] = [];

    result.data.shows.edges.forEach((item) => {
      const title = this.getProperTitle(
        item.name,
        item.englishName,
        item.nativeName,
        prefTitleLang,
      );

      const params = new URLSearchParams({
        id: item._id,
        slugTime: item.slugTime || "",
        title: this.slugifyTitle(item.name),
      });

      animeList.push({
        title,
        url: params.toString(),
        coverImageUrl: item.thumbnail,
        isNsfw: null,
        status: "unknown",
      });
    });

    const hasMore = animeList.length === this.PAGE_SIZE;

    return {
      data: animeList,
      hasMore,
    };
  }

  override getSeries: GetSeries<Anime> = async (query) => {
    const params = new URLSearchParams(query);
    const id = params.get("id")!;
    const payloadObj = {
      variables: {
        _id: id,
      },
      query: ANIME_DETAILS_QUERY,
    };

    const { data: result } = await this.makeGQLRequest<AnimeDetails>(payloadObj);

    if (!result.data.show) throw new Error("Anime not found");

    const { show: anime } = result.data;

    const pref = await this.$preferences.getString(
      this.SETTING_KEYS.preferredTitle,
      this.TITLE_OPTIONS[0]!,
    );

    const title = this.getProperTitle(anime.name, anime.englishName, anime.nativeName, pref);

    let description = "";

    if (anime.description) description = `${anime.description}<br><br>`;

    description += `Type: ${anime.type || "Unknown"}`;

    if (anime.season) {
      description += `<br>Season: ${anime.season.quarter} ${anime.season.year}`;
    }

    if (anime.rating) {
      description += `<br>Rating: ${anime.rating}`;
    }

    return {
      id: anime._id,
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      url: query,
      isNsfw: anime.isAdult ?? null,
      coverImageUrl: anime.thumbnail,
      status: this.getSeriesStatus(anime.status),
      genres: anime.genres,
      studios: anime.studios,
      rating: anime.score,
      description,
    };
  };

  override getEpisodes: GetEpisodes = async (animeUrl) => {
    const params = new URLSearchParams(animeUrl);
    const id = params.get("id")!;
    const body = {
      variables: {
        _id: id,
        // _id: animeUrl.split(this.URL_SEPARATOR)[0]!,
      },
      query: EPISODES_QUERY,
    };

    const { data: episodesData } = await this.makeGQLRequest<SeriesResult>(body);

    const episodes: Episode[] = [];
    const { sub, dub } = episodesData.data.show.availableEpisodesDetail;
    const preferredSub = await this.$preferences.getString(
      this.SETTING_KEYS.preferredSubKey,
      "sub",
    );

    if (preferredSub) {
      sub?.forEach((ep) => {
        const episodeNumber = this.toNumberOrNull(ep, true);
        const title = `Episode ${episodeNumber} (Sub)`;
        const chapterUrl = new URLSearchParams({
          showId: episodesData.data.show._id,
          translationType: "sub",
          episodeString: ep,
        });
        episodes.push({
          title,
          url: chapterUrl.toString(),
          episodeNumber,
        });
      });
    } else {
      dub?.forEach((ep) => {
        const episodeNumber = this.toNumberOrNull(ep, true);
        const title = `Episode ${episodeNumber} (Dub)`;
        const chapterUrl = new URLSearchParams({
          showId: episodesData.data.show._id,
          translationType: "dub",
          episodeString: ep,
        });

        episodes.push({
          title,
          url: chapterUrl.toString(),
          episodeNumber,
        });
      });
    }

    return this.addEpisodeNavigation(episodes);
  };

  override getVideos: GetVideos = async (url) => {
    const sourceUrls = await this.fetchSourceUrls(url);

    const servers: any[] = [];

    const containsAny = (str: string, arr: string[]) => arr.some((s) => str.includes(s));

    const INTERNAL_HOSTER_MATCHERS = this.INTERNAL_HOSTER_NAMES.map(
      (s) => new RegExp(`\\b${s.toLowerCase()}\\b`),
    );

    sourceUrls.forEach((video) => {
      const videoUrl = this.decryptSource(video.sourceUrl);
      const sourceName = video.sourceName.toLowerCase();

      const matchingMapping = Object.entries(MKissa.HOSTER_MAPPINGS).find(
        ([_altHoster, urlMatches]) => containsAny(videoUrl, urlMatches),
      );

      if (
        videoUrl.startsWith("/apivtwo/") &&
        INTERNAL_HOSTER_MATCHERS.some((s) => s.test(sourceName))
      ) {
        servers.push({
          link: videoUrl,
          name: `Internal ${video.sourceName}`,
          id: videoUrl,
          index: video.priority,
          type: "internal",
        });
      } else if (video.type === "player") {
        servers.push({
          link: videoUrl,
          name: `player@${video.sourceName}`,
          id: videoUrl,
          index: video.priority,
          type: video.type,
        });
      } else if (matchingMapping) {
        const [altHoster] = matchingMapping;
        servers.push({
          link: videoUrl,
          name: altHoster,
          id: videoUrl,
          index: video.priority,
          type: video.type,
        });
      }
    });

    const iframeEndpoint = this.PLAYER_DOMAIN;

    const extracted = await parallelCatchingFlatMap(servers, async (server) => {
      const sName = server.name;
      const lowerSName = sName.toLowerCase();

      if (lowerSName.startsWith("internal")) {
        const videos = await this.allAnimeExtractor.videoFromUrl(
          server.link,
          server.name,
          iframeEndpoint,
        );
        return videos;
      }

      if (sName.startsWith("player@")) {
        const headers = {
          Accept:
            "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
          Host: new URL(server.link).host,
          // These Yt sources live on the site's CDN (tools.fast4speed.rsvp), which is
          // Cloudflare-gated: it streams with a legacy allanime.day Referer and 403s on
          // any mkissa one
          Referer: `${this.PLAYER_DOMAIN}/`,
        };

        const videoList: Video[] = [
          {
            label: `Original (player ${server.name.replace("player@", "")})`,
            url: server.link,
            headers,
            type: "video/webm",
          },
        ];

        return videoList;
      }

      if (sName === "vidstreaming") {
        const videos = await this.gogoStreamExtractor.getVideosFromUrl(server.link);
        return videos;
      }

      if (sName === "dood") {
        const videos = await this.doodExtractor.getVideosFromUrl({
          url: server.link,
        });
        return videos;
      }

      if (sName === "okru") {
        const videos = await this.okruExtractor.getVideos(server.link);
        return videos.sort((a, b) => b.label.localeCompare(a.label));
      }

      if (sName === "mp4upload") {
        const videos = await this.mp4UploadExtractor.videosFromUrl({
          url: server.link,
          headers: this.headersBuilders(),
        });
        return videos;
      }

      if (sName === "streamlare") {
        const videos = await this.streamlareExtractor.videosFromUrl({
          url: server.link,
        });
        return videos;
      }

      if (sName === "Fm-Hls") {
        const videos = await this.filemoonExtractor.videosFromUrl({
          url: server.link,
          headers: this.headersBuilders(),
          prefix: "Fm-Hls:",
        });
        return videos;
      }

      if (sName === "streamwish") {
        const videos = await this.streamwishExtractor.videosFromUrl({
          url: server.link,
          headers: this.headersBuilders(),
        });
        return videos;
      }

      return [];
    });

    return extracted;
  };

  private async fetchSourceUrls(url: string): Promise<SourceUrl[]> {
    let buildHealed = false;
    let encryptionChangeError = new Error(
      "MKissa changed its stream encryption; update the extension",
    );
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.MAX_KEY_ATTEMPTS; attempt++) {
      try {
        const material = await this.keyManager.material(attempt > 0);
        let tobeparsed: string | null = null;
        let responseBody: any = null;
        try {
          const { data: result } = await this.videoListRequest(url, material);
          responseBody = result;
          tobeparsed = (result as EncryptedEpisodeResult).data?.tobeparsed;
        } catch (error) {
          lastError = error as Error;
          continue;
        }

        if (tobeparsed?.trim()) {
          const decrypted = await this.keyManager.decrypt(tobeparsed, material);
          if (decrypted) {
            const json = JSON.parse(decrypted) as DecryptedEpisodeResult;
            return (json.episode?.sourceUrls || []) as SourceUrl[];
          }
        }

        const apiError = MKissaKeyManager.apiErrorMessage(responseBody || {});
        if (apiError) throw new Error(apiError);

        if (!MKissaKeyManager.isCryptoError(responseBody || {})) {
          try {
            const parsed = JSON.parse(responseBody || "") as EpisodeResult;
            const sourceUrls = parsed.data.episode?.sourceUrls ?? [];
            if (Array.isArray(sourceUrls) && sourceUrls.length) {
              return sourceUrls;
            }
          } catch {}
        }

        lastError = encryptionChangeError;

        if (attempt >= 1 && !buildHealed && MKissaKeyManager.isCryptoError(responseBody || {})) {
          this.keyManager.invalidate();
          buildHealed = true;
        }

        this.keyManager.invalidate();
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw lastError || encryptionChangeError;
  }

  private async videoListRequest<T>(server: string, material: Material): Promise<AxiosResponse<T>> {
    const params = new URLSearchParams(server);
    const variables = Object.fromEntries(params.entries());
    const aaReq = await this.keyManager.aaReq(material);
    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: STREAM_HASH,
      },
      k: MKissaKeyManager.ANIME_LANE,
      aaReq,
    };

    const headers = new AxiosHeaders();
    headers.set("Referer", `${this.baseUrl}/`);
    headers.set("x-build-id", material.buildId);

    const url = new URL(`${this.apiUrl}/api`);
    url.searchParams.set("query", STREAM_QUERY);
    url.searchParams.set("variables", JSON.stringify(variables));
    url.searchParams.set("extensions", JSON.stringify(extensions));

    return this.client.get(url.toString(), { headers });
  }

  private decryptSource(input: string): string {
    let hexPayload: string;
    let keyType: number;

    if (input.startsWith("--")) {
      hexPayload = input.slice(2);
      keyType = 3;
    } else if (input.startsWith("#-")) {
      hexPayload = input.slice(2);
      keyType = 2;
    } else if (input.startsWith("##")) {
      hexPayload = input.slice(2);
      keyType = 1;
    } else if (input.startsWith("-#")) {
      hexPayload = input.slice(2);
      keyType = 4;
    } else if (input.startsWith("#")) {
      hexPayload = input.slice(1);
      keyType = 0;
    } else {
      return input;
    }

    const mask = this.XOR_MASKS[keyType]!;

    let result = "";
    for (let i = 0; i < hexPayload.length; i += 2) {
      const hexByte = hexPayload.substring(i, i + 2);
      const value = Number.parseInt(hexByte, 16);
      const decrypted = (value ^ mask) & 0xff;
      result += String.fromCharCode(decrypted);
    }

    return result;
  }

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.SETTING_KEYS.preferredTitle,
      label: "Preferred Title",
      type: "select",
      options: this.TITLE_OPTIONS.map((t) => ({
        label: `${t.charAt(0).toUpperCase()}${t.slice(1)}`,
        value: t,
      })),
      defaultValue: this.TITLE_OPTIONS[0],
    },
    {
      key: this.SETTING_KEYS.preferredSubKey,
      label: "Prefer Subs or Dubs?",
      type: "select",
      options: [
        {
          label: "Subs",
          value: "sub",
        },
        {
          label: "Dubs",
          value: "dub",
        },
      ],
      defaultValue: "sub",
    },
  ];

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      ALL_ANIME_SORT_BY_FILTER,
      ALL_ANIME_COUNTRY_ORIGIN_FILTER,
      ALL_ANIME_SEASON_FILTER,
      ALL_ANIME_RELEASE_YEAR_FILTER,
      ALL_ANIME_TYPE_FILTER,
      ALL_ANIME_GENRE_FILTER,
    ],
  });

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input) {
      case "Releasing":
        return "ongoing";
      case "Finished":
        return "completed";
      case "Not Yet Released":
        return "upcoming";
      default:
        return "unknown";
    }
  };

  private static readonly HOSTER_MAPPINGS: Record<string, string[]> = {
    vidstreaming: ["vidstreaming", "https://gogo", "playgo1.cc", "playtaku", "vidcloud"],
    doodstream: ["dood"],
    okru: ["ok.ru", "okru"],
    mp4upload: ["mp4upload.com"],
    streamlare: ["streamlare.com"],
    // Fm-Hls is Filemoon; the embed domain rotates (bysekoze.com is current), so match the
    // legacy filemoon domains too.
    "Fm-Hls": ["bysekoze.com", "fastmoon", "filemoon", "moonplayer"],
    streamwish: ["wish"],
  };

  private readonly FALLBACK_PLAYER_DOMAIN = "https://blog.allanime.day";
  private readonly PLAYER_DOMAIN = "https://allanime.day";
  private readonly MAX_KEY_ATTEMPTS = 1;

  private makeGQLRequest<T = any>(dataObj: Record<string, any>): Promise<AxiosResponse<T>> {
    const payload = JSON.stringify(dataObj);

    const headers = this.headersBuilders();
    headers.set("Accept", "*/*");
    headers.set("Content-Type", "application/json");
    headers.set("Content-Length", Buffer.byteLength(payload).toString());
    headers.set("Host", new URL(this.apiUrl).host);
    headers.set("Origin", new URL(this.baseUrl).origin);
    headers.set("Referer", `${this.apiUrl}/`);

    return this.client.post<T>(`${this.apiUrl}/api`, payload, { headers });
  }

  private getProperTitle(
    name: string,
    englishName: string | null,
    nativeName: string | null,
    prefTitleLang: string,
  ): string {
    let title = "";

    if (prefTitleLang === "english") title = englishName || name;
    else if (prefTitleLang === "romaji") title = name;
    else title = nativeName || englishName || name;

    return title;
  }

  private readonly SETTING_KEYS = {
    preferredTitle: "preferredTitle",
    preferredSubKey: "preferredSubKey",
  };

  private readonly TITLE_OPTIONS = ["english", "romaji", "native"] as const;

  private readonly PAGE_SIZE = 26;

  private slugifyTitle(title: string): string {
    return title
      .replace(/[^a-zA-Z0-9]/g, "-")
      .replace(/-{2,}/g, "-")
      .toLowerCase();
  }

  private readonly URL_SEPARATOR = "<&sep>";

  private DECRYPT_SECRET = "Xot36i3lK3";
  private DECRYPT_TAG_LENGTH = 16; // 128 bits = 16 bytes
  private DECRYPT_KEY_ALGO = "sha256";
  private DECRYPT_CIPHER_ALGO = "aes-256-gcm";

  private XOR_KEYS = [
    "allanimenews",
    "1234567890123456789",
    "1234567890123456789012345",
    "s5feqxw21",
    "feqx1",
  ];
  private XOR_MASKS = Int32Array.from(
    this.XOR_KEYS.map((key) => [...key].reduce((mask, ch) => mask ^ ch.charCodeAt(0), 0)),
  );
  // private XOR_MASKS = this.XOR_KEYS.map(key => [...key].reduce((mask, ch) => mask ^ ch.charCodeAt(0), 0));

  private INTERNAL_HOSTER_NAMES = [
    "Default",
    "Ac",
    "Ak",
    "Kir",
    "Rab",
    "Luf-mp4",
    "Si-Hls",
    "S-mp4",
    "Ac-Hls",
    "Uv-mp4",
    "Pn-Hls",
  ];
}
