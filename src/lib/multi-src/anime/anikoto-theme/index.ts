import crypto from "node:crypto";
import type {
  Anime,
  Episode,
  ExtensionClientConstructorOptions,
  ExtensionMetadata,
  GetEpisodes,
  GetFilterConfig,
  GetLatestSeries,
  GetPopularSeries,
  GetSeries,
  GetSeriesStatus,
  GetSettingsFilters,
  GetVideos,
  SearchSeries,
  SeriesListResponse,
} from "@tsukimichi/common";
import { resolveFilterEntries } from "@tsukimichi/common";
import type { AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { KwikExtractor } from "@/extensions/anime/animepahe/kwik-extractor";
import { BaseAnimeScraper } from "@/generic/base-anime-scraper";
import { PlaylistUtils } from "@/lib/playlist-utils";
import { ANIKOTO_THEME_FILTERS } from "./filters";
import type { VideoServer } from "./types";
import { substringBefore } from "@/utils/string";
import { AnikotoExtractor } from "./anikoto-extractor";

interface AnikotoThemeConstructorOptions extends ExtensionClientConstructorOptions {
  metadata: ExtensionMetadata;
  mirrors: string[];
  hosterNames?: string[];
}

export class AnikotoTheme extends BaseAnimeScraper {
  private readonly MIRRORS: string[];
  private readonly PREFERRED_DEFAULT_MIRROR: string;
  playlistUtils: PlaylistUtils;
  private kwikExtractor: KwikExtractor;
  extractor: AnikotoExtractor;

  constructor(options: AnikotoThemeConstructorOptions) {
    // oxlint-disable-next-line no-unused-vars unused hosterNames
    const { mirrors, hosterNames, ...rest } = options;
    super({ ...rest });
    this.MIRRORS = mirrors;
    this.PREFERRED_DEFAULT_MIRROR = this.MIRRORS[0]!;

    this.baseUrl = this.preferences.getPreferredMirror();

    this.playlistUtils = new PlaylistUtils(this.client);
    this.kwikExtractor = new KwikExtractor(this.client);
    this.extractor = new AnikotoExtractor(this, this.client);
  }

  override searchSeries: SearchSeries<Anime> = async (query, options) => {
    const { data: html } = await this.searchAnimeRequest(query, options);
    return this.parsePopularAnime({
      html,
      selector: this.popularAnimeSelector,
      nextPageSelector: this.popularAnimeNextPageSelector,
    });
  };

  protected searchAnimeRequest(
    query?: string,
    options?: Record<string, any>,
  ): Promise<AxiosResponse> {
    const { page = 1, filters } = options ?? {};

    const url = new URL("filter", this.baseUrl);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("keyword", query?.trim() || "");

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value);
          break;

        case "multi-select":
          if (!(Array.isArray(value) && value.length)) continue;
          value.forEach((v) => {
            url.searchParams.append(filter.key, v);
          });
          break;

        case "tri-state-checkbox":
          if (Array.isArray(value) && value.length) {
            for (const item of value) {
              let valuePrefix = "";
              if (item.state === "include") valuePrefix = "";
              else if (item.state === "exclude") valuePrefix = "-";
              url.searchParams.append(filter.key, `${valuePrefix}${item.value}`);
            }
          }
          break;
        default:
          break;
      }
    }
    return this.client.get(url.toString());
  }

  override getPopularSeries: GetPopularSeries<Anime> = async (options) => {
    const { data: html } = await this.popularAnimeRequest(options);
    return this.parsePopularAnime({
      html,
      selector: this.popularAnimeSelector,
      nextPageSelector: this.popularAnimeNextPageSelector,
    });
  };

  protected popularAnimeRequest(options?: Record<string, any>): Promise<AxiosResponse> {
    const { page = 1 } = options ?? {};

    const url = new URL("most-viewed", this.baseUrl);
    url.searchParams.set("page", page.toString());

    return this.client.get<string>(url.toString());
  }

  override getLatestSeries: GetLatestSeries<Anime> = async (options) => {
    const { data: html } = await this.latestAnimeRequest(options);
    return this.parsePopularAnime({
      html,
      selector: this.latestAnimeSelector,
      nextPageSelector: this.latestAnimeNextPageSelector,
    });
  };

  cleanHlsQuality(quality: string) {
    return substringBefore(substringBefore(quality, " - "), " (");
  }

  protected latestAnimeRequest(options?: Record<string, any>): Promise<AxiosResponse> {
    const { page = 1 } = options ?? {};

    const url = new URL("latest-updated", this.baseUrl);
    url.searchParams.set("page", page.toString());

    return this.client.get<string>(url.toString());
  }

  protected parsePopularAnime(options: {
    html: string;
    selector: string;
    nextPageSelector: string;
  }): SeriesListResponse<Anime> {
    const { html, selector, nextPageSelector } = options;
    const $ = cheerio.load(html);

    const animes: Anime[] = [];

    $(selector).each((_, el) => {
      const $el = $(el);

      const $anchor = $el.find("a.name, div.name > a").first();
      const urlFromElement = $anchor.attr("href");
      if (!urlFromElement) return;

      const url = this.setUrlWithoutDomain(urlFromElement.replace(this.EP_URL_SUFFIX_REGEX, ""));
      const title = this.getProperTitle($anchor);

      let coverImageUrl: string | null = null;
      if (this.listingCoverSelector) {
        const imgEl = $el.find(this.listingCoverSelector);
        coverImageUrl = imgEl.attr("data-src") || imgEl.attr("src") || null;
      }

      animes.push({
        title,
        coverImageUrl,
        isNsfw: null,
        status: "unknown",
        url,
      });
    });

    const hasMore = $(nextPageSelector).length > 0;

    return {
      data: animes,
      hasMore,
    };
  }

  override getSeries: GetSeries<Anime> = async (query) => {
    const url = new URL(query, this.baseUrl);
    const { data: html } = await this.client.get(url.toString());

    return this.parseAnimeDetails(html, url);
  };

  protected parseAnimeDetails(html: string, url: URL): Anime {
    const $ = cheerio.load(html);

    const titleEl = $("h1.title, h2.title");
    const title = this.getProperTitle(titleEl);

    let coverImageUrl: string | null = null;
    if (this.animeDetailsCoverSelector) {
      const imgEl = $(this.animeDetailsCoverSelector);
      coverImageUrl = imgEl.attr("data-src") || imgEl.attr("src") || null;
    }

    const genres = $('div:contains("Genres:") > span > a')
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);

    const studios = $('div:contains("Studios:") > span > a')
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);

    const producers = $('div:contains("Producers:") > span > a')
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);

    const isNsfw = this.isNsfw($("div.meta i.rating").text().trim());

    const alternateTitles = $(this.animeDetailsAlternateTitlesSelector)
      .text()
      .trim()
      .split(";")
      .filter(Boolean)
      .map((t) => t.trim());

    const description = this.buildDescription($);

    return {
      title,
      url: `${this.setUrlWithoutDomain(url.toString())}`,
      coverImageUrl,
      isNsfw,
      status: this.getSeriesStatus($('div:contains("Status:") > span').text().trim()),
      genres,
      studios,
      producers,
      description,
      alternateTitles,
    };
  }

  protected buildDescription($: cheerio.CheerioAPI): string {
    let description = "";

    const detailsContent = $(this.animeDetailsDescriptionSelector).text().trim();
    description += `${detailsContent.length ? `${detailsContent}<br>` : ""}`;

    const metaDescription = this.getMetaDescription($);
    description += `${metaDescription.length ? `${metaDescription}` : ""}`;

    return description;
  }

  protected descriptionSelectors() {
    return [
      {
        selector: 'div.meta div:contains("Type:") > span',
        label: "Type:",
      },
      {
        selector: 'div.meta div:contains("Country:") > span',
        label: "Country:",
      },
      {
        selector: 'div.meta div:contains("Premiered:") > span',
        label: "Premiered:",
      },
      {
        selector:
          'div.meta div:contains("Date aired:") > span, div.meta div:contains("Aired:") > span',
        label: "Date aired:",
      },
      {
        selector: 'div:contains("MAL:") > span',
        label: "MAL rating:",
      },
      {
        selector: 'div.meta div:contains("Duration:") > span',
        label: "Duration:",
      },
      {
        selector: 'div.meta div:contains("Episodes:") > span',
        label: "Episodes:",
      },
      {
        selector: 'div.meta div:contains("Broadcast:") > span',
        label: "Broadcast:",
      },
    ];
  }

  protected getMetaDescription($: cheerio.CheerioAPI): string {
    let desc = "";

    this.descriptionSelectors().forEach(({ selector, label }) => {
      const value = $(selector).text().trim();
      if (value) {
        desc += `<br>${label} ${value}`;
      }
    });

    return desc;
  }

  protected getProperTitle($el: cheerio.Cheerio<any>) {
    const lang = this.preferences.getPreferredTitleLang();

    const englishTitle = $el.text().trim();
    const romajiTitle = $el.attr("data-jp")?.trim();

    if (lang === "romaji") return romajiTitle || englishTitle;
    return englishTitle;
  }

  protected isNsfw(text: string): boolean | null {
    switch (text.toLowerCase()) {
      case "g":
        return false;
      case "pg":
        return false;
      case "pg_13":
      case "pg-13":
      case "pg 13":
      case "pg13":
        return false;
      case "r":
        return true;
      case "r+":
        return true;
      case "rx":
        return true;
      default:
        return null;
    }
  }

  protected episodeFromElement(element: cheerio.Cheerio<any>, animeUrl: string): Episode | null {
    const titleAttr = element.parent().attr("title") || "";
    const episodeNumber = this.toNumberOrNull(element.attr("data-num"));
    const ids = element.attr("data-ids");
    if (!ids) return null;

    const sub = this.toNumberOrNull(element.attr("data-sub")) === 1 ? "Sub" : "";
    const dub = this.toNumberOrNull(element.attr("data-dub")) === 1 ? "Dub" : "";
    const softSub = this.SOFTSUB_REGEX.test(titleAttr) ? "SoftSub" : "";
    const malId = element.attr("data-mal");
    const slug = element.attr("data-slug");
    const timestamp = element.attr("data-timestamp");

    const name = element.parent().find("span.d-title").text().trim();

    let title = `Episode ${episodeNumber}`;
    if (name && name !== title) title += `: ${name}`;

    const epUrl = `${animeUrl.replace(this.EP_URL_SUFFIX_REGEX, "")}/ep-${episodeNumber}`;
    const urlParams = new URLSearchParams({
      ids,
      epUrl,
    });
    if (malId) urlParams.set("malId", malId);
    if (slug) urlParams.set("slug", slug);
    if (timestamp) urlParams.set("timestamp", timestamp);

    return {
      title,
      url: decodeURIComponent(urlParams.toString()),
      episodeNumber,
      scanlator: [sub, dub, softSub].filter(Boolean).join(", "),
    };
  }

  override getEpisodes: GetEpisodes = async (query) => {
    const url = new URL(query, this.baseUrl);

    let animeId: string | null = null;

    if (!animeId) {
      const { data: animeDetailsHtml } = await this.client.get(url.toString());

      const $ = cheerio.load(animeDetailsHtml);

      const newAnimeId =
        $("div[data-id]").first().attr("data-id") || $("[data-tip]").first().attr("data-id");
      if (!newAnimeId) throw new Error("Anime ID not found");
      animeId = newAnimeId;
    }

    const headers = this.headersBuilders();
    headers.set("Accept", "application/json, text/javascript, */*;");
    headers.set("Referer", new URL(query, this.baseUrl).toString());
    headers.set("X-Requested-With", "XMLHttpRequest");

    const ajaxUrl = new URL(`ajax/episode/list/${animeId}`, this.baseUrl);

    const { data: episodeResult } = await this.client.get<{ result: string }>(ajaxUrl.toString(), {
      headers,
    });

    const $ = cheerio.load(episodeResult.result);

    const episodes: Episode[] = [];

    $(this.episodeListSelector).each((_, el) => {
      const episode = this.episodeFromElement($(el), query);

      if (episode) episodes.push(episode);
    });
    return episodes;
  };

  protected serverListRequest(query: string): Promise<AxiosResponse> {
    const params = new URLSearchParams(query);
    const ids = params.get("ids");
    if (!ids) throw new Error("ids not found");
    const eps = this.toNumberOrNull(params.get("eps") ?? params.get("slug"), true);

    const epUrl = params.get("epUrl");
    const headers = this.headersBuilders();
    headers.set("Accept", "application/json, text/javascript, */*;");
    headers.set("Referer", new URL(epUrl || "/", this.baseUrl).toString());
    headers.set("X-Requested-With", "XMLHttpRequest");

    const serverListUrl = new URL("ajax/server/list", this.baseUrl);
    serverListUrl.searchParams.set("servers", ids);
    if (eps != null) serverListUrl.searchParams.set("eps", eps.toString());

    return this.client.get(serverListUrl.toString(), { headers });
  }

  protected extractBaseServerName(rawName: string): string {
    let name = rawName.replace(/-*\\d+\\s*$/g, "");
    name = name.endsWith("-") ? name.slice(0, -1) : name;
    return name;
  }

  protected serverSelector(type: string): string {
    return `div.servers div[data-type="${type}"] ul > li`;
  }

  parseServerList(html: string): VideoServer[] {
    const videoServers: VideoServer[] = [];
    const $ = cheerio.load(html);

    const servers = ["sub", "hsub", "ssub", "dub"];

    for (const server of servers) {
      const $server = $(this.serverSelector(server));
      if (!$server.length) continue;

      $server.each((_, el) => {
        const $el = $(el);
        const link = $el.attr("data-link-id");
        if (!link) return;

        if (server === "sub" || server === "hsub" || server === "ssub") {
          let name = this.extractBaseServerName($el.text().trim());
          const type = server === "sub" ? "Sub" : server === "hsub" ? "H-Sub" : "S-Sub";
          videoServers.push({
            name,
            serverId: link,
            type,
          });
        }

        if (server === "dub") {
          const name = this.extractBaseServerName($el.text().trim());
          videoServers.push({
            serverId: link,
            type: "Dub",
            name,
          });
        }
      });
    }

    return videoServers;
  }

  override labelToLang(label: string): string | undefined {
    return super.labelToLang(label);
  }

  mapperUrl = "https://mapper.nekostream.site/api";
  hasMapper = true;

  async getEmbedLink(serverId: string, epUrl: string): Promise<string> {
    const headers = this.headersBuilders();
    headers.set("Accept", "application/json, text/javascript, */*;");
    headers.set("Referer", new URL(epUrl, this.baseUrl).href);
    headers.set("X-Requested-With", "XMLHttpRequest");

    const url = new URL("ajax/server", this.baseUrl);
    url.searchParams.set("get", serverId);

    const { data } = await this.client.get(url.toString(), { headers });

    if (!data.result?.url) throw new Error("Video not found");
    return data.result.url;
  }

  private parseHostMap(html: string): Map<string, string> {
    const mapRegex = /var HOST_MAP\s*=\s*\{([\s\S]*?)\}/;
    const entryRegex = /'([^']+)'\s*:\s*'([^']+)'/g;

    const hostMap = new Map<string, string>();

    const mapMatch = html.match(mapRegex);
    if (!mapMatch?.[1]) return hostMap;

    let entryMatch: RegExpExecArray | null = null;
    while ((entryMatch = entryRegex.exec(mapMatch[1]))) {
      hostMap.set(entryMatch[1]!, entryMatch[2]!);
    }
    return hostMap;
  }

  private applyHostMap(url: string, hostMap: Map<string, string>): string {
    let result = url;
    for (const [origin, proxy] of hostMap) {
      if (result.includes(origin)) {
        result = result.replace(origin, proxy);
      }
    }

    return result;
  }

  mapMapperServerName(key: string): string {
    const sanitized = key.trim().toLowerCase();
    if (sanitized === "gogoanime") return "Vidstream";
    if (sanitized === "anivibe") return "Vibe-Stream";
    if (sanitized === "animepahe") return "Kiwi-Stream";
    if (sanitized.startsWith("kiwi-stream")) return key;
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  alwaysNeedsProxy(serverName: string): boolean {
    const name = serverName.trim().toLowerCase();
    switch (true) {
      case name.includes("kiwi"):
        return true;
      case name.includes("vidplay"):
        return true;
      default:
        return false;
    }
  }

  override getVideos: GetVideos = async (query) => {
    const { data } = await this.serverListRequest(query);
    const params = new URLSearchParams(query);

    const epUrl = params.get("epUrl");
    const referer = new URL(epUrl || "/", this.baseUrl).href;

    return this.extractor.extractVideos(data.result, query, referer);
  };

  private typePriority(label: string): number {
    if (label.toLowerCase().includes("sub")) return 0;
    if (label.toLowerCase().includes("dub")) return 1;
    return 2;
  }

  override getFilterConfig: GetFilterConfig = () => {
    let filters = ANIKOTO_THEME_FILTERS;
    if (!this.useTriStateForGenres) {
      filters = filters.map((f) => {
        if (f.key === "genre[]") {
          return {
            ...f,
            type: "multi-select",
            renderAs: "checkbox-group",
            defaultValue: [],
          };
        }
        return f;
      });
    }

    return {
      filters,
    };
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREFERRED_MIRROR_KEY,
      label: "Preferred Mirror",
      type: "select",
      options: this.MIRRORS.map((m) => ({
        label: new URL(m).hostname,
        value: m,
      })),
      defaultValue: this.PREFERRED_DEFAULT_MIRROR,
    },
    {
      key: this.PREFERRED_TITLE_LANG_KEY,
      label: "Preferred Title Language",
      type: "select",
      options: [
        { label: "English", value: "english" },
        { label: "Romaji", value: "romaji" },
      ],
      defaultValue: "english",
    },
  ];

  override getSeriesStatus: GetSeriesStatus = (input) => {
    switch (input?.toLowerCase()) {
      case "finished airing":
        return "completed";
      case "currently airing":
      case "airing":
        return "ongoing";
      case "not yet aired":
        return "upcoming";
      default:
        return "unknown";
    }
  };

  private getServerInfo(serverName: string): {
    displayName: string;
    quality: string;
    qualityNum: number | null;
  } {
    const qualityMatch = serverName.match(/(\d+)p$/);
    const quality = qualityMatch?.[0];
    const qualityNum = this.toNumberOrNull(qualityMatch?.[1]);

    const nameWithQuality = quality
      ? serverName.substring(0, serverName.lastIndexOf(`-${quality}`))
      : serverName;

    const parts = nameWithQuality.split("-");
    const numPart = this.toNumberOrNull(parts.at(-1));
    const rawBaseName =
      numPart != null && parts.length > 1 ? parts.slice(-1).join("-") : nameWithQuality;

    const displayName = rawBaseName
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("-");

    return {
      displayName,
      quality: quality || "",
      qualityNum,
    };
  }

  protected animeDetailsCoverSelector = "";
  protected animeDetailsAlternateTitlesSelector = "div.names.font-italic";
  protected animeDetailsDescriptionSelector = "div.synopsis div.content";

  private readonly PREFERRED_MIRROR_KEY = "preferredMirror";
  private readonly PREFERRED_TITLE_LANG_KEY = "preferredTitleLang";

  protected preferences = {
    getPreferredMirror: (): string => {
      const mirror = this.settings?.[this.PREFERRED_MIRROR_KEY];
      if (mirror && this.MIRRORS.includes(mirror)) return mirror;
      return this.PREFERRED_DEFAULT_MIRROR;
    },

    getPreferredTitleLang: (): string =>
      this.settings?.[this.PREFERRED_TITLE_LANG_KEY] || "english",
  };

  private readonly EXCHANGE_KEY_1 = ["AP6GeR8H0lwUz1", "UAz8Gwl10P6ReH"];
  private readonly KEY_1 = "ItFKjuWokn4ZpB";
  private readonly KEY_2 = "fOyt97QWFB3";
  private readonly EXCHANGE_KEY_2 = ["1majSlPQd2M5", "da1l2jSmP5QM"];
  private readonly EXCHANGE_KEY_3 = ["CPYvHj09Au3", "0jHA9CPYu3v"];
  private readonly KEY_3 = "736y1uTJpBLUX";

  private readonly ORDER: OrderItem[] = [
    {
      step: 1,
      type: "exchange",
      value: this.EXCHANGE_KEY_1,
    },
    {
      step: 2,
      type: "rc4",
      value: this.KEY_1,
    },
    {
      step: 3,
      type: "rc4",
      value: this.KEY_2,
    },
    {
      step: 4,
      type: "exchange",
      value: this.EXCHANGE_KEY_2,
    },
    {
      step: 5,
      type: "exchange",
      value: this.EXCHANGE_KEY_3,
    },
    {
      step: 6,
      type: "reverse",
      value: "",
    },
    {
      step: 7,
      type: "rc4",
      value: this.KEY_3,
    },
    {
      step: 8,
      type: "base64",
      value: "",
    },
  ];

  private vrfEncrypt(input: string): string {
    let vrf = input;

    for (const item of this.ORDER.sort((a, b) => a.step - b.step)) {
      switch (item.type) {
        case "exchange":
          vrf = this.exchange(vrf, item.value as string[]);
          break;

        case "rc4":
          vrf = this.rc4Encrypt(item.value as string, vrf);
          break;

        case "reverse":
          vrf = vrf.split("").reverse().join("");
          break;

        case "base64":
          vrf = this.toUrlSafeBase64(vrf);
          break;
        default:
          continue;
      }
    }

    return encodeURIComponent(vrf);
  }

  private exchange(input: string, keys: string[]): string {
    const [key1, key2] = keys;

    return input
      .split("")
      .map((char) => {
        const index = key1!.indexOf(char);
        return index !== -1 ? key2![index] : char;
      })
      .join("");
  }

  private rc4Encrypt(key: string, input: string): string {
    const cipher = crypto.createCipheriv("rc4", Buffer.from(key), null);

    const encrypted = Buffer.concat([cipher.update(Buffer.from(input, "utf-8")), cipher.final()]);

    return this.toUrlSafeBase64FromBuffer(encrypted);
  }

  private toUrlSafeBase64(str: string): string {
    return this.toUrlSafeBase64FromBuffer(Buffer.from(str, "utf8"));
  }

  private toUrlSafeBase64FromBuffer(buffer: Buffer): string {
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  protected useTriStateForGenres = true;

  protected get popularAnimeSelector(): string {
    return "div.ani.items > div.item";
  }
  protected get popularAnimeNextPageSelector(): string {
    return "nav > ul.pagination > li.active ~ li";
  }

  protected get latestAnimeSelector(): string {
    return this.popularAnimeSelector;
  }
  protected get latestAnimeNextPageSelector(): string {
    return this.popularAnimeNextPageSelector;
  }

  protected get searchAnimeSelector(): string {
    return this.popularAnimeSelector;
  }
  protected get searchAnimeNextPageSelector(): string {
    return this.popularAnimeNextPageSelector;
  }

  protected listingCoverSelector = "div.poster img";

  protected episodeListSelector = "div.episodes ul > li > a";

  private readonly SOFTSUB_REGEX = /\bsoftsub\b/i;

  protected EP_URL_SUFFIX_REGEX = /\/ep-\d+$/;
}

interface OrderItem {
  step: number;
  type: "exchange" | "reverse" | "rc4" | "base64";
  value: string | string[];
}
