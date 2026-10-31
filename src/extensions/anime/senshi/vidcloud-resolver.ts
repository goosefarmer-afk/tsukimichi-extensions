import { Mutex } from "async-mutex";
import type { VidcloudEntry } from "./types";
import { LRUCache } from "@/utils/lru-cache";
import { type BrowserWindow, browserWindow } from "electron";
import { randomUUID } from "node:crypto";

interface CachedEntries {
  entries: VidcloudEntry[];
  createdAt: number;
}

export class VidcloudResolver {
  private readonly mutex = new Mutex();

  private readonly cache = new LRUCache<number, CachedEntries>({
    maxSize: 16,
  });

  private activeWindow: BrowserWindow | null = null;
  private cancelActiveAttempt?: (reason: Error) => void;

  constructor(
    private readonly baseUrl: () => string,
    private readonly warmUp: () => Promise<void>,
    private readonly extensionId: string,
    private readonly userAgent?: string,
  ) {}

  cancel(): void {
    this.mutex.cancel();

    this.cancelActiveAttempt?.(new Error("Vidcloud resolution cancelled"));
  }

  async resolve(videoId: number): Promise<VidcloudEntry[]> {
    return this.mutex.runExclusive(async () => {
      const cached = this.cache.get(videoId);

      if (cached && Date.now() - cached.createdAt < this.CACHE_TTL_MS) {
        return cached.entries;
      }

      let lastError: Error | undefined;

      for (let attempt = 0; attempt < this.ATTEMPTS; attempt++) {
        try {
          if (attempt > 0) {
            await this.warmUp();
          }

          const result = await this.openInBrowserWindow(videoId);

          if (!Array.isArray(result) || !result.some((entry) => (entry.sources?.length ?? 0) > 0)) {
            throw new Error("No playable sources found");
          }

          this.cache.set(videoId, {
            entries: result,
            createdAt: Date.now(),
          });

          return result;
        } catch (cause) {
          lastError = cause instanceof Error ? cause : new Error(String(cause));

          console.warn(
            `[VidcloudResolver] video=${videoId} ` +
              `attempt=${attempt + 1}/${this.ATTEMPTS}: ` +
              lastError.message,
          );

          if (lastError.message === "Vidcloud resolution cancelled") {
            throw lastError;
          }
        }
      }

      throw new Error(
        `Could not resolve video ${videoId}: ` + (lastError?.message ?? "Unknown error"),
        { cause: lastError },
      );
    });
  }

  private openInBrowserWindow(videoId: number): Promise<VidcloudEntry[]> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const nonce = randomUUID();
      const prefix = `__SENSHI__:${nonce}:`;
      const teardowns: Array<() => void> = [];

      let win: BrowserWindow | undefined;

      const cleanup = () => {
        if (settled) return;
        settled = true;

        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }

        for (const teardown of teardowns.splice(0)) {
          try {
            teardown();
          } catch {
            // Continue cleaning up remaining resources.
          }
        }

        if (win && this.activeWindow === win) {
          this.activeWindow = null;
        }

        if (this.cancelActiveAttempt === cancelAttempt) {
          this.cancelActiveAttempt = undefined;
        }

