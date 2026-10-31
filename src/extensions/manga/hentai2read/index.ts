import type {
  Chapter,
  ExtensionClientConstructorOptions,
  GetChapterPages,
  GetFilterConfig,
  GetLatestSeries,
  GetMangaChapters,
  GetPopularSeries,
  GetSeries,
  GetSeriesStatus,
  Manga,
  SearchSeries,
  SeriesListResponse,
  TriStateFilterValue,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";
import { serialize } from "php-serialize";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import {
  ARTIST_NAME_SELECT_OPTIONS,
  CATEGORY_OPTIONS,
  CHARACTER_NAME_SELECT_OPTIONS,
  MANGA_NAME_SELECT_OPTIONS,
  SORT_ORDER_OPTIONS,
} from "./filters";
import manifest from "./manifest.json";

export class Hentai2Read extends BaseMangaScraper {
  private readonly IMAGE_BASE_URL = "https://static.hentaicdn.com/hentai";

  constructor(options?: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};
    const url = new URL(`hentai-list/all/any/all/most-popular/${page}`, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    return this.parsePopularSeries({
      html,
      selector: this.popularSeriesSelector,
      nextPageSelector: this.popularSeriesSelectorNextPage,
    });
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};
    const url = new URL(`hentai-list/all/any/all/last-updated/${page}`, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    return this.parsePopularSeries({
      html,
      selector: this.latestSeriesSelector,
      nextPageSelector: this.latestSeriesSelectorNextPage,
    });
  };

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};
    const url = this.buildGETSearchUrl({ query, filters: filters ?? {}, page });
    console.log("Search url", url);
    const response = await this.client.get(url);

    return this.parsePopularSeries({
      html: response.data,
      selector: this.searchSeriesSelector,
      nextPageSelector: this.searchSeriesSelectorNextPage,
    });
  };

  private buildGETSearchUrl(options: {
    query: string | undefined;
    filters: Record<string, any>;
    page: number;
  }): string {
    const { query, filters, page } = options;

    const filterObj: Record<string, any> = {};

    // manga name
    filterObj["nme"] = query?.trim() || "";
    filterObj["name_opr"] = filters[this.MANGA_NAME_SELECT_KEY] ?? "0";

    // artist
    filterObj["ats"] = filters[this.ARTIST_NAME_KEY] ?? "";
    filterObj["ats_opr"] = filters[this.ARTIST_NAME_SELECT_KEY] ?? "0";

    // character
    filterObj["chr"] = filters[this.CHARACTER_NAME_KEY] ?? "";
    filterObj["chr_opr"] = filters[this.CHARACTER_NAME_SELECT_KEY] ?? "0";

    // release year
    filterObj["rls_yer"] = filters[this.RELEASE_YEAR_KEY] ?? "";
    filterObj["rls_yer_opr"] = filters[this.RELEASE_YEAR_SELECT_KEY] ?? "0";

    // status
    filterObj["sts"] = filters[this.STATUS_KEY] ?? "0";

    const tagFilter = filters[this.TAG_LIST_KEY];
    const categoryFilter = filters[this.CATEGORY_LIST_KEY];

    const inc: Set<string> = new Set();
    const exc: Set<string> = new Set();

    if (Array.isArray(tagFilter)) {
      for (const tag of tagFilter as TriStateFilterValue[])
        if (tag.state === "include") inc.add(tag.value?.toString());
        else if (tag.state === "exclude") exc.add(tag.value?.toString());
    }

    if (Array.isArray(categoryFilter)) {
      for (const category of categoryFilter as TriStateFilterValue[])
        if (category.state === "include") inc.add(category.value?.toString());
        else if (category.state === "exclude") exc.add(category.value?.toString());
    }

    filterObj["tag"] = {
      inc: Array.from(inc),
      exc: Array.from(exc),
      mde: filters[this.TAG_SEARCH_MODE_KEY] ?? "and",
    };

    const serialized = serialize(filterObj);
    const encoded = Buffer.from(serialized).toString("base64");

    const sort = filters[this.SORT_ORDER_KEY] ?? "name-az";

    return `${this.baseUrl}/hentai-list/advanced-search/${encoded}/all/${sort}/${page}`;
  }

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html, {
      baseURI: this.baseUrl,
    });

    const $info = $("ul.list-simple-mini").first();

    const title = $("h3.block-title > a").first().text().trim();
    const status = this.getSeriesStatus($info.find("li:contains(Status) > a").text().trim());
    const authors = $info
      .find("li:contains(Author) > a")
      .get()
      .map((el) => this.getOwnText($(el)))
      .filter(Boolean);
    const artists = $info
      .find("li:contains(Artist) > a")
      .get()
      .map((el) => this.getOwnText($(el)))
      .filter(Boolean);
    const genres = $info
      .find("li:contains(Category) > a, li:contains(Content) > a")
      .get()
      .map((el) => this.getOwnText($(el)))
      .filter(Boolean);

    const alternateTitleText = $info.find("li").first().text().trim();
    const alternateTitles =
      alternateTitleText === "-"
        ? []
        : alternateTitleText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);

    const coverImageUrl = $("a#js-linkNext img").prop("src") || null;

    let description = "";

    description += $info.find("li:contains(Storyline) > p").text().trim();

    if (description.length > 0) description += "<br><br>";

    const sections = ["Parody", "Page", "Character", "Language"];

    for (const section of sections) {
      $info.find(`li:contains(${section}) a`).each((_, el) => {
        const $el = $(el);
        const text = this.getOwnText($el);
        if (text.trim() && text !== "-") description += `${section}: ${text}<br><br>`;
      });
    }

    return {
      id: query,
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      url: this.setUrlWithoutDomain(query),
      coverImageUrl,
      status,
      genres,
      authors,
      artists,
      alternateTitles,
      description,
      isNsfw: null,
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const chapters: Chapter[] = [];

    $("ul.nav-chapters > li > div.media > a").each((_, el) => {
      const $el = $(el);
      const urlFormElement = $el.attr("href");
      if (!urlFormElement) return;

      const title = this.getOwnText($el);

      const chapterNumStr = title.slice(0, title.indexOf("-"));
      const chapterNumber = this.toNumberOrNull(chapterNumStr.match(/\d+(\.\d+)?/)?.[0], true);

      chapters.push({
        title,
        languageKey: "en",
        url: this.setUrlWithoutDomain(urlFormElement),
        chapterNumber,
      });
    });

    return chapters;
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const raw = html.match(this.pagesUrlRegex)?.[1] || "";

    return raw.split('","').map((url, index) => ({
      url: this.IMAGE_BASE_URL + url.replace(/^"|"$/g, "").replace(/\\\//g, "/"),
      index,
    }));
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: this.SORT_ORDER_KEY,
        label: "Order",
        type: "select",

        options: SORT_ORDER_OPTIONS,
        defaultValue: SORT_ORDER_OPTIONS[0]?.value,
      },
      {
        key: this.STATUS_KEY,
        type: "select",

        label: "Status",
        options: ["Any", "Completed", "Ongoing"].map((s, i) => ({
          label: s,
          value: i.toString(),
        })),
        defaultValue: "0",
      },
      {
        key: this.MANGA_NAME_SELECT_KEY,
        label: "Manga name",
        type: "select",

        options: MANGA_NAME_SELECT_OPTIONS,
        defaultValue: MANGA_NAME_SELECT_OPTIONS[0]?.value,
      },
      {
        key: this.ARTIST_NAME_KEY,
        type: "text",
        label: "Artist",
        placeholder: "Artist name",
        defaultValue: "",
      },
      {
        key: this.ARTIST_NAME_SELECT_KEY,
        type: "select",
        label: "Artist name",

        options: ARTIST_NAME_SELECT_OPTIONS,
        defaultValue: ARTIST_NAME_SELECT_OPTIONS[0]?.value,
      },
      {
        key: this.CHARACTER_NAME_KEY,
        type: "text",
        label: "Character",
        placeholder: "Character name",
        defaultValue: "",
      },
      {
        key: this.CHARACTER_NAME_SELECT_KEY,
        type: "select",
        label: "Character name",

        options: CHARACTER_NAME_SELECT_OPTIONS,
        defaultValue: CHARACTER_NAME_SELECT_OPTIONS[0]?.value,
      },
      {
        key: this.RELEASE_YEAR_KEY,
        type: "text",
        label: "Release year",
        defaultValue: "",
      },
      {
        key: this.RELEASE_YEAR_SELECT_KEY,
        type: "select",

        label: "Release year",
        options: ["In", "Before", "After"].map((s, i) => ({
          label: s,
          value: i.toString(),
        })),
        defaultValue: "0",
      },
      {
        key: this.TAG_SEARCH_MODE_KEY,
        type: "select",
        label: "Tag search mode",

        options: ["AND", "OR"].map((v) => ({
          label: v,
          value: v.toLowerCase(),
        })),
        defaultValue: "and",
      },
      {
        key: this.CATEGORY_LIST_KEY,
        multiple: true,
        type: "tri-state-checkbox",
        options: CATEGORY_OPTIONS,
        label: "Categories",
      },
      {
        key: this.TAG_LIST_KEY,
        multiple: true,
        type: "tri-state-checkbox",
        options: [],
        label: "Tags",
      },
    ],
  });

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input) {
      case "Ongoing":
        return "ongoing";
      case "Completed":
        return "completed";
      default:
        return "unknown";
    }
  };

  private parsePopularSeries(options: {
    html: string;
    selector: string;
    nextPageSelector: string;
  }): SeriesListResponse<Manga> {
    const { html, selector } = options;

    const $ = cheerio.load(html, {
      baseURI: this.baseUrl,
    });

    const mangaList: Manga[] = [];

    $(selector).each((_, el) => {
      const $el = $(el);

      const $anchor = $el.find("div.overlay-title a").first();
      const urlFromElement = $anchor.prop("href");

      if (!urlFromElement) return;

      const coverImageUrl = $el.find("img").prop("src") || null;

      mangaList.push({
        title: $anchor.text().trim(),
        url: new URL(urlFromElement, this.baseUrl).pathname,
        isNsfw: null,
        status: "unknown",
        coverImageUrl,
      });
    });

    const hasMore = $(this.popularSeriesSelectorNextPage).length > 0;

    return {
      data: mangaList,
      hasMore,
    };
  }

  private readonly popularSeriesSelector = "div.book-grid-item";
  private readonly popularSeriesSelectorNextPage = "a#js-linkNext";

  private readonly latestSeriesSelector = this.popularSeriesSelector;
  private readonly latestSeriesSelectorNextPage = this.popularSeriesSelectorNextPage;

  private readonly searchSeriesSelector = this.popularSeriesSelector;
  private readonly searchSeriesSelectorNextPage = this.popularSeriesSelectorNextPage;

  private readonly pagesUrlRegex = /'images'\s*:\s*\["(.*?)[,]?"\]/;

  private readonly MANGA_NAME_SELECT_KEY = "mangaNameSelect";
  private readonly ARTIST_NAME_SELECT_KEY = "artistNameSelect";
  private readonly CHARACTER_NAME_SELECT_KEY = "characterNameSelect";
  private readonly RELEASE_YEAR_SELECT_KEY = "releaseYearSelect";
  private readonly TAG_SEARCH_MODE_KEY = "tagSearchMode";
  private readonly STATUS_KEY = "status";
  private readonly SORT_ORDER_KEY = "sort";

  private readonly ARTIST_NAME_KEY = "artistName";
  private readonly CHARACTER_NAME_KEY = "characterName";
  private readonly RELEASE_YEAR_KEY = "releaseYear";

  private readonly TAG_LIST_KEY = "tags";
  private readonly CATEGORY_LIST_KEY = "categories";
}
