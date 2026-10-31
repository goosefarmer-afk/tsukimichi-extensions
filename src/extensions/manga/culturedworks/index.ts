import type {
  ExtensionClientConstructorOptions,
  GetFilterConfig,
  GetImage,
  MultiSelectFilter,
  SelectFilter,
} from "@tsukimichi/common";
import { MangaReader } from "@/lib/multi-src/manga/manga-reader";
import {
  CULTURED_WORKS_GENRES,
  CULTURED_WORKS_SERIES_TYPES,
  CULTURED_WORKS_SORT_ORDER_OPTIONS,
  CULTURED_WORKS_STATUSES,
} from "./filters";
import manifest from "./manifest.json";
export class CulturedWorks extends MangaReader {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "genre[]",
        label: "Genres",
        type: "multi-select",
        renderAs: "checkbox-group",
        options: CULTURED_WORKS_GENRES,
        multiple: true,
        description: "Filter by genre",
      } as MultiSelectFilter,
      {
        key: "status",
        label: "Status",
        type: "select",
        options: CULTURED_WORKS_STATUSES,

        description: "Filter by status",
      } as SelectFilter,
      {
        key: "type",
        label: "Type",
        type: "select",
        options: CULTURED_WORKS_SERIES_TYPES,

        description: "Filter by type",
      } as SelectFilter,
      {
        key: "order",
        label: "Sort Order",
        type: "select",
        options: CULTURED_WORKS_SORT_ORDER_OPTIONS,

        description: "Filter by order",
      } as SelectFilter,
    ],
  });

  override getImage: GetImage = async (url) => {
    const urlObj = new URL(url);

    const imageHeaders = this.getImageHeaders();

    // This doesn't load on the website, but removing referrer
    // seems to fix it
    if (urlObj.hostname.includes("kumacdn")) {
      imageHeaders.delete("Referer");
    } else {
      imageHeaders.set("Referer", `${this.baseUrl}/`);
    }

    const { data, headers } = await this.client.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      headers: imageHeaders,
    });

    if (!Buffer.isBuffer(data)) {
      throw new Error("Invalid image data");
    }

    const contentType = (headers["content-type"] as string | undefined) || "image/jpeg";

    return {
      data,
      contentType,
    };
  };
}
