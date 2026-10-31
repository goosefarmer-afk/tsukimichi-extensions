import type {
  ExtensionClientConstructorOptions,
  GetImage,
  GetSettingsFilters,
  Preferences,
} from "@tsukimichi/common";
import { MangaBox } from "@/lib/multi-src/manga/manga-box";
import manifest from "./manifest.json";
import { AxiosHeaders, type AxiosInstance, type AxiosResponseHeaders } from "axios";
import { DispatcherLimiter } from "@/lib/network/interceptors/dispatcher-limiter";
import { RateLimiter } from "@/lib/network/interceptors/rate-limiter";
import { seconds } from "@/lib/network/network-helper";
import { ErrorNormalizer } from "@/lib/network/interceptors/error-normalizer";

export class MangaKakalot extends MangaBox {
  private imageClient: AxiosInstance;

  private dispatcher = new DispatcherLimiter({
    maxRequests: 8,
    maxRequestsPerHost: 3,
  });

  private limiter = new RateLimiter({
    maxRequests: 2,
    perMilliseconds: seconds(1),
  });

  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();

    this.imageClient = this.network
      .newBuilder()
      .addInterceptor(this.dispatcher)
      .addInterceptor(this.limiter)
      .addInterceptor(new ErrorNormalizer())
      .build();
  }

  override async init(): Promise<void> {
    await super.init();

    this.baseUrl = await this.$preferences.getString(this.PREFERRED_MIRROR_KEY, this.MIRRORS[0]!);
  }

  override getImage: GetImage = async (imageUrl) => {
    const imageHeaders = super.getImageHeaders();
    imageHeaders.set("Referer", `${this.baseUrl}/`);

    let data: ArrayBuffer | null = null;
    const {
      data: arrayBuffer,
      headers: responseHeaders,
      status,
    } = await this.imageClient.get(imageUrl, {
      headers: imageHeaders,
      responseType: "arraybuffer",
      // Reject on cf error code
      validateStatus: (status) => ![403].includes(status),
    });

    const headers = new AxiosHeaders(responseHeaders as AxiosResponseHeaders);
    const contentType = headers.get("Content-Type") as string | undefined;

    if (status === 200) {
      data = arrayBuffer;
      // Move working cdn to first
      this.cdnSet.moveItemToFirst(new URL(imageUrl).origin);
    } else {
      // Try fallback CDNs
      const originalUrl = new URL(imageUrl);

      for (const cdnUrl of this.cdnSet) {
        // Skip the original CDN that already failed
        if (cdnUrl === originalUrl.origin) continue;

        // Construct new URL with fallback CDN
        const fallbackUrl = new URL(`${originalUrl.pathname}${originalUrl.search}`, cdnUrl);

        const {
          data: fallbackData,
          headers: fallbackHeaders,
          status: fallbackStatus,
        } = await this.imageClient.get(fallbackUrl.toString(), {
          headers: imageHeaders,
          responseType: "arraybuffer",
          validateStatus: () => true,
        });

        if (fallbackStatus === 200) {
          data = fallbackData;
          // Move working CDN to first
          this.cdnSet.moveItemToFirst(cdnUrl);

          // Update content type from fallback response
          const fallbackAxiosHeaders = new AxiosHeaders(fallbackHeaders as AxiosResponseHeaders);
          const fallbackContentType = fallbackAxiosHeaders.get("Content-Type") as
            | string
            | undefined;

          return {
            data: fallbackData,
            contentType: fallbackContentType || "image/jpeg",
          };
        }
      }

      // If all CDNs fail, return the original failed response
      data = arrayBuffer;
    }

    return {
      data: data || arrayBuffer,
      contentType: contentType || "image/jpeg",
    };
  };

  private readonly MIRRORS = ["https://www.mangakakalot.gg", "https://www.mangakakalove.com"];

  private readonly PREFERRED_MIRROR_KEY = "preferredMirror";

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREFERRED_MIRROR_KEY,
      label: "Preferred Mirror",
      type: "select",
      options: this.MIRRORS.map((m) => ({
        label: new URL(m).hostname,
        value: m,
      })),
      defaultValue: this.MIRRORS[0]!,
    },
  ];
}
