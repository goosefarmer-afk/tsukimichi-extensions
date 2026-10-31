import {
  resolveFilterEntries,
  type ChapterPage,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetPopularSeries,
  type GetSeriesStatus,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import { MangaReader } from "@/lib/multi-src/manga/manga-reader";
import { Filters, SeriesTypeFilter, SortFilter, StatusFilter } from "./filters";
import manifest from "./manifest.json";
import { type AxiosResponse } from "axios";
import { toManga, type Comic } from "./types";
import { Mutex } from "async-mutex";
import { LRUCache } from "@/utils/lru-cache";
import * as cheerio from "cheerio";
import { substringAfterLast } from "@/utils/string";

export class RizzComic extends MangaReader {
  private mutex = new Mutex();

  private cachedValueMap: LRUCache<string, string> | null = null;
  private fetchTime = 0;

  private mangaUrlDirectory = "/series";
  private listUrl = this.mangaUrlDirectory;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  private async getUrlMap(): Promise<LRUCache<string, string>> {
    const now = Date.now();

    if (this.fetchTime + 3_600_000 < now) {
      this.cachedValueMap = null;
    }

    if (this.cachedValueMap) {
      console.debug("using cached value map");
      return this.cachedValueMap;
    }

    return this.mutex.runExclusive(async () => {
      if (this.cachedValueMap) return this.cachedValueMap;

      const result = await this.fetchUrlMap();

      this.cachedValueMap = result;
      this.fetchTime = Date.now();
      return result;
    });
  }

  private async fetchUrlMap(): Promise<LRUCache<string, string>> {
    const url = new URL(this.listUrl, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const elements = $("div.bsx a").toArray();

    const map = new LRUCache<string, string>({ maxSize: elements.length });

    for (const el of elements) {
      const $el = $(el);
      const href = $el.attr("href");
      if (!href) continue;

      const url = new URL(href, this.baseUrl).pathname;
      const slug = url.replace(/\/$/, "").split("/").pop() as string;

      const permaSlug = slug.replace(/^(r\d+-)/, "");
      map.set(permaSlug, slug);
    }

    return map;
  }

  private searchMangaRequest<T>(
    query?: string,
    options?: Record<string, any>,
  ): Promise<AxiosResponse<T>> {
    const { filters } = options || {};

    const apiHeaders = this.headersBuilders();
    apiHeaders.set("X-Requested-With", "XMLHttpRequest");
    apiHeaders.set("X-API-Request", "1");

    if (query?.trim()) {
      const form = new URLSearchParams();
      form.set("search_value", query);

      const url = new URL("Index/live_search", this.baseUrl);
      return this.client.post(url.toString(), form, { headers: apiHeaders });
    }

    const form = new URLSearchParams();

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          form.set(filter.key, value);
          break;

        case "multi-select":
          if (value.length) {
            value.forEach((v) => {
              form.append(filter.key, v);
            });
          }
          break;

        default:
          break;
      }
    }

    const url = new URL("Index/filter_series", this.baseUrl);

    return this.client.post(url.toString(), form, {
      headers: apiHeaders,
    });
  }

  private searchMangaParse(comics: Comic[]): SeriesListResponse<Manga> {
    const data = comics.map((comic) =>
      toManga({
        comic,
        extensionMetadata: this.extensionMetadata,
        mangaUrlDirectory: this.mangaUrlDirectory,
        parseStatus: this.getSeriesStatus,
      }),
    );

    return {
      data,
      hasMore: false,
    };
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { data: result } = await this.searchMangaRequest<Comic[]>(query, options);

    return this.searchMangaParse(result);
  };

  override getPopularSeries: GetPopularSeries<Manga> = async () => {
    const { data: result } = await this.searchMangaRequest<Comic[]>(undefined, {
      filters: {
        [SortFilter.key]: SortFilter.options.at(-1)?.value,
        [StatusFilter.key]: StatusFilter.options.at(0)?.value,
        [SeriesTypeFilter.key]: SeriesTypeFilter.options.at(0)?.value,
      },
    });

    return this.searchMangaParse(result);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async () => {
    const { data: result } = await this.searchMangaRequest<Comic[]>(undefined, {
      filters: {
        [SortFilter.key]: SortFilter.options.at(3)?.value,
        [StatusFilter.key]: StatusFilter.options.at(0)?.value,
        [SeriesTypeFilter.key]: SeriesTypeFilter.options.at(0)?.value,
      },
    });

    return this.searchMangaParse(result);
  };

  protected override async mangaDetailsRequest<T>(query: string): Promise<AxiosResponse<T>> {
    let slug = query
      .split("#")[0]
      ?.replace(/^(r\d+-)/, "")
      ?.replace(/\/$/, "");

    if (!slug) throw new Error("Slug not found");

    slug = substringAfterLast(slug, "/");

    const map = await this.getUrlMap();

    const randomSlug = map.has(slug) ? map.get(slug) : slug;

    const url = new URL(`${this.mangaUrlDirectory}/${randomSlug}`, this.baseUrl);

    return this.client.get(url.toString());
  }

  protected override mangaDetailsParse(html: string, query: string): Manga {
    const details = super.mangaDetailsParse(html, query);

    const $ = cheerio.load(html);
    const genres = $(this.genresSelector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    details.genres = genres;

    details.description = details.description
      ?.split('var description = "')[1]
      ?.split('"')[0]
      ?.replace(/\\r\\n|\\n|\\r/g, "<br>");

    return details;
  }

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const pages: ChapterPage[] = [];

    $("div#readerarea img").each((index, el) => {
      const $el = $(el);
      let src: string | null = null;
      if ($el.attr("data-lazy-src")) {
        src = $el.attr("data-lazy-src") as string;
      } else if ($el.attr("data-src")) {
        src = $el.attr("data-src") as string;
      } else if ($el.attr("src")) {
        src = $el.attr("src") as string;
      }

      if (!src) return;
      pages.push({
        index,
        url: new URL(src, this.baseUrl).toString(),
      });
    });

    return pages;
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    input = input?.toLowerCase() || "";
    switch (true) {
      case ["ongoing", "new season", "mass released"].includes(input):
        return "ongoing";
      case ["completed"].includes(input):
        return "completed";
      case ["dropped"].includes(input):
        return "cancelled";
      case ["hiatus", "season end"].includes(input):
        return "hiatus";
      default:
        return "unknown";
    }
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: Filters,
    header: "Filters doesn't work with text search",
  });

  protected override ratingSelector = ".rating .numscore";
  protected override seriesDetailsGenresSelector = '.mgen a[href*="/genres/"]';
  protected override seriesDetailsStatusSelector = ".imptdt:contains(Status) i";
  protected override genresSelector = ".mgen a[href*='/genre/']";
}
