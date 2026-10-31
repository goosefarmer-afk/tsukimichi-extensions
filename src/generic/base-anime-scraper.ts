import {
  type Anime,
  AnimeExtensionClient,
  type Episode,
  type ExtensionClientConstructorOptions,
  type ExtensionMetadata,
  type GetEpisodes,
  type GetFilterConfig,
  type GetImage,
  type GetLatestSeries,
  type GetMetadata,
  type GetPopularSeries,
  type GetSeries,
  type GetSettingsFilters,
  type GetVideos,
  LANGUAGES,
  type SearchSeries,
} from "@tsukimichi/common";
import { AxiosHeaders, type AxiosInstance } from "axios";
import type { Cheerio } from "cheerio";
import { NSFW_KEYWORDS } from "@/lib/constants";
import { NetworkHelper } from "@/lib/network/network-helper";

export abstract class BaseAnimeScraper extends AnimeExtensionClient {
  name: string;
  extensionMetadata: ExtensionMetadata;
  baseUrl: string;

  protected network: NetworkHelper;

  protected client: AxiosInstance;

  constructor(
    options: ExtensionClientConstructorOptions & {
      metadata: ExtensionMetadata;
    },
  ) {
    super(options);

    this.extensionMetadata = options.metadata;
    this.name = this.extensionMetadata.name;
    this.baseUrl = this.extensionMetadata.url;
    this.network = new NetworkHelper({
      extensionId: options.metadata.id,
      dohProvider: () => this.settings["dohProvider"] || "",
    });
    this.client = this.network.client;
  }

  abstract override getSeries: GetSeries<Anime>;
  abstract override getEpisodes: GetEpisodes;
  abstract override searchSeries: SearchSeries<Anime>;
  abstract override getPopularSeries: GetPopularSeries<Anime>;
  abstract override getLatestSeries: GetLatestSeries<Anime>;
  abstract override getVideos: GetVideos;

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [],
  });

  override getSettingsFilters: GetSettingsFilters = () => [];

  getMetadata: GetMetadata = () => this.extensionMetadata;

  getImage: GetImage = async (url) => {
    const { data, headers } = await this.client.get(url, {
      responseType: "arraybuffer",
    });

    const contentType = (headers["Content-Type"] as string) || "image/jpeg";

    return {
      data,
      contentType,
    };
  };

  protected detectNsfw(params: {
    title: string;
    description?: string | null;
    genres?: string[] | null;
    tags?: string[];
  }): boolean {
    const { title, description, genres, tags } = params;

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
    const number = numberMatch ? Number(numberMatch[0]) : null;
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

  protected getOwnText(element: Cheerio<any>): string {
    return element
      .contents()
      .filter(function () {
        return this.type === "text";
      })
      .text()
      .trim();
  }

  protected headersBuilders(): AxiosHeaders {
    const headers = new AxiosHeaders();
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  protected slugify(input?: string): string {
    if (!input || typeof input !== "string") return "";

    return input
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  protected toAbsoluteUrl(input?: string | null, base?: string): string | null {
    if (!input?.trim()) return null;

    try {
      const url = new URL(input, base || this.baseUrl);
      return url.toString();
    } catch {
      return null;
    }
  }

  protected addEpisodeNavigation(episodes: Episode[] | null): Episode[] {
    if (!episodes || episodes.length === 0) return [];

    const sorted = [...episodes].sort((a, b) => {
      const aNum = Number(a.episodeNumber);
      const bNum = Number(b.episodeNumber);

      if (Number.isNaN(aNum) && Number.isNaN(bNum)) return 0;
      if (Number.isNaN(aNum)) return 1;
      if (Number.isNaN(bNum)) return -1;

      return aNum - bNum;
    });

    return sorted?.map((episode, i) => {
      const previousEpisode = sorted?.[i - 1];
      const nextEpisode = sorted?.[i + 1];

      return {
        ...episode,
        previousEpisode: previousEpisode?.url || null,
        nextEpisode: nextEpisode?.url || null,
      };
    });
  }

  protected labelToLang(label: string): string | undefined {
    if (!label) return undefined;

    const normalized = label
      .toLowerCase()
      .replace(/[()]/g, "")
      .replace(/[_\s-]+/g, " ")
      .trim();

    const tokens = normalized.split(/\s+/);

    const langKey = tokens.find((token) => token in this.LANG_MAP);

    if (langKey) {
      const lang = this.LANG_MAP[langKey as keyof typeof this.LANG_MAP];

      const regionKey = tokens.find((token) => token in this.REGION_MAP);
      const region = regionKey ? this.REGION_MAP[regionKey] : undefined;

      if (lang === "zh" && region) {
        const script = this.CHINESE_LANG_SCRIPT_MAP[region] ?? "Hans";
        return `${lang}-${script}-${region.toUpperCase()}`;
      }

      return region ? `${lang}-${region.toUpperCase()}` : lang;
    }

    for (const token of tokens) {
      if (this.ISO_639_1_CODES.has(token)) {
        return token;
      }
    }

    return undefined;
  }

  private readonly LANG_MAP = {
    english: "en",
    spanish: "es",
    french: "fr",
    german: "de",
    italian: "it",
    portuguese: "pt",
    russian: "ru",
    chinese: "zh",
    japanese: "ja",
    korean: "ko",
    arabic: "ar",
    indonesian: "id",
    bahasa: "id",
    malay: "ms",
    thai: "th",
    vietnamese: "vi",
    vietnam: "vi",
  } as const;

  private readonly REGION_MAP: Record<string, string> = {
    mexico: "mx",
    mx: "mx",
    brazil: "br",
    br: "br",
    unitedstates: "us",
    us: "us",
    uk: "gb",
    england: "gb",
    egypt: "eg",
    saudi: "sa",
    indonesia: "id",
    malaysia: "my",
    vietnam: "vn",
  };

  private ISO_639_1_CODES = new Set(Object.keys(LANGUAGES));

  protected readonly CHINESE_LANG_SCRIPT_MAP: Record<string, string> = {
    hk: "Hant",
    tw: "Hant",
    cn: "Hans",
  };
}
