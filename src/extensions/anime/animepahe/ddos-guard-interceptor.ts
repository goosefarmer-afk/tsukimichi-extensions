import {
  AxiosHeaders,
  isAxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import type { NetworkInterceptor } from "@/lib/network/types";
import { getCookiesForExtension } from "@/lib/cookies";
import { CloudflareBypass, type CloudflareBypassResult } from "./extractors/cloudflare-bypass";
import { app } from "electron";

export class DdosGuardInterceptor implements NetworkInterceptor {
  readonly name = "DdosGuardInterceptor";

  private static readonly WELL_KNOWN_URL = "https://check.ddos-guard.net/check.js";

  private static readonly ERROR_CODES = new Set([403]);

  private static readonly SERVER_CHECK = ["ddos-guard"];

  private readonly cookieJar = new Map<string, string>();

  private cookie: string | null = null;

  constructor(
    private readonly client: AxiosInstance,
    private readonly extensionId: string,
    private readonly cfBypassUAProvider?: () => string,
  ) {}

  async onRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    const cookies = await getCookiesForExtension(this.extensionId);

    for (const cookie of cookies) {
      this.setCookie(cookie.name, cookie.value);
    }

    this.applyCookies(config);

    return config;
  }

  async onResponse(response: AxiosResponse): Promise<AxiosResponse> {
    if (!this.isChallengeResponse(response)) {
      return response;
    }

    return (await this.handleChallenge(response.config, response)) ?? response;
  }

  async onResponseError(error: unknown): Promise<AxiosResponse | never> {
    if (!isAxiosError(error) || !error.response) {
      throw error;
    }

    const response = error.response;

    if (!this.isChallengeResponse(response)) {
      throw error;
    }

    const result = await this.handleChallenge(response.config, response);

    if (result) {
      return result;
    }

    throw error;
  }

  private async handleChallenge(
    config: InternalAxiosRequestConfig,
    response: AxiosResponse,
  ): Promise<AxiosResponse | null> {
    // 1. Try cookies supplied by the challenge response itself.
    if (this.extractCookies(response)) {
      console.log("Found cookie in extractCookies");
      return this.retryRequest(config);
    }

    console.log("Trying to bypass using WebView");
    // 2. Try WebView/browser challenge.
    const bypassResult = await this.tryWebViewBypass(response);
    console.log(`[${this.name}] WebView bypass result:`, bypassResult);

    if (bypassResult) {
      console.log("Found cookie in WebView");
      config.headers["User-Agent"] = bypassResult.userAgent;
      config.headers["Cookie"] = bypassResult.cookies;
      this.importCookieString(bypassResult.cookies);
      config.headers["Accept"] = null;
      console.log("Retrying request", config.headers?.toJSON?.());
      return this.client.request(config);
    }

    // 3. Fallback to DDOS-Guard's check endpoint.
    const finalUrl = this.getFinalUrl(config, response);

    try {
      const url = new URL(finalUrl);

      if (await this.getNewCookie(url)) {
        return this.retryRequest(config);
      }
    } catch (error) {
      console.error(`[${this.name}] Failed to resolve final URL:`, error);
    }

    return null;
  }

  private isChallengeResponse(response: AxiosResponse): boolean {
    return this.isDdosGuardResponse(response) || this.isCloudflareResponse(response);
  }

  private isDdosGuardResponse(response: AxiosResponse): boolean {
    if (!DdosGuardInterceptor.ERROR_CODES.has(response.status)) {
      return false;
    }

    const server = response.headers["server"];

    return (
      typeof server === "string" &&
      DdosGuardInterceptor.SERVER_CHECK.some((name) => server.toLowerCase().includes(name))
    );
  }

  private isCloudflareResponse(response: AxiosResponse): boolean {
    return Boolean(response.headers["cf-ray"]);
  }

  private getFinalUrl(config: InternalAxiosRequestConfig, response: AxiosResponse): string {
    return response.request?.res?.responseUrl ?? response.config?.url ?? config.url!;
  }

  private extractCookies(response: AxiosResponse): boolean {
    const setCookie = response.headers["set-cookie"];

    if (!setCookie) {
      return false;
    }

    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];

    let found = false;

    for (const cookieString of cookies) {
      const cookie = this.parseDdgCookie(cookieString);

      if (!cookie) {
        continue;
      }

      this.setCookie(cookie.name, cookie.value);
      found = true;
    }

    return found;
  }

  private parseDdgCookie(cookieString: string): { name: string; value: string } | null {
    const match = cookieString.match(/^(__ddg2_)=([^;]*)/);

    if (!match) {
      return null;
    }

    return {
      name: match[1]!,
      value: match[2]!,
    };
  }

  private async getNewCookie(url: URL): Promise<boolean> {
    try {
      const response = await this.client.get(DdosGuardInterceptor.WELL_KNOWN_URL);

      const extractedPath = response.data.match(/['"]([^'"]+)['"]/)?.[1];

      if (!extractedPath) {
        return false;
      }

      const checkUrl = `${url.protocol}//${url.host}${extractedPath}`;

      const checkResponse = await this.client.get(checkUrl);

      return this.extractCookies(checkResponse);
    } catch (error) {
      console.error(`[${this.name}] Failed to get new cookie:`, error);
      return false;
    }
  }

  private async tryWebViewBypass(response: AxiosResponse): Promise<CloudflareBypassResult | null> {
    const userAgent = this.cfBypassUAProvider?.() ?? this.getDefaultUserAgent();

    const url = this.getFinalUrl(response.config, response);

    try {
      const bypass = new CloudflareBypass(this.extensionId);

      return await bypass.getCookies(url, userAgent);
    } catch (error) {
      console.error(`[${this.name}] WebView bypass failed:`, error);
      return null;
    }
  }

  private importCookieString(cookieString: string): void {
    for (const cookie of cookieString.split(/;\s*/)) {
      const separator = cookie.indexOf("=");

      if (separator === -1) {
        continue;
      }

      const name = cookie.slice(0, separator).trim();
      const value = cookie.slice(separator + 1).trim();

      if (name && value) {
        this.setCookie(name, value);
      }
    }
  }

  private setCookie(name: string, value: string): void {
    this.cookieJar.set(name, value);

    if (name === "__ddg2_") {
      this.cookie = `${name}=${value}`;
    }
  }

  private applyCookies(config: InternalAxiosRequestConfig): void {
    if (this.cookieJar.size === 0) {
      return;
    }

    const cookieString = [...this.cookieJar.entries(), config.headers["Cookie"]?.toString() || ""]
      .filter(Boolean)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");

    console.log("cookieString", cookieString);

    config.headers = new AxiosHeaders(config.headers);
    config.headers.set("Cookie", cookieString);
  }

  private async retryRequest(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.applyCookies(config);

    return this.client.request(config);
  }

  private getDefaultUserAgent(): string {
    // return (
    //   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    //   "AppleWebKit/537.36 (KHTML, like Gecko) " +
    //   "Chrome/120.0.0.0 Safari/537.36"
    // );

    return app.userAgentFallback;
  }
}
