import type { SubtitleTrack, Video } from "@tsukimichi/common";
import { AxiosHeaders, type AxiosInstance } from "axios";
import { type BrowserWindow, browserWindow } from "electron";
import { PlaylistUtils } from "@/lib/playlist-utils";

export class MegaUpExtractor {
  private playlistUtils: PlaylistUtils;
  private DEFAULT_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  constructor(
    private client: AxiosInstance,
    private headers: AxiosHeaders,
  ) {
    this.playlistUtils = new PlaylistUtils(this.client);
  }

  async getVideosFromUrl(url: string, serverName?: string): Promise<Video[]> {
    const parsedUrl = new URL(url);
    const userAgent =
      this.headers["User-Agent"] || this.headers["user-agent"] || this.DEFAULT_USER_AGENT;

    const segments = parsedUrl.pathname.split("/").filter(Boolean);

    if (segments[0] === "iframe") {
      console.info("Detected iFrame wrapper. Unwrapping...");
      const iframeUrl = await this.unwrapIframeUrl(url);
      return this.getVideosFromUrl(iframeUrl, serverName);
    }

    const megaHost = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const host = this.properString(this.extractHoster(megaHost));
    const prefix = serverName || host;

    console.info(`Fetching videos for ${prefix} from: ${url}`);

    const token =
      segments.at(-1) ??
      (() => {
        throw new Error(`No token found in URL: ${url}`);
      })();

    const megaUrl = new URL(`${megaHost}/media/${token}`);
    const mediaHeaders = new AxiosHeaders(this.headers);
    mediaHeaders.set("User-Agent", userAgent);
    mediaHeaders.set("Accept", "application/json, text/plain, */*");
    mediaHeaders.set("X-Requested-With", "XMLHttpRequest");
    mediaHeaders.set("Referer", url);

    const { result: megaToken } = await this.client
      .get(megaUrl.toString(), {
        headers: mediaHeaders,
        responseType: "json",
      })
      .then((res) => res.data);

    const tokenBody = {
      text: megaToken,
      agent: userAgent,
    };
    const { result } = await this.client
      .post("https://enc-dec.app/api/dec-mega", tokenBody, {
        headers: this.encDecHeaders(url),
      })
      .then((res) => res.data as Promise<MegaUpTokenResponse>);

    if (result.sources.length === 0) {
      throw new Error("Failed to extract videos from URL");
    }

    const subtitles = this.subTitleTracks(result?.tracks ?? []);

    const videos = await Promise.all(
      result.sources.flatMap((source) => {
        const videoUrl = source.file;
        switch (true) {
          case this.m3u8Regex.test(videoUrl):
            console.info("m3u8 url found", videoUrl);
            return this.playlistUtils.extractFromHls({
              playlistUrl: videoUrl,
              videoNameGen: (q) => `${prefix ? `${prefix}: ` : ""}${q}`,
              subtitleList: subtitles,
              referer: `${megaHost}/`,
            });
          case this.mpdRegex.test(videoUrl):
            console.info("mpd url found", videoUrl);
            return this.playlistUtils.extractFromDash({
              mpdUrl: videoUrl,
              videoNameGen: (q) => `${prefix ? `${prefix}: ` : ""}${q}`,
              referer: `${megaHost}/`,
              subtitleList: subtitles,
            });
          case this.mp4Regex.test(videoUrl):
            console.info("mp4 url found", videoUrl);
            return new Promise<Video[]>((resolve) => {
              resolve([
                {
                  url: videoUrl,
                  label: `${prefix ? `${prefix}:` : ""} MP4`,
                  subtitleTracks: subtitles,
                  headers: {
                    Referer: `${megaHost}/`,
                    Origin: megaHost,
                    "User-Agent": userAgent,
                  },
                },
              ]);
            });
          default:
            return [];
        }
      }),
    ).then((v) => v.flat());

    return videos;
  }

  private encDecHeaders(url: string): AxiosHeaders {
    const headers = new AxiosHeaders(this.headers);
    const referer = headers.get("referer") || headers.get("Referer") || url;
    const refererUrl = new URL(referer as string);
    const origin = refererUrl.origin;

    headers.set("User-Agent", this.DEFAULT_USER_AGENT);
    headers.set("Accept", "application/json, text/plain, */*");
    headers.set("Referer", referer);
    headers.set("Origin", origin);
    headers.set("Sec-Fetch-Dest", "empty");
    headers.set("Sec-Fetch-Mode", "cors");
    headers.set("Sec-Fetch-Site", "cross-site");
    return headers;
  }

