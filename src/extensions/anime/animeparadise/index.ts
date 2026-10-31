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
  type GetSettingsFilters,
  type GetVideos,
  type SearchSeries,
  type SeriesListResponse,
  type SubtitleTrack,
  type Preferences,
  type Episode,
} from "@tsukimichi/common";
import type { AxiosHeaders } from "axios";
import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import type {
  AnimeDetailsResponse,
  AnimeListResponse,
  AnimeObject,
  EpisodeListResponse,
  RecentEpisodesResponse,
  EpisodeDataResponse,
} from "./dto";
import { GenreFilter, SortFilter } from "./filters";
import manifest from "./manifest.json";

export class AnimeParadise extends BaseAnimeScraper {
  private readonly API_URL = "https://api.animeparadise.moe";
  private readonly STREAM_URL = "https://stream.animeparadise.moe";

  private preferences: Preferences<{ pref_title_lang: string }> | undefined;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.preferences = options?.$context?.createPreferences?.();
  }

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { filters, page = 1 } = options ?? {};

    const url = new URL("search", this.API_URL);
    url.searchParams.set("v", "1");
    url.searchParams.set("page", page.toString());

    let genre: string | null = null;

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select": {
          if (filter.key === SortFilter.key) {
            url.searchParams.set(filter.key, value);
          } else if (filter.key === GenreFilter.key) {
            genre = value;
          }
          break;
        }
        default:
          break;
      }
    }

    if (query?.trim()) url.searchParams.set("q", query);
    else if (genre) url.searchParams.set("genres", genre);

    const { data } = await this.client.get<AnimeListResponse>(url.toString(), {
      headers: this.apiHeaders(),
    });

    return this.parseAnimeListing(data);
  };

  private async parseAnimeListing(data: AnimeListResponse): Promise<SeriesListResponse<Anime>> {
    if (!data.data?.length) {
      return this.emptyListResponse();
    }

    const titleLang =
      (await this.preferences?.getString("pref_title_lang", this.PREF_TITLE_LANG_DEFAULT)) ??
      this.PREF_TITLE_LANG_DEFAULT;

    const animeList: Anime[] = data.data.map((item) => {
      const poster = item.posterImage;
      const title = this.pickTitle(item.alternativeTitle, titleLang) || item.title;
      const params = new URLSearchParams({ id: String(item._id), slug: item.link }).toString();
      return {
        title,
        url: decodeURIComponent(params),
        coverImageUrl:
          poster.large ??
          poster.medium ??
          poster.small ??
          (poster.original?.includes("X-Amz-") ? null : poster.original) ??
          null,
        isNsfw: null,
        status: "unknown",
      };
    });

    const hasMore = data.pagination.hasNext ?? false;

    return {
      data: animeList,
      hasMore,
    };
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    return this.searchSeries(undefined, {
      page: options?.page,
      filters: {
        [SortFilter.key]: "POPULARITY",
      },
    });
  };

  private seenLatest = new Set<string>();

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const page = options?.page ?? 1;

    if (page === 1) this.seenLatest.clear();

    const url = new URL("ep/recently-added", this.API_URL);
    url.searchParams.set("limit", "25");
    url.searchParams.set("v", page.toString());

    const { data } = await this.client.get<RecentEpisodesResponse>(url.toString(), {
      headers: this.apiHeaders(),
    });

    const result = await this.parseAnimeListing({
      data: data.data.map((item) => item.origin),
      pagination: data.pagination,
    });

    return {
      data: result.data.filter((item) => {
        if (this.seenLatest.has(item.url)) return false;
        this.seenLatest.add(item.url);
        return true;
      }),
      hasMore: result.hasMore,
    };
  };

  override getSeries: GetSeries<Anime> = async (query) => {
    const slug = new URLSearchParams(query).get("slug");
    if (!slug) {
      throw new Error("Slug not found in the URL");
    }

    const url = new URL(`anime/${slug}`, this.API_URL);
    const { data: result } = await this.client.get<AnimeDetailsResponse>(url.toString(), {
      headers: this.apiHeaders(),
    });

    if (!result.data) throw new Error("Anime not found");

    const data = result.data;
    const poster = data.posterImage;

    const titleLang =
      (await this.preferences?.getString("pref_title_lang", this.PREF_TITLE_LANG_DEFAULT)) ??
      this.PREF_TITLE_LANG_DEFAULT;

    const title = this.pickTitle(data.alternativeTitle, titleLang) || data.title;
    const alternateTitles: string[] = Object.values(data.alternativeTitle ?? {})
      .filter(Boolean)
      .filter((t) => t !== title);

    let description = data.synopsys?.replaceAll("\n", "<br>") || "";
    if (data.type) {
      description += `<br>Type: ${data.type}`;
    }

    if (data.animeSeason?.season) {
      description += `<br>Season: ${data.animeSeason.season}`;
    }

    if (data.animeSeason?.year) {
      description += `<br>Year: ${data.animeSeason.year}`;
    }

    return {
      title,
      url: query,
      coverImageUrl:
        poster.large ??
        poster.medium ??
        poster.small ??
        (poster.original?.includes("X-Amz-") ? null : poster.original) ??
        null,
      isNsfw: null,
      status: "unknown",
      genres: data.genres ?? [],
      alternateTitles,
      description,
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    const id = new URLSearchParams(query).get("id");
    if (!id) {
      throw new Error("ID not found in the URL");
    }

    const url = new URL(`anime/${id}/episode`, this.API_URL);

    const { data } = await this.client.get<EpisodeListResponse>(url.toString(), {
      headers: this.apiHeaders(),
    });

    const episodes: Episode[] = data.data.map((episode) => {
      let title = episode.number ? `Episode ${episode.number}` : "Episode";

      if (episode.title && episode.title !== title) {
        title += `: ${episode.title}`;
      }

      return {
        episodeNumber: this.toNumberOrNull(episode.number, true),
        title,
        url: `/watch/${episode.uid}?origin=${episode.origin}`,
      };
    });

    return episodes;
  };

  override getVideos: GetVideos = async (query) => {
    const watchUrl = new URL(query, this.baseUrl);
    const url = new URL(`ep/${watchUrl.pathname.split("/").filter(Boolean)[1]}`, this.API_URL);
    url.searchParams.set("origin", watchUrl.searchParams.get("origin") ?? "");

    const { data: result } = await this.client.get<EpisodeDataResponse>(url.toString(), {
      headers: this.apiHeaders(),
    });
    if (!result.data?.episode?.streamLink) return [];

    const playlistUrl = new URL("m3u8", this.STREAM_URL);
    playlistUrl.searchParams.set("url", result.data.episode.streamLink);

    const subtitleTracks: SubtitleTrack[] = (result.data.episode.subData ?? [])
      .toSorted((a, b) => a.label?.localeCompare(b.label))
      .map((s) => ({
        kind: "subtitles",
        label: s.label,
        url: s.src.startsWith("http") ? s.src : `${this.API_URL}/stream/file/${s.src}`,
        lang: this.labelToLang(s.label) || s.label,
      }));

    return [
      {
        url: playlistUrl.toString(),
        label: "AnimeParadise",
        subtitleTracks,
        headers: {
          Origin: this.baseUrl,
          Referer: `${this.baseUrl}/`,
        },
        type: "application/vnd.apple.mpegurl",
      },
    ];
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [SortFilter, GenreFilter],
    header: "Note: Genre filter is ignored if search query is present",
  });

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_TITLE_LANG_KEY,
      label: "Preferred title language",
      options: this.PREF_TITLE_LANG_OPTIONS,
      type: "select",
      defaultValue: this.PREF_TITLE_LANG_DEFAULT,
      description: "Fall back to Romaji when selected language is not available",
    },
  ];

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "finished":
        return "completed";
      case "current":
        return "ongoing";
      case "upcoming":
        return "upcoming";
      default:
        return "unknown";
    }
  };

  private apiHeaders(): AxiosHeaders {
    const headers = super.headersBuilders();
    headers.set("Accept", "application/json, text/plain, */*");
    headers.set("Host", new URL(this.API_URL).host);
    headers.set("Origin", this.baseUrl);
    return headers;
  }

  private pickTitle(titles: AnimeObject["alternativeTitle"], titleLang: string): string | null {
    if (!titles) return null;

    switch (titleLang) {
      case "english":
        return titles?.english;
      case "native":
        return titles?.native;
      default:
        return null;
    }
  }

  private readonly PREF_TITLE_LANG_KEY = "pref_title_lang";
  private readonly PREF_TITLE_LANG_DEFAULT = "romaji";
  private PREF_TITLE_LANG_OPTIONS = [
    { label: "Romaji", value: "romaji" },
    { label: "English", value: "english" },
    { label: "Native", value: "native" },
  ];
}
