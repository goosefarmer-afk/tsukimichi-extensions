import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import axios, { AxiosHeaders } from "axios";
import { app, browserWindow, type BrowserWindow, session, type Cookie } from "electron";
import type { NetworkInterceptor } from "../network/types";
import { getCookiesForExtension } from "../cookies";

interface CloudflareInterceptorConfig {
  extensionId: string;
  timeout?: number;
}

export class CloudflareInterceptor implements NetworkInterceptor {
  readonly name = "cloudflare";

  private readonly ERROR_CODES = [403, 503];
  private readonly SERVER_CHECK = ["cloudflare-nginx", "cloudflare"];
  private readonly COOKIE_NAME = "cf_clearance";
  private readonly DEFAULT_TIMEOUT = 30_000;
  private readonly CHALLENGE_TITLES = ["just a moment", "attention required", "cloudflare"];

  constructor(
    private readonly client: AxiosInstance,
    private readonly config: CloudflareInterceptorConfig,
  ) {}

  async onResponseError(error: unknown): Promise<AxiosResponse | never> {
    if (!axios.isAxiosError(error) || !error.response || !this.shouldIntercept(error.response)) {
      throw error;
    }

    const originalConfig = error.config as InternalAxiosRequestConfig & { _cfAttempt?: number };
    const attempt = originalConfig._cfAttempt ?? 0;

    if (attempt >= 2) {
      console.info("[CF] Max attempts reached, giving up");
      throw error;
    }

    // Increment attempt BEFORE any retry logic
    originalConfig._cfAttempt = attempt + 1;
    const finalUrl = this.getFinalUrl(originalConfig, error.response);
    console.info(`[CF] Attempt ${attempt + 1}, final URL: ${finalUrl}`);

    try {
      if (attempt === 0) {
        const existingCookie = await this.getValidClearanceCookie(finalUrl);
        if (existingCookie) {
          console.info("[CF] Found valid cookie for redirected domain, retrying with it");
          const updatedConfig = this.injectCookie(originalConfig, existingCookie);
          updatedConfig.url = finalUrl;

          try {
            return await this.client.request({
              ...updatedConfig,
              // @ts-expect-error
              cache: false,
              jar: undefined,
              withCredentials: false,
            });
          } catch {
            // If the retry with existing cookie fails, continue to bypass
            console.info("[CF] Retry with existing cookie failed, proceeding to bypass");
            // Clear the cookie since it's invalid
            await this.clearClearanceCookies(finalUrl);
            // Fall through to bypass logic below
          }
        } else {
          // No valid cookie - clear any stale ones
          await this.clearClearanceCookies(finalUrl);
        }
      } else {
        // For attempt === 1, clear cookies before bypass
        await this.clearClearanceCookies(finalUrl);
      }

      // Run the bypass (for attempt 0 with failed cookie retry, or attempt 1)
      const { result, cookie } = await this.resolveWithWebView(finalUrl);
      console.log("[CF] Bypass result:", {
        name: cookie?.name,
        value: cookie?.value,
      });
      if (!result || !cookie) {
        console.warn("[CF] Bypass did not produce a valid cookie, giving up");
        throw new Error("Failed to bypass Cloudflare");
      }

      console.info("[CF] Got fresh cf_clearance, retrying");
      const updatedConfig = this.injectCookie(originalConfig, cookie);
      updatedConfig.url = finalUrl;
      return await this.client.request({
        ...updatedConfig,
        // @ts-expect-error
        cache: false,
        jar: undefined,
        withCredentials: false,
      });
    } catch (bypassError) {
      if (axios.isAxiosError(bypassError)) throw bypassError;
      console.error("[CF] Bypass failed:", bypassError);
      throw error;
    }
  }

  // ─── WebView Challenge Resolver ───────────────────────────────────────────

  private async resolveWithWebView(
    url: string,
  ): Promise<{ result: boolean; cookie: Cookie | null }> {
    const challengeWindow: BrowserWindow = browserWindow.create({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        javascript: true,
        nodeIntegration: false,
        sandbox: false,
        contextIsolation: true,
        partition: `persist:${this.config.extensionId}`,
      },
    });

    challengeWindow.webContents.session.setUserAgent(app.userAgentFallback);

    const oldCookie = await this.getSessionClearanceCookie(challengeWindow);
    const oldValue = oldCookie?.value ?? null;

