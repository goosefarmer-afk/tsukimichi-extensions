import {
  resolveFilterEntries,
  type ExtensionClientConstructorOptions,
  type GetChapterPages,
  type GetFilterConfig,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetPopularSeries,
  type GetSeries,
  type GetSettingsFilters,
  type Manga,
  type Preferences,
  type SearchSeries,
} from "@tsukimichi/common";

import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import manifest from "./manifest.json" with { type: "json" };
import type { MangaDetails, MangaTitle } from "./types";
import { substringAfterLast } from "@/utils/string";
import { MangaUpImageInterceptor } from "./interceptors/image-interceptor";
import { ErrorNormalizer } from "@/lib/network/interceptors/error-normalizer";
import { decodeMangaDetails, decodeSeriesResponse, decodeViewerResponse } from "./proto/decoder";

export class MangaUp extends BaseMangaScraper {
  private domain = "manga-up.com";

  private apiBase = `https://global-api.${this.domain}`;
  private apiUrl = `${this.apiBase}/api`;
  private imgurl = `https://global-img.${this.domain}`;

  private $preferences: Preferences;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();

    this.client = this.network
      .newBuilder()
      .addInterceptor(new MangaUpImageInterceptor())
      .addInterceptor(new ErrorNormalizer())
      .build();
  }

  override getPopularSeries: GetPopularSeries<Manga> = async () => {
    const url = new URL(`${this.apiUrl}/search`);
    this.addCommonParameters(url);

    const response = await this.client.get(url.toString(), {
      responseType: "arraybuffer",
    });

    const result = decodeSeriesResponse(Buffer.from(response.data));

    const mangas = (result.titles ?? [])
      .sort((a, b) => (b.bookmarks ?? 0) - (a.bookmarks ?? 0))
      .map((title) => this.toManga(title));

    return {
      data: mangas,
      hasMore: false,
    };
  };

  private toManga(data: MangaTitle): Manga {
    return {
      title: data.name,
      coverImageUrl: data.thumbnail ? `${this.imgurl}${data.thumbnail}` : null,
      isNsfw: null,
      status: "unknown",
      url: String(data.id),
    };
  }

  override getLatestSeries: GetLatestSeries<Manga> = async () => {
    const response = await this.client.get(`${this.apiUrl}/search`, {
      params: {
        lang: "en",
      },
      responseType: "arraybuffer",
    });

    const result = decodeSeriesResponse(Buffer.from(response.data));

    const mangas = (result.titles ?? [])
      .sort(
        (a, b) => (Date.parse(b.lastUpdated ?? "") || 0) - (Date.parse(a.lastUpdated ?? "") || 0),
      )
      .map((title) => this.toManga(title));

    return {
      data: mangas,
      hasMore: false,
    };
  };

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { filters } = options ?? {};

    if (query?.startsWith(this.PREFIX_ID_SEARCH)) {
      const manga = await this.getSeries(query.replace(this.PREFIX_ID_SEARCH, ""));
      return {
        data: [manga].filter((item) => item !== null),
        hasMore: false,
      };
    }

    let genre: string | null = null;

    for (const { type, value } of resolveFilterEntries(filters, this.getFilterConfig().filters)) {
      if (value === "all") continue;

      switch (type) {
        case "select":
          genre = value === "all" ? null : value;

          break;
        default:
          break;
      }
    }

    if (query?.trim()) {
      const url = new URL(`${this.apiUrl}/manga/search`);
      url.searchParams.set("word", query.trim());
      this.addCommonParameters(url);
      const { data } = await this.client.get(url.toString(), { responseType: "arraybuffer" });
      const result = decodeSeriesResponse(Buffer.from(data), true);
      const mangas = (result.titles ?? []).map((title) => this.toManga(title));
      return {
        data: mangas,
        hasMore: false,
      };
    }

    if (genre) {
      const url = new URL(`${this.apiUrl}/manga/tag`);
      this.addCommonParameters(url);
      url.searchParams.set("tag_id", genre);
      const { data } = await this.client.get(url.toString(), { responseType: "arraybuffer" });
      const result = decodeSeriesResponse(Buffer.from(data), true);
      const mangas = (result.titles ?? []).map((title) => this.toManga(title));
      return {
        data: mangas,
        hasMore: false,
      };
    }

    return this.getPopularSeries();
  };

  override getSeries: GetSeries<Manga> = async (query) => {
    const result = await this.getMangaDetails(query);

    let description = result.description || "";
    if (result.copyright) description += `${result.copyright}<br><br>`;
    if (result.schedule) description += `${result.schedule}<br><br>`;
    if (result.warning) description += `${result.warning}`;

    description = description.replaceAll("\n", "<br>");

    return {
      id: query,
      extensionId: this.extensionMetadata.id,
      source: this.extensionMetadata.name,
      title: result.title,
      coverImageUrl: result.thumbnail ? `${this.imgurl}${result.thumbnail}` : null,
      isNsfw: null,
      url: query,
      genres: result.tags?.map((t) => t.name.trim()).filter(Boolean) ?? [],
      status: result.chapters?.some((c) => c.isFinal === true) ? "completed" : "ongoing",
      authors:
        result.author
          ?.split(",")
          .map((a) => a.trim())
          .filter(Boolean) ?? [],
      description,
    };
  };

  private async getMangaDetails(query: string): Promise<MangaDetails> {
    const url = new URL(`${this.apiUrl}/manga/detail_v2`);
    this.addCommonParameters(url);
    url.searchParams.set("title_id", query);
    url.searchParams.set("quality", "high");
    url.searchParams.set("ui_lang", "en");

    const { data } = await this.client.get(url.toString(), { responseType: "arraybuffer" });

    return decodeMangaDetails(Buffer.from(data));
  }

  override getChapters: GetMangaChapters = async (query) => {
    const id = substringAfterLast(query, "/");
    const chapters = (await this.getMangaDetails(query)).chapters ?? [];
    const hidePaid = await this.$preferences.getBoolean(
      this.PREF_HIDE_PAID_CHAPTERS_KEY,
      this.PREF_HIDE_PAID_CHAPTERS_DEFAULT,
    );

    return [...chapters.reverse()]
      .filter((c) => !hidePaid || c.price == null)
      .map((c) => {
        let title = c.name;
        if (c.subtitle) title += ` : ${c.subtitle}`;
        if (c.isFinal) title += " [Final]";
        if (c.price != null) title = `🔒 ${title}`;

        return {
          id: String(c.id),
          extensionId: this.extensionMetadata.id,
          source: this.extensionMetadata.name,
          title,
          url: `${id}/${c.id}`,
          lastUpdated: c.dateStr ? this.parseSeriesDate(c.dateStr) : null,
        };
      });
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const chapterId = query.split("/")[1];
    if (!chapterId) throw new Error("Chapter ID not found");

    const url = new URL(`${this.apiUrl}/manga/viewer_v2`);
    url.searchParams.set("chapter_id", chapterId);
    url.searchParams.set("quality", "high");
    this.addCommonParameters(url);

    const { data } = await this.client.post<ArrayBuffer>(url.toString(), undefined, {
      responseType: "arraybuffer",
    });

    const result = decodeViewerResponse(Buffer.from(data));

    const pages = result.pageBlocks
      .find((block) => block.chapterId === Number(chapterId))
      ?.pages.filter((page) => !page.url.includes("tutorial"));

    if (!pages) throw new Error("Pages not found");

    return pages.map((page, index) => {
      const url = new URL(`${this.imgurl}${page.url}`);
      url.searchParams.set("key", page.key || "");
      url.searchParams.set("iv", page.iv || "");

      return {
        url: url.toString(),
        index,
      };
    });
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "genre",
        label: "Genre",
        type: "select",
        defaultValue: "all",
        options: [
          { label: "All", value: "all" },
          { label: "Action", value: "13" },
          { label: "Adventure", value: "14" },
          { label: "Comedy", value: "15" },
          { label: "School Life", value: "16" },
          { label: "Dark Fantasy", value: "17" },
          { label: "Suspense", value: "18" },
          { label: "Historical", value: "19" },
          { label: "Game", value: "20" },
          { label: "Media Tie-ins", value: "21" },
          { label: "LGBTQ+", value: "253" },
          { label: "Completed", value: "256" },
        ],
      },
    ],
  });

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_HIDE_PAID_CHAPTERS_KEY,
      label: "Hide Paid Chapters",
      type: "toggle",
      defaultValue: this.PREF_HIDE_PAID_CHAPTERS_DEFAULT,
      description: "Hide chapters that require points to unlock",
    },
  ];

  private addCommonParameters(url: URL) {
    url.searchParams.set("lang", "en");
    url.searchParams.set("app_ver", "0");
    url.searchParams.set("os_ver", "0");
  }

  private readonly PREFIX_ID_SEARCH = "id:";

  private readonly PREF_HIDE_PAID_CHAPTERS_KEY = "pref_hide_paid_chapters";
  private PREF_HIDE_PAID_CHAPTERS_DEFAULT = false;
}
