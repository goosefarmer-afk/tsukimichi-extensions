import {
  resolveFilterEntries,
  type ExtensionClientConstructorOptions,
  type GetFilterConfig,
  type Manga,
  type MultiSelectFilter,
  type SelectFilter,
  type TextFilter,
} from "@tsukimichi/common";
import type { AxiosHeaders, AxiosRequestConfig, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { Madara } from "@/lib/multi-src/manga/madara";
import {
  TOONILY_ADULT_CONTENT_FILTER,
  TOONILY_GENRES,
  TOONILY_GENRES_CONDITION,
  TOONILY_ORDER_BY_OPTIONS,
  TOONILY_STATUS,
} from "./filters";
import manifest from "./manifest.json";

export class Toonily extends Madara {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override getFilterConfig: GetFilterConfig = () => {
    return {
      filters: [
        {
          key: "genre",
          label: "Select Genres",
          type: "multi-select",
          multiple: true,
          options: TOONILY_GENRES,
          renderAs: "checkbox-group",
        } as MultiSelectFilter,
        {
          key: "status",
          label: "Select Status",
          type: "multi-select",
          multiple: true,
          options: TOONILY_STATUS,
          renderAs: "select",
        } as MultiSelectFilter,
        {
          key: "op",
          label: "Genres Condition",
          type: "select",
          defaultValue: "0",
          options: TOONILY_GENRES_CONDITION,
        } as SelectFilter,
        {
          key: "adult",
          label: "Content Shown",
          type: "select",
          options: TOONILY_ADULT_CONTENT_FILTER,
          defaultValue: "all",
        } as SelectFilter,
        {
          key: "m_orderby",
          label: "Order By",
          type: "select",
          options: TOONILY_ORDER_BY_OPTIONS,
          defaultValue: "relevance",
        } as SelectFilter,
        {
          key: "author",
          label: "Author",
          type: "text",
          placeholder: "Enter author name...",
        } as TextFilter,
        {
          key: "artist",
          label: "Artist",
          type: "text",
          placeholder: "Enter artist name...",
        } as TextFilter,
      ],
    };
  };

  protected override parseSeriesDetails(html: string, url: URL, query: string): Manga {
    const details = super.parseSeriesDetails(html, url, query);
    const $ = cheerio.load(html);

    details.authors = $(".author-content a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    details.artists = $(".artist-content a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    details.genres = $(".genres-content a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const publishers = $('div.summary-heading:contains("Publisher") + .summary-content a')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    let description = "";

    $("div.summary__content p").each((_, element) => {
      description += `${$(element).text().trim()}<br>`;
    });

    if (publishers.length) description += `<br>Publishers: ${publishers.join(", ")}<br>`;

    details.description = description.replaceAll("\n", "<br>");

    return details;
  }

  protected override popularMangaRequest<T>(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1 } = options ?? {};

    const url = new URL(`search/page/${page}`, this.baseUrl);
    url.searchParams.set("post_type", "wp-manga");
    url.searchParams.set("m_orderby", "views");
    return this.client.get<T>(url.toString(), requestConfig);
  }

  protected override async searchMangaRequest(
    query?: string,
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    const { page = 1, filters } = options ?? {};
    const url = new URL(`search/page/${page}`, this.baseUrl);
    if (query?.trim()) url.searchParams.set("s", query.trim());
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
          url.searchParams.set(filter.key, value);
          if (value !== "all" && value !== "any") url.searchParams.set(filter.key, value);
          break;
        case "multi-select":
          value.forEach((v, i) => {
            url.searchParams.append(`${filter.key}[${i}]`, v?.toString());
          });

          break;
        default:
          break;
      }
    }

    return await this.client.get(url.toString(), {
      ...requestConfig,
      headers: this.headersBuilders({ searchOptions: options }),
    });
  }

  protected override async latestMangaRequest(
    options?: Record<string, any>,
    config?: AxiosRequestConfig,
  ) {
    const { page = 1 } = options ?? {};
    const url = new URL(`webtoons/page/${page}`, this.baseUrl);
    url.searchParams.set("m_orderby", "latest");

    return await this.client.get(url.toString(), {
      ...config,
      headers: this.headersBuilders({ searchOptions: options }),
    });
  }

  protected override get searchSeriesNextPageSelector(): string {
    return '.wp-pagenavi a[rel="next"]';
  }
  protected override get searchSeriesSelector(): string {
    return ".page-listing-item .page-item-detail";
  }
  protected override get mangaSubString(): string {
    return "serie";
  }

  protected override alternateTitleDelimiter = ",";

  protected override headersBuilders(options?: {
    headers?: AxiosHeaders;
    searchOptions?: Record<string, any>;
  }): AxiosHeaders {
    const headers = super.headersBuilders(options);
    headers.set("User-Agent", "Tsukimichi/1.0.0");
    headers.set(
      "Cookie",
      `toonily-mature=${options?.searchOptions?.filters?.includeNsfw ? "1" : "0"}`,
    );
    return headers;
  }
}
