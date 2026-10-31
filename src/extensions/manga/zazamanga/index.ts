import {
  resolveFilterEntries,
  type Chapter,
  type ExtensionClientConstructorOptions,
  type GetFilterConfig,
  type GetMangaChapters,
} from "@tsukimichi/common";
import type { AxiosHeaders, AxiosRequestConfig, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { Madara } from "@/lib/multi-src/manga/madara";
import {
  ZAZA_MANGA_GENRES_CONDITION_OPTIONS,
  ZAZA_MANGA_ORDER_BY_OPTIONS,
  ZAZA_MANGA_ORDER_GENRES_OPTIONS,
  ZAZA_MANGA_STATUS_OPTIONS,
} from "./filters";
import manifest from "./manifest.json";

export class ZazaManga extends Madara {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  protected override async searchMangaRequest<T>(
    query?: string,
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1, filters } = options ?? {};
    const url = new URL(this.baseUrl);
    url.searchParams.set("page", page.toString());
    if (query?.trim()) {
      url.searchParams.set("s", query);
    }
    url.searchParams.set("post_type", "wp-manga");

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          if (value !== "all" && value !== "any") url.searchParams.set(filter.key, value);
          break;
        case "multi-select":
          {
            if (value.length > 0) {
              const validValues = value.filter((v) => v !== "all" && v !== "any");
              if (validValues.length > 0) {
                for (const v of validValues) {
                  url.searchParams.append(filter.key, v);
                }
              }
            }
          }
          break;
        default:
          break;
      }
    }

    if (filters?.includeNsfw) {
      url.searchParams.set("adult", "1");
    } else {
      url.searchParams.set("adult", "0");
    }

    return await this.client.get(url.toString(), {
      headers: this.headersBuilders(),
      ...requestConfig,
    });
  }

  protected override async latestMangaRequest<T>(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1 } = options ?? {};

    const url = new URL(this.baseUrl);
    url.searchParams.set("s", "");
    url.searchParams.set("page", page.toString());
    url.searchParams.set("post_type", "wp-manga");
    url.searchParams.set("m_orderby", "latest");

    if (options?.filters?.includeNsfw) {
      url.searchParams.set("adult", "1");
    } else {
      url.searchParams.set("adult", "0");
    }

    return await this.client.get(url.toString(), requestConfig);
  }

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(`${this.mangaSubString}${query}`, this.baseUrl);

    const { data: html } = await this.client.get(url.toString(), {
      headers: this.headersBuilders(),
    });

    const $ = cheerio.load(html);

    const chapters: Chapter[] = [];

    $("div.wp-manga-chapter").each((_, el) => {
      const $el = $(el);
      const $anchor = $el.find("a");
      const title = $anchor.text().trim();
      const url = $anchor.attr("href")!;
      const chapterNumberStr = title.replace("Chapter ", "");

      chapters.push({
        title,
        url: this.setUrlWithoutDomain(url).replace(`/${this.mangaSubString}`, ""),
        languageKey: "en",
        chapterNumber: this.toNumberOrNull(chapterNumberStr, true),
      });
    });

    return this.addChapterNavigation(chapters);
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "orderby",
        label: "Order by",
        type: "select",
        options: ZAZA_MANGA_ORDER_BY_OPTIONS,
      },
      {
        key: "status[]",
        label: "Status",
        type: "multi-select",
        options: ZAZA_MANGA_STATUS_OPTIONS,
        renderAs: "select",
        multiple: true,
      },
      {
        key: "op",
        label: "Genres Condition",
        options: ZAZA_MANGA_GENRES_CONDITION_OPTIONS,
        type: "select",
      },
      {
        key: "genre[]",
        label: "Genres",
        type: "multi-select",
        options: ZAZA_MANGA_ORDER_GENRES_OPTIONS,
        multiple: true,
        renderAs: "checkbox-group",
      },
    ],
  });

  protected override headersBuilders(): AxiosHeaders {
    const headers = super.headersBuilders();
    const url = new URL(this.baseUrl);
    headers.set("Referer", `${url.protocol}//www.${url.host}/`);
    return headers;
  }

  protected override get searchSeriesSelector(): string {
    return "div.page-item-detail:not(.manga)";
  }
  protected override get searchSeriesUrlSelector(): string {
    return "p.widget-title a";
  }

  protected override get searchSeriesNextPageSelector(): string {
    return ".pagination li:last-child:not(.disabled) > a";
  }
  protected override get popularSeriesNextPageSelector(): string {
    return this.searchSeriesNextPageSelector;
  }
  protected override get latestSeriesNextPageSelector(): string {
    return this.searchSeriesNextPageSelector;
  }

  protected override seriesDetailsAlternateTitleSelector =
    ".summary-heading:contains(Alternative:) + .summary-content";
  protected override seriesDetailsStatusSelector = ".summary-heading:Contains(Status:) + div";
  protected override seriesDetailsDescriptionSelector =
    ".description-summary > .summary__content.show-more";
  protected override seriesDetailsGenreSelector = ".tags a[href*='manga-genre']";

  protected override alternateTitleDelimiter = ";";
}
