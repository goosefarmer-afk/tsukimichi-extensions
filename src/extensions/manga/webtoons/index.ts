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
  GetSettingsFilters,
  Manga,
  Preferences,
  SearchSeries,
} from "@tsukimichi/common";
import * as cheerio from "cheerio";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import type { ChapterListResponse } from "./dto";
import manifest from "./manifest.json";

export class WebtoonsCom extends BaseMangaScraper {
  private readonly mobileUrl = "https://m.webtoons.com";

  private $preferences: Preferences;
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();
  }

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    let searchTypeAdded = false;

    const url = new URL(`${this.getLang()}/search`, this.baseUrl);

    if (filters?.["search_type"]) {
      url.pathname += `/${filters["search_type"]}`;
      searchTypeAdded = true;
    }

    if (query?.trim()) url.searchParams.set("keyword", query.trim());

    if (page > 1 && searchTypeAdded) url.searchParams.set("page", page.toString());

    const { data: html } = await this.client.get<string>(url.toString());

    const mangaList: Manga[] = [];

    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    $(".webtoon_list li a").each((_, el) => {
      const $el = $(el);
      mangaList.push(this.mangaFromElement($el));
    });

    const hasMore = $("a.pagination[aria-current=true] + a").first().length > 0;

    return {
      data: mangaList,
      hasMore,
    };
  };

  override getLatestSeries: GetLatestSeries<Manga> = async () => {
    const url = new URL(`${this.getLang()}/originals/${this.getDayString()}`, this.baseUrl);
    url.searchParams.set("sortOrder", "UPDATE");
    const { data: html } = await this.client.get<string>(url.toString());

    const mangaList: Manga[] = [];

    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    $(".webtoon_list li a").each((_, el) => {
      const $el = $(el);
      mangaList.push(this.mangaFromElement($el));
    });

    return {
      data: mangaList,
      hasMore: false,
    };
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1, filters } = options ?? {};

    const ranking = () => {
      switch (page) {
        case 1:
          return "trending";
        case 2:
          return "popular";
        case 3:
          return "originals";
        case 4:
          return "canvas";
        default:
          throw new Error("page > 4 not available");
      }
    };

    const url = new URL(`${this.getLang()}/ranking/${ranking()}`, this.baseUrl);

    const { data } = await this.client.get<string>(url.toString(), {
      headers: {
        Cookie: `locale=${this.getLang()};needGDPR=false;${filters?.includeNsfw && "ageGatePass=true"}`,
      },
    });

    const mangaList: Manga[] = [];

    const $ = cheerio.load(data, { baseURI: this.baseUrl });

    $(".webtoon_list li a").each((_, el) => {
      const $el = $(el);
      mangaList.push(this.mangaFromElement($el));
    });

    return {
      data: mangaList,
      hasMore: page < 4,
    };
  };

  private mangaFromElement($el: cheerio.Cheerio<any>): Manga {
    const url = new URL($el.prop("href")!, this.baseUrl);
    const title = $el.find(".title").first().text().trim();
    const coverImageUrl = $el.find("img").prop("src") || null;

    return {
      title,
      url: `${url.pathname}${url.search}`,
      coverImageUrl,
      isNsfw: null,
      status: "unknown",
    };
  }

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html, { baseURI: this.baseUrl });

    const $detailEl = $(".detail_header .info");
    const $infoEl = $("#_asideDetail");

    const title = $("h1.subj, h3.subj").text().trim();

    const statusText = $infoEl.find("p.day_info").text().trim();
    const status = this.getSeriesStatus(statusText);

    const authorText =
      this.getOwnText($detailEl.find(".author:nth-of-type(1)").first()) ||
      this.getOwnText($detailEl.find(".author_area").first());
    const authors = authorText
      .split(",")
      .map((el) => el.trim())
      .filter(Boolean);

    const artistText =
      this.getOwnText($detailEl.find(".author:nth-of-type(2)").first()) ||
      this.getOwnText($detailEl.find(".author_area").first());
    const artists = artistText
      .split(",")
      .map((el) => el.trim())
      .filter(Boolean);

    const genreText = $detailEl.find(".genre").text().trim();
    const genres = genreText
      .split(",")
      .map((el) => el.trim())
      .filter(Boolean);

    const description = $infoEl.find("p.summary").text().trim();

    const getCoverImageUrl = () => {
      let coverImageUrl: string | null = null;

      const bannerFile = $(".detail_header .thumb img").prop("src");
      const thumbnailFile = $('meta[property="og:image"]').attr("content");

      if (bannerFile) {
        coverImageUrl = bannerFile;
      } else if (thumbnailFile) {
        coverImageUrl = thumbnailFile;
      }

      return coverImageUrl;
    };

    return {
      id: this.slugify(title),
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title,
      status,
      description,
      authors,
      artists,
      url: this.setUrlWithoutDomain(query),
      coverImageUrl: getCoverImageUrl(),
      isNsfw: null,
      genres,
    };
  };

  override getChapters: GetMangaChapters = async (query) => {
    const urlObj = new URL(query, this.baseUrl);
    const titleId = urlObj.searchParams.get("title_no") || urlObj.searchParams.get("titleNo");

    if (!titleId) {
      throw new Error("Title ID not found in the URL");
    }

    const segments = urlObj.pathname.split("/").filter(Boolean);

    let type: string;
    if (segments.includes("episodeList")) {
      switch (segments[0]) {
        case "episodeList":
          type = "webtoon";
          break;
        case "challenge":
          type = "canvas";
          break;
        default:
          throw new Error("Series type not found in the URL");
      }
    } else {
      if (segments[1] === "canvas") type = "canvas";
      else type = "webtoon";
    }

    const url = new URL(this.mobileUrl);
    url.pathname = `/api/v1/${type}/${titleId}/episodes`;
    url.searchParams.set("pageSize", "99999");

    const { data } = await this.client.get<ChapterListResponse>(url.toString());

    const chapters: Chapter[] = [];

    data.result.episodeList.forEach((ep) => {
      chapters.push({
        title: ep.episodeTitle,
        chapterNumber: ep.episodeNo,
        url: ep.viewerLink,
        languageKey: "multi",
      });
    });

    return this.addChapterNavigation(chapters);
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(query, this.baseUrl);

    const { data: html } = await this.client.get<string>(url.toString());

    const $ = cheerio.load(html);

    const useMaxQuality = await this.getUseMaxQuality();

    const pages: { url: string; index: number }[] = [];

    $("div#_imageList > img").each((index, el) => {
      const $el = $(el);

      const imageUrl = $el.attr("data-url");
      if (!imageUrl) return;

      const imageUrlObj = new URL(imageUrl);

      if (useMaxQuality && imageUrlObj.searchParams.get("type") === "q90") {
        imageUrlObj.searchParams.delete("type");
        pages.push({
          url: imageUrlObj.toString(),
          index,
        });
      } else {
        pages.push({
          url: imageUrl,
          index,
        });
      }
    });

    return pages;
  };

  override getSeriesStatus: GetSeriesStatus = (input) => {
    input ??= "";

    switch (true) {
      case ["UP", "EVERY", "NOUVEAU"].includes(input):
        return "ongoing";
      case ["END", "COMPLETED", "TERMINÉ"].includes(input):
        return "completed";
      default:
        return "unknown";
    }
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_LANG_KEY,
      label: "Language",
      type: "select",
      options: this.SETTINGS_LANGUAGE_OPTIONS,
      defaultValue: "en",
    },
    {
      key: this.PREF_USE_MAX_QUALITY_KEY,
      label: "Use max quality",
      type: "toggle",
      defaultValue: false,
    },
  ];

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "search_type",
        label: "Search Type",
        type: "select",
        options: [
          { label: "All", value: "all" },
          { label: "Originals", value: "originals" },
          { label: "Canvas", value: "canvas" },
        ],
        defaultValue: "all",
      },
    ],
  });

  private getDayString(): string {
    const date = new Date();
    const day = date.getDay();
    const dayMap = {
      0: "sunday",
      1: "monday",
      2: "tuesday",
      3: "wednesday",
      4: "thursday",
      5: "friday",
      6: "saturday",
    };

    if (day < 0 || day > 6) throw new Error("Unknown day of week");

    return dayMap[day as keyof typeof dayMap];
  }

  private async getLang(): Promise<string> {
    return await this.$preferences.getString(this.PREF_LANG_KEY, "en");
  }

  private async getUseMaxQuality(): Promise<boolean> {
    return await this.$preferences.getBoolean(this.PREF_USE_MAX_QUALITY_KEY, false);
  }

  private readonly SETTINGS_LANGUAGE_OPTIONS = [
    {
      label: "English",
      value: "en",
    },
    {
      label: "Thai",
      value: "th",
    },
    {
      label: "Spanish",
      value: "es",
    },
    {
      label: "French",
      value: "fr",
    },
    {
      label: "German",
      value: "de",
    },
  ];

  private readonly LANGS = ["en", "th", "es", "fr", "de"];

  private readonly PREF_LANG_KEY = "pref_lang";
  private readonly PREF_USE_MAX_QUALITY_KEY = "pref_use_max_quality";
}
