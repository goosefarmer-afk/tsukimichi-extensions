import {
  resolveFilterEntries,
  type Chapter,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetMangaChapters,
  type GetSeriesStatus,
  type GetSettingsFilters,
  type Manga,
  type MultiSelectFilter,
  type Preferences,
  type SelectFilter,
} from "@tsukimichi/common";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { Madara } from "@/lib/multi-src/manga/madara";
import {
  MANHWA_READ_GENRES,
  MANHWA_READ_KEYWORD_MODE,
  MANHWA_READ_SORT_BY_OPTIONS,
  MANHWA_READ_STATUS,
  MANHWA_READ_TAG_SEARCH_OPTIONS,
} from "./filters";
import manifest from "./manifest.json";

export class ManhwaRead extends Madara {
  private $preferences: Preferences;
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();
  }

  override async init(): Promise<void> {
    await super.init();

    this.baseUrl = await this.$preferences.getString(
      this.PREFERRED_MIRROR_KEY,
      this.DEFAULT_MIRROR,
    );
  }

  protected override searchMangaRequest(
    query?: string,
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    const { page = 1, filters } = options ?? {};
    const pageNumStr = Math.max(page, 1).toString();
    const url = new URL(`page/${pageNumStr}`, this.baseUrl);
    url.searchParams.set("s", query?.trim() || "");
    url.searchParams.set("post_type", "wp-manga");

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value?.toString());

          break;
        case "multi-select":
          if (value.length > 0 && filter.renderAs === "checkbox-group") {
            value.forEach((v) => {
              url.searchParams.append(filter.key, v);
            });
          }
          break;
        default:
          break;
      }
    }

    return this.client.get(url.toString(), requestConfig);
  }

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const chapters: Chapter[] = [];

    $("#chaptersList > a.chapter-item").each((_, el) => {
      const chapter = this.chapterFromElement($(el));
      if (chapter) chapters.push(chapter);
    });

    return this.addChapterNavigation(chapters) || [];
  };

  protected override chapterFromElement($el: cheerio.Cheerio<any>): Chapter | null {
    const urlFromElement = $el.attr("href");
    if (!urlFromElement) return null;

    const url = this.setUrlWithoutDomain(urlFromElement);
    const lastUpdated = this.parseSeriesDate($el.find(".chapter-item__date").text().trim());

    const title = $el.find(".chapter-item__name").text().trim();
    const chapterNumber = this.toNumberOrNull(this.extractChapterNumber(title), true);

    return {
      title,
      url,
      chapterNumber,
      languageKey: "en",
      lastUpdated,
    };
  }

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const imageUrls: string[] = [];

    const data = this.#getImagesAndCdnUrl(html);

    data.images.forEach((url) => {
      imageUrls.push(`${data.baseUrl}/${url}`);
    });

    return imageUrls.map((url, index) => ({ index, url }));
  };

  protected override async popularMangaRequest(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    const { page = 1 } = options ?? {};
    const pageNumStr = Math.max(page, 1).toString();
    const url = new URL(`page/${pageNumStr}`, this.baseUrl);
    url.searchParams.set("s", "");
    url.searchParams.set("sortby", "daily_top");
    return await this.client.get(url.toString(), requestConfig);
  }

  protected override async latestMangaRequest(
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    const { page = 1 } = options ?? {};
    const pageNumStr = Math.max(page, 1).toString();
    const url = new URL(this.baseUrl);
    url.searchParams.set("s", "");
    if (page > 1) url.pathname = `page/${pageNumStr}/`;
    return await this.client.get(url.toString(), requestConfig);
  }

  protected override parseSeriesDetails(html: string, url: URL, query: string): Manga {
    const details = super.parseSeriesDetails(html, url, query);

    const $ = cheerio.load(html);

    const metrics = $("div:has(> #mangaRating)");
    let description = "";

    if (metrics) {
      const views = metrics.find(".fa-eye + span").first().text().trim();
      if (views) description += `Views: ${views}<br>`;

      const comments = metrics.find(".fa-comments + span").first().text().trim();
      if (comments) description += `Comments: ${comments}<br>`;

      const bookmarks = metrics.find(".w-5.h-5 + span").first().text().trim();
      if (bookmarks) description += `Bookmarks: ${bookmarks}<br>`;

      const publishers: string[] = [];

      $("#mangaSummary .text-primary:contains(Publisher:) + .flex a span:first-child").each(
        (_, el) => {
          publishers.push($(el).text().trim());
        },
      );

      if (publishers.length)
        description += `${publishers.length > 1 ? "Publishers" : "Publisher"}: ${publishers.join(", ")}<br>`;

      const desc = $(this.seriesDetailsDescriptionSelector).first().text().trim();
      if (desc) description += `${desc}<br><br>`;

      if (description.trim()) details.description = description;
    }

    return details;
  }

  override getFilterConfig: GetFilterConfig = () => {
    return {
      filters: [
        {
          key: "status",
          label: "Status",
          options: MANHWA_READ_STATUS,
          type: "select",
        } as SelectFilter,
        {
          key: "sortby",
          label: "Sort By",
          options: MANHWA_READ_SORT_BY_OPTIONS,
          type: "select",
        } as SelectFilter,
        {
          key: "keyword_mode",
          label: "Keyword Mode",
          description:
            "Select how the keyword should match the title (anywhere, beginning, or end).",
          options: MANHWA_READ_KEYWORD_MODE,
          type: "select",
        } as SelectFilter,
        {
          key: "s_mode",
          label: "Tag Search Mode",
          options: MANHWA_READ_TAG_SEARCH_OPTIONS,
          type: "select",
        } as SelectFilter,
        {
          key: "genres[]",
          label: "Genres",
          options: MANHWA_READ_GENRES,
          type: "multi-select",
          renderAs: "checkbox-group",
        } as MultiSelectFilter,
      ],
    };
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.trim().toLowerCase()) {
      case "ongoing":
        return "ongoing";
      case "completed":
        return "completed";
      case "canceled":
        return "cancelled";
      case "on-hold":
        return "hiatus";
      case "incomplete":
        return "ongoing";
      default:
        return "unknown";
    }
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREFERRED_MIRROR_KEY,
      label: "Preferred mirror",
      type: "select",
      options: this.MIRRORS.map((m) => ({
        label: new URL(m).hostname,
        value: m,
      })),
      defaultValue: this.DEFAULT_MIRROR,
    },
  ];

  private MIRRORS = ["https://manhwaread.com", "https://manhwaread.org"];
  private DEFAULT_MIRROR = this.MIRRORS[0]!;

  private PREFERRED_MIRROR_KEY = "preferredMirror";

  protected override get searchSeriesSelector(): string {
    return ".manga-grid .manga-item";
  }
  protected override get popularSeriesSelector(): string {
    return this.searchSeriesSelector;
  }
  protected override get latestSeriesSelector(): string {
    return this.searchSeriesSelector;
  }
  protected override tagSelector = ".manga-item__tags span";
  protected override statusSelector = ".manga-status__label";
  protected override get mangaSubString(): string {
    return "manhwa";
  }
  protected override seriesSelector = "#mangaSummary";

  protected override seriesDetailsTitleSelector = ".manga-titles h1";
  protected override seriesDetailsTagSelector = "a[href*='/tag/'] span:first-child";
  protected override seriesDetailsGenreSelector = 'a[href*="/genre/"]';
  protected override seriesDetailsArtistSelector = 'a[href*="/artist/"] span:first-child';
  protected override seriesDetailsAuthorSelector = 'a[href*="/author/"] span:first-child';
  protected override seriesDetailsStatusSelector = "span.manga-status__label span:nth-of-type(2)";
  protected override seriesDetailsAlternateTitleSelector = ".manga-titles h2";
  protected override seriesDetailsRatingSelector = ".rating__current";
  protected override seriesDetailsDescriptionSelector = "#mangaDesc .manga-desc__content";
  protected override seriesDetailsCoverSelector = "#mangaSummary img";

  protected override alternateTitleDelimiter = "|";

  #getImagesAndCdnUrl(html: string): { baseUrl: string; images: string[] } {
    const $ = cheerio.load(html);
    const singleChapterScript = $("script#single-chapter-js-extra").text();

    const singleChapterMatch = singleChapterScript.match(
      /var\s+chapterData\s*=\s*(\{.*?\});/s,
    )?.[1];

    let baseUrl: string | null = null;
    const images: string[] = [];

    if (singleChapterMatch) {
      const chapterData = JSON.parse(singleChapterMatch);
      baseUrl = chapterData.base;
      JSON.parse(this.#base64ToUtf8(chapterData.data))?.forEach((item: any) => {
        if (item?.src?.trim()) {
          images.push(item.src);
        }
      });
    }

    if (!baseUrl) throw new Error("CDN Base URL not found");

    return { baseUrl, images };
  }

  #base64ToUtf8(base64String: string): string {
    return Buffer.from(base64String, "base64").toString("utf-8");
  }
}
