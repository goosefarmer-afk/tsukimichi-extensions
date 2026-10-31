import {
  resolveFilterEntries,
  type Chapter,
  type GetChapterPages,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";
import type { AxiosResponse } from "axios";

import { BaseMangaScraper } from "@/generic/base-manga-scraper";

export class MangaReader extends BaseMangaScraper {
  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};
    const pageNumStr = Math.max(page, 1).toString();
    let endpoint = `page/${pageNumStr}`;

    if (!query?.trim()) endpoint = this.mangaSubString;

    const url = new URL(endpoint, this.baseUrl);

    if (query?.trim()) url.searchParams.set("s", query?.trim() || "");

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value);
          break;
        case "multi-select":
          value.forEach((v) => {
            if (v !== "any") url.searchParams.append(filter.key, v?.toString());
          });

          break;
        default:
          break;
      }
    }

    const { data: html } = await this.client.get<string>(url.toString());
    return this.#parseSeriesFromListing(html);
  };

  protected mangaDetailsRequest<T>(query: string): Promise<AxiosResponse<T>> {
    const url = new URL(query, this.baseUrl);
    return this.client.get(url.toString());
  }

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(`${query}`, this.baseUrl);
    const { data: html } = await this.mangaDetailsRequest<string>(url.toString());

    return this.mangaDetailsParse(html, query);
  };

  protected mangaDetailsParse(html: string, query: string): Manga {
    const $ = cheerio.load(html);

    const $container = $('article[itemscope="itemscope"]').first();

    if (!$container.length) throw new Error("Manga not found");

    const title = $container.find("h1.entry-title").text().trim();
    const alternateTitles = $container
      .find("span.alternative")
      .first()
      .text()
      .trim()
      .split("/")
      .filter(Boolean);
    const coverImageUrl = $container.find(".thumb img").first().attr("src") || null;
    const genres = $container
      .find(this.seriesDetailsGenresSelector)
      .map((_, el) => $(el).text())
      .get()
      .filter(Boolean);
    const description = $container.find(this.seriesDetailsDescriptionSelector).text().trim();

    const ratingText = $container.find(this.ratingSelector).text().trim();
    const statusText = $(this.seriesDetailsStatusSelector).first().text().trim();
    const authors = this.getOwnText($(this.seriesDetailsAuthorSelector).first())
      .trim()
      .split(",")
      .filter(Boolean);
    const artists = this.getOwnText($(this.seriesDetailsArtistSelector).first())
      .trim()
      .replaceAll("\t", "")
      .split(",")
      .filter(Boolean);

    const lastUpdatedText = $(".imptdt time[itemprop='dateModified']").attr("datetime");

    return {
      title,
      alternateTitles,
      coverImageUrl,
      genres,
      artists,
      authors,
      description,
      rating: this.getLargestNumber([ratingText]),
      status: this.getSeriesStatus(statusText),
      lastUpdated: this.parseSeriesDate(lastUpdatedText),
      url: query,
      isNsfw: this.detectNsfw(title, description, genres),
    };
  }

  protected chapterListRequest<T>(query: string): Promise<AxiosResponse<T>> {
    return this.mangaDetailsRequest<T>(query);
  }

  override getChapters: GetMangaChapters = async (query) => {
    const { data: html } = await this.chapterListRequest<string>(query);

    const chapters: Chapter[] = [];

    const $ = cheerio.load(html);
    $(this.chaptersSelector).each((_, el) => {
      const $el = $(el);
      const title = this.getOwnText($el.find(".lch a, .chapternum").first())
        .trim()
        .replace(/\s+/g, " ");
      const urlFromElement = $el.find("a").attr("href");
      if (!urlFromElement) return;
      const lastUpdated = $el.find(".chapterdate").text().trim();

      chapters.push({
        title,
        url: this.setUrlWithoutDomain(urlFromElement),
        languageKey: "en",
        lastUpdated: this.parseSeriesDate(lastUpdated),
        groupName: null,
        chapterNumber: this.getLargestNumber([$el.attr("data-num") || title]),
        volumeNumber: null,
      });
    });

    return this.addChapterNavigation(chapters?.reverse()) || [];
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString());
    const $ = cheerio.load(html);

    const scriptTag = $("script")
      .filter((_, el) => {
        const content = $(el).html() || "";
        return content.includes("ts_reader.run");
      })
      .first();

    const scriptContent = scriptTag.html();
    if (!scriptContent) throw new Error("No script content found");

    const jsonMatch = scriptContent.match(/ts_reader\.run\((\{.*?\})\);?/s);
    if (!jsonMatch?.[1]) throw new Error("Failed to extract chapter JSON");

    const chapterData = JSON.parse(jsonMatch[1]);
    const imageUrls: string[] = chapterData.sources?.[0]?.images?.filter(Boolean) || [];

    return imageUrls.map((url, index) => ({
      index,
      url,
    }));
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options || {};
    const pageNumStr = Math.max(page, 1).toString();
    const url = new URL(this.mangaSubString, this.baseUrl);
    url.searchParams.set(this.popularMangaParams.key, this.popularMangaParams.value);
    url.searchParams.set("page", pageNumStr);
    const { data: html } = await this.client.get<string>(url.toString());

    return this.#parseSeriesFromListing(html);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options || {};
    const pageNumStr = Math.max(page, 1).toString();
    const url = new URL(this.mangaSubString, this.baseUrl);
    url.searchParams.set(this.latestMangaParams.key, this.latestMangaParams.value);
    url.searchParams.set("page", pageNumStr);
    const { data: html } = await this.client.get<string>(url.toString());

    return this.#parseSeriesFromListing(html);
  };

  #parseSeriesFromListing(html: string): SeriesListResponse<Manga> {
    const $ = cheerio.load(html);
    const $seriesContainer = $(".listupd");
    if (!$seriesContainer.length) return this.emptyListResponse();

    const mangaList: Manga[] = [];

    $seriesContainer.find(".bs").each((_, el) => {
      const $el = $(el);
      const $anchor = $el.find("a").first();
      const urlFromElement = $anchor.attr("href");
      if (!urlFromElement) return;
      const title = $anchor.find(".tt").text()?.trim();
      const coverImageUrl = $anchor.find("img").attr("src")?.trim() || null;
      const rating = $el.find(this.ratingSelector).text()?.trim();
      const genres = $el
        .find(this.genresSelector)
        .get()
        .map((el) => $(el).text()?.trim());
      const statusText = $el.find(".status").text()?.trim();

      mangaList.push({
        title,
        coverImageUrl,
        url: this.setUrlWithoutDomain(urlFromElement),
        rating: rating ? Number.parseFloat(rating) : null,
        status: this.getSeriesStatus(statusText),
        isNsfw: genres?.length > 0 ? this.detectNsfw(title, "", genres) : null,
        genres,
      });
    });

    const hasMore = $(".hpage .r").length > 0;

    return {
      data: mangaList,
      hasMore,
    };
  }

  protected popularMangaParams = {
    key: "order",
    value: "popular",
  };
  protected latestMangaParams = {
    key: "order",
    value: "latest",
  };
  protected ratingSelector = ".rating-status .rating";
  protected mangaSubString = "manga";
  protected genresSelector = "a[href*='/genres/']";
  protected seriesDetailsGenresSelector = ".genres:first .genre-name";
  protected seriesDetailsStatusSelector = ".rating-status .status";
  protected seriesDetailsArtistSelector = ".imptdt:contains(Artist) i";
  protected seriesDetailsAuthorSelector = ".imptdt:contains(Author) i";
  protected seriesDetailsDescriptionSelector = ".desc, .entry-content[itemprop=description]";

  protected chaptersSelector =
    "div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)";

  protected latestChapterSelector = ".lastend a:nth-of-type(1)";
}
