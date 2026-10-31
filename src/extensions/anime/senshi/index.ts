import {
  resolveFilterEntries,
  type Anime,
  type ExtensionClientConstructorOptions,
  type GetEpisodes,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type GetVideos,
  type SearchSeries,
  type Segment,
  type SeriesListResponse,
  type SubtitleTrack,
  type TriStateFilterValue,
  type Video,
} from "@tsukimichi/common";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { Mutex } from "async-mutex";

import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import manifest from "./manifest.json";
import type { AnimeMeta, EpisodeEmbed, FilterResponse, SenshiAnime, SenshiEpisode } from "./types";
import {
  SortFilter,
  StatusFilter,
  FormatFilter,
  LanguageFilter,
  SeasonFilter,
  YearFilter,
  GenreFilter,
} from "./filters";
import { LRUCache } from "@/utils/lru-cache";
import { VidcloudResolver } from "./vidcloud-resolver";
import { parallelCatchingFlatMap } from "@/utils/map";
import { app } from "electron";

export class Senshi extends BaseAnimeScraper {
  private animeMetaCache = new LRUCache<string, AnimeMeta>({ maxSize: 64 });
  private animeMetaMutex = new Mutex();

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  private apiHeaders() {
    return new AxiosHeaders().set("Accept", "application/json").set("Referer", `${this.baseUrl}/`);
  }

  private browsePage = 1;

  private async filterRequest<T>({
    page,
    sortBy,
    query = "",
    genres = [],
    status = [],
    seasons = [],
    year = "",
    languages = [],
    types = [],
  }: {
    page: number;
    sortBy: string;
    query?: string;
    types?: string[];
    genres?: string[];
    status?: string[];
    seasons?: string[];
    year?: string;
    languages?: string[];
  }) {
    this.browsePage = page;

    const payload = {
      searchTerm: query,
      types,
      genres,
      status,
      seasons,
      year,
      studios: [],
      producers: [],
      languages,
      page,
      limit: this.PAGE_LIMIT,
      sortBy,
      serverLanguage: "EN",
    };

    return this.client.post<T>(`${this.baseUrl}/anime/filter`, payload, {
      headers: this.apiHeaders(),
    });
  }

  private filterParse(data: FilterResponse): SeriesListResponse<Anime> {
    const animes: Anime[] = [];
    if (!Array.isArray(data.data) || !data.data.length) return this.emptyListResponse();

    for (const item of data.data) {
      const title = item.title ? item.title : item.title_english || null;
      if (!title) continue;

      let coverImageUrl: string | null = null;
      if (item.anime_picture?.trim()) {
        coverImageUrl = item.anime_picture.startsWith("http")
          ? item.anime_picture
          : `${this.baseUrl}${item.anime_picture}`;
      }

      animes.push({
        title,
        url: item.public_id,
        isNsfw: null,
        coverImageUrl,
        genres: item.genres?.split(",").filter(Boolean) ?? [],
        description: item.ani_description?.replaceAll("\n", "<br>") || "",
        status: this.getSeriesStatus(item.ani_status),
        studios: item.studios?.split(",").filter(Boolean) ?? [],
      });
    }

    const hasMore = this.browsePage * this.PAGE_LIMIT < (data.total ?? 0);

    return {
      data: animes,
      hasMore,
    };
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};
    const { data } = await this.filterRequest<FilterResponse>({ page, sortBy: "score_desc" });

