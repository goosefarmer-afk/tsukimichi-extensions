import {
  resolveFilterEntries,
  type Chapter,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type GetSeriesStatus,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";

import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import manifest from "./manifest.json";
import { GenresFilter, SortFilter, StatusFilter } from "./filters";

export class HentaiReadIO extends BaseMangaScraper {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("/", this.baseUrl);
    url.searchParams.set("act", "search");
    url.searchParams.set("f[status]", "all");
    url.searchParams.set("f[sortby]", "top-manga");
    url.searchParams.set("pageNum", page.toString());

    const { data: html } = await this.client.get<string>(url.toString());

    return this.parseSearchManga(html);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("/", this.baseUrl);
    url.searchParams.set("act", "search");
    url.searchParams.set("f[status]", "all");
    url.searchParams.set("f[sortby]", "lastest-chap");
    url.searchParams.set("pageNum", page.toString());

    const { data: html } = await this.client.get<string>(url.toString());

    return this.parseSearchManga(html);
  };

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    const url = new URL("/", this.baseUrl);
    url.searchParams.set("act", "searchadvance");
    url.searchParams.set("pageNum", page.toString());

    if (query?.trim()) url.searchParams.set("f[keyword]", query.trim());

    let statusAdded = false;
    let sortAdded = false;

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          if (filter.key === SortFilter.key) {
            url.searchParams.set(filter.key, value);
            sortAdded = true;
          } else if (filter.key === StatusFilter.key) {
            url.searchParams.set(filter.key, value);
            statusAdded = true;
          }
          break;

        case "multi-select":
          if (value.length > 0) {
            value.forEach((v) => {
              url.searchParams.append(filter.key, v);
            });
          }
          break;

        default:
          break;
      }
    }

    if (!sortAdded) url.searchParams.set(SortFilter.key, SortFilter.defaultValue!);
    if (!statusAdded) url.searchParams.set(StatusFilter.key, StatusFilter.defaultValue!);

    console.log(decodeURIComponent(url.toString()));
    const { data: html } = await this.client.get<string>(url.toString());

    return this.parseSearchManga(html);
  };

  private parseSearchManga(html: string): SeriesListResponse<Manga> {
    const $ = cheerio.load(html, {
      baseURI: this.baseUrl,
    });

    const mangaMap = new Map<string, Manga>();

    $("div.card:has(.jtip)").each((_, el) => {
      const $el = $(el);

      const $anchor = $el.find(".title-manga a").first();
      const urlFromElement = $anchor.attr("href");
      if (!urlFromElement) return;

      const url = this.setUrlWithoutDomain(urlFromElement);

      if (mangaMap.has(url)) return;
      mangaMap.set(url, {
        title: $anchor.text().trim(),
        url,
        isNsfw: true,
        coverImageUrl: $el.find("img.card-img-top").first().prop("src") || null,
        status: "unknown",
      });
    });

    const hasMore = $('ul.pagination li.page-item a.page-link:contains("»")').length > 0;

    return {
      data: Array.from(mangaMap.values()),
      hasMore,
    };
  }

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html, {
      baseURI: this.baseUrl,
    });

    const title = $("h1.title-detail").first().text().trim();
    const authorsText = $(".author p.col-8").text().trim();
    const authors = authorsText.toLowerCase().includes("updating")
      ? []
      : authorsText
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);

    const alternateTitles = $("h2.other-name.col-8")
      .text()
      .trim()
      .split("/")
      .map((t) => t.trim())
      .filter(Boolean);

    const statusText = $(".status p.col-8").text().trim();
    const status = this.getSeriesStatus(statusText);

    const coverImageUrl = $(".col-image img").prop("src") || null;
    const description = $("#summary_shortened").text().trim().replaceAll("\n", "<br>");

    const genres = $(".kind p.col-8 a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const rating = this.toNumberOrNull($('span[itemprop="ratingValue"]').text().trim(), true);

    return {
      id: query,
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      authors,
      alternateTitles,
      status,
      isNsfw: null,
      coverImageUrl,
      description,
      genres,
      rating,
      url: query,
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html, {
      baseURI: this.baseUrl,
    });

    const chapters: Chapter[] = [];

    $("ul#list_chapter_id_detail li.wp-manga-chapter, ul.version-chap li.wp-manga-chapter").each(
      (_, el) => {
        const $el = $(el);

        const $anchor = $el.find("a").first();
        const urlFromElement = $anchor.attr("href");
        if (!urlFromElement) return;

        const url = this.setUrlWithoutDomain(urlFromElement);
        const title = $anchor.text().trim();
        const lastUpdated = this.parseSeriesDate(
          $el.find(".chapter-release-date").first().text().trim(),
        );

        chapters.push({
          title,
          url,
          lastUpdated,
          chapterNumber: this.toNumberOrNull(title.replace("Chapter ", ""), true),
        });
      },
    );

    return chapters.toReversed();
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html, {
      baseURI: this.baseUrl,
    });

    return $(".page-chapter img")
      .map((index, el) => {
        const $el = $(el);
        const urlFromElement = $el.prop("data-src") || $el.prop("src");
        if (!urlFromElement) return null;

        const url = new URL(urlFromElement, this.baseUrl).toString();

        return {
          url,
          index,
        };
      })
      .get()
      .filter((page) => page !== null);
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    input = input?.toLowerCase() || "";

    switch (true) {
      case ["complete", "completed"].includes(input):
        return "completed";
      case ["in process", "ongoing"].includes(input):
        return "ongoing";
      default:
        return "unknown";
    }
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [StatusFilter, SortFilter, GenresFilter],
  });
}
