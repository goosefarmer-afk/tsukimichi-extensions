import {
  resolveFilterEntries,
  type ExtensionClientConstructorOptions,
  type GetFilterConfig,
  type Manga,
} from "@tsukimichi/common";
import type { AxiosHeaders, AxiosRequestConfig, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { Madara } from "@/lib/multi-src/manga/madara";
import {
  MANHWA_TOON_ME_GENRES,
  MANHWA_TOON_ME_GENRES_CONDITION,
  MANHWA_TOON_ME_ORDER_BY_OPTIONS,
  MANHWA_TOON_ME_STATUS,
} from "./filters";
import manifest from "./manifest.json";

export class ManhwaToonMe extends Madara {
  constructor(options?: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  protected override searchMangaRequest<T>(
    query?: string,
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1, filters } = options ?? {};
    const url = new URL(this.baseUrl);
    if (page > 1) url.pathname = `/page/${page}/`;
    url.searchParams.set("s", query?.trim() || "");
    url.searchParams.set("post_type", "wp-manga");

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "text":
          url.searchParams.set(filter.key, value);

          break;
        case "select":
          // Using value for "op" other than 1 breaks the search
          if (filter.key === "op" && value !== "1") continue;
          url.searchParams.set(filter.key, value?.toString());
          break;
        case "multi-select":
          value.forEach((v) => {
            url.searchParams.append(filter.key, v);
          });

          break;
        default:
          break;
      }
    }

    return this.client.get(url.toString(), {
      headers: this.headersBuilders(),
      ...requestConfig,
    });
  }

  protected override latestMangaRequest<T>(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1 } = options ?? {};

    const url = new URL(this.baseUrl);
    if (page > 1) url.pathname = `/page/${page}/`;
    url.searchParams.set("post_type", "wp-manga");
    url.searchParams.set("s", "");
    url.searchParams.set("m_orderby", "latest");
    return this.client.get(url.toString(), requestConfig);
  }

  protected override popularMangaRequest<T>(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1 } = options ?? {};

    const url = new URL(this.baseUrl);
    if (page > 1) url.pathname = `/page/${page}/`;
    url.searchParams.set("post_type", "wp-manga");
    url.searchParams.set("s", "");
    url.searchParams.set("m_orderby", "views");
    return this.client.get(url.toString(), requestConfig);
  }

  override getFilterConfig: GetFilterConfig = () => {
    return {
      filters: [
        {
          key: "status[]",
          label: "Select Status",
          type: "multi-select",
          multiple: true,
          options: MANHWA_TOON_ME_STATUS,
          renderAs: "select",
        },
        {
          key: "m_orderby",
          label: "Order By",
          type: "select",

          options: MANHWA_TOON_ME_ORDER_BY_OPTIONS,
        },
        {
          key: "op",
          label: "Genres Condition",
          type: "select",

          options: MANHWA_TOON_ME_GENRES_CONDITION,
        },
        {
          key: "author",
          label: "Author",
          type: "text",
          placeholder: "Enter author name...",
          defaultValue: "",
        },
        {
          key: "artist",
          label: "Artist",
          type: "text",
          placeholder: "Enter artist name...",
          defaultValue: "",
        },
        {
          key: "genre[]",
          label: "Select Genres",
          type: "multi-select",
          multiple: true,
          options: MANHWA_TOON_ME_GENRES,
          renderAs: "checkbox-group",
          description: "Multiple options can be selected",
        },
      ],
    };
  };

  protected override parseSeriesDetails(html: string, url: URL, query: string): Manga {
    const details = super.parseSeriesDetails(html, url, query);

    const $ = cheerio.load(html);

    const type = $("div.summary-heading:contains('Type') + .summary-content").text().trim();
    const prevGenres = details.genres || [];
    if (type && !prevGenres.includes(type)) prevGenres.push(type);
    details.genres = prevGenres;

    let description = "";

    const release = $('div.summary-heading:contains("Release") + .summary-content');
    if (release) description += `Release year: ${release.text().trim()}<br>`;

    const bookmarksNum = this.toNumberOrNull(
      $("div.add-bookmark div.action_detail span").text().trim().split("Users")[0],
    );

    if (bookmarksNum != null) description += `Bookmarks: ${bookmarksNum}<br>`;

    description += `<br>${$(this.seriesDetailsDescriptionSelector).text().trim()}`;

    details.description = description;

    return details;
  }

  protected override headersBuilders(options?: {
    headers?: AxiosHeaders;
    options?: Record<string, any>;
  }): AxiosHeaders {
    const includeNsfw = options?.options?.filters?.includeNsfw;
    const headers = super.headersBuilders(options);
    headers.set("Cookie", `wpmanga-adult=${includeNsfw ? "0" : "1"}`);
    return headers;
  }

  // protected override get mangaSubString(): string {
  //   return "manhwa";
  // }

  protected override get searchSeriesSelector(): string {
    return ".c-tabs-item .row.c-tabs-item__content";
  }

  protected override get searchSeriesNextPageSelector(): string {
    return "nav .nav-previous a";
  }

  protected override seriesDetailsGenreSelector = ".genres-content a";
  protected override seriesDetailsAlternateTitleSelector =
    ".post-content_item:has(h5:contains('Alternative')) .summary-content";
  protected override seriesDetailsDescriptionSelector =
    ".description-summary > .summary__content.show-more";

  protected override useNewChapterEndpoint = true;
}
