import {
  resolveFilterEntries,
  type Anime,
  type AuxiliaryTrack,
  type Episode,
  type ExtensionClientConstructorOptions,
  type GetEpisodes,
  type GetFilterConfig,
  type GetImage,
  type GetLatestSeries,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type GetSettingsFilters,
  type GetVideos,
  type Preferences,
  type SearchSeries,
  type SubtitleTrack,
  type Video,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";
import type { AxiosHeaders } from "axios";

import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import { SortFilter, GenresFilter, StudiosFilter, YearsFilter } from "./filters";
import manifest from "./manifest.json";
import { parallelCatchingFlatMap } from "@/utils/map";
import type { Hoster, Source, Track } from "./types";
import { StringUtils } from "@/utils/string";

export class HentaiMama extends BaseAnimeScraper {
  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();
  }

  protected override headersBuilders(): AxiosHeaders {
    const headers = super.headersBuilders();
    headers.set("Cookie", "dt_series_layout=bare");
    return headers;
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};
    const url = new URL(this.baseUrl);
    if (page === 1) url.pathname = "/hentai-series/";
    else url.pathname = `/hentai-series/page/${page}/`;
    url.searchParams.set("filter", "weekly");

    const { data: html } = await this.client.get(url.toString(), {
      headers: this.headersBuilders(),
    });
    const items = this.parseAnimeFromListing(html, this.popularSeriesSelector);
    const $ = cheerio.load(html);

    const hasMore = $(this.popularSeriesNextPageSelector).length > 0;

    return {
      data: items,
      hasMore,
    };
  };

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};
    const url = new URL(`tvshows/page/${page}`, this.baseUrl);

    const { data: html } = await this.client.get(url.toString(), {
      headers: this.headersBuilders(),
    });

    const items = this.parseAnimeFromListing(html, this.latestSeriesSelector);

    const $ = cheerio.load(html);
    const hasMore = $(this.latestSeriesNextPageSelector).length > 0;

    return {
      data: items,
      hasMore,
    };
  };

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { page = 1, filters } = options ?? {};
    let url: URL;

    if (query?.trim()) {
      url = new URL(`page/${page}`, this.baseUrl);
      url.searchParams.set("s", query.trim().replace(/[\W]/, " "));
    } else {
      url = new URL(`advance-search/page/${page}`, this.baseUrl);
      url.searchParams.set("submit", "Submit");

      for (const { filter, value, type } of resolveFilterEntries(
        filters,
        this.getFilterConfig().filters,
      )) {
        switch (type) {
          case "select":
            url.searchParams.set(filter.key, value);
            break;

          case "multi-select":
            if (Array.isArray(value) && value.length > 0) {
              value.forEach((v) => {
                url.searchParams.append(filter.key, v);
              });
            }
            break;

          default:
            break;
        }
      }
    }

    const { data: html } = await this.client.get(url.toString(), {
      headers: this.headersBuilders(),
    });

    const $ = cheerio.load(html);

    const items = this.parseAnimeFromListing(html, this.searchSeriesSelector);

    const hasMore = $(this.searchSeriesNextPageSelector).length > 0;

    return {
      data: items,
      hasMore,
    };
  };

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data: html } = await this.client.get(url.toString());

    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    const title = $("h1.dsc-title").first().text().trim();
    const alternateTitles = $("div.dsc-alt").first().text().trim().split(",").filter(Boolean);

    const genres = $('div.dsc-genres a[rel="tag"]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const studios = $('div.dsc-stats > div.dsc-stat a[href*="/studio/"]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const rating = this.toNumberOrNull(
      $('span.dt_rating_vgs[itemprop="ratingValue"]').text(),
      true,
    );
    const coverImageUrl = $("div.dsc-poster img").first().attr("src") || null;

    const statusText = $("div.dsc-body > div.dsc-chips > span.dsc-chip").eq(0).text().trim();
    const status = this.getSeriesStatus(statusText);

    let description = $("div.dsc-desc p").text().trim();

    const views = $('div.dsc-stat span:contains("Views")').next("b").text().trim();
    if (views) description += `<br><br>Views: ${views}`;
    const aired = $('div.dsc-stat span:contains("Aired")').next("b").text().trim();
    if (aired) description += `<br>Aired: ${aired}`;

    return {
      title,
      isNsfw: true,
      url: query,
      genres,
      rating,
      coverImageUrl,
      status,
      alternateTitles,
      studios,
      description,
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    const url = new URL(query, this.baseUrl);
    const response = await this.client.get(url.toString());
    const $ = cheerio.load(response.data);

    const episodes: Episode[] = [];

    $("div#episodes a.dt-se-item").each((_, el) => {
      const $el = $(el);
      const urlFromElement = $el.attr("href");
      if (!urlFromElement) return;

      const title = $el.find("span.dt-se-toprow > .dt-se-title").first().text().trim();
      const episodeNumber = this.toNumberOrNull(title.match(this.EPISODE_NUMBER_REGEX)?.[1], true);
      const url = this.setUrlWithoutDomain(urlFromElement);

      const lastUpdatedText = $el.find("span.dt-se-date").first().text().trim();

      episodes.push({
        title,
        url,
        episodeNumber,
        lastUpdated: this.parseSeriesDate(lastUpdatedText),
      });
    });

    return episodes;
  };

  override getFilterConfig: GetFilterConfig = () => {
    return {
      header: "Ignored if using text search.",
      filters: [SortFilter, GenresFilter, StudiosFilter, YearsFilter],
    };
  };

  override getVideos: GetVideos = async (episodeUrl) => {
    const url = new URL(episodeUrl, this.baseUrl).toString();
    const hosters = await this.getHosterList(url);
    const ajaxUrl = `${this.baseUrl}/wp-admin/admin-ajax.php`;
    const quality = await this.$preferences.getString(
      this.PREF_VIDEO_QUALITY_KEY,
      this.PREF_VIDEO_QUALITY_DEFAULT,
    );

    return parallelCatchingFlatMap(hosters, async ({ hosterName, internalData }) => {
      const [postId, optionNumber] = internalData.split("||");
      const optionIndex = this.toNumberOrNull(optionNumber);

      if (optionIndex == null) return [];

      const formBody = new URLSearchParams({
        action: "get_player_contents",
        a: postId!,
        i: optionNumber!,
      });

      const iframeResponse = await this.client.post<string>(ajaxUrl, formBody, {
        headers: {
          Referer: url,
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
        },
        responseType: "text",
      });

      const rawIframeList: string[] = JSON.parse(
        iframeResponse.data
          .trim()
          .replace(/&quot;/g, '"')
          .replace(/,\s*$/, "")
          .replace(/\\n|\r/g, ""),
      );

      const fragment = rawIframeList[optionIndex - 1];
      if (!fragment) return [];

      const iframeSrc = cheerio
        .load(fragment, { baseURI: this.baseUrl })("iframe[src]")
        .prop("src");

      if (!iframeSrc) return [];

      const { data: playerHtml } = await this.client.get<string>(iframeSrc);
      const sourcesJson = this.SOURCES_REGEX.exec(playerHtml)?.[1];

      if (!sourcesJson) return [];

      const sources: Source[] = JSON.parse(sourcesJson);
      if (!sources.length) return [];

      const subtitleTracks: SubtitleTrack[] = [];
      const auxiliaryTracks: AuxiliaryTrack[] = [];

      const tracksRaw = playerHtml.match(this.TRACKS_REGEX)?.[1];
      if (tracksRaw) {
        try {
          const jsonTracks = tracksRaw.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
          const tracks = JSON.parse(jsonTracks) as Track[];

          const thumbnail = tracks.find((track) => track.kind === "thumbnails")?.file;
          if (thumbnail) {
            auxiliaryTracks.push({
              kind: "metadata",
              label: "Thumbnail",
              url: thumbnail.replaceAll("\\/", "/"),
            });
          }

          tracks
            .filter((track) => track.kind === "subtitles" || track.kind === "captions")
            .forEach((sub, index) => {
              subtitleTracks.push({
                kind: "subtitles",
                label: `Subtitle ${index + 1}`,
                url: sub.file.replaceAll("\\/", "/"),
                lang: "und",
              });
            });
        } catch {}
      }

      const videos: Video[] = [];

      for (const source of sources) {
        const file = source.file.replaceAll("\\/", "/");
        const isHls = source.type === "hls" || file.endsWith(".m3u8") || file.includes(".m3u8");
        const isMp4 = source.type === "mp4" || file.endsWith(".mp4") || file.includes(".mp4");

        if (!isHls && !isMp4) continue;

        const label = `${isMp4 ? "[MP4]" : "[HLS]"} ${
          source.label ? `${hosterName} - ${source.label}` : hosterName
        }`;

        videos.push({
          url: file,
          type: isHls ? "application/vnd.apple.mpegurl" : "video/mp4",
          label,
          tracks: auxiliaryTracks,
          subtitleTracks,
        });
      }

      // Move preferred quality to the front
      if (quality) {
        videos.sort(
          (a, b) => Number(b.label.includes(quality)) - Number(a.label.includes(quality)),
        );
      }

      return videos;
    });
  };

  private async getHosterList(url: string): Promise<Hoster[]> {
    const { data: html } = await this.client.get(url);
    const $ = cheerio.load(html);
    const postId = $('#post_report input[name="idpost"]').attr("value");
    if (!postId) throw new Error("Post ID not found");

    const hosters: Hoster[] = [];

    $(".dt-mi-tabs a").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href");
      if (!href) return;
      const optionNumber = StringUtils.removePrefix(href, "#option-");
      const serverId = $el.text().trim();
      hosters.push({
        hosterName: serverId,
        internalData: `${postId}||${optionNumber}||${serverId}`,
      });
    });

    return hosters;
  }

  override getSeriesStatus: GetSeriesStatus = (status) => {
    switch (status?.toLowerCase()) {
      case "ongoing":
      case "airing":
        return "ongoing";
      case "completed":
        return "completed";
      default:
        return "unknown";
    }
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_VIDEO_QUALITY_KEY,
      label: "Preferred quality",
      options: this.PREF_VIDEO_QUALITY_OPTIONS,
      type: "select",
      defaultValue: this.PREF_VIDEO_QUALITY_DEFAULT,
    },
  ];

  override getImage: GetImage = async (url) => {
    const { data, headers } = await this.client.get(url, {
      headers: this.headersBuilders(),
      responseType: "arraybuffer",
    });

    const contentType = (headers["Content-Type"] as string) || "image/jpeg";
    return {
      data,
      contentType,
    };
  };

  private parseAnimeFromListing(html: string, selector: string): Anime[] {
    const $ = cheerio.load(html, { baseURI: this.baseUrl });
    const items: Anime[] = [];

    $(selector).each((_, el) => {
      const $el = $(el);

      const $anchor = $el.find("div.data h3 > a").first();
      const urlFromElement = $anchor.attr("href");
      if (!urlFromElement) return;

      const title = $anchor.text();
      const coverImageUrl = $el.find("div.poster img").first().attr("src") || null;

      items.push({
        title,
        isNsfw: true,
        coverImageUrl,
        status: "unknown",
        url: this.setUrlWithoutDomain(urlFromElement),
      });
    });

    return items;
  }

  protected popularSeriesSelector = "article.tvshows";
  protected searchSeriesSelector = this.popularSeriesSelector;
  protected latestSeriesSelector = this.popularSeriesSelector;

  private popularSeriesNextPageSelector = 'div.pagination a.dt-pg-next:not([aria-disabled="true"])';
  private latestSeriesNextPageSelector = this.popularSeriesNextPageSelector;
  private searchSeriesNextPageSelector = this.popularSeriesNextPageSelector;

  private PREF_VIDEO_QUALITY_KEY = "pref_video_quality";
  private PREF_VIDEO_QUALITY_OPTIONS = ["1080p", "720p", "480p"].map((item) => ({
    label: item,
    value: item,
  }));
  private PREF_VIDEO_QUALITY_DEFAULT = this.PREF_VIDEO_QUALITY_OPTIONS[0]!.value;

  private SOURCES_REGEX = /sources:\s*(\[[\s\S]*?\])/;
  private TRACKS_REGEX = /tracks:\s*(\[[\s\S]*?\])/;
  private EPISODE_NUMBER_REGEX = /Episode (\d+\.?\d*)/;
}
