import type { ExtensionClientConstructorOptions, GetImage, Manga } from "@tsukimichi/common";
import * as cheerio from "cheerio";
import { MangaBox } from "@/lib/multi-src/manga/manga-box";
import manifest from "./manifest.json";
import { AxiosHeaders, type AxiosResponseHeaders } from "axios";

export class MangaBats extends MangaBox {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override getImage: GetImage = async (imageUrl) => {
    const imageHeaders = super.getImageHeaders();
    imageHeaders.set("Referer", `${this.baseUrl}/`);

    let data: ArrayBuffer | null = null;
    const {
      data: arrayBuffer,
      headers: responseHeaders,
      status,
    } = await this.client.get(imageUrl, {
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
        } = await this.client.get(fallbackUrl.toString(), {
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

  protected override mangaSelectorFromListing = ".list-comic-item-wrap";

  protected override parseSeriesDetails(html: string, query: string): Manga {
    const manga = super.parseSeriesDetails(html, query);

    const $ = cheerio.load(html);

    const mainInfo = $(this.seriesDetailsMainSelector).first();

    const authors = mainInfo
      .find('li:contains("Author(s) :")')
      .text()
      .trim()
      .replace("Author(s) :", "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const alternateTitles = mainInfo
      .find(this.seriesDetailsAlternateTitlesSelector)
      .text()
      .trim()
      .replace("Alternative :", "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    manga.authors = authors;
    manga.alternateTitles = alternateTitles;

    return manga;
  }
}
