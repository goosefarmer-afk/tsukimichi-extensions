import {
  resolveFilterEntries,
  type Chapter,
  type ChapterPage,
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
} from "@tsukimichi/common";
import type { AxiosHeaders } from "axios";
import * as cheerio from "cheerio";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import {
  WEEB_CENTRAL_ANIME_ADAPTION_OPTIONS,
  WEEB_CENTRAL_SERIES_TYPES,
  WEEB_CENTRAL_SORT_OPTIONS,
  WEEB_CENTRAL_SORT_ORDER_OPTIONS,
  WEEB_CENTRAL_STATUS_OPTIONS,
  WEEB_CENTRAL_TAG_OPTIONS,
  WEEB_CENTRAL_TRANSLATION_OPTIONS,
} from "./filters";
import manifest from "./manifest.json";

export class WeebCentral extends BaseMangaScraper {
  constructor(options?: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    const url = new URL("search/data", this.baseUrl);
    url.searchParams.set("limit", this.FETCH_LIMIT.toString());
    url.searchParams.set("offset", ((page - 1) * this.FETCH_LIMIT).toString());
    url.searchParams.set("display_mode", "Full Display");
    url.searchParams.set(
      "text",
      query?.trim()?.replace(this.EXCLUDED_SEARCH_CHARACTERS, " ") || "",
    );

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
            url.searchParams.append(filter.key, v);
          });

          break;
        default:
          break;
      }
    }

    const { data: html } = await this.client.get<string>(url.toString(), {
      headers: this.headersBuilders(),
    });

    const $ = cheerio.load(html);

    const mangaList: Manga[] = [];

    $("article > section > a").each((_, el) => {
      const $el = $(el);
      const coverImageUrl = this.sourceImg($el);
      const title = $el.find("div:not([class]):last-child").text().trim();
      const url = new URL($el.attr("href")!, this.baseUrl).pathname;

      mangaList.push({
        title,
        coverImageUrl,
        url,
        status: "unknown",
        isNsfw: null,
      });
    });

    let nextPage: number | null = null;
    const nextPageUrl = $("button").attr("hx-get");

    if (nextPageUrl) {
      const urlObj = new URL(nextPageUrl, this.baseUrl);
      const offset = urlObj.searchParams.get("offset");
      if (offset) {
        const offsetNum = this.toNumberOrNull(offset);
        if (offsetNum !== null) nextPage = Math.floor(offsetNum / this.FETCH_LIMIT) + 1;
      }
    }

    return {
      data: mangaList,
      hasMore: nextPage != null,
    };
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    return await this.searchSeries("", {
      ...options,
      filters: {
        includeNsfw: options?.filters?.includeNsfw,
        sort: "Popularity",
      },
    });
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    return await this.searchSeries("", {
      ...options,
      filters: {
        includeNsfw: options?.filters?.includeNsfw,
        sort: "Latest Updates",
      },
    });
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString(), {
      headers: this.headersBuilders(),
    });

    const $ = cheerio.load(html);

    const sections = $("section[x-data] > section");
    const $containerOne = sections.eq(0);
    const $containerTwo = sections.eq(1);

    const coverImageUrl = this.sourceImg($containerOne);

    const authors = $containerOne
      .find("ul > li:has(strong:contains(Author)) > span > a[href*='author']")
      .map((_, el) => $(el).text().trim())
      .get();

    const genres = $containerOne
      .find("ul > li:has(strong:contains(Tag),strong:contains(Type)) a[href*='included_tag']")
      .map((_, el) => $(el).text().trim())
      .get();

    const statusText = $containerOne
      .find("ul > li:has(strong:contains(Status)) > a[href*='included_status']")
      .first()
      .text()
      .trim();

    const status = this.getSeriesStatus(statusText);

    const isAdultContent = $containerOne
      .find("ul > li:has(strong:contains(Adult Content)) a[href*='adult']")
      .text()
      .includes("Yes");

    const title = $containerTwo.find("h1").first().text().trim();

    const descriptionParts: string[] = [];

    const description = $containerTwo
      .find("li:has(strong:contains(Description)) > p")
      .first()
      .text()
      .replace("NOTE: ", "<br/>NOTE: ")
      .trim();

    if (description) {
      descriptionParts.push(description);
    }

    // Related Series
    const relatedSeries = $containerTwo.find("li:has(strong:contains(Related Series)) li");

    if (relatedSeries.length > 0) {
      descriptionParts.push("<br/>Related Series(s):");
      relatedSeries.each((_, el) => {
        descriptionParts.push(`• ${$(el).text().trim()}`);
      });
    }

    const finalDescription = descriptionParts.join("<br/>");

    const alternateTitles = $containerTwo
      .find("li:has(strong:contains(Associated Name)) li")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    return {
      id: this.slugify(title),
      extensionId: this.extensionMetadata.id,
      source: this.name,
      title,
      coverImageUrl,
      url: url.pathname,
      status,
      isNsfw: isAdultContent,
      genres,
      authors,
      description: finalDescription,
      alternateTitles,
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(query, this.baseUrl);

    const segments = url.pathname.split("/").filter(Boolean);
    segments.splice(2, 1);
    segments.push("full-chapter-list");

    url.pathname = `/${segments.join("/")}`;

    const { data: html } = await this.client.get<string>(url.toString(), {
      headers: this.headersBuilders(),
      responseType: "text",
    });

    const chapters: Chapter[] = [];

    const $ = cheerio.load(html);

    const getGroupName = (color?: string) => {
      switch (color) {
        case "#d8b4fe":
          return "Official";
        case "#4C4D54":
          return "Unknown";
        default:
          return null;
      }
    };

    $("div[x-data] > a").each((_, el) => {
      const $el = $(el);

      const title = $el.find("span.flex > span").first().text().trim();
      const chapterNumber = this.toNumberOrNull(title.match(/\d+(\.\d+)?/)?.[0], true);
      const url = new URL($el.attr("href")!, this.baseUrl).href;

      const color = $("svg").first().attr("stroke");

      const lastUpdatedText = $("time[datetime]").attr("datetime")?.trim();

      chapters.push({
        title,
        url,
        lastUpdated: this.parseSeriesDate(lastUpdatedText),
        languageKey: "multi",
        groupName: getGroupName(color),
        chapterNumber,
      });
    });

    return this.addChapterNavigation(chapters);
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(`${query}/images`, this.baseUrl);
    url.searchParams.set("is_prev", "False");
    url.searchParams.set("reading_style", "long_strip");

    const { data: html } = await this.client.get<string>(url.toString(), {
      headers: this.headersBuilders(),
    });

    const $ = cheerio.load(html);

    const data: ChapterPage[] = [];

    $("section[x-data*='scrollDown'] > img").each((index, el) => {
      const $el = $(el);
      const src = $el.attr("src");
      if (src) {
        data.push({
          url: new URL(src, this.baseUrl).href,
          index,
        });
      }
    });

    return data;
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "included_status",
        label: "Series Status",
        options: WEEB_CENTRAL_STATUS_OPTIONS,
        multiple: true,
        type: "multi-select",
        renderAs: "select",
      },
      {
        key: "sort",
        label: "Sort",
        options: WEEB_CENTRAL_SORT_OPTIONS,

        type: "select",
        defaultValue: WEEB_CENTRAL_SORT_OPTIONS?.[0]?.value,
      },
      {
        key: "order",
        label: "Sort Order",
        options: WEEB_CENTRAL_SORT_ORDER_OPTIONS,

        type: "select",
        defaultValue: WEEB_CENTRAL_SORT_ORDER_OPTIONS?.[0]?.value,
      },
      {
        key: "official",
        label: "Official Translation",
        options: WEEB_CENTRAL_TRANSLATION_OPTIONS,

        type: "select",
        defaultValue: WEEB_CENTRAL_TRANSLATION_OPTIONS?.[0]?.value,
      },
      {
        key: "anime",
        label: "Anime Adaption",
        options: WEEB_CENTRAL_ANIME_ADAPTION_OPTIONS,

        type: "select",
        defaultValue: WEEB_CENTRAL_ANIME_ADAPTION_OPTIONS?.[0]?.value,
      },
      {
        key: "included_type",
        label: "Series Type",
        options: WEEB_CENTRAL_SERIES_TYPES,
        multiple: true,
        type: "multi-select",
        renderAs: "select",
      },
      {
        key: "included_tag",
        label: "Tags",
        options: WEEB_CENTRAL_TAG_OPTIONS,
        multiple: true,
        type: "multi-select",
        renderAs: "checkbox-group",
      },
    ],
  });

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "ongoing":
        return "ongoing";
      case "complete":
        return "completed";
      case "hiatus":
        return "hiatus";
      case "canceled":
        return "cancelled";
      default:
        return "unknown";
    }
  };

  protected override headersBuilders(): AxiosHeaders {
    const headers = super.headersBuilders();
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    return headers;
  }

  private sourceImg(el: cheerio.Cheerio<any>): string | null {
    let src =
      el.find("source").first().attr("srcset")?.replace("small", "normal") ||
      el.find("img").first().attr("src");

    if (src) {
      src = new URL(src, this.baseUrl).href;
    }

    return src || null;
  }

  private readonly EXCLUDED_SEARCH_CHARACTERS = /[!#:()]/;
  private readonly FETCH_LIMIT = 32;
}
