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
  type GetSettingsFilters,
  type Manga,
  type SearchSeries,
  type SeriesListResponse,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import {
  OMEGA_SCANS_ORDER_BY_OPTIONS,
  OMEGA_SCANS_ORDER_OPTIONS,
  OMEGA_SCANS_STATUS_OPTIONS,
} from "./filters";
import manifest from "./manifest.json";
import type { OmegaScansChapterResponse } from "./omega-scans-dto";

export class OmegaScans extends BaseMangaScraper {
  private readonly baseApiUrl = this.baseUrl.replace("://", "://api.");
  private readonly seriesIdRegex = /\\"series_id\\":(\d+)/;
  private readonly cdnUrl = this.baseApiUrl;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};
    const url = new URL("query", this.baseApiUrl);
    if (query?.trim()) {
      url.searchParams.set("query_string", query);
    }
    url.searchParams.set("page", page.toString());
    url.searchParams.set("perPage", "12");
    url.searchParams.set("adult", "true");
    url.searchParams.set("series_type", "Comic");
    url.searchParams.set("tag_ids", "[]");

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value);
          break;
        default:
          break;
      }
    }

    const { data } = await this.client.get(url.toString());

    return this.parseSearchResponse(data);
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);
    const titleEl = $("h1").first();
    const title = titleEl.text().trim();
    const alternateTitles = $(titleEl.parent().next())
      .text()
      .trim()
      .split("|")
      .map((t) => t.replace(/[()]/g, "").trim());

    const $genresContainer = $(".flex.flex-row.flex-wrap.gap-2");

    const statusText = $genresContainer.find("span").first().text().trim();
    const status = this.getSeriesStatus(statusText);
    const genres = $genresContainer
      .find("span:not(:first-child)")
      .map((_, el) => $(el).text().trim())
      .get();
    const description = $genresContainer.next("div").find("p").text().trim();

    const coverImageUrl = $("meta[property='og:image']").attr("content") || null;

    const seriesId = this.getSeriesIdFromRSCPayload(html);

    if (!seriesId) {
      throw new Error("Failed to extract series ID");
    }

    url.searchParams.set("seriesId", seriesId);

    return {
      id: seriesId,
      extensionId: this.extensionMetadata.id,
      source: this.name,
      title,
      description,
      alternateTitles,
      coverImageUrl,
      url: url.toString(),
      isNsfw: null,
      status,
      genres,
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    const tempUrl = new URL(query, this.baseUrl);
    const seriesId = tempUrl.searchParams.get("seriesId");
    if (!seriesId) {
      throw new Error("seriesId not found in URL");
    }

    const chapters: Chapter[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const url = new URL("chapter/query", this.baseApiUrl);
      url.searchParams.set("series_id", seriesId);
      url.searchParams.set("page", currentPage.toString());
      url.searchParams.set("perPage", "500");

      const { data } = await this.client.get(url.toString());
      data.data.forEach((chapter: any) => {
        const title = chapter.chapter_name;

        chapters.push({
          title,
          url: `${this.baseUrl}/series/${chapter.series.series_slug}/${chapter.chapter_slug}`,
          languageKey: "en",
          chapterNumber: this.toNumberOrNull(this.extractChapterNumber(title), true),
        });
      });

      hasMorePages = currentPage < data.meta.last_page;
      currentPage++;
    }

    return this.addChapterNavigation(chapters) || [];
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const tempUrl = new URL(query, this.baseUrl);
    const pathname = tempUrl.pathname;
    const url = new URL(pathname.replace("/series/", "/chapter/"), this.baseApiUrl);

    const { data: json } = await this.client.get<OmegaScansChapterResponse>(url.toString());

    if (json.paywall) {
      throw new Error("Chapter is behind paywall. Wait for it to be available for free");
    }

    const images = json.chapter.chapter_data?.images;
    const imageUrls =
      images && images.length > 0
        ? images.map((url) =>
            url.startsWith("https://") || url.startsWith("http://") ? url : `${this.cdnUrl}/${url}`,
          )
        : [];

    return imageUrls.map((url, index) => ({ index, url }));
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};
    const url = new URL("query", this.baseApiUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("perPage", "12");
    url.searchParams.set("adult", "true");
    url.searchParams.set("orderBy", "total_views");
    url.searchParams.set("order", "desc");
    url.searchParams.set("series_type", "Comic");
    url.searchParams.set("tag_ids", "[]");

    const { data: json } = await this.client.get(url.toString());
    return this.parseSearchResponse(json);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};
    const url = new URL("query", this.baseApiUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("perPage", "12");
    url.searchParams.set("adult", "true");
    url.searchParams.set("orderBy", "latest");
    url.searchParams.set("order", "desc");
    url.searchParams.set("series_type", "Comic");
    url.searchParams.set("tag_ids", "[]");

    const { data: json } = await this.client.get(url.toString());
    return this.parseSearchResponse(json);
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.DISPLAY_PAID_CHAPTERS_KEY,
      type: "toggle",
      label: "Display paid chapters",
      defaultValue: false,
      description: "If enabled, paid chapters will be displayed in the chapter list",
    },
    {
      key: this.OMEGA_SCANS_USERNAME_KEY,
      label: "Username/Email",
      type: "text",
      defaultValue: "",
      placeholder: "Enter your username or email",
      description: "This is required to access paid chapters",
    },
    {
      key: this.OMEGA_SCANS_PASSWORD_KEY,
      label: "Password",
      type: "password",
      defaultValue: "",
      placeholder: "Enter your password",
      description: "This is required to access paid chapters",
    },
  ];

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "status",
        label: "Status",
        type: "select",
        options: OMEGA_SCANS_STATUS_OPTIONS,
      },
      {
        key: "orderBy",
        label: "Order By",
        type: "select",
        options: OMEGA_SCANS_ORDER_BY_OPTIONS,
      },
      {
        key: "order",
        label: "Order",
        type: "select",
        options: OMEGA_SCANS_ORDER_OPTIONS,
      },
    ],
  });

  private getSeriesIdFromRSCPayload(rscPayload: string, regex?: RegExp): string | null {
    const $ = cheerio.load(rscPayload);
    const scriptTags: string[] = [];

    $("script").each((_, el) => {
      if ($(el).html()?.includes("self.__next_f.push")) {
        scriptTags.push($(el).html() || "");
      }
    });

    const payload = scriptTags.join("\n");

    // Match with escaped quotes
    const seriesIdMatch = payload.match(regex || this.seriesIdRegex);
    const seriesId = seriesIdMatch?.[1] ? seriesIdMatch[1] : null;

    return seriesId;
  }

  override getSeriesStatus: GetSeriesStatus = (status) => {
    switch (status) {
      case "Completed":
        return "completed";
      case "Ongoing":
        return "ongoing";
      case "Hiatus":
        return "hiatus";
      case "Cancelled":
        return "cancelled";
      case "Dropped":
        return "hiatus";
      default:
        return "unknown";
    }
  };

  private parseSearchResponse(json: any): SeriesListResponse<Manga> {
    const hasMore = json.meta.current_page < json.meta.last_page;

    const data: Manga[] = [];

    json.data.forEach((series: any) => {
      data.push({
        title: series.title,
        url: `${this.baseUrl}/series/${series.series_slug}?seriesId=${series.id}`,
        coverImageUrl: series.thumbnail,
        isNsfw: null,
        status: this.getSeriesStatus(series.status),
      });
    });

    return {
      data,
      hasMore,
    };
  }

  private readonly DISPLAY_PAID_CHAPTERS_KEY = "displayPaidChapters";
  private readonly OMEGA_SCANS_USERNAME_KEY = "omegaScansUsername";
  private readonly OMEGA_SCANS_PASSWORD_KEY = "omegaScansPassword";
}
