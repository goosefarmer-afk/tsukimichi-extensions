import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import {
  resolveFilterEntries,
  type Chapter,
  type ChapterPage,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type Manga,
  type Preferences,
  type SearchSeries,
} from "@tsukimichi/common";
import manifest from "./manifest.json" with { type: "json" };
import { AxiosHeaders, isAxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { DETAILS_QUERY, POPULAR_QUERY, SEARCH_QUERY } from "./queries";
import type { MangaDetails, PageListData, PopularMangaResult, SearchMangaResult } from "./types";
import { CountryFilter, GenresFilter, SortFilter } from "./filters";
import { randomBytes } from "node:crypto";
import { type BrowserWindow, browserWindow } from "electron";
import * as cheerio from "cheerio";
import { HttpError } from "@/errors/http-error";

export class MKissaManga extends BaseMangaScraper {
  private readonly API_URL = "https://api.mkissa.net/api";

  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();
  }

  private async allowAdult() {
    return await this.$preferences.getBoolean(
      this.PREF_ALLOW_ADULT_KEY,
      this.PREF_ALLOW_ADULT_DEFAULT,
    );
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const body = {
      query: POPULAR_QUERY,
      variables: {
        type: "manga",
        size: this.LIMIT,
        page,
        dateRange: 0,
        allowAdult: await this.allowAdult(),
        allowUnknown: false,
      },
    };

    const { data } = await this.makeGQLRequest<PopularMangaResult>(body);

    const mangaList: Manga[] = [];
    for (const card of data.data.queryPopular.recommendations) {
      if (!card.anyCard) continue;
      const params = new URLSearchParams({
        url: card.anyCard._id,
        slug: this.titleToSlug(card.anyCard.name),
      });

      mangaList.push({
        title: card.anyCard.englishName || card.anyCard.name,
        coverImageUrl: card.anyCard.thumbnail
          ? this.parseThumbnailUrl(card.anyCard.thumbnail)
          : null,
        isNsfw: null,
        url: params.toString(),
        status: "unknown",
      });
    }

    const hasMore = data.data.queryPopular.recommendations.length === this.LIMIT;

    return {
      data: mangaList,
      hasMore,
    };
  };

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    return this.fetchSearchManga(query, options);
  };

  private async fetchSearchManga(query = "", options: Parameters<SearchSeries<Manga>>[1]) {
    const { page = 1, filters } = options ?? {};
    const body: Record<string, any> = {
      query: SEARCH_QUERY,
      variables: {
        search: {
          isManga: true,
          allowAdult: await this.allowAdult(),
          allowUnknown: false,
        },
      },
      size: this.LIMIT,
      page,
      translationType: "sub",
    };

    if (query) {
      body.variables.search["query"] = query;
    }

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          body.variables.search = {
            ...body.variables.search,
            [filter.key]: value,
          };
          break;
        case "tri-state-checkbox":
          value.forEach((v) => {
            if (!body.variables.search?.[filter.key]) {
              body.variables.search[filter.key] = [];
            }
            body.variables.search[filter.key].push(v);
          });

          break;
        default:
          break;
      }
    }

    const { data } = await this.makeGQLRequest<SearchMangaResult>(body);

    const mangaList: Manga[] = [];
    for (const item of data.data.mangas.edges) {
      const params = new URLSearchParams({
        url: item._id,
        slug: this.titleToSlug(item.name),
      });
      mangaList.push({
        title: item.englishName || item.name,
        coverImageUrl: item.thumbnail ? this.parseThumbnailUrl(item.thumbnail) : null,
        isNsfw: null,
        url: params.toString(),
        status: "unknown",
      });
    }

    const hasMore = data.data.mangas.edges.length === this.LIMIT;

    return {
      data: mangaList,
      hasMore,
    };
  }

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    return this.fetchSearchManga("", {
      ...options,
      filters: {},
    });
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const result = (await this.fetchMangaDetails(query, "Failed to fetch manga details")).data
      ?.manga;
    if (!result) throw new Error("Manga not found");

    const manga: Manga = {
      title: result.englishName || result.name,
      coverImageUrl: result.thumbnail ? this.parseThumbnailUrl(result.thumbnail) : null,
      isNsfw: null,
      status: this.getSeriesStatus(result.status),
      url: query,
      genres: result.genres?.filter(Boolean) ?? [],
      alternateTitles: result.altNames?.filter(Boolean) ?? [],
      description: result.description ?? null,
    };

    if (result.authors?.length) {
      manga.authors = [result.authors[0]].filter(Boolean) as string[];
      manga.artists = result.authors.slice(1).filter(Boolean) as string[];
    }

    return manga;
  };

  private parseMangaUrl(query: string): [mangaId: string, mangaSlug: string] {
    const params = new URLSearchParams(query);
    const url = params.get("url")!;
    const slug = params.get("slug");
    const legacy = url.startsWith("/");
    const [mangaId, mangaSlug] = legacy
      ? url.split("/").reduce((parts, part, index) => {
          if (index === 2 || index === 3) {
            parts.push(part);
          }
          return parts;
        }, [] as string[])
      : [url, slug];
    if (!mangaId) throw new Error("Manga ID not found in the URL");

    return [mangaId, mangaSlug!];
  }

  private async fetchMangaDetails(query: string, errorMessage: string): Promise<MangaDetails> {
    const [mangaId] = this.parseMangaUrl(query);

    const body = {
      query: DETAILS_QUERY,
      variables: {
        id: mangaId!,
        showId: `manga@${mangaId}`,
      },
    };

    let attempt = 0;
    let lastError: Error = new Error(errorMessage);
    let data: MangaDetails | null = null;

    while (attempt < 5) {
      try {
        const { data: result } = await this.makeGQLRequest<MangaDetails>(body);
        if (result.data) {
          data = result;
          break;
        }
      } catch (error) {
        if (isAxiosError(error)) {
          const method = error.config?.method?.toUpperCase();
          lastError = new Error(
            `${method || "Request"} failed: ${error.response?.status ?? "No response"} - ${error.message}`,
          );
        } else {
          lastError = Error.isError(error) ? error : new Error(errorMessage);
        }
      }
    }

    if (!data?.data.manga) throw lastError;

    return data;
  }

  override getChapters: GetMangaChapters = async (query) => {
    const result = (await this.fetchMangaDetails(query, "Failed to fetch chapters")).data;
    if (!Array.isArray(result.episodeInfos)) {
      throw new Error("Episodes not found");
    }

    const [mangaId] = this.parseMangaUrl(query);

    const chapterDetails = Object.fromEntries(
      result.episodeInfos.map((item) => [item.episodeIdNum.toString(), item]),
    );
    const chaptersData = result
      .manga!.availableChaptersDetail.sub.map((item) => chapterDetails[item]!)
      .filter(Boolean);

    const chapters: Chapter[] = [];

    for (const item of chaptersData) {
      let title = `Chapter ${item.episodeIdNum}`;
      if (item.notes && !/\d/.test(item.notes)) {
        title += `: ${item.notes}`;
      }
      const params = new URLSearchParams({
        mangaId,
        url: item.episodeIdNum.toString(),
      });
      chapters.push({
        title,
        url: params.toString(),
        chapterNumber: this.toNumberOrNull(item.episodeIdNum, true),
      });
    }

    return chapters.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const params = new URLSearchParams(query);
    const mangaId = params.get("mangaId");

    if (!mangaId) throw new Error("Manga ID not found in the URL");
    const mangaUrl = new URL(`manga/${mangaId}`, this.baseUrl);

    const {
      data: mangaHtml,
      status,
      statusText,
    } = await this.client.get(mangaUrl.toString(), {
      validateStatus: () => true,
    });

    const isSuccessful = status >= 200 && status < 300;

    if (!isSuccessful) {
      if (status === 403 || status === 503) {
        throw new Error("Solve captcha in BrowserWindow");
      } else {
        throw new HttpError({
          method: "GET",
          status,
          statusText,
        });
      }
    }

    const chapterUrl = new URL(
      `manga/${mangaId}/chapter-${params.get("url")}-sub`,
      this.baseUrl,
    ).toString();

    const $ = cheerio.load(mangaHtml);

    const script = `
      <script>
        (() => {
          const OriginalTextDecoder = TextDecoder;
          window.TextDecoder = function(...args) {
          const decoder = new OriginalTextDecoder(...args);
        
          // Override the decode method
          const originalDecode = decoder.decode;
          decoder.decode = function(buffer, options) {
          const result = originalDecode.call(this, buffer, options);
          
          // Check if this looks like JSON
          if (result && (result.startsWith('{') || result.startsWith('['))) {
            try {
              const parsed = JSON.parse(result);
              if (parsed && typeof parsed === 'object' && parsed.chapterPages) {
                window.MKissa_PAYLOAD = result;
                try {
                  sessionStorage.setItem('MKissa_PAYLOAD', result);
                  localStorage.setItem('MKissa_PAYLOAD', result);
                  console.log('MKISSA_PAYLOD', result)
                } catch(e) {}
              }
            } catch(e) {
              // Not JSON or incomplete
            }
          }
          
          return result;
        };
        
        return decoder;
      };
        })();
      </script>
    `;

    $("head").prepend(script);

    const finalHtml = $.html() || "";

    const payload = await this.runInBrowserWindow(
      chapterUrl.toString(),
      (_interfaceName) => `
      (function() {
        function triggerChapterNav() {
          const a = document.createElement('a');
          a.href = a.dataset.href = '${chapterUrl}';
          document.body.append(a);
          console.log('Element created: ', a.dataset.href);
          a.click();
        }

        let checkAttempts = 0;
        const maxAttempts = 300; // 15 seconds

        function check() {
          if(document.querySelector('[data-href]')) {
            // Trigger early when SPA is ready
            triggerChapterNav();
          }else if(checkAttempts < maxAttempts) {
            checkAttempts++;
            setTimeout(check, 50);
          }else {
            // Trigger anyway
            triggerChapterNav();
          }
        }
        check();
      })();
    `,
      finalHtml,
    );

    try {
      const pageListData = (JSON.parse(payload) as PageListData).chapterPages;
      const pages =
        pageListData?.edges.find((item) => {
          const randomUrl = item.pictureUrls?.[Math.floor(Math.random() * item.pictureUrls.length)];
          const fullUrlAvailable = randomUrl?.url.match(this.urlRegex) ? true : false;
          const serverAvailable = !!item.pictureUrlHead;

          return fullUrlAvailable || serverAvailable;
        }) ?? pageListData?.edges[0];

      const imageDomain = pages?.pictureUrlHead
        ? this.urlRegex.test(pages.pictureUrlHead)
          ? `${pages.pictureUrlHead.replace(/\/+$/, "")}/`
          : `https://${pages.pictureUrlHead.replace(/\/+$/, "")}/`
        : "https://ytimgf.youtube-anime.com/";

      return pages?.pictureUrls
        .map((item, index) => {
          if (!item.url) return null;

          const imageUrl = this.urlRegex.test(item.url)
            ? item.url
            : new URL(item.url, imageDomain).toString();

          return {
            url: imageUrl,
            index,
          };
        })
        .filter(Boolean) as ChapterPage[];
    } catch {
      return [];
    }
  };

  private runInBrowserWindow(
    _url: string,
    buildScript: (id: string) => string,
    html: string,
  ): Promise<string> {
    const id = randomBytes(8).toString("hex");
    const script = buildScript(id);

    const win: BrowserWindow = browserWindow.create({
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: `persist:${this.extensionMetadata.id}`,
      },
    });

    if (!win) throw new Error("Failed to create browser window.");

    const session = win.webContents.session;

    session.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
      try {
        callback({ cancel: details.resourceType === "image" });
      } catch {
        callback({ cancel: false });
      }
    });

    let resolved = false;
    let timeout: NodeJS.Timeout | null = null;

    const PREFIX = `MKissa_PAYLOAD`;

    const dataUri = `data:text/html;base64,${Buffer.from(html).toString("base64")}`;

    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        if (resolved) return;

        resolved = true;
        if (timeout) clearTimeout(timeout);

        session.webRequest.onBeforeRequest(null);

        win.webContents.removeListener("console-message", onConsoleMessage);
        win.webContents.removeListener("did-finish-load", onLoaded);
        win.webContents.removeListener("did-fail-load", onFail);

        if (!win.isDestroyed()) {
          setTimeout(() => {
            if (!win.isDestroyed()) win.destroy();
          }, 300);
        }
      };

      const onConsoleMessage = ({ message }: Electron.WebContentsConsoleMessageEventParams) => {
        if (!message.startsWith(PREFIX)) return;
        const payload = message.slice(PREFIX.length);
        cleanup();
        resolve(payload);
      };

      const onLoaded = async () => {
        await win.webContents.executeJavaScript(script);

        // Start polling for the payload
        pollForPayload();
      };

      const pollForPayload = async () => {
        let attempts = 0;
        const maxAttempts = 600; // 30 seconds at 50ms intervals

        const poll = async () => {
          if (resolved) return;

          try {
            const payload = await win.webContents.executeJavaScript(`
              window['${PREFIX}'] || localStorage.getItem('${PREFIX}') || sessionStorage.getItem('${PREFIX}');
            `);

            if (payload) {
              console.log("Payload found via polling");
              cleanup();
              resolve(payload);
              return;
            }
          } catch {
            // Ignore errors during polling
          }

          attempts++;
          if (attempts < maxAttempts && !resolved) {
            setTimeout(poll, 50);
          } else if (!resolved) {
            // Fallback: try console method if polling fails
            console.log("Polling timeout, falling back to console capture");
          }
        };

        poll();
      };

      const onFail = (_: unknown, code: number, desc: string) => {
        console.log("fail", { code, desc });
        cleanup();
        reject(new Error(`${code}: ${desc}`));
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout while capturing payload"));
      }, 35_000);

      win.webContents.on("console-message", onConsoleMessage);
      win.webContents.on("did-finish-load", onLoaded);
      win.webContents.once("did-fail-load", onFail);

      win
        .loadURL(dataUri, {
          userAgent: win.webContents.session.getUserAgent(),
          baseURLForDataURL: this.baseUrl,
        })
        .catch((err) => {
          console.error("Failed to load URL:", err);
          cleanup();
          reject(err);
        });
    });
  }

  override getSeriesStatus: GetSeriesStatus = (input) => {
    const lower = input?.toLowerCase();
    switch (true) {
      case lower?.includes("releasing"):
        return "ongoing";
      case lower?.includes("finished"):
        return "completed";
      default:
        return "unknown";
    }
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [SortFilter, CountryFilter, GenresFilter],
  });

  private makeGQLRequest<T = any>(
    body: Record<string, any>,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const payload = JSON.stringify(body);

    const headers = new AxiosHeaders(config?.headers as Record<string, string>);
    headers.set("Accept", "*/*");
    headers.set("Content-Type", "application/json");
    headers.set("Content-Length", Buffer.byteLength(payload).toString());
    headers.set("Origin", new URL(this.baseUrl).origin);
    headers.set("Referer", `${this.baseUrl}/`);

    return this.client.post<T>(`${this.API_URL}`, payload, { headers });
  }

  private parseThumbnailUrl(url: string): string {
    if (this.urlRegex.test(url)) return url;
    return `${this.THUMBNAIL_CDN}${url}?w=250`;
  }

  private titleToSlug(title: string): string {
    return title.toLowerCase().replace(/[^a-z\d]+/g, "-");
  }

  private readonly PREF_ALLOW_ADULT_KEY = "pref_allow_adult";
  private readonly PREF_ALLOW_ADULT_DEFAULT = false;

  private readonly LIMIT = 20;
  private readonly THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";

  private urlRegex = /^https?:\/\/.*/;
}
