import {
  type Chapter,
  type ExtensionClientConstructorOptions,
  type ExtensionMetadata,
  type GetChapterPages,
  type GetFilterConfig,
  type GetImage,
  type GetLatestSeries,
  type GetMangaChapters,
  type GetMetadata,
  type GetPopularSeries,
  type GetSeries,
  type GetSettingsFilters,
  type Manga,
  MangaExtensionClient,
  type SearchSeries,
} from "@tsukimichi/common";
import {
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import type { Cheerio } from "cheerio";
import { NetworkHelper } from "@/lib/network/network-helper";
import { NSFW_KEYWORDS } from "../lib/constants";

export abstract class BaseMangaScraper extends MangaExtensionClient {
  protected network: NetworkHelper;
  protected client: AxiosInstance;

  name: string;
  extensionMetadata: ExtensionMetadata;
  baseUrl: string;
  override settings: Record<string, any> = {};

  protected readonly defaultOptions = {
    timeout: 10_000,
    retries: 3,
    delay: 700,
  };

  constructor(
    options: ExtensionClientConstructorOptions & {
      metadata: ExtensionMetadata;
    },
  ) {
    super(options);
    const { metadata } = options;
    this.extensionMetadata = metadata;
    this.name = metadata.name;
    this.baseUrl = metadata.url;
    this.network = new NetworkHelper({
      extensionId: options.metadata.id,
      dohProvider: () => this.settings["dohProvider"] || "",
    });
    this.client = this.network.client;
  }

  protected async fetchWithRetry<T = any>(
    url: string,
    args?: {
      retryCount?: number;
      options?: {
        config?: AxiosRequestConfig;
        [key: string]: any;
      };
    },
  ): Promise<AxiosResponse<T>> {
    const { retryCount = 0, options } = args ?? {};
    const {
      delay = this.defaultOptions.delay,
      retries = this.defaultOptions?.retries,
      timeout = this.defaultOptions.timeout,
    } = options?.timeoutOptions ?? {};
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await this.client.request({
        url,
        signal: controller.signal,
        ...options?.config,
      });

      clearTimeout(timeoutId);

      return response;
    } catch (error) {
      if (retryCount < retries) {
        console.warn(`Request failed, retrying... (${retryCount + 1}/${retries})`);
        await this.delay(delay * (retryCount + 1));
        return this.fetchWithRetry(url, {
          retryCount: retryCount + 1,
          options,
        });
      }
      throw error;
    }
  }

  protected override delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected normalizeUrl(url: string): string {
    return url.startsWith("http") ? url : `${this.baseUrl}${url}`;
  }

  abstract override searchSeries: SearchSeries<Manga>;
  abstract override getSeries: GetSeries<Manga>;
  abstract override getChapters: GetMangaChapters;
  abstract override getPopularSeries: GetPopularSeries<Manga>;
  abstract override getLatestSeries: GetLatestSeries<Manga>;
  abstract override getChapterPages: GetChapterPages;

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [],
  });

  override getSettingsFilters: GetSettingsFilters = () => [];

  getMetadata: GetMetadata = () => this.extensionMetadata;

  override getImage: GetImage = async (url) => {
    const { data, headers } = await this.client.get(url, {
      responseType: "arraybuffer",
      headers: this.getImageHeaders(),
    });
    const contentType = (headers["content-type"] as string) || "image/jpeg";

    return {
      data,
      contentType,
    };
  };

  protected getImageHeaders(options?: HeadersInit): AxiosHeaders {
    const headers = this.headersBuilders();
    headers.set(
      "Accept",
      "image/avif,image/jxl,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5",
    );
    headers.set("Accept-Language", "en-US,en;q=0.9");
    headers.set("Accept-Encoding", "gzip, deflate, br");
    headers.set("Sec-GPC", "1");
    headers.set("Connection", "keep-alive");
    headers.set("Sec-Fetch-Dest", "image");
    headers.set("Sec-Fetch-Mode", "no-cors");
    headers.set("Sec-Fetch-Site", "cross-site");
    if (!headers.get("Referer")) {
      headers.set("Referer", `${this.baseUrl}/`);
    }

    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    );

    if (options) {
      const extra = new Headers(options);
      extra.forEach((value, key) => {
        headers.set(key, value);
      });
    }

    return headers;
  }

  protected slugify(title: string): string {
    if (!title || typeof title !== "string") return "";

    const normalized = title
      .normalize("NFD")
      .split("")
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: <explanation>
      .filter((char) => char.match(/[^\u0300-\u036f]/))
      .join("");

    return normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");
  }

  protected detectNsfw(
    title: string,
    description?: string | null,
    genres?: string[] | null,
    tags?: string[],
  ): boolean {
    const allText = [title, description ?? "", ...(genres ?? []), ...(tags ?? [])]
      .filter(Boolean)
      .join(" ")
      .replace(/[-_]/g, " ")
      .replace(/[^\w\s\u3000-\u30FF\u4E00-\u9FFF]/g, "") // remove symbols except Japanese
      .toLowerCase()
      .replace(/\s+/g, " "); // collapse spaces

    return NSFW_KEYWORDS.some((keyword) => {
      // Use word boundary only for non-Japanese words
      const isJapanese = /[\u3000-\u30FF\u4E00-\u9FFF]/.test(keyword);
      const pattern = isJapanese ? keyword : `\\b${keyword}\\b`;
      return new RegExp(pattern, "i").test(allText);
    });
  }

  protected headersBuilders(options?: {
    headers?: AxiosHeaders;
    searchOptions?: Record<string, any>;
  }): AxiosHeaders {
    const headers = new AxiosHeaders(options?.headers);
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  protected getOwnText(element: Cheerio<any>): string {
    return element
      .contents()
      .filter(function () {
        return this.type === "text";
      })
      .text()
      .trim();
  }

  protected getLargestNumber(texts: string[]) {
    if (texts?.filter(Boolean)?.length === 0) return null;

    const chapterNumbers = texts
      .map((text) => {
        const match = text.match(/(\d+(?:[.-]\d+)?)/);
        if (!match) return null;

        const rawNum = match[1]?.replace("-", ".");
        const parsedNum = Number.parseFloat(rawNum ?? "");
        return Number.isNaN(parsedNum) ? null : parsedNum;
      })
      .filter((num): num is number => num !== null);

    if (chapterNumbers.length === 0) return null;

    return Math.max(...chapterNumbers);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected extractSourceIdsFromUrl(
    url?: string,
    segment = "manga",
  ): {
    parentSourceId: string;
    childSourceId?: string;
  } {
    if (!url) return { parentSourceId: "" };

    const segments = url.replace(/\/$/, "").split("/").filter(Boolean);
    const baseIndex = segments.findIndex((s) => s.toLowerCase() === segment.toLowerCase());

    if (baseIndex === -1 || baseIndex + 1 >= segments.length) {
      return { parentSourceId: "" };
    }

    const parentSourceId = segments[baseIndex + 1] || "";
    const childSourceId = segments[baseIndex + 2]
      ? segments.slice(baseIndex + 2).join("/")
      : undefined;

    const result: { parentSourceId: string; childSourceId?: string } = {
      parentSourceId,
    };

    if (childSourceId) {
      result.childSourceId = childSourceId;
    }

    return result;
  }

  protected addChapterNavigation(chapters: Chapter[] | null): Chapter[] {
    if (!chapters || chapters.length === 0) return [];

    const sorted = [...chapters].sort((a, b) => {
      const aNum = Number(a.chapterNumber);
      const bNum = Number(b.chapterNumber);

      if (Number.isNaN(aNum) && Number.isNaN(bNum)) return 0;
      if (Number.isNaN(aNum)) return 1;
      if (Number.isNaN(bNum)) return -1;

      return aNum - bNum;
    });

    return sorted?.map((chapter, i) => {
      const prevChapter = sorted?.[i - 1];
      const nextChapter = sorted?.[i + 1];

      return {
        ...chapter,
        nextChapter: nextChapter?.url || null,
        previousChapter: prevChapter?.url || null,
      };
    });
  }

  protected getValidRating(rating: string | null) {
    if (typeof rating !== "string") return null;

    const ratingNumber = Number.isNaN(Number.parseFloat(rating)) ? null : Number.parseFloat(rating);
    return ratingNumber;
  }

  protected parseSeriesDate(date: string | null | undefined): string | null {
    if (!date) return null;

    const now = new Date();

    const toMidNight = (d: Date): string => {
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    };

    const startsWith = (s: string, words: string[]): boolean =>
      words.some((w) => s.toLowerCase().startsWith(w.toLowerCase()));

    const endsWith = (s: string, words: string[]): boolean =>
      words.some((w) => s.toLowerCase().endsWith(w.toLowerCase()));

    // Handle keywords like "yesterday", "today"
    if (startsWith(date, ["yesterday", "يوم واحد"])) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return toMidNight(d);
    }

    if (startsWith(date, ["today"])) {
      return toMidNight(new Date(now));
    }

    if (startsWith(date, ["يومين"])) {
      const d = new Date(now);
      d.setDate(d.getDate() - 2);
      return toMidNight(d);
    }

    // Handle relative formats
    if (
      endsWith(date, ["ago", "atrás", "önce", "قبل"]) ||
      startsWith(date, ["hace"]) ||
      /\b\d+ jour/.test(date) ||
      /^(\d+)([smhdwMy])\s*ago$/.test(date)
    ) {
      return this.parseRelativeDate(date);
    }

    // Convert date like "5th December 2022" -> "5 December 2022"
    if (/\d(st|nd|rd|th)/.test(date)) {
      const cleaned = date
        .split(" ")
        .map((part) => (/\d\D{2}/.test(part) ? part.replace(/\D/g, "") : part))
        .join(" ");
      return this.tryParseDate(cleaned);
    }

    // Fallback: try parsing regular date
    return this.tryParseDate(date);
  }

  protected parseRelativeDate(date: string): string | null {
    const now = new Date();

    // Short-form like "5d ago"
    const shortRegex = /^(\d+)([smhdwMy])\s*ago$/;
    const shortMatch = date.match(shortRegex);
    if (shortMatch?.[1]) {
      const value = Number.parseInt(shortMatch[1], 10);
      const unit = shortMatch[2];

      const d = new Date(now);
      switch (unit) {
        case "s":
          d.setSeconds(d.getSeconds() - value);
          break;
        case "m":
          d.setMinutes(d.getMinutes() - value);
          break;
        case "h":
          d.setHours(d.getHours() - value);
          break;
        case "d":
          d.setDate(d.getDate() - value);
          break;
        case "w":
          d.setDate(d.getDate() - value * 7);
          break;
        case "M":
          d.setMonth(d.getMonth() - value);
          break;
        case "y":
          d.setFullYear(d.getFullYear() - value);
          break;
        default:
          return null;
      }
      return d.toISOString();
    }

    // Long-form: "5 days ago", "2 horas atrás", etc.
    const numberMatch = date.match(/(\d+)/);
    const number = numberMatch ? Number.parseInt(numberMatch[0], 10) : null;
    if (!number) return null;

    const units = [
      {
        words: ["hari", "gün", "jour", "día", "dia", "day", "วัน", "ngày", "giorni", "أيام", "天"],
        adjust: (d: Date) => d.setDate(d.getDate() - number),
      },
      {
        words: ["jam", "saat", "heure", "hora", "hour", "ชั่วโมง", "giờ", "ore", "ساعة", "小时"],
        adjust: (d: Date) => d.setHours(d.getHours() - number),
      },
      {
        words: ["menit", "dakika", "min", "minute", "minuto", "นาที", "دقائق"],
        adjust: (d: Date) => d.setMinutes(d.getMinutes() - number),
      },
      {
        words: ["detik", "segundo", "second", "วินาที"],
        adjust: (d: Date) => d.setSeconds(d.getSeconds() - number),
      },
      {
        words: ["week", "semana"],
        adjust: (d: Date) => d.setDate(d.getDate() - number * 7),
      },
      {
        words: ["month", "mes"],
        adjust: (d: Date) => d.setMonth(d.getMonth() - number),
      },
      {
        words: ["year", "año"],
        adjust: (d: Date) => d.setFullYear(d.getFullYear() - number),
      },
    ];

    for (const unit of units) {
      if (unit.words.some((w) => date.toLowerCase().includes(w))) {
        const d = new Date(now);
        unit.adjust(d);
        return d.toISOString();
      }
    }

    return null;
  }

  protected tryParseDate(dateString: string): string | null {
    const parsed = Date.parse(dateString);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  protected extractChapterNumber(text: string) {
    const regex = /(?:chapter|ch)\.?[\s-]*(\d+(?:\.\d+)?)/i;

    const match = text.match(regex);

    // If a match is found, return the captured group (the number)
    if (match?.[1]) {
      return Number.parseFloat(match[1])?.toString();
    }

    // If no chapter number is found, return null
    return null;
  }
}
