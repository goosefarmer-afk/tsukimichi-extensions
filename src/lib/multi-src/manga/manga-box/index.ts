import {
  resolveFilterEntries,
  type GetChapterPages,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import type { AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import {
  MANGA_BOX_GENRE_OPTIONS,
  MANGA_BOX_SORT_OPTIONS,
  MANGA_BOX_STATUS_OPTIONS,
} from "./filters";
import { BetterSet } from "@/utils/set";

export class MangaBox extends BaseMangaScraper {
  protected cdnSet = new BetterSet<string>();

  // Helper to get image URL with fallbacks
  #getImageUrl($img: cheerio.Cheerio<any>): string | null {
    return $img.attr("data-src") || $img.attr("src") || null;
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    let url: URL;

    if (query?.trim()) {
      url = new URL(`search/story/${encodeURIComponent(query)}`, this.baseUrl);

      url.searchParams.set("page", page.toString());
    } else {
      url = new URL("genre", this.baseUrl);

      url.searchParams.set("page", page.toString());

      for (const { type, value, filter } of resolveFilterEntries(
        filters,
        this.getFilterConfig().filters,
      )) {
        switch (type) {
          case "text":
            if (value.trim()) {
              url.searchParams.set(filter.key, value);
            }
            break;
          case "select":
            if (filter.key === "genre") url.pathname += `/${value}`;
            else url.searchParams.set(filter.key, value);
            break;
          case "multi-select":
            if (Array.isArray(value) && value.length) {
              value.forEach((v) => {
                url.searchParams.append(filter.key, v);
              });
            }
            break;
          default:
            break;
        }
      }
    }

    const { data: html } = await this.client.get<string>(url.toString());
    return this.#parseSearchResultFromQuery(html);
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data: html } = await this.client.get(url.toString());

    return this.parseSeriesDetails(html, query);
  };

  protected parseSeriesDetails(html: string, query: string): Manga {
    const $ = cheerio.load(html, {
      baseURI: this.baseUrl,
    });

    const mainInfo = $(this.seriesDetailsMainSelector).first();

    const manga: Manga = {
      url: query,
      isNsfw: null,
      coverImageUrl: null,
      status: "unknown",
      title: "",
    };

    manga.authors = [];
    manga.tags = [];
    manga.genres = [];
    manga.artists = [];
    manga.alternateTitles = [];

    if (mainInfo) {
      manga.title = mainInfo.find("h1, h2").first().text().trim();

      manga.genres = mainInfo
        .find("li.genres a")
        .get()
        .map((el) => $(el).text().trim())
        .filter(Boolean);

      manga.status = this.getSeriesStatus(
        mainInfo.find("li:contains('Status')").text().toLowerCase().replace("status :", "")?.trim(),
      );

      const ratingStr = mainInfo.find("li em:contains('rate :')").text()?.split("/")?.[0];
      manga.rating = this.toNumberOrNull(ratingStr, true);

      manga.lastUpdated = this.parseSeriesDate(
        mainInfo.find("li:contains('Last updated')").text().replace("Last updated :", "").trim(),
      );
    } else {
      throw new Error("Manga not found");
    }

    manga.alternateTitles = $(this.seriesDetailsAlternateTitlesSelector)
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);

    let description = $(this.seriesDetailsDescriptionSelector).text().trim();
    description = description
      .replace(new RegExp(`^${manga.title} summary:\\s`), "")
      .replace(/<[^>]*>/g, "")
      .trim();

    manga.description = description;

    manga.coverImageUrl = $(this.seriesDetailsCoverSelector).prop("src") || null;

    return manga;
  }

  override getChapters: GetMangaChapters = async (query) => {
    const parts = query.split("/").filter(Boolean);
    const slug = parts.at(-1);

    if (!slug) throw new Error("Invalid manga slug");

    const { data: result } = await this.chapterListRequest<ChapterListApiResponse>(slug);
    if (!result.success) return [];

    return result.data.chapters.reverse().map((c) => ({
      id: c.chapter_slug,
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title: c.chapter_name,
      chapterNumber: c.chapter_num,
      url: `/manga/${slug}/${c.chapter_slug}`,
      languageKey: "multi",
      lastUpdated: this.parseSeriesDate(c.updated_at),
    }));
  };

  protected async chapterListRequest<T>(slug: string): Promise<AxiosResponse<T>> {
    const url = new URL(`api/manga/${slug}/chapters`, this.baseUrl);
    url.searchParams.set("limit", "-1");

    return await this.client.get(url.toString());
  }

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    // Try to extract chapterImages and cdns from <script>
    const scriptContent = $('script:contains("var chapterImages")').html() || "";
    const chapterImagesMatch = scriptContent.match(/var chapterImages\s*=\s*(\[[^\]]*\])/);
    const cdnsMatch = scriptContent.match(/var cdns\s*=\s*(\[[^\]]*\])/);

    let images: string[] = [];

    if (chapterImagesMatch?.[1] && cdnsMatch?.[1]) {
      try {
        const chapterImages: string[] = JSON.parse(chapterImagesMatch[1].replace(/\\/g, ""));
        const cdns: string[] = JSON.parse(cdnsMatch[1].replace(/\\/g, ""));

        if (cdns?.length > 0 && chapterImages.length > 0) {
          this.cdnSet.addAll(cdns);
          const baseCdn = cdns?.[0]?.replace(/\/$/, "");

          images = chapterImages.map((path) => `${baseCdn}/${path}`);
        }
      } catch (e) {
        console.warn("Error parsing chapterImages or cdns:", e);
      }
    }

    // Fallback to HTML scraping if no script-based images
    if (!images.length) {
      images = $(".container-chapter-reader > img")
        .get()
        .map((el) => $(el).attr("src"))
        .filter((src): src is string => !!src);
    }

    return images.map((url, index) => ({
      index,
      url,
    }));
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("manga-list/latest-manga", this.baseUrl);
    url.searchParams.set("page", page.toString());

    const { data: html } = await this.client.get<string>(url.toString());

    return this.parseSearchResultsFromListing(html);
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("manga-list/hot-manga", this.baseUrl);
    url.searchParams.set("page", page.toString());

    const { data: html } = await this.client.get<string>(url.toString());

    return this.parseSearchResultsFromListing(html);
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "type",
        label: "Sort",
        type: "select",

        options: MANGA_BOX_SORT_OPTIONS,
        defaultValue: MANGA_BOX_SORT_OPTIONS[0]?.value,
      },
      {
        key: "state",
        label: "Status",
        type: "select",

        options: MANGA_BOX_STATUS_OPTIONS,
        defaultValue: MANGA_BOX_STATUS_OPTIONS[0]?.value,
      },
      {
        key: "genre",
        label: "Genre",
        type: "select",

        options: MANGA_BOX_GENRE_OPTIONS,
        defaultValue: MANGA_BOX_GENRE_OPTIONS[0]?.value,
      },
    ],
  });

  // When user types something in the search bar
  #parseSearchResultFromQuery(html: string): SeriesListResponse<Manga> {
    const $ = cheerio.load(html);

    const mangaLists: Manga[] = [];

    $(".panel_story_list .story_item").each((_, element) => {
      const $el = $(element);
      const $link = $el.find(".story_name a");
      const urlFromElement = $link.attr("href");
      if (!urlFromElement) return;

      const title = $link.text().trim();

      mangaLists.push({
        title,
        coverImageUrl: this.#getImageUrl($el.find("img")),
        isNsfw: null,
        status: "unknown",
        url: this.setUrlWithoutDomain(urlFromElement),
      });
    });

    return {
      data: mangaLists,
      hasMore: this.#getPagination(html, "search").hasMore,
    };
  }

  protected parseSearchResultsFromListing(html: string): SeriesListResponse<Manga> {
    const $ = cheerio.load(html);

    const mangaLists: Manga[] = [];

    $(this.mangaSelectorFromListing).each((_, el) => {
      const $el = $(el);
      const $anchor = $el.find("h3 a");
      const $img = $el.find("img");
      const title = $anchor.text().trim();
      const urlFromElement = $anchor.attr("href");
      if (!urlFromElement || urlFromElement === "#") return;

      mangaLists.push({
        title,
        coverImageUrl: this.#getImageUrl($img),
        isNsfw: null,
        status: "unknown",
        url: this.setUrlWithoutDomain(urlFromElement),
      });
    });

    return {
      data: mangaLists,
      hasMore: this.#getPagination(html, "listing").hasMore,
    };
  }

  // TODO: fix
  #getPagination(html: string, type: "search" | "listing" = "listing") {
    const $ = cheerio.load(html);

    const lastPageHref = $(".group_page a.page_last").attr("href");
    const lastPage = lastPageHref
      ? Number.parseInt(new URL(lastPageHref, this.baseUrl).searchParams.get("page") || "1", 10)
      : 1;

    const pageSelector = type === "listing" ? "a.page_select" : "div.page_select";
    const currentPage = Number.parseInt($(`.group_page ${pageSelector}`).text().trim(), 10) || 1;

    const hasMore = currentPage < lastPage;

    return {
      hasMore,
    };
  }

  protected mangaSelectorFromListing =
    ":is(div.truyen-list > div.list-truyen-item-wrap, div.comic-list > .list-comic-item-wrap):has(a[data-id])";

  protected seriesDetailsDescriptionSelector =
    "div#noidungm, div#panel-story-info-description, div#contentBox";
  protected seriesDetailsMainSelector = "div.manga-info-top, div.panel-story-info";
  protected seriesDetailsAlternateTitlesSelector =
    ".story-alternative, tr:has(.info-alternative) h2";
  protected seriesDetailsCoverSelector = "div.manga-info-pic img, span.info-image img";
}

interface ChapterListApiResponse {
  success: boolean;
  data: {
    chapters: {
      chapter_name: string;
      chapter_slug: string;
      chapter_num: number;
      updated_at: string;
    }[];
    pagination: {
      has_more: boolean;
    };
  };
}