    return new Promise((resolve) => {
      let settled = false;

      const POLL_INTERVAL_MS = 500;
      const MAX_POLL_ATTEMPTS = Math.floor(
        (this.config.timeout ?? this.DEFAULT_TIMEOUT) / POLL_INTERVAL_MS,
      );

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        if (!challengeWindow.isDestroyed()) {
          challengeWindow.webContents.removeAllListeners();
          challengeWindow.webContents.session.cookies.removeAllListeners("changed");
          challengeWindow.destroy();
        }
      };

      const settle = (result: boolean, cookie: Cookie | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ result, cookie });
      };

      const timeoutHandle = setTimeout(() => {
        settle(false, null);
      }, this.config.timeout ?? this.DEFAULT_TIMEOUT);

      challengeWindow.webContents.session.cookies.on(
        "changed",
        async (_event, cookie, _cause, removed) => {
          if (removed || cookie.name !== this.COOKIE_NAME) return;
          if (cookie.value === oldValue) return;

          await new Promise((resolve) => setTimeout(resolve, 100));

          const isStillChallenge = await this.isChallengePage(challengeWindow);
          if (!isStillChallenge) {
            console.info("[CF] Cookie changed and no longer on challenge page");
            settle(true, cookie);
          } else {
            console.info("[CF] Cookie changed but still on challenge page, waiting...");
          }
        },
      );

      challengeWindow.webContents.once("did-finish-load", () => {
        void (async () => {
          for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
            if (settled) return;
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            if (settled || challengeWindow.isDestroyed()) return;

            const current = await this.getSessionClearanceCookie(challengeWindow);
            const isNewCookie = current && current.value !== oldValue;

            if (isNewCookie) {
              const isChallengePage = await this.isChallengePage(challengeWindow);

              if (!isChallengePage) {
                console.info(`[CF] Valid cookie detected via polling (attempt ${i + 1})`);
                settle(true, current);
                return;
              }
            }
          }

          if (!settled) {
            console.warn("[CF] Polling exhausted without valid cookie");
            settle(false, null);
          }
        })();
      });

      challengeWindow.loadURL(url);
    });
  }

  // ─── Cookie Helpers ───────────────────────────────────────────────────────

  private async getValidClearanceCookie(url: string): Promise<Cookie | null> {
    // Check WebView partition session first (most up-to-date)
    const partitionCookies = await session
      .fromPartition(`persist:${this.config.extensionId}`)
      .cookies.get({ name: this.COOKIE_NAME });

    const { hostname: domain } = new URL(url);

    const sessionCookie = partitionCookies.find((c) => {
      const domainMatch =
        c.domain === domain ||
        c.domain === `.${domain}` ||
        (c.domain?.startsWith(".") && domain.endsWith(c.domain.slice(1))) ||
        c.name === this.COOKIE_NAME;
      const notExpired =
        !c.expirationDate || new Date(c.expirationDate * 1000).getTime() > Date.now();
      return domainMatch && notExpired;
    });

    if (sessionCookie) return sessionCookie;

    // Fallback: check external cookie store
    const external = await this.getCookiesForUrl(url);
    return (
      external
        .filter((c) => c.name === this.COOKIE_NAME)
        .find(
          (c) => !c.expirationDate || new Date(c.expirationDate * 1000).getTime() > Date.now(),
        ) ?? null
    );
  }

  private getFinalUrl(config: InternalAxiosRequestConfig, response: AxiosResponse): string {
    const responseURL: string | undefined =
      response?.request?.responseURL ?? // XMLHttpRequest (renderer)
      response?.request?.res?.responseUrl ?? // Node http.IncomingMessage
      response?.config?.url; // fallback: original URL

    return responseURL ?? config.url!;
  }

  private async clearClearanceCookies(url: string): Promise<void> {
    const { hostname: domain } = new URL(url);
    const partition = `persist:${this.config.extensionId}`;

    const cookies = (
      await Promise.all([
        getCookiesForExtension(this.config.extensionId, {
          domain: `.${domain}`,
        }),
        getCookiesForExtension(this.config.extensionId, {
          domain,
        }),
      ])
    ).flat();

    for (const cookie of cookies) {
      await session.fromPartition(partition).cookies.remove(`https://${domain}`, cookie.name);
    }

    console.info(`[CF] Cleared ${cookies.length} cf_clearance cookie(s) for ${domain}`);
  }

  private async getSessionClearanceCookie(win: BrowserWindow): Promise<Cookie | null> {
    if (win.isDestroyed()) return null;
    const cookies = await win.webContents.session.cookies.get({ name: this.COOKIE_NAME });
    return cookies[0] ?? null;
  }

  private async getCookiesForUrl(url: string): Promise<Cookie[]> {
    const { hostname: domain, pathname: path } = new URL(url);
    const allCookies = await getCookiesForExtension(this.config.extensionId);

    const matches = (c: Cookie) => {
      const cookieDomain = c.domain ?? "";
      const domainMatches =
        cookieDomain === domain ||
        cookieDomain === `.${domain}` ||
        (cookieDomain.startsWith(".") && domain.endsWith(cookieDomain.slice(1)));
      const pathMatches = !c.path || c.path === "/" || path.startsWith(c.path);
      return domainMatches && pathMatches;
    };

    return allCookies.filter(matches);
  }

  // ─── Misc Helpers ─────────────────────────────────────────────────────────

  private injectCookie(
    config: InternalAxiosRequestConfig,
    cookie: Cookie,
  ): InternalAxiosRequestConfig {
    const headers = new AxiosHeaders(config.headers);
    const existing = headers.get("Cookie");

    const cookies = new Map<string, string>();

    if (typeof existing === "string") {
      for (const part of existing.split(";")) {
        const separator = part.indexOf("=");
        if (separator === -1) continue;

        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();

        if (name) cookies.set(name, value);
      }
    }

    // Replace any existing cookie with the same name.
    cookies.set(cookie.name, cookie.value);

    headers.set(
      "Cookie",
      [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
    );

    headers.set("User-Agent", app.userAgentFallback);

    return { ...config, headers };
  }

  private shouldIntercept(response: AxiosResponse): boolean {
    const server = (response.headers["server"] ?? response.headers["Server"]) as string | undefined;
    return (
      this.ERROR_CODES.includes(response.status) && !!server && this.SERVER_CHECK.includes(server)
    );
  }

  private async isChallengePage(win: BrowserWindow): Promise<boolean> {
    if (win.isDestroyed()) return false;
    try {
      const title = (await win.webContents.getTitle()).toLowerCase();
      return this.CHALLENGE_TITLES.some((t) => title.toLowerCase().includes(t));
    } catch {
      return false;
    }
  }
}
