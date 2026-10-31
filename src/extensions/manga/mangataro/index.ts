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
} from "@tsukimichi/common";
import crypto from "node:crypto";

import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import manifest from "./manifest.json";
import { SortFilter, StatusFilter, TypeFilter } from "./filters";
import type { BrowseManga, ChapterList, MangaDetails, PageListResponse } from "./types";
import { getLanguageKey } from "@/utils/language";
import { HttpError } from "@/errors/http-error";

export class MangaTaro extends BaseMangaScraper {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override getPopularSeries: GetPopularSeries<Manga> = async (option) => {
    return this.browseManga(undefined, {
      page: option?.page ?? 1,
      filters: {
        sort: {
          value: "popular",
          direction: "descending",
        },
      },
    });
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (option) => {
    return this.browseManga(undefined, {
      page: option?.page ?? 1,
      filters: {
        sort: {
          value: "post",
          direction: "descending",
        },
      },
    });
  };

  private async browseMangaRequest(query?: string, options?: Parameters<SearchSeries<Manga>>[1]) {
    const { page = 1, filters } = options ?? {};

    const url = new URL("wp-json/manga/v1/load", this.baseUrl);

    const payload: Record<string, unknown> = {
      page,
      search: query?.trim() || "",
    };

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "sort":
          const dir = value.direction === "ascending" ? "asc" : "desc";
          payload[filter.key] = `${value.value}_${dir}`;

          break;

        case "select":
          if (filter.key === StatusFilter.key) {
            const val = value === "all" ? [] : [value];
            payload[filter.key] = JSON.stringify(val);
          } else if (filter.key === TypeFilter.key) {
            const val = value === "all" ? [] : [value];
            payload[filter.key] = JSON.stringify(val);
          }
          break;

        default:
          break;
      }
    }