        if (win && !win.isDestroyed()) {
          try {
            win.destroy();
          } catch {
            // The window may already be closing.
          }
        }
      };

      const fail = (error: unknown) => {
        if (settled) return;

        const normalized = error instanceof Error ? error : new Error(String(error));

        cleanup();
        reject(normalized);
      };

      const succeed = (json: string) => {
        if (settled) return;

        try {
          const entries: unknown = JSON.parse(json);

          if (
            !Array.isArray(entries) ||
            !entries.every(
              (entry) =>
                entry &&
                typeof entry === "object" &&
                Array.isArray(entry.sources) &&
                Array.isArray(entry.tracks),
            )
          ) {
            throw new Error("Invalid resolver response");
          }

          cleanup();
          resolve(entries as VidcloudEntry[]);
        } catch (error) {
          fail(error);
        }
      };

      const cancelAttempt = (reason: Error) => {
        fail(reason);
      };

      try {
        win = browserWindow.create({
          show: false,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: `persist:${this.extensionId}`,
          },
        }) as BrowserWindow;

        this.activeWindow = win;
        this.cancelActiveAttempt = cancelAttempt;

        const wc = win.webContents;

        if (this.userAgent) {
          wc.setUserAgent(this.userAgent);
        }

        const onConsole = ({ message }: Electron.WebContentsConsoleMessageEventParams) => {
          if (settled || !message.startsWith(prefix)) {
            return;
          }

          const body = message.slice(prefix.length);

          if (body.startsWith("RESULT ")) {
            succeed(body.slice("RESULT ".length));
          } else if (body.startsWith("ERROR ")) {
            fail(body.slice("ERROR ".length));
          }
        };

        const onFailLoad = (
          _event: Electron.Event,
          errorCode: number,
          errorDescription: string,
          validatedURL: string,
          isMainFrame: boolean,
        ) => {
          if (!isMainFrame || errorCode === -3) return;

          fail(
            new Error(`Failed to load (${errorCode}): ` + `${errorDescription} ${validatedURL}`),
          );
        };

        const onRenderGone = (
          _event: Electron.Event,
          details: Electron.RenderProcessGoneDetails,
        ) => {
          fail(new Error(`Renderer exited: ${details.reason} ` + `(exitCode=${details.exitCode})`));
        };

        const onUnresponsive = () => {
          fail(new Error("Renderer became unresponsive"));
        };

        const onClosed = () => {
          if (!settled) {
            fail(new Error("Window closed before resolver completed"));
          }
        };

        const onDomReady = () => {
          if (settled) return;

          const html = this.buildPage(videoId, nonce);

          // JSON.stringify makes the HTML a safely quoted JS string.
          wc.executeJavaScript(
            `document.open();document.write(${JSON.stringify(html)});document.close();`,
          ).catch(fail);
        };

        wc.on("console-message", onConsole);
        wc.on("did-fail-load", onFailLoad);
        wc.on("render-process-gone", onRenderGone);
        wc.on("unresponsive", onUnresponsive);
        wc.once("dom-ready", onDomReady);
        win.once("closed", onClosed);

        teardowns.push(
          () => wc.off("console-message", onConsole),
          () => wc.off("did-fail-load", onFailLoad),
          () => wc.off("render-process-gone", onRenderGone),
          () => wc.off("unresponsive", onUnresponsive),
          () => wc.off("dom-ready", onDomReady),
          () => win?.off("closed", onClosed),
        );

        timeout = setTimeout(() => {
          fail(new Error(`Resolver timed out after ${this.TIMEOUT_MS / 1000}s`));
        }, this.TIMEOUT_MS);

        const base = this.baseUrl().replace(/\/+$/, "");

        win.loadURL(`${base}/`).catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  private buildPage(videoId: number, nonce: string): string {
    const scripts = JSON.stringify([
      this.VENDOR_CDN_URL,
      `${this.baseUrl().replace(/\/+$/, "")}/assets/vendor.js`,
    ]);

    const script = this.RESOLVE_SCRIPT.replace("__SCRIPTS__", scripts)
      .replace("__VIDEO_ID__", String(videoId))
      .replace(/__PREFIX__/g, JSON.stringify(`__SENSHI__:${nonce}:`));

    return `<!doctype html>
              <html>
                <head>
                <meta charset="utf-8">
                <script>${script}</script>
                </head>
                <body></body>
              </html>`;
  }

  private readonly RESOLVE_SCRIPT = `
(function () {
  const prefix = __PREFIX__;
  const scripts = __SCRIPTS__;
  const videoId = __VIDEO_ID__;

  let finished = false;
  let scriptIndex = 0;
  let loadTimer;
  let pollTimer;

  function send(kind, body) {
    if (finished) return;

    try {
      console.log(prefix + kind + " " + body);
    } catch {}
  }

  function fail(error) {
    if (finished) return;

    finished = true;
    clearTimeout(loadTimer);
    clearInterval(pollTimer);

    try {
      console.log(
        prefix + "ERROR " +
        String(error && error.message ? error.message : error)
      );
    } catch {}
  }

  function normalize(value) {
    const entries = Array.isArray(value) ? value : [value];

    return entries.map(function (entry) {
      entry = entry || {};

      const source = entry.source;
      let sources;

      if (Array.isArray(source)) {
        sources = source;
      } else if (typeof source === "string") {
        sources = [{ src: source }];
      } else if (source && (source.src || source.file)) {
        sources = [source];
      } else {
        sources = entry.file ? [{ src: entry.file }] : [];
      }

      return {
        sources: sources
          .filter(function (item) {
            return item && (item.src || item.file);
          })
          .map(function (item) {
            return {
              src: item.src || item.file,
              label: item.label || null
            };
          }),
        tracks: (Array.isArray(entry.tracks) ? entry.tracks : [])
          .map(function (track) {
            return {
              url: track.url || track.file || null,
              vttUrl: track.vtt_url || null,
              label: track.label || null
            };
          })
      };
    });
  }

  function open() {
    if (finished) return;

    let request;

    try {
      request = window.__oct.open(videoId);
    } catch (error) {
      fail(error);
      return;
    }

    Promise.resolve(request)
      .then(function (result) {
        if (finished) return;

        const entries = normalize(result || []);

        if (!entries.some(function (entry) {
          return entry.sources.length > 0;
        })) {
          throw new Error("No playable sources found");
        }

        finished = true;
        clearTimeout(loadTimer);
        clearInterval(pollTimer);

        try {
          console.log(prefix + "RESULT " + JSON.stringify(entries));
        } catch {}
      })
      .catch(fail);
  }

  function loadNext() {
    if (finished) return;

    clearTimeout(loadTimer);
    clearInterval(pollTimer);

    if (scriptIndex >= scripts.length) {
      fail(new Error("Player runtime failed to load"));
      return;
    }

    const script = document.createElement("script");
    script.src = scripts[scriptIndex++];

    let elapsed = 0;

    pollTimer = setInterval(function () {
      if (
        window.__oct &&
        typeof window.__oct.open === "function"
      ) {
        clearInterval(pollTimer);
        clearTimeout(loadTimer);
        open();
      } else if ((elapsed += 100) >= 10000) {
        loadNext();
      }
    }, 100);

    loadTimer = setTimeout(loadNext, 11000);

    script.onerror = loadNext;
    document.body.appendChild(script);
  }

  loadNext();
})();
`;

  private readonly VENDOR_CDN_URL = "https://cdn.vidcloud.se/vjs/vendor.js";

  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private readonly TIMEOUT_MS = 30_000;
  private readonly ATTEMPTS = 2;
}
