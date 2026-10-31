import type {
  Anime,
  Episode,
  ExtensionClientConstructorOptions,
  GetEpisodes,
  GetImage,
  GetLatestSeries,
  GetPopularSeries,
  GetSeries,
  GetSeriesStatus,
  GetSettingsFilters,
  GetVideos,
  SearchSeries,
  Video,
  Preferences,
} from "@tsukimichi/common";
import {
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import * as cheerio from "cheerio";
import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import type { EpisodeResponse, LatestAnimeResponse, SearchAnimeResponse } from "./anime-pahe-dto";
import { KwikExtractor } from "./kwik-extractor";
import manifest from "./manifest.json";
import { app, BrowserWindow, session, type Cookie } from "electron";
import { getCookiesForExtension } from "@/lib/cookies";
import { HttpError } from "@/errors/http-error";
// import { DdosGuardInterceptor } from "./ddos-guard-interceptor";
import { ErrorNormalizer } from "@/lib/network/interceptors/error-normalizer";

export class AnimePahe extends BaseAnimeScraper {
  private readonly sessionIdRegex = /\/anime\/([\w-]+)/;

  private readonly kwikExtractor: KwikExtractor;

  private baseUrlPromise: Promise<string>;

  private $preferences: Preferences;

  private extractorClient: AxiosInstance;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.extractorClient = this.network.newBuilder().addInterceptor(new ErrorNormalizer()).build();

    this.kwikExtractor = new KwikExtractor(this.extractorClient);

    this.$preferences = options.$context!.createPreferences!();

    this.baseUrlPromise = this.getPreferredDomain();
  }

  private async getBaseUrl() {
    return this.baseUrlPromise;
  }

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { page = 1 } = options ?? {};

    this.baseUrl = await this.getBaseUrl();

    const url = new URL(this.baseUrl);
    url.searchParams.set("m", "search");
    url.searchParams.set("page", page.toString());

    if (query?.trim()) {
      url.pathname = "/api";

      const timeSuffix = Date.now() / 1000 + page * 3;

      url.searchParams.set("q", `${query.trim()} ${timeSuffix}`);
      const { data: response } = await this.client.get<SearchAnimeResponse>(url.toString(), {
        headers: {
          "User-Agent": null,
          Referer: `${this.baseUrl}/`,
          Accept: null,
          "Accept-Encoding": null,
        },
      });

      if (!response.data) {
        return this.emptyListResponse();
      }

      const data: Anime[] = [];

      response.data.forEach((anime) => {
        data.push({
          title: anime.title,
          coverImageUrl: anime.poster,
          url: `/a/${anime.id}`,
          status: "unknown",
          isNsfw: null,
        });
      });

      const hasMore = response.current_page < response.last_page;

      return {
        data,
        hasMore,
      };
    }

    return this.emptyListResponse();
  };

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { page = 1 } = options ?? {};

    this.baseUrl = await this.getBaseUrl();

    if (page > 1) await this.delay(3000);

    const url = new URL("api", this.baseUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("m", "airing");

    const result = await this.resolveWithBrowserWindow(
      url.toString(),
      `
      (() => {
        const pre = document.querySelector("pre")?.textContent;
        if(!pre) return false;
        return pre.includes("data") && pre.includes("last_page");
      })()
    `,
    );

    const $ = cheerio.load(result);
    const resultElement = $("pre").first();

    const response = JSON.parse(resultElement.text()) as LatestAnimeResponse;

    const data: Anime[] = [];

    response.data.forEach((anime) => {
      data.push({
        title: anime.anime_title,
        coverImageUrl: anime.snapshot,
        url: `/a/${anime.anime_id}`,
        status: this.getSeriesStatus(anime.completed.toString()),
        isNsfw: null,
      });
    });

    const hasMore = response.current_page < response.last_page;

    return {
      data,
      hasMore,
    };
  };

  // AnimePahe doesn't have a popular series page,
  // so for popular series we will use the latest series page instead.
  override getLatestSeries: GetLatestSeries<Anime> = () => {
    throw new Error("Method not supported.");
  };

  override getSeries: GetSeries<Anime> = async (query) => {
    const animeId = this.getId(query);

    this.baseUrl = await this.getBaseUrl();

    const url = new URL(this.baseUrl);
    url.pathname = animeId ? `/a/${animeId}` : query;

    const response = await this.client.get<string>(url.toString());

    const html = response.data;
    const $ = cheerio.load(html);

    const title = $("div.title-wrapper h1:first-of-type > span").text().trim();
    const coverImageUrl = $("div.anime-poster a").first().attr("href") || null;
    const statusText = $("div.col-sm-4.anime-info p:contains(Status:) a").text().trim();
    const alternateTitles = $("div.anime-info p:contains(Synonyms:)")
      .text()
      .replace(/^Synonyms:\s*/i, "")
      .split(",")
      .map((title) => title.trim())
      .filter(Boolean);

    const studios = $("div.col-sm-4.anime-info p:contains(Studios:)")
      .text()
      .replace("Studios:", "")
      .split(",")
      .map((studio) => studio.trim())
      .filter(Boolean);

    const genres: string[] = $(
      "div.anime-genre ul li, div.col-sm-4.anime-info p:contains(Demographic:) a, div.col-sm-4.anime-info p:contains(Theme:) a",
    )
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    let description = $("div.anime-summary div.anime-synopsis").text().trim();

    const season = $("div.col-sm-4.anime-info p:contains(Season:) a").text().trim();

    if (season) {
      description += `<br/><br/>Season: ${season}`;
    }

    const externalLinks = $("div.col-sm-4.anime-info p:contains(External Links:) a")
      .get()
      .map((el) => {
        const $el = $(el);

        return `[${$el.text().trim()}](${$el.attr("href")})`;
      });

    if (externalLinks.length > 0) {
      description += `<br/><br/>*External Links:*<br/>${externalLinks.join(",<br/>")}<br/>`;
    }

    return {
      id: animeId ? animeId : this.slugify(query),
      extensionId: this.extensionMetadata.id,
      source: this.name,
      title,
      coverImageUrl,
      url: query,
      status: this.getSeriesStatus(statusText),
      description,
      alternateTitles,
      isNsfw: null,
      studios,
      genres,
    };
  };

  override getEpisodes: GetEpisodes = async (query) => {
    const animeId = this.getId(query);

    this.baseUrl = await this.getBaseUrl();

    const animeUrl = new URL(query, this.baseUrl);

    let sessionId: string | null = null;
    if (animeId) {
      sessionId = await this.fetchSession(animeId);
    } else {
      sessionId = this.sessionIdRegex.exec(animeUrl.pathname)?.[1] ?? null;
    }

    if (!sessionId) {
      throw new Error(`Anime session not found in the URL: ${query}`);
    }

    const episodes: Episode[] = [];
    let currentPage = 1;
    let hasMore = true;

    while (hasMore) {
      const apiUrl = new URL("api", this.baseUrl);
      apiUrl.searchParams.set("m", "release");
      apiUrl.searchParams.set("id", sessionId);
      apiUrl.searchParams.set("sort", "episode_asc");
      apiUrl.searchParams.set("page", currentPage.toString());

      const { data: response } = await this.client.get<EpisodeResponse>(apiUrl.toString());

      response.data.forEach((episode) => {
        episodes.push({
          title: `Episode ${episode.episode}`,
          url: `/play/${sessionId}/${episode.session}`,
          isFiller: episode.filler === 1,
        });
      });

      hasMore = response.current_page < response.last_page;
      currentPage += 1;
    }

    return this.addEpisodeNavigation(
      episodes.map((ep, i) => ({
        ...ep,
        title: `Episode ${i + 1}`,
        episodeNumber: i + 1,
      })),
    );
  };

  override getVideos: GetVideos = async (episodeUrl) => {
    this.baseUrl = await this.getBaseUrl();

    const url = new URL(episodeUrl, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const downloadLinks = $("div#pickDownload > a")
      .toArray()
      .map((el) => el.attribs.href)
      .filter((link) => link !== undefined);

    const videos = await Promise.all(
      $("div#resolutionMenu > button")
        .get()
        .map(async (el, index) => {
          const kwikLink = $(el).attr("data-src");
          if (!kwikLink) return null;
          const qualityText = $(el).text().trim();
          let label = "";
          if (qualityText.toLowerCase().includes("eng")) {
            label = qualityText.replace("eng", "(dub)");
          } else {
            label = qualityText;
          }
          const paheLink = downloadLinks[index];
          let videoUrl: string;

          let videoContentType: string;

          if (await this.useHlsLinks()) {
            videoUrl = await this.kwikExtractor
              .getHlsStreamVideo(kwikLink, `${this.baseUrl}/`)
              .then((v) => v.url);
            videoContentType = "application/x-mpegURL";
          } else {
            try {
              if (!paheLink) return null;
              videoUrl = await this.kwikExtractor.getStreamUrlFromKwik(paheLink);
              videoContentType = "video/mp4";
            } catch (error) {
              console.error("Failed to get MP4 link", error);
              return null;
            }
          }

          const video: Video = {
            url: videoUrl,
            label,
            type: videoContentType,
            headers: {
              referer: "https://kwik.cx/",
            },
          };

          return video;
        }),
    ).then((v) => v.filter((v) => v !== null));

    return videos;
  };

  protected getImageHeaders(options?: HeadersInit): AxiosHeaders {
    const headers = this.headersBuilders();
    headers.set(
      "Accept",
      "image/avif,image/jxl,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5",
    );
    headers.set("Accept-Language", "en-US,en;q=0.9");
    headers.set("Accept-Encoding", "gzip, deflate, br");
    headers.set("Sec-GPC", "1");
    headers.set("Connection", "keep-alive");
    headers.set("Sec-Fetch-Dest", "image");
    headers.set("Sec-Fetch-Mode", "no-cors");
    headers.set("Sec-Fetch-Site", "cross-site");
    if (!headers.get("Referer")) {
      headers.set("Referer", `${this.baseUrl}/`);
    }

    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    );

    if (options) {
      const extra = new Headers(options);
      extra.forEach((value, key) => {
        headers.set(key, value);
      });
    }

    return headers;
  }

  override getImage: GetImage = async (url) => {
    this.baseUrl = await this.getBaseUrl();

    const ses = session.fromPartition(`persist:${this.extensionMetadata.id}`);
    // const cookies = await getCookiesForExtension(this.extensionMetadata.id);
    // const cookie = cookies
    //   .map((c) => {
    //     if (c.name.startsWith("cf_")) {
    //       console.log(c.name, c.value.slice(0, 100));
    //     }
    //     return `${c.name}=${c.value}`;
    //   })
    //   .join("; ");

    // const headers = this.getImageHeaders();
    // headers.set("User-Agent", app.userAgentFallback);
    // headers.set("Referer", `${this.baseUrl}/`);
    // if (cookie) {
    //   headers.set("Cookie", cookie);
    // }

    const response = await ses.fetch(url, {
      headers: {
        referer: `${this.baseUrl}/`,
      },
      credentials: "include",
    });

    const data = await response.arrayBuffer();
    const contentType = response.headers.get("Content-Type") as string | undefined;

    // const { data, headers: responseHeaders } = await this.client.get<ArrayBuffer>(url, {
    //   headers,
    //   responseType: "arraybuffer",
    // });

    return {
      data,
      contentType: contentType || "image/jpeg",
    };
  };

  private async getSessionCookie(): Promise<Cookie | null> {
    const COOKIE_NAME = "cf_clearance";
    const partitionCookies = await getCookiesForExtension(this.extensionMetadata.id, {
      name: COOKIE_NAME,
    });
    const mirrorDomains = this.DOMAIN_LIST.map((d) => new URL(d).hostname);

    const sessionCookie = partitionCookies.find((c) => {
      const domainMatch =
        mirrorDomains.some(
          (mirrorDomain) =>
            c.domain === mirrorDomain ||
            c.domain === `.${mirrorDomain}` ||
            (c.domain?.startsWith(".") && mirrorDomain.endsWith(c.domain.slice(1))),
        ) || c.name === COOKIE_NAME;
      const notExpired =
        !c.expirationDate || new Date(c.expirationDate * 1000).getTime() > Date.now();
      return domainMatch && notExpired;
    });

    if (sessionCookie) return sessionCookie;

    return null;
  }

  override getSeriesStatus: GetSeriesStatus = (text) => {
    switch (text?.trim().toLowerCase()) {
      case "finished airing":
        return "completed";
      case "currently airing":
        return "ongoing";
      default:
        return "unknown";
    }
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_DOMAIN_KEY,
      type: "select",
      label: "Preferred domain",
      description: "It's recommended to restart the app after changing this setting.",
      options: this.DOMAIN_LIST.map((d) => ({
        label: new URL(d).hostname,
        value: d,
      })),
      defaultValue: this.DEFAULT_DOMAIN,
    },
    {
      key: this.PREF_LINK_TYPE_KEY,
      type: "toggle",
      defaultValue: this.PREF_LINK_TYPE_DEFAULT,
      label: "Use HLS links",
      description: "Enable this if you are having issues with non-HLS links.",
    },
  ];

  protected override headersBuilders(): AxiosHeaders {
    const headers = new AxiosHeaders();
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    return headers;
  }

  /**
   * Helper function to execute API requests and automatically handle 429 rate limits.
   * Waits 12 seconds and retries once if a 429 occurs.
   */
  private async safeApiCall<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    try {
      const response = this.client.request(config);
      return response;
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        await this.delay(12000);

        return this.safeApiCall(config);
      }

      throw err;
    }
  }

  private async fetchSession(animeId: string): Promise<string> {
    const url = new URL(`a/${animeId}`, this.baseUrl);

    const response = await this.client.get(url.toString());
    const finalUrl = response.request.res.responseUrl;
    const sessionId = finalUrl.split("/").pop();

    if (!sessionId) {
      throw new Error("Session ID not found");
    }

    return sessionId;
  }

  private getId(text: string): string | null {
    return this.newAnimeIdRegex.exec(text)?.[1] ?? this.oldAnimeIdRegex.exec(text)?.[1] ?? null;
  }

  private resolveWithBrowserWindow(pageUrl: string, script: string): Promise<string> {
    console.log("Resolving with browser window", script);
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: NodeJS.Timeout | null = null;
      let evaluateIntervalId: NodeJS.Timeout | null = null;

      const MAX_TIMEOUT = 30_000;
      const EVALUATE_INTERVAL_MS = 500;

      const win = new BrowserWindow({
        height: 800,
        width: 600,
        show: false,
        webPreferences: {
          javascript: true,
          nodeIntegration: false,
          contextIsolation: true,
          partition: `persist:${this.extensionMetadata.id}`,
        },
      });

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (evaluateIntervalId) {
          clearInterval(evaluateIntervalId);
          evaluateIntervalId = null;
        }

        if (!win.isDestroyed()) {
          win.destroy();
        }
      };

      const success = (html: string) => {
        if (settled) return;

        settled = true;
        cleanup();
        resolve(html);
      };

      const error = (err: Error) => {
        if (settled) return;

        settled = true;
        cleanup();
        reject(err);
      };

      const matchesPageUrl = () => {
        try {
          const expected = new URL(pageUrl);
          const current = new URL(win.webContents.getURL());

          return current.origin === expected.origin && current.pathname === expected.pathname;
        } catch {
          return false;
        }
      };

      const evaluate = async () => {
        if (settled || win.isDestroyed()) {
          return;
        }

        try {
          // Cloudflare/interstitial/redirect page.
          if (!matchesPageUrl()) {
            return;
          }

          const ready = await win.webContents.executeJavaScript(`Boolean(${script})`, true);

          if (!ready) {
            return;
          }

          // Check once more immediately before extracting HTML.
          if (!matchesPageUrl()) {
            return;
          }

          const html = await win.webContents.executeJavaScript(
            `document.documentElement.outerHTML`,
            true,
          );

          success(html);
        } catch (err) {
          error(Error.isError(err) ? err : new Error(String(err)));
        }
      };

      timeoutId = setTimeout(() => {
        error(
          new Error(
            `Timeout waiting for page: ${pageUrl}. ` +
              `Current URL: ${win.isDestroyed() ? "destroyed" : win.webContents.getURL()}`,
          ),
        );
      }, MAX_TIMEOUT);

      win.webContents.on("console-message", ({ level, message }) => {
        if (level === "error") {
          console.error("Console message:", message);
        }
      });

      win.webContents.once("did-finish-load", () => {
        void evaluate();

        evaluateIntervalId = setInterval(() => void evaluate(), EVALUATE_INTERVAL_MS);
      });

      win.loadURL(pageUrl).catch(error);
    });
  }

  sendRequest(url: string, options?: AxiosRequestConfig) {
    return this.client.request({
      url,
      ...options,
    });
  }

  private readonly newAnimeIdRegex = /\/a\/(\d+)/;
  private readonly oldAnimeIdRegex = /\?anime_id=(\d+)/;

  private readonly DOMAIN_LIST = [
    "https://animepahe.pw",
    "https://animepahe.com",
    "https://animepahe.org",
  ];

  private readonly PREF_DOMAIN_KEY = "preferred-domain";
  private readonly DEFAULT_DOMAIN = this.DOMAIN_LIST[0]!;

  private readonly PREF_LINK_TYPE_KEY = "preferred-link-type";
  private readonly PREF_LINK_TYPE_DEFAULT = true;

  private async useHlsLinks(): Promise<boolean> {
    return (
      (await this.$preferences.getBoolean(this.PREF_LINK_TYPE_KEY, this.PREF_LINK_TYPE_DEFAULT)) ??
      this.PREF_LINK_TYPE_DEFAULT
    );
  }

  private async getPreferredDomain(): Promise<string> {
    const preferredDomain = await this.$preferences.getString(
      this.PREF_DOMAIN_KEY,
      this.DEFAULT_DOMAIN,
    );
    if (preferredDomain && this.DOMAIN_LIST.includes(preferredDomain)) {
      return preferredDomain;
    }

    return this.DEFAULT_DOMAIN;
  }
}

// const client = new AnimePahe();

// client.searchSeries("solo leveling").then(console.log);
