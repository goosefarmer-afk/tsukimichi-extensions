import { AxiosHeaders, isAxiosError, type InternalAxiosRequestConfig, type Method } from "axios";

import { HttpError } from "@/errors/http-error";
import { getCookiesForExtension } from "@/lib/cookies";
import type { NetworkInterceptor } from "@/lib/network/types";

export class NHentaiAuthorizationInterceptor implements NetworkInterceptor {
  readonly name = "NHentaiAuthorizationInterceptor";

  constructor(
    private extensionId: string,
    private apiKey?: string,
  ) {}

  async onRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    if (!config.url) return config;

    const url = new URL(config.url);

    if (url.host !== this.NHENTAI_HOST || !this.API_PATH_REGEX.test(url.pathname)) {
      return config;
    }

    if (this.apiKey) {
      console.log("Adding API key");
      const headers = new AxiosHeaders(config.headers);
      headers.set("Authorization", `Key ${this.apiKey}`);
      headers.set("X-Api-Key-Used", "true");
      config.headers = headers;

      return config;
    }

    if (url.pathname.includes("/favorites")) {
      const accessToken = await this.getAccessToken();
      const headers = new AxiosHeaders(config.headers);
      if (accessToken) {
        headers.set("Authorization", `User ${accessToken}`);
      }

      config.headers = headers;
    }

    return config;
  }

  onResponseError(error: unknown): Promise<never> {
    if (isAxiosError(error)) {
      const { response, config } = error;
      const headers = config?.headers;

      if (response?.status === 401) {
        if (headers?.["X-Api-Key-Used"] === "true") {
          return Promise.reject(new Error("Invalid API key"));
        }
        return Promise.reject(
          new Error("Log in via BrowserWindow or add API key in the settings to view favorites"),
        );
      }

      return Promise.reject(
        new HttpError({
          method: (config?.method?.toString() as Method) ?? "GET",
          status: response?.status,
          statusText: error.message,
        }),
      );
    }

    if (Error.isError(error)) return Promise.reject(error);

    return Promise.reject(new Error(String(error)));
  }
  private async getAccessToken() {
    const cookies = await getCookiesForExtension(this.extensionId, {
      name: "access_token",
    });

    return cookies.filter((c) => c.domain?.includes(this.NHENTAI_HOST))?.[0]?.value || null;
  }

  private readonly API_PATH_REGEX = /^\/api\/v2\/.*$/;
  private readonly NHENTAI_HOST = "nhentai.net";
}
