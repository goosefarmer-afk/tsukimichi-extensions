import type {
  Chapter,
  ExtensionClientConstructorOptions,
  GetChapterPages,
  GetLatestSeries,
  GetMangaChapters,
  GetPopularSeries,
  GetSeries,
  Manga,
  SearchSeries,
  SeriesListResponse,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";

import { BaseMangaScraper } from "@/generic/base-manga-scraper";

import manifest from "./manifest.json";

// TODO: add filters
export class MangaKatana extends BaseMangaScraper {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1 } = options ?? {};
    const pageNum = Math.max(page, 1);

    const url = new URL(`page/${pageNum}`, this.baseUrl);
    url.searchParams.set("search", query!);
    url.searchParams.set("search_by", "book_name");

    const { data: html } = await this.client.get<string>(url.toString());

    const result = this.#parseSearchResult(html);
    if (result?.data?.length > 0) return result;

    // When there's only one search result, MangaKatana sometimes redirects
    // directly to the manga details page instead of showing a search results page.
    // In this case, we parse the manga details and return it as a single result.
    const newResult = this.#parseManga(html);
    return {
      data: newResult ? [newResult] : [],
      hasMore: false,
    };
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());
    return this.#parseManga(html);
  };

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const chapters: Chapter[] = [];

    const $ = cheerio.load(html);

    const $chapter = $("table tbody tr");

    if (!$chapter.length) return [];

    $chapter.each((_, el) => {
      const $el = $(el);
      const titleFromEl = $el.find("a").text();
      const chapterNumber = this.toNumberOrNull(this.extractChapterNumber(titleFromEl), true);
      const url = $el.find("a").attr("href") || "";
      const lastUpdated = this.parseSeriesDate($el.find("td .update_time").text());

      chapters.push({
        title: chapterNumber ? `Chapter ${chapterNumber}` : titleFromEl,
        url,
        lastUpdated,
        languageKey: "en",
        groupName: null,
        volumeNumber: null,
        chapterNumber,
      });
    });

    return chapters.toReversed();
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const imageUrls: string[] = [];

    // Look for common manga reader array variable names
    const commonArrayNames = ["thzq", "ytaw", "images", "pages", "imageUrls"];

    for (const arrayName of commonArrayNames) {
      const regex = new RegExp(`var\\s+${arrayName}\\s*=\\s*\\[([^\\]]+)\\]`, "i");
      const match = html.match(regex);

      if (match) {
        const arrayContent = match[1];
        const urlMatches = arrayContent?.match(/'([^']+)'/g) || [];

        for (const urlMatch of urlMatches) {
          const imageUrl = urlMatch.replace(/'/g, "");
          if (
            imageUrl.includes(".jpg") ||
            imageUrl.includes(".jpeg") ||
            imageUrl.includes(".png") ||
            imageUrl.includes(".gif")
          ) {
            imageUrls.push(imageUrl);
          }
        }

        if (imageUrls.length > 0) {
          break;
        }
      }
    }

    return imageUrls.map((url, index) => ({ index, url }));
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};
    const pageNum = Math.max(page, 1);
    const url = new URL(`manga/page/${pageNum}`, this.baseUrl);
    url.searchParams.set("filter", "1");
    url.searchParams.set("order", "latest");

    const { data: html } = await this.client.get<string>(url.toString());

    return this.#parseSearchResult(html);
  };

  override getPopularSeries: GetPopularSeries<Manga> = () => {
    throw new Error("METHOD_NOT_IMPLEMENTED");
  };

  #parseSearchResult(html: string): SeriesListResponse<Manga> {
    const $ = cheerio.load(html);

    const $container = $("#book_list");

    if (!$container.length) return this.emptyListResponse();

    const mangaList: Manga[] = [];

    $container.find(".item").each((_, el) => {
      const $el = $(el);

      const $titleSelector = $el.find("h3");
      const urlFromElement = $titleSelector.find("a").attr("href");
      if (!urlFromElement) return;
      const title = $titleSelector.find("a").text();
      const description = $el.find(".summary").text().trim();
      const coverImageUrl = $el.find("a img").attr("src") || null;
      const statusText = $el.find(".status").text();

      const genres = $el
        .find(".genres a")
        .get()
        .map((el) => $(el).text().trim())
        .filter(Boolean);

      mangaList.push({
        title,
        url: this.setUrlWithoutDomain(urlFromElement),
        coverImageUrl,
        status: this.getSeriesStatus(statusText),
        isNsfw: genres?.length > 0 ? this.detectNsfw(title, description, genres) : null,
        genres,
      });
    });

    const lastPageHref = $(".uk-pagination li:last-child a.page-numbers").attr("href");
    const lastPage = lastPageHref
      ? Number.parseInt(
          new URL(lastPageHref, this.baseUrl).pathname.split("/")?.filter(Boolean)?.pop() || "1",
          10,
        )
      : 1;

    const currentPage =
      Number.parseInt($(".uk-pagination li.uk-active .current").text().trim(), 10) || 1;

    const hasMore = currentPage < lastPage;

    return {
      data: mangaList,
      hasMore,
    };
  }

  #parseManga(html: string): Manga | null {
    const $ = cheerio.load(html);

    const $container = $("#single_book");

    if (!$container.length) return null;

    const title = $container.find("h1.heading").text().trim();

    const alternateTitles = $container
      .find(".alt_name")
      .text()
      ?.split(";")
      .map((el) => el.trim())
      .filter(Boolean);

    const description = $container.find(".summary p").text().trim();

    const coverImageUrl = $container.find("img").attr("src") || null;

    const statusText = $container.find(".d-row-small .status").text();

    const genres = $container
      .find(".genres a")
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);

    const lastUpdated = this.parseSeriesDate($container.find(".updateAt").text().trim());

    const authors = $container
      .find(".authors a")
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);

    return {
      title,
      description,
      coverImageUrl,
      status: this.getSeriesStatus(statusText),
      genres,
      isNsfw: this.detectNsfw(title, description, genres),
      lastUpdated,
      alternateTitles,
      authors,
      url: this.setUrlWithoutDomain($('meta[property="og:url"]').attr("content") || ""),
      artists: authors,
    };
  }
}
