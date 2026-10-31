import type {
  Chapter,
  ChapterPage,
  ExtensionClientConstructorOptions,
  GetChapterPages,
  GetLatestSeries,
  GetMangaChapters,
  GetPopularSeries,
  GetSeries,
  GetSeriesStatus,
  GetSettingsFilters,
  Manga,
  Preferences,
  SearchSeries,
  SeriesListResponse,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";

import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import manifest from "./manifest.json";
import { StringUtils } from "@/utils/string";
import type { ChapterListResponse, DataWrapper, WrapperContent } from "./types";

export class Tapas extends BaseMangaScraper {
  private apiUrl: string;

  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();

    this.apiUrl = `https://story-api.${StringUtils.substringAfterLast(this.baseUrl, "/")}`;

    this.client.defaults.headers.common["Cookie"] =
      "brithDate=1990-01-01; adjustedBirthDate=1990-01-01";
    this.client.defaults.headers.common["Referer"] = "https://m.tapas.io";
    this.client.defaults.headers.common["User-Agent"] =
      '"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:105.0) Gecko/20100101 Firefox/105.0"';
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("cosmos/api/v1/landing/ranking", this.apiUrl);
    url.searchParams.set("category_type", "COMIC");
    url.searchParams.set("subtab_id", "17");
    url.searchParams.set("size", "25");
    url.searchParams.set("page", (page - 1).toString());

    const { data } = await this.client.get<DataWrapper<WrapperContent>>(url.toString());

    return this.parseMangaList(data);
  };

  private parseMangaList(response: DataWrapper<WrapperContent>): SeriesListResponse<Manga> {
    const mangas: Manga[] = [];

    for (const manga of response.data.items) {
      const cover = Object.values(manga?.assetProperty?.bookCoverImage ?? {}).at(0);
      const coverImageUrl = cover ? `${cover}.png` : null;

      mangas.push({
        title: manga.title,
        description: manga.description.replaceAll("\r", "").replaceAll("\n", "<br>").trim(),
        url: `/series/${manga.seriesId}`,
        coverImageUrl,
        isNsfw: manga.mature ?? null,
        status: "unknown",
      });
    }

    const hasMore = !(response.meta?.pagination.last ?? true);

    return {
      data: mangas,
      hasMore,
    };
  }

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("cosmos/api/v1/landing/genre", this.apiUrl);
    url.searchParams.set("category_type", "COMIC");
    url.searchParams.set("sort_option", "NEWEST_EPISODE");
    url.searchParams.set("subtab_id", "17");
    url.searchParams.set("size", "25");
    url.searchParams.set("page", (page - 1).toString());
    const { data } = await this.client.get<DataWrapper<WrapperContent>>(url.toString());

    return this.parseMangaList(data);
  };

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("search", this.baseUrl);
    url.searchParams.set("pageNumber", page.toString());
    url.searchParams.set("q", query ?? "");
    url.searchParams.set("t", "COMICS");

    const { data: html } = await this.client.get<string>(url.toString(), {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8",
      },
    });

    const $ = cheerio.load(html);

    const mangas: Manga[] = [];

    $(".search-item-wrap").each((_, el) => {
      const $el = $(el);
      const seriesId = $el
        .find(".item__thumb a, .title-section .title a")
        .first()
        .attr("data-series-id");
      if (!seriesId) return;

      const title =
        $el.find(".item__thumb img").first().attr("alt")?.trim() ||
        $el.find(".title-section .title a").text().trim();
      const coverImageUrl = $el.find(".item__thumb img, .thumb-wrap img").attr("src") || null;
      const description = $el
        .find(".desc.force.mbm")
        .first()
        .text()
        .replaceAll("\r", "")
        .replaceAll("\n", "<br>")
        .trim();

      mangas.push({
        coverImageUrl,
        description,
        isNsfw: null,
        title,
        status: "unknown",
        url: `/series/${seriesId}`,
      });
    });

    const hasMore = $("a[class*=paging__button--next]").first().length > 0;

    return {
      data: mangas,
      hasMore,
    };
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const id = this.toNumberOrNull(query.split("/").filter(Boolean).at(1));
    if (id == null) {
      throw new Error("Invalid series id");
    }

    const url = new URL(`/series/${id}/info`, this.baseUrl);

    const { data: html } = await this.client.get(url.toString(), {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8",
      },
    });
    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    const title = $(".info__right .title").first().text().trim();
    const coverImageUrl = $(".thumb.js-thumbnail img").first().prop("src") || null;
    let description = $(".description__body").first().text().trim();
    const type = $('.stats > a[href^="/static-landing/genre?category="]').text().trim();
    if (type) description += `<br><br>Type: ${type}`;

    const genres = new Set<string>();
    $(".genre-btn").each((_, el) => {
      const $el = $(el);
      genres.add($el.text().trim());
    });
    const statusText = $(".schedule-ico:has(.sp-ico-updated-line-pwt) + .schedule-label")
      .first()
      .text()
      .trim();

    return {
      id: query,
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      coverImageUrl,
      description,
      isNsfw: null,
      status: this.getSeriesStatus(statusText),
      url: query,
      genres: [...genres],
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    const chapters: Chapter[] = [];

    const showLocked = await this.showLockedChapters();
    const showScheduled = await this.showScheduledChapters();

    const fetchPage = async (page: number, promiseAll = false) => {
      if (page !== 1 && promiseAll) {
        await this.delay(200 * page);
      }

      const url = new URL(`${query}/episodes`, this.baseUrl);
      url.searchParams.set("page", page.toString());
      url.searchParams.set("sort", "OLDEST");
      url.searchParams.set("since", Date.now().toString());
      url.searchParams.set("large", "true");
      url.searchParams.set("last_access", "0");
      url.searchParams.set("", ""); // Same as the browser

      const { data } = await this.client.get<DataWrapper<ChapterListResponse>>(url.toString());

      return data.data;
    };

    const toChapters = (episodes: ChapterListResponse["episodes"]): Chapter[] => {
      const result: Chapter[] = [];

      for (const chapter of episodes) {
        const isPaywalledVisible = showLocked || chapter.unlocked || chapter.free;
        const isScheduledVisible = showScheduled || !chapter.scheduled;

        if (!isPaywalledVisible || !isScheduledVisible) {
          continue;
        }

        const title = chapter.unlocked || chapter.free ? chapter.title : `🔒 ${chapter.title}`;

        result.push({
          title,
          url: `/episode/${chapter.id}`,
          chapterNumber: chapter.scene,
          lastUpdated: this.parseSeriesDate(chapter.publish_date),
        });
      }

      return result;
    };

    // Fetch the first page to determine pagination details.
    const firstPage = await fetchPage(1);
    const firstPagination = firstPage.pagination;

    const pages: Chapter[][] = [];
    pages[0] = toChapters(firstPage.episodes);

    if (
      firstPagination?.total != null &&
      firstPagination.limit != null &&
      firstPagination.limit > 0
    ) {
      const totalPages = Math.ceil(firstPagination.total / firstPagination.limit);

      // Fetch remaining pages concurrently, preserving their page indexes.
      const requests = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);

      const results = await Promise.allSettled(requests.map((page) => fetchPage(page, true)));

      results.forEach((result, index) => {
        const pageIndex = requests[index]! - 1;

        if (result.status === "fulfilled") {
          pages[pageIndex] = toChapters(result.value.episodes);
        }
      });
    } else {
      // Fallback when pagination metadata is unavailable.
      let page = 2;
      let hasMore = firstPagination?.has_next === true;

      while (hasMore) {
        const data = await fetchPage(page++);
        pages[page - 2] = toChapters(data.episodes);
        hasMore = data.pagination?.has_next === true;
      }
    }

    // Flatten in page order, not request completion order.
    for (const pageChapters of pages) {
      if (pageChapters) {
        chapters.push(...pageChapters);
      }
    }

    return chapters;
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const { data: html } = await this.client.get(`${this.baseUrl}${query}`, {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8",
      },
    });
    const $ = cheerio.load(html, { baseURI: this.baseUrl });
    const isNovel = $('.toolbar a[data-type="style"]').length > 0;
    if (isNovel) {
      throw new Error("This is not a comic, but a novel chapter");
    }

    const pages = $("img.content__img")
      .map((index, el) => {
        const $el = $(el);
        const url = $el.attr("data-src") || $el.prop("src");
        if (!url) return null;

        return { index, url };
      })
      .get()
      .filter(Boolean) as ChapterPage[];

    return pages;
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    input = input?.toLowerCase();
    switch (true) {
      case input?.includes("updates"):
        return "ongoing";
      case input?.includes("completed"):
        return "completed";
      default:
        return "unknown";
    }
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_LOCKED_CHAPTER_VISIBILITY_KEY,
      label: "Show paywalled chapters",
      description:
        "Tapas requires login/payment for some chapters. Enable to always show paywalled chapters.<br>Hiding chapters with paid access will also hide scheduled chapters.",
      type: "toggle",
      defaultValue: this.PREF_LOCKED_CHAPTER_VISIBILITY_DEFAULT,
    },
    {
      key: this.PREF_SCHEDULED_CHAPTER_VISIBILITY_KEY,
      label: "Show scheduled chapters",
      description:
        "Scheduled chapters can be hidden from the chapter list by enabling this option.",
      type: "toggle",
      defaultValue: this.PREF_SCHEDULED_CHAPTER_VISIBILITY_DEFAULT,
    },
  ];

  private async showScheduledChapters() {
    return await this.$preferences.getBoolean(
      this.PREF_SCHEDULED_CHAPTER_VISIBILITY_KEY,
      this.PREF_SCHEDULED_CHAPTER_VISIBILITY_DEFAULT,
    );
  }

  private async showLockedChapters() {
    return await this.$preferences.getBoolean(
      this.PREF_LOCKED_CHAPTER_VISIBILITY_KEY,
      this.PREF_LOCKED_CHAPTER_VISIBILITY_DEFAULT,
    );
  }

  private PREF_LOCKED_CHAPTER_VISIBILITY_KEY = "pref_locked_chapter_visibility";
  private PREF_LOCKED_CHAPTER_VISIBILITY_DEFAULT = false;

  private PREF_SCHEDULED_CHAPTER_VISIBILITY_KEY = "pref_scheduled_chapter_visibility";
  private PREF_SCHEDULED_CHAPTER_VISIBILITY_DEFAULT = true;
}