    return await this.client.post<BrowseManga[]>(url.toString(), payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  private async browseManga(query?: string, options?: Parameters<SearchSeries<Manga>>[1]) {
    const { data } = await this.browseMangaRequest(query, options);

    const mangaList = data
      .filter((item) => item.type !== "Novel" && !!item.url)
      .map((item) => this.toManga(item));

    const hasMore = data.length === 24;

    return {
      data: mangaList,
      hasMore,
    };
  }

  override searchSeries: SearchSeries<Manga> = this.browseManga;

  private toManga(item: BrowseManga): Manga {
    const params = new URLSearchParams({
      id: item.id,
      slug: this.toSlug(item.url),
    });

    return {
      title: item.title,
      coverImageUrl: item.cover,
      isNsfw: null,
      url: decodeURIComponent(params.toString()),
      status: "unknown",
    };
  }

  private toSlug(url: string) {
    const segments = new URL(url, this.baseUrl).pathname.split("/").filter(Boolean);
    if (
      (segments.length === 2 && segments[0] === "manga") ||
      (segments.length === 3 && segments[0] === "read")
    ) {
      return segments[1]!;
    }

    throw new Error(`Expected manga or read path, found ${url}`);
  }

  override getSeries: GetSeries<Manga> = async (query) => {
    const params = new URLSearchParams(query);
    const id = params.get("id");
    if (!id) throw new Error("Missing manga ID");

    const url = new URL(`wp-json/wp/v2/manga/${id}`, this.baseUrl);
    url.searchParams.set("_embed", "");

    const { data } = await this.client.get<MangaDetails>(url.toString());

    const status = this.getSeriesStatus(data.status);

    let description = data.content?.rendered?.replaceAll("\n", "<br>") || "";
    if (data.type) description += `<br><br>Type: ${data.type}`;

    const terms = data._embedded?.["wp:term"]?.flat() ?? [];
    const genres = terms
      .filter((t) => t.taxonomy === "post_tag")
      ?.map((t) => t.name)
      .filter(Boolean);
    const authors = terms
      .filter((t) => t.taxonomy === "manga_author")
      ?.map((t) => t.name)
      .filter(Boolean);

    return {
      id: String(data.id),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title: data.title?.rendered,
      description,
      url: query,
      authors,
      coverImageUrl: data._embedded?.["wp:featuredmedia"]?.[0]?.source_url || null,
      status: status || "unknown",
      isNsfw: null,
      genres,
    };
  };

  private serverTimeOffset = 0;

  private getChapterAuthParams() {
    const now = Date.now() + this.serverTimeOffset;
    const timestamp = Math.floor(now / 1000);
    const date = new Date(now).toISOString().replace(/[-:T]/g, "").slice(0, 10);

    const token = this.md5(`${timestamp}mng_ch_${date}`).slice(0, 16);

    return { timestamp, token };
  }

  override getChapters: GetMangaChapters = async (query) => {
    const params = new URLSearchParams(query);
    const mangaId = params.get("id");

    if (!mangaId) {
      throw new Error("Manga ID not found");
    }

    const fetchChapterPage = async (offset: number, retry = true): Promise<ChapterList> => {
      const { timestamp, token } = this.getChapterAuthParams();

      const url = new URL("auth/manga-chapters", this.baseUrl);
      url.searchParams.set("manga_id", mangaId);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", "500");
      url.searchParams.set("order", "DESC");
      url.searchParams.set("_t", token);
      url.searchParams.set("_ts", String(timestamp));

      const response = await this.client.get<ChapterList>(url.toString(), {
        validateStatus: () => true,
      });

      if (response.status === 403 && retry) {
        const dateHeader = response.headers["date"];

        if (!dateHeader) {
          throw new HttpError({
            method: "GET",
            status: 403,
            statusText: "Missing Date header",
          });
        }

        const serverTime = new Date(dateHeader).getTime();

        if (Number.isNaN(serverTime)) {
          throw new HttpError({
            method: "GET",
            status: 403,
            statusText: "Invalid Date header",
          });
        }

        this.serverTimeOffset = serverTime - Date.now();

        // Rebuild the URL with a fresh timestamp and token.
        return fetchChapterPage(offset, false);
      }

      if (response.status < 200 || response.status >= 300) {
        throw new HttpError({
          method: "GET",
          status: response.status,
          statusText: response.statusText,
        });
      }

      return response.data;
    };

    const remoteChapters: ChapterList["chapters"] = [];
    let offset = 0;

    while (true) {
      const page = await fetchChapterPage(offset);

      remoteChapters.push(...page.chapters);

      if (!page.has_more || page.chapters.length === 0) {
        break;
      }

      offset += page.chapters.length;
    }

    const placeholders = new Set(["", "N/A", "—"]);
    const chapters: Chapter[] = remoteChapters.map((chapter) => {
      const title = placeholders.has(chapter.title ?? "")
        ? `Chapter ${chapter.chapter}`
        : `Chapter ${chapter.chapter}: ${chapter.title}`;

      return {
        id: chapter.url,
        extensionId: this.extensionMetadata.id,
        source: this.extensionMetadata.name,
        title,
        url: this.setUrlWithoutDomain(chapter.url),
        groupName:
          chapter.group_name && !placeholders.has(chapter.group_name) ? chapter.group_name : null,
        chapterNumber: this.toNumberOrNull(chapter.chapter, true),
        languageKey: chapter.language ? getLanguageKey(chapter.language) : null,
        lastUpdated: this.parseSeriesDate(chapter.date),
      };
    });

    return chapters.reverse();
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const chapterId = query.split("/").at(-1)?.split("-").at(-1);
    if (!chapterId) {
      throw new Error("Chapter ID not found in the URL");
    }

    const url = new URL("auth/chapter-content", this.baseUrl);
    url.searchParams.set("chapter_id", chapterId);
    const { data } = await this.client.get<PageListResponse>(url.toString());

    return data.images.map((img, index) => ({
      url: img,
      index,
    }));
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "ongoing":
      case "publish":
        return "ongoing";
      case "completed":
        return "completed";
      default:
        return "unknown";
    }
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [SortFilter, StatusFilter, TypeFilter],
  });

  private md5(input: string) {
    return crypto.createHash("md5").update(input, "utf-8").digest("hex");
  }
}
