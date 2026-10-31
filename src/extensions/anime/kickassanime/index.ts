import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
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
} from "@tsukimichi/common";
import manifest from "./manifest.json";
import type {
  AnimeDetailsResponse,
  EpisodeResponse,
  LanguagesResponse,
  PopularResponse,
  RecentResponse,
  SearchResponse,
  VideoServerResponse,
} from "./types";
import { GenresFilter, StatusFilter, TypeFilter, YearFilter } from "./filters";
import type { AxiosResponse } from "axios";
import { KickAssAnimeExtractor } from "./extractors/kickassanime-extractor";
import { parallelCatchingFlatMap } from "@/utils/map";

export class KickAssAnime extends BaseAnimeScraper {
  private apiUrl: string;
  private kickAssAnimeExtractor: KickAssAnimeExtractor;

  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();
    this.apiUrl = `${this.baseUrl}/api/show`;

    this.kickAssAnimeExtractor = new KickAssAnimeExtractor(this.client);
  }

  override async init(): Promise<void> {
    await super.init();
    const pref = await this.$preferences.getString(this.PREF_DOMAIN_KEY, this.PREF_DEFAULT_DOMAIN);

    if (this.DOMAINS.includes(pref)) {
      this.baseUrl = pref;
    }
    this.apiUrl = `${this.baseUrl}/api/show`;
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL(`${this.apiUrl}/trending`);
    url.searchParams.set("page", page.toString());

    const { data } = await this.client.get<PopularResponse>(url.toString());

    const hasMore = data.page_count > page;
    return {
      data: this.popularAnimeParse(
        data.result,
        await this.$preferences.getBoolean(this.PREF_USE_ENGLISH_TITLE_KEY, true),
      ),
      hasMore,
    };
  };

  private popularAnimeParse(results: PopularResponse["result"], useEnglish = true): Anime[] {
    return results.map((item) => ({
      title: useEnglish && item.title_en ? item.title_en : item.title,
      url: item.slug,
      isNsfw: null,
      status: "unknown",
      coverImageUrl: `${this.baseUrl}/image/poster/${item.poster.hq}.webp`,
    }));
  }

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL(`${this.apiUrl}/recent`);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("type", "all");

    const { data } = await this.client.get<RecentResponse>(url.toString());

    const hasMore = data.hadNext ?? false;
    return {
      data: this.popularAnimeParse(
        data.result,
        await this.$preferences.getBoolean(this.PREF_USE_ENGLISH_TITLE_KEY, true),
      ),
      hasMore,
    };
  };

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const page = options?.page ?? 1;
    const { data } = await this.searchAnimeRequest<SearchResponse>(query, options);

    const hasMore = data.maxPage > page;
    return {
      data: this.popularAnimeParse(
        data.result,
        await this.$preferences.getBoolean(this.PREF_USE_ENGLISH_TITLE_KEY, true),
      ),
      hasMore,
    };
  };

  private searchAnimeRequest<T>(
    query?: string,
    options?: Record<string, any>,
  ): Promise<AxiosResponse<T>> {
    const { page = 1, filters } = options ?? {};

    const headers = this.headersBuilders();
    headers.set("Accept", "application/json, text/plain, */*;");
    headers.set("Content-Type", "application/json;");
    headers.set("Host", new URL(this.SEARCH_BASE_URL).hostname);
    headers.set("Referer", `${this.SEARCH_BASE_URL}/search?q=${query || ""}`);

    const filtersObj: Record<string, any> = {};

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          if (filter.key === YearFilter.key) {
            const num = this.toNumberOrNull(value);
            if (num !== null) filtersObj[filter.key] = num;
          } else {
            filtersObj[filter.key] = value;
          }
          break;
        case "multi-select":
          if (Array.isArray(value) && value.length > 0) {
            filtersObj[filter.key] = value;
          }
          break;
        default:
          break;
      }
    }

    const strFilter = JSON.stringify(filtersObj);
    const encodedFilter = strFilter === "{}" ? "" : Buffer.from(strFilter).toString("base64");

    if (query?.trim()) {
      const url = new URL("api/fsearch", this.SEARCH_BASE_URL);
      const body: Record<string, any> = {
        query,
        page,
      };
      if (encodedFilter !== "") body.filters = encodedFilter;

      return this.client.post<T>(url.toString(), body, { headers });
    }

    const url = new URL("api/anime", this.SEARCH_BASE_URL);
    url.searchParams.set("page", page.toString());
    if (encodedFilter !== "") url.searchParams.set("filters", encodedFilter);

    return this.client.get<T>(url.toString(), { headers });
  }

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = `${this.apiUrl}/${query}`;

    const { data } = await this.client.get<AnimeDetailsResponse>(url.toString());

    const useEnglish = await this.$preferences.getBoolean(this.PREF_USE_ENGLISH_TITLE_KEY, true);

    const title = useEnglish && data.title_en ? data.title_en : data.title;

    let description = "";
    if (data.synopsis) {
      description += `${data.synopsis}<br><br>`;
    }

    if (data.rating) description += `Rating: ${data.rating}<br>`;

    if (data.type) {
      const found = TypeFilter.options.find((t) => t.value === data.type);
      description += `Type: ${found?.label || data.type.charAt(0).toUpperCase() + data.type.slice(1)}<br>`;
    }

    if (data.season) description += `Season: ${data.season}<br>`;

    if (data.year) description += `Year: ${data.year}`;

    return {
      title,
      isNsfw: null,
      status: this.getSeriesStatus(data.status),
      coverImageUrl: `${this.baseUrl}/image/poster/${data.poster.hq}.webp`,
      url: query,
      genres: data.genres ?? [],
      description,
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    const languages = await this.client
      .get<LanguagesResponse>(`${this.apiUrl}/${query}/language`)
      .then((res) => res.data.result);

    const prefLang = await this.$preferences.getString(
      this.PREF_AUDIO_LANG_KEY,
      this.PREF_AUDIO_LANG_DEFAULT,
    );
    const pref2ndLang = await this.$preferences.getString(
      this.PREF_SECONDARY_AUDIO_LANG_KEY,
      this.PREF_AUDIO_LANG_SECONDARY,
    );

    const langOrder = [...languages].sort(
      (a, b) =>
        Number(b === prefLang) - Number(a === prefLang) ||
        Number(b === pref2ndLang) - Number(a === pref2ndLang),
    );

    const episodes: Episode[] = [];

    for (const lang of langOrder) {
      try {
        const { data: firstPage } = await this.episodesRequest(query, 1, lang);
        if (!firstPage || !Array.isArray(firstPage.result) || !firstPage.result.length) {
          continue;
        }

        const size = firstPage.pages.slice(1).length;

        const otherPages = (
          await Promise.all(
            Array.from({ length: size }, async (_, i) => {
              try {
                const { data } = await this.episodesRequest(query, i + 2, lang);
                return data.result;
              } catch {
                return [];
              }
            }),
          )
        ).flat();

        for (const episode of firstPage.result.concat(otherPages)) {
          let title = `Episode ${episode.episode_string}`;
          if (episode.title?.trim()) title += ` - ${episode.title}`;
          const locale = this.getLocale(lang);
          episodes.push({
            title,
            url: `${query}/ep-${episode.episode_string}-${episode.slug}`,
            scanlator: locale,
            episodeNumber: this.toNumberOrNull(episode.episode_string, true),
          });
        }

        // Already have all episodes, no need to try other lang
        break;
      } catch {
        continue;
      }
    }

    return episodes;
  };

  private episodesRequest(query: string, page: number, lang: string) {
    return this.client.get<EpisodeResponse>(`${this.apiUrl}/${query}/episodes`, {
      params: {
        page,
        lang,
      },
    });
  }

  override getVideos: GetVideos = async (query) => {
    const url = `${this.apiUrl}/${query.replace("/ep-", "/episode/ep-")}`;

    const servers = (await this.client.get<VideoServerResponse>(url)).data.servers;
    return parallelCatchingFlatMap(
      servers.map((s) => this.kickAssAnimeExtractor.videosFromUrl(s.src, s.name)),
      (v) => v,
    );
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [StatusFilter, TypeFilter, YearFilter, GenresFilter],
  });

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_DOMAIN_KEY,
      type: "select",
      label: "Preferred domain",
      options: this.DOMAINS.map((domain) => ({ label: new URL(domain).hostname, value: domain })),
      defaultValue: this.PREF_DEFAULT_DOMAIN,
    },
    {
      key: this.PREF_USE_ENGLISH_TITLE_KEY,
      type: "toggle",
      label: "Use English title",
      defaultValue: true,
    },
    {
      key: this.PREF_AUDIO_LANG_KEY,
      label: "Preferred audio language",
      options: this.LANG_OPTIONS,
      type: "select",
      defaultValue: this.LANG_OPTIONS[0]!.value,
    },
    {
      key: this.PREF_SECONDARY_AUDIO_LANG_KEY,
      label: "Secondary preferred audio language",
      options: this.LANG_OPTIONS,
      type: "select",
      defaultValue: this.LANG_OPTIONS[1]!.value,
    },
  ];

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input) {
      case "finished_airing":
        return "completed";
      case "currently_airing":
        return "ongoing";
      default:
        return "unknown";
    }
  };

  /** Only the primary URL does the search, other domains are redirected to it.*/
  private readonly SEARCH_BASE_URL = "https://kaa.lt";

  // Domains list https://kickassanime.cx
  private DOMAINS = [
    "https://kaa.lt", // Main site. Other domains are redirected to this site, meaning that any search with these domains fail because of non-existent addresses
    "https://kickass-anime.ru",
    "https://kickass-anime.ro",
    "https://kaa.to",
    "https://kaa.rs",
  ];

  private LANG_OPTIONS = [
    { label: "Japanese", value: "ja-JP" },
    { label: "English", value: "en-US" },
    { label: "Spanish", value: "es-ES" },
    { label: "Korean", value: "ko-KR" },
    { label: "Chinese Simplified", value: "zh-CN" },
  ];

  private getLocale(lang: string): string {
    return this.LANG_OPTIONS.find((item) => item.value === lang)?.label || "";
  }

  private readonly PREF_DEFAULT_DOMAIN = this.DOMAINS[0]!;
  private readonly PREF_DOMAIN_KEY = "pref_domain_key";

  private readonly PREF_USE_ENGLISH_TITLE_KEY = "pref_use_english_title_key";
  private readonly PREF_AUDIO_LANG_KEY = "pref_audio_lang_key";
  private readonly PREF_AUDIO_LANG_DEFAULT = "ja-JP";
  private readonly PREF_AUDIO_LANG_SECONDARY = "en-US";

  private readonly PREF_SECONDARY_AUDIO_LANG_KEY = "pref_secondary_audio_lang_key";
}