    return this.filterParse(data);
  };

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};
    const { data } = await this.filterRequest<FilterResponse>({ page, sortBy: "recent" });

    return this.filterParse(data);
  };

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    let sortBy = "score_desc";
    let types: string[] = [];
    let genres: string[] = [];
    let status: string[] = [];
    let seasons: string[] = [];
    let year = "";
    let languages: string[] = [];

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (value === "any") continue;

      switch (type) {
        case "select":
          if (filter.key === SortFilter.key && typeof value === "string") {
            sortBy = value;
          }
          if (filter.key === YearFilter.key && typeof value === "string") {
            year = value;
          }
          break;

        case "multi-select":
          if (filter.key === FormatFilter.key && Array.isArray(value)) {
            types = value;
          }
          if (filter.key === StatusFilter.key && Array.isArray(value)) {
            status = value;
          }
          if (filter.key === SeasonFilter.key && Array.isArray(value)) {
            seasons = value;
          }
          if (filter.key === LanguageFilter.key && Array.isArray(value)) {
            languages = value;
          }
          break;

        case "tri-state-checkbox":
          if (filter.key === GenreFilter.key && Array.isArray(value)) {
            genres = value
              // Site shows genre exclusion, but it just ignores the genre
              .filter((g: TriStateFilterValue) => g.state === "include")
              .map((g: TriStateFilterValue) => g.value);
          }
          break;

        default:
          break;
      }
    }

    const { data } = await this.filterRequest<FilterResponse>({
      page,
      query: query?.trim() || "",
      types,
      genres,
      status,
      seasons,
      year,
      languages,
      sortBy,
    });

    return this.filterParse(data);
  };

  private async fetchAnimeMeta(publicId: string): Promise<AnimeMeta | null> {
    if (this.animeMetaCache.has(publicId)) return this.animeMetaCache.get(publicId)!;

    return this.animeMetaMutex.runExclusive(async () => {
      if (this.animeMetaCache.has(publicId)) return this.animeMetaCache.get(publicId)!;

      try {
        const { data } = await this.client.get<SenshiAnime>(`${this.baseUrl}/anime/${publicId}`, {
          headers: this.apiHeaders(),
        });

        this.animeMetaCache.set(publicId, {
          malId: data.id,
          anilistId: data.anilist_id ?? undefined,
          dubCount: data.dub_count ?? 0,
          subCount: data.sub_count ?? 0,
        });

        return this.animeMetaCache.get(publicId)!;
      } catch {
        return null;
      }
    });
  }

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(`anime/${query}`, this.baseUrl);

    const { data } = await this.client.get<SenshiAnime>(url.toString());

    this.animeMetaCache.set(data.public_id, {
      malId: data.id,
      anilistId: data.anilist_id ?? undefined,
      dubCount: data.dub_count ?? 0,
      subCount: data.sub_count ?? 0,
    });

    const title = data.title ? data.title : data.title_english || null;
    if (!title) {
      throw new Error("Title not found");
    }

    let coverImageUrl: string | null = null;
    if (data.anime_picture?.trim()) {
      coverImageUrl = data.anime_picture.startsWith("http")
        ? data.anime_picture
        : `${this.baseUrl}${data.anime_picture}`;
    }

    let description = data.ani_description?.replaceAll("\n", "<br>") || "";
    if (data.ani_episodes) {
      description += `<br>Episodes: ${data.ani_episodes}`;
    }

    if (data.duration) {
      description += `<br>Duration: ${data.duration}`;
    }

    if (data.ani_season && data.ani_year) {
      description += `<br>Season: ${data.ani_season} ${data.ani_year}`;
    }

    return {
      id: String(data.public_id),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      url: query,
      isNsfw: null,
      coverImageUrl,
      genres:
        data.genres
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? [],
      description,
      status: this.getSeriesStatus(data.ani_status),
      studios:
        data.studios
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? [],
      rating: data.score,
      alternateTitles:
        data.synonyms
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((t) => !t.startsWith("http") && t !== title) ?? [],
    };
  };

  //   Keyed by `${publicId}/${ep_id}`
  private skipTimesCache = new LRUCache<string, { intro?: Segment; outro?: Segment }>({
    maxSize: 64,
  });

  override getEpisodes: GetEpisodes = async (query) => {
    const meta = this.animeMetaCache.get(query) ?? (await this.fetchAnimeMeta(query));
    if (!meta) throw new Error("Could not load anime info.");

    const { data } = await this.client.get<SenshiEpisode[]>(
      `${this.baseUrl}/episodes/${meta.malId}`,
    );

    return data.map((ep) => {
      let title =
        ep.ep_title && ep.ep_title !== `Episode ${ep.ep_id}`
          ? `Episode ${ep.ep_id} - ${ep.ep_title}`
          : `Episode ${ep.ep_id}`;
      if (ep.ep_recap) {
        title += " [Recap]";
      }

      const url = `${query}/${ep.ep_id}`;

      const hasSub = ep.ep_id <= meta.subCount;
      const hasDub = ep.ep_id <= meta.dubCount;

      const scanlator = hasSub && hasDub ? "Sub & Dub" : hasSub ? "Sub" : hasDub ? "Dub" : null;

      const prev = this.skipTimesCache.get(url);
      const skipTimes = {
        intro:
          ep.intro_start && ep.intro_end
            ? {
                start: ep.intro_start,
                end: ep.intro_end,
              }
            : prev?.intro,
        outro:
          ep.outro_start && ep.outro_end
            ? {
                start: ep.outro_start,
                end: ep.outro_end,
              }
            : prev?.outro,
      };

      this.skipTimesCache.set(url, skipTimes);

      return {
        id: String(ep.ep_id),
        extensionId: this.extensionMetadata.id,
        source: this.extensionMetadata.name,
        url,
        title,
        isFiller: ep.ep_filler ?? false,
        scanlator,
        lastUpdated: this.parseSeriesDate(ep.created_at),
        episodeNumber: ep.ep_id,
      };
    });
  };

  private vidcloudResolver = new VidcloudResolver(
    () => this.baseUrl,
    () => this.client.get("https://s.vidcloud.se/"),
    this.extensionMetadata.id,
  );

  override getVideos: GetVideos = async (query) => {
    const [publicId, epNumStr] = query.split("/");
    if (!publicId || !epNumStr) throw new Error("Invalid episode url");

    const epNum = this.toNumberOrNull(epNumStr, true);
    if (epNum == null) {
      throw new Error("Invalid episode url");
    }

    const meta = this.animeMetaCache.get(publicId) ?? (await this.fetchAnimeMeta(publicId));
    if (!meta) throw new Error("Could not load anime info.");

    let embedsResponse: AxiosResponse<EpisodeEmbed[]>;
    try {
      embedsResponse = await this.client.get<EpisodeEmbed[]>(
        `${this.baseUrl}/episode-embeds/${meta.malId}/${epNum}`,
        { headers: this.apiHeaders() },
      );
    } catch {
      return [];
    }

    const epSkip = this.skipTimesCache.get(query);

    const embedData = embedsResponse.data.flatMap((it) => {
      if (it.remote_source_id == null || it.status == null || it.status.trim() === "") {
        return [];
      }

      return [
        {
          name: it.status,
          remoteSourceId: it.remote_source_id,
          malId: meta.malId,
          epNum,
        },
      ];
    });

    return parallelCatchingFlatMap(embedData, async (it) => {
      const videoId = it.remoteSourceId;
      const entries = await this.vidcloudResolver.resolve(videoId);

      return entries.flatMap((entry) => {
        const url = entry.sources?.[0]?.src;
        if (!url) return [];

        const subtitles: SubtitleTrack[] =
          entry.tracks
            ?.filter((t) => t.url || t.vttUrl)
            .map((t) => ({
              kind: "captions",
              label: t.label ?? "",
              lang: "",
              url: t.url! || t.vttUrl!,
            })) ?? [];

        const video: Video = {
          url,
          label: entry.sources?.[0]?.label || "",
          subtitleTracks: subtitles,
          headers: {
            Origin: this.baseUrl,
            Referer: `${this.baseUrl}/`,
            "User-Agent": app.userAgentFallback,
          },
          intro: epSkip?.intro,
          outro: epSkip?.outro,
          type: "application/vnd.apple.mpegurl",
        };

        return [video];
      });
    });
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.trim()) {
      case "Currently Airing":
        return "ongoing";
      case "Finished Airing":
        return "completed";
      default:
        return "unknown";
    }
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      SortFilter,
      StatusFilter,
      FormatFilter,
      LanguageFilter,
      SeasonFilter,
      YearFilter,
      GenreFilter,
    ],
  });

  private readonly PAGE_LIMIT = 30;
}

// const client = new Senshi();
// client.getEpisodes("zpykk7").then(console.log);