  private async unwrapIframeUrl(url: string): Promise<string> {
    try {
      const urlObj = new URL(url);
      const iframeHeaders = new AxiosHeaders();
      iframeHeaders.set("User-Agent", this.DEFAULT_USER_AGENT);
      iframeHeaders.set(
        "Accept",
        "text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8",
      );
      iframeHeaders.set("Referer", url);

      const { data: html } = await this.client.get<string>(url, {
        headers: iframeHeaders,
      });
      const iframeRegex = /<iframe[^>]+src=["']([^"']*(?:\/e\/|megaup)[^"']*)["']/i;
      let realUrl = iframeRegex.exec(html)?.[1];
      console.info({ realUrl });

      if (realUrl) {
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
        realUrl = new URL(realUrl, baseUrl).toString();
        console.info({ finalRealUrl: realUrl });
        return realUrl;
      }
    } catch {
      console.warn("Unwrap failed (Cloudflare block), falling back to BrowserWindow");
    }

    console.info("Falling back to BrowserWindow");

    return await this.unwrapWithBrowserWindow(url);
  }

  private unwrapWithBrowserWindow(url: string): Promise<string> {
    const win: BrowserWindow = browserWindow.create({ show: false });
    if (!win) throw new Error("Failed to create BrowserWindow");

    return new Promise<string>((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        try {
          if (!win.isDestroyed()) {
            win.removeAllListeners("did-finish-load");
            win.removeAllListeners("closed");
            win.close();
          }
        } catch {
          // ignore
        }
      };

      const done = (value: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve(value);
      };

      const fail = (error: Error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        reject(error);
      };

      const timeout = setTimeout(
        () => fail(new Error("Timeout while unwrapping URL via BrowserWindow")),
        30_000,
      );

      const tryExtractIframe = async (): Promise<string | null> => {
        try {
          const result = await win.webContents.executeJavaScript(`
          (function() {
            try {
              var iframe = document.querySelector('iframe[src]');
              if (iframe && (iframe.src.includes('/e/') || iframe.src.includes('megaup'))) {
                return iframe.src;
              }
            } catch(e) {}
            return '';
          })();
        `);
          return (result as string | null | undefined)?.trim() || null;
        } catch {
          return null;
        }
      };

      const pollForIframe = async () => {
        const maxAttempts = 10;
        const intervalMs = 800;

        for (let i = 0; i < maxAttempts; i++) {
          if (resolved) return;

          await new Promise((r) => setTimeout(r, intervalMs));

          if (resolved) return;

          const extractedUrl = await tryExtractIframe();
          console.info(`[unwrap] attempt ${i + 1}/${maxAttempts}:`, extractedUrl ?? "(empty)");

          if (extractedUrl) {
            done(extractedUrl);
            return;
          }
        }
      };

      win.webContents.on("did-finish-load", async () => {
        const loadedUrl = win.webContents.getURL();

        // Skip Cloudflare challenge intermediate pages
        if (loadedUrl.includes("/cdn-cgi/")) {
          console.info("[unwrap] Skipping Cloudflare challenge page:", loadedUrl);
          return;
        }

        console.info("[unwrap] Page loaded:", loadedUrl);
        await pollForIframe();
      });

      win.on("closed", () => fail(new Error("BrowserWindow closed before resolving")));

      win.loadURL(url).catch(fail);
    });
  }

  private extractHoster(host: string): string {
    const match = this.hosterRegex.exec(host)?.[1];

    if (match) return match;

    return host;
  }

  private properString(str: string): string {
    if (!str) return str;

    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private subTitleTracks(tracks: MegaUpTokenResponse["result"]["tracks"]): SubtitleTrack[] {
    return tracks
      .filter((t) => t.kind === "captions" && t.file.endsWith(".vtt"))
      .map((t) => ({
        label: t.label || "Unknown",
        kind: "captions",
        lang: t.label || "Unknown",
        url: t.file,
        default: t.default,
      }));
  }

  private m3u8Regex = /.*\.m3u8(\?.*)?$/i;
  private mpdRegex = /.*\.mpd(\?.*)?$/i;
  private mp4Regex = /.*\.mp4(\?.*)?$/i;

  private hosterRegex = /([^.]+)\.[^.]+$/;
}

interface MegaUpTokenResponse {
  result: {
    sources: {
      file: string;
    }[];
    tracks: {
      file: string;
      label?: string;
      kind: string;
      default: boolean;
    }[];
  };
}
