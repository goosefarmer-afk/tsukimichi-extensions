import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import {
  resolveFilterEntries,
  type Chapter,
  type GetChapterPages,
  type GetFilterConfig,
  type GetImage,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";

import type { ChapterListResponse, NextJsPageProps, SearchResponse } from "./types";
import {
  AuthorFilter,
  ContentRatingFilter,
  GenresFilter,
  MinimumChaptersFilter,
  SortFilter,
  StatusFilter,
  TypeFilter,
} from "./filters";
import { extractNextJs, inferredNextJsPredicate } from "@/utils/next-js";

export class MangaKSource extends BaseMangaScraper {
  protected get apiUrl() {
    return `https://api.${new URL(this.baseUrl).hostname}`;
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("titles/search", this.apiUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("sort", this.SORT_POPULAR);
    url.searchParams.set("window", this.WINDOW_WEEK);
    url.searchParams.set("limit", this.DEFAULT_PAGE_LIMIT.toString());

    const { data: result } = await this.client.get<SearchResponse>(url.toString());

    return this.parseSearchResponse(result);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("titles/search", this.apiUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("sort", this.SORT_LATEST);
    url.searchParams.set("window", this.WINDOW_WEEK);
    url.searchParams.set("limit", this.DEFAULT_PAGE_LIMIT.toString());

    const { data: result } = await this.client.get<SearchResponse>(url.toString());

    return this.parseSearchResponse(result);
  };

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    const url = new URL("titles/search", this.apiUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("limit", this.DEFAULT_PAGE_LIMIT.toString());

    if (query?.trim()) {
      url.searchParams.set("q", query.trim().slice(0, this.DEFAULT_LENGTH_LIMIT));
    }

    const includedGenres = new Set<string>();
    const excludedGenres = new Set<string>();

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          if (filter.key === TypeFilter.key && value === "any") continue;
          else url.searchParams.set(filter.key, value);
          break;

        case "tri-state-checkbox":
          if (filter.key === GenresFilter.key) {
            value.forEach((item) => {
              if (item.state === "include") includedGenres.add(item.value);
              else if (item.state === "exclude") excludedGenres.add(item.value);
            });
          }
          break;

        case "text":
          if (typeof value === "string" && value.trim()) {
            if (filter.key === MinimumChaptersFilter.key) {
              const parsed = this.toNumberOrNull(value.trim());
              if (parsed !== null) url.searchParams.set(filter.key, String(parsed));
            } else {
              url.searchParams.set(filter.key, value.trim());
            }
          }
          break;

        default:
          break;
      }
    }

    if (includedGenres.size > 0)
      url.searchParams.set("genres", [...includedGenres.values()].join(","));
    if (excludedGenres.size > 0)
      url.searchParams.set("exclude", [...excludedGenres.values()].join(","));

    const { data: result } = await this.client.get<SearchResponse>(url.toString());

    return this.parseSearchResponse(result);
  };

  protected parseSearchResponse(response: SearchResponse): SeriesListResponse<Manga> {
    if (!Array.isArray(response.data?.items)) return this.emptyListResponse();

    const mangaList: Manga[] = [];

    for (const item of response.data.items) {
      const url = new URLSearchParams({
        id: item.id,
        url: item.url,
      }).toString();

      mangaList.push({
        title: item.name,
        url: decodeURIComponent(url),
        coverImageUrl: item.cover,
        status: "unknown",
        isNsfw: null,
      });
    }

    const hasMore = response.data.pagination?.has_next ?? false;

    return {
      data: mangaList,
      hasMore,
    };
  }

  override getSeries: GetSeries<Manga> = async (query) => {
    const params = new URLSearchParams(query);
    const url = new URL(params.get("url")!, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const predicate = inferredNextJsPredicate<NextJsPageProps>(["pageProps.initialManga"], {
      isArray: false,
      strict: true,
    });
    const nextJsData = extractNextJs<NextJsPageProps>(
      $,
      predicate,
      (payload) => payload as NextJsPageProps,
    );

    if (!nextJsData?.pageProps?.initialManga) throw new Error("Manga details not found");

    const { initialManga: manga } = nextJsData.pageProps;

    const result: Manga = {
      title: manga.name,
      coverImageUrl: manga.cover,
      isNsfw: manga.isAdult ?? false,
      status: this.getSeriesStatus(manga.status),
      url: query,
      alternateTitles: manga.altNames?.map((t) => t.name.trim()).filter(Boolean) || [],
      genres: manga.genres?.map((g) => g.name.trim()).filter(Boolean) || [],
      authors: manga.authors?.map((a) => a.name.trim()).filter(Boolean) || [],
      description: manga.summary || null,
      rating: this.toNumberOrNull(manga.rating, true),
      lastUpdated: this.parseSeriesDate(manga.updated_at),
    };

    return result;
  };

  override getChapters: GetMangaChapters = async (query) => {
    const params = new URLSearchParams(query);
    let id = params.get("id");
    const mangaUrl = params.get("url")!;

    if (!id) {
      const { data: html } = await this.client.get<string>(mangaUrl);
      const $ = cheerio.load(html);
      const predicate = inferredNextJsPredicate<NextJsPageProps>(["pageProps.initialManga.id"], {
        isArray: false,
        strict: true,
      });
      const nextJsData = extractNextJs<NextJsPageProps>(
        $,
        predicate,
        (payload) => payload as NextJsPageProps,
      );

      if (!nextJsData?.pageProps?.initialManga) throw new Error("Failed to fetch manga ID");

      id = nextJsData.pageProps.initialManga.id;
    }

    const chaptersUrl = new URL(`titles/${id}/chapters`, this.apiUrl);
    chaptersUrl.searchParams.set("cv", String(Date.now()));

    const { data: response } = await this.client.get<ChapterListResponse>(chaptersUrl.toString());

    if (!Array.isArray(response.data?.chapters)) return [];

    const chapters: Chapter[] = [];

    for (const chapter of response.data.chapters) {
      chapters.push({
        title: chapter.name,
        url: chapter.url,
        chapterNumber: this.toNumberOrNull(chapter.chapter_number, true),
      });
    }

    return chapters.toReversed();
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data } = await this.client.get<string>(url.toString());
    const $ = cheerio.load(data);

    const nextJsData = extractNextJs<NextJsPageProps>(
      $,
      inferredNextJsPredicate<NextJsPageProps>(["pageProps.initialChapter.images"], {
        isArray: false,
        strict: true,
      }),
      (payload) => payload as NextJsPageProps,
    );

    if (!Array.isArray(nextJsData?.pageProps?.initialChapter?.images)) return [];

    return nextJsData.pageProps.initialChapter.images.map((image, index) => ({
      url: image,
      index,
    }));
  };

  override getImage: GetImage = async (url) => {
    let response = await this.client.get(url, {
      responseType: "arraybuffer",
      validateStatus: (status) => status >= 200 && status < 300,
      headers: this.getImageHeaders(),
    });

    const requestUrl = new URL(url);

    if (response.status !== 200 && this.IMAGE_FALLBACK_REGEX.test(requestUrl.hostname)) {
      requestUrl.hostname = this.FALLBACK_IMAGE_HOST;

      response = await this.client.get(requestUrl.toString(), {
        responseType: "arraybuffer",
        headers: this.getImageHeaders(),
      });
    }

    const contentType = response.headers["content-type"] as string | undefined;

    return {
      data: response.data,
      contentType: contentType || "image/jpeg",
    };
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      SortFilter,
      ContentRatingFilter,
      StatusFilter,
      TypeFilter,
      AuthorFilter,
      MinimumChaptersFilter,
      GenresFilter,
    ],
  });

  private readonly FALLBACK_IMAGE_HOST = "rx.rzyn.net";
  private readonly DEFAULT_PAGE_LIMIT = 24;
  private readonly DEFAULT_LENGTH_LIMIT = 50;
  private readonly SORT_POPULAR = "popular";
  private readonly SORT_LATEST = "latest";
  private readonly WINDOW_WEEK = "week";

  private IMAGE_FALLBACK_REGEX = /^rx\.qvzr[a-z]\.org$/;
}
