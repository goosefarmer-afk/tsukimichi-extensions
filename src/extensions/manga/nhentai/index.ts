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
  type SeriesListResponse,
} from "@tsukimichi/common";
import type { AxiosResponse } from "axios";

import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import manifest from "./manifest.json";
import {
  type GalleryItem,
  type Hentai,
  type NHConfig,
  type PaginatedSeriesResponse,
  toChapter,
} from "./types";
import { NHentaiAuthorizationInterceptor } from "./interceptors/authorization";
import { RateLimiter } from "@/lib/network/interceptors/rate-limiter";
import { seconds } from "@/lib/network/network-helper";
import { app } from "electron";

export class NHentai extends BaseMangaScraper {
  private $preferences: Preferences;

  private rateLimiter = new RateLimiter({
    maxRequests: 1,
    perMilliseconds: seconds(1),
    shouldLimit: (url) => {
      const baseUrlHost = new URL(url).hostname;
      const urlHost = new URL(this.baseUrl).hostname;
      return baseUrlHost === urlHost;
    },
  });

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();
  }

  override async init(): Promise<void> {
    await super.init();

    const apiKey = await this.$preferences.getString(this.PREF_API_KEY_KEY, "");
    this.client = this.network
      .newBuilder()
      // TODO: check in the app
      .addInterceptor(this.rateLimiter)
      .addInterceptor(new NHentaiAuthorizationInterceptor(this.extensionMetadata.id, apiKey))
      .build();

    this.client.defaults.headers.common["User-Agent"] = `${app.getName()}/${app.getVersion()}`;
  }

  private readonly apiUrl = `${this.baseUrl}/api/v2`;

  override getSeries: GetSeries<Manga> = async (query) => {
    const url = new URL(this.apiUrl);
    url.pathname += `/galleries/${query.replace("/g/", "/")}`;

    const { data } = await this.client.get<Hentai>(url.toString());

    return await this.parseMangaDetails(data);
  };

  override getChapters: GetMangaChapters = async (query) => {
    const url = new URL(this.apiUrl);
    url.pathname += `/galleries/${query.replace("/g/", "/")}`;

    const { data: hentai } = await this.client.get<Hentai>(url.toString());

    return [toChapter(hentai)];
  };

  override getChapterPages: GetChapterPages = async (query) => {
    const url = new URL(this.apiUrl);
    url.pathname += `/galleries/${query.replace("/g/", "/")}`;
    const { data } = await this.client.get<Hentai>(url.toString());

    const imageServer = await this.imageServer();

    return data.pages.map((p, index) => ({
      index,
      url: `${imageServer}/${p.path}`,
    }));
  };

  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};
    const isIdSearch = /^\d+$/.test(query?.trim() || "");

    const url = new URL(this.apiUrl);

    if (isIdSearch) {
      url.pathname += `/galleries/${query}`;

      const { data } = await this.client.get<Hentai>(url.toString());

      const manga = await this.parseMangaDetails(data);

      return {
        data: [manga],
        hasMore: false,
      };
    }

    // If query is empty, using `""` is a hacky way to get all results
    const baseQuery = query?.trim() || '""';
    const queryParts = [baseQuery];
    let favoritesOnly = false;

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (value === "any") continue;

      switch (type) {
        case "checkbox":
          const parsed = typeof value === "boolean" ? value : false;
          favoritesOnly = parsed;
          break;

        case "text": {
          if (favoritesOnly) continue;
          const values = String(value)
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0);

          const shouldQuote = !(filter.key === "pages" || filter.key === "uploaded");

          values.forEach((tag) => {
            let part = "";

            const isNegative = tag.startsWith("-");
            const rawTag = isNegative ? tag.slice(1) : tag;

            const isExplicitQuoted = rawTag.startsWith('"') && rawTag.endsWith('"');

            // Remove quotes
            const unquotedTag = isExplicitQuoted ? rawTag.slice(1, -1) : rawTag;

            const needsAutoQuote = shouldQuote && !isExplicitQuoted && unquotedTag.includes("-");

            if (isNegative) part += "-";

            part += `${filter.key}:`;

            if (!shouldQuote) {
              part += unquotedTag;
            } else if (isExplicitQuoted) {
              // Preserve user choice
              part += `"${unquotedTag}"`;
            } else if (needsAutoQuote) {
              part += `"${unquotedTag}"`;
            } else {
              part += unquotedTag;
            }

            queryParts.push(part);
          });

          break;
        }

        case "select":
          if (favoritesOnly) continue;
          url.searchParams.set(filter.key, value);
          break;

        default:
          break;
      }
    }

    if (favoritesOnly) url.pathname += "/favorites";
    else url.pathname += "/search";
    url.searchParams.set("query", queryParts.join(" "));
    url.searchParams.set("page", page.toString());

    const response = await this.client.get(url.toString());

    return await this.parseSearchManga(response);
  };

  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL(`${this.apiUrl}/search`);
    url.searchParams.set("query", '""');
    url.searchParams.set("sort", "popular");
    url.searchParams.set("page", page.toString());

    const response = await this.client.get(url.toString());

    return await this.parseSearchManga(response);
  };

  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL(`${this.apiUrl}/galleries`);
    url.searchParams.set("page", page.toString());

    const response = await this.client.get(url.toString());

    return await this.parseSearchManga(response);
  };

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.TITLE_PREFERENCE_KEY,
      label: "Title preference",
      type: "select",
      options: [
        { value: "full", label: "Full" },
        { value: "short", label: "Short" },
      ],
      defaultValue: "full",
    },
    {
      key: this.PREF_API_KEY_KEY,
      label: "API key",
      description: "Get your API key at https://nhentai.net/user/settings#apikeys",
      type: "text",
      defaultValue: "",
    },
  ];

  override getFilterConfig: GetFilterConfig = () => ({
    header: 'Sort is ignored if "favorites only"',
    filters: [
      {
        key: "sort",
        label: "Sort by",
        options: [
          {
            label: "Popular: All Time",
            value: "popular",
          },
          {
            label: "Popular: Month",
            value: "popular-month",
          },
          {
            label: "Popular: Week",
            value: "popular-week",
          },
          {
            label: "Popular: Today",
            value: "popular-today",
          },
          {
            label: "Recent",
            value: "date",
          },
        ],
        type: "select",
        defaultValue: "date",
      },
      {
        key: "tag",
        label: "Tags",
        type: "text",
        description:
          "Separate tags with commas (,). Prepend with dash (-) to exclude. Wrap in double quotes for exact match",
        placeholder: 'eg: tag1, "tag2", -tag3',
        defaultValue: "",
      },
      {
        key: "artist",
        label: "Artists",
        type: "text",
        placeholder: 'eg: artist1, "artist-2"',
        defaultValue: "",
      },
      {
        key: "group",
        label: "Groups",
        type: "text",
        placeholder: 'eg: group1, "group-2"',
        defaultValue: "",
      },
      {
        key: "parody",
        label: "Parodies",
        type: "text",
        placeholder: 'eg: parody1, "parody-2"',
        defaultValue: "",
      },
      {
        key: "pages",
        type: "text",
        label: "Pages",
        description: "Filter by pages. Example: >40",
        placeholder: "eg: >40",
        defaultValue: "",
      },
      {
        key: "uploaded",
        type: "text",
        label: "Uploaded",
        description: "Filter by uploaded. Valid units are: h, d, w, m, y.",
        placeholder: "eg: >40d",
        defaultValue: "",
      },
      {
        key: "favories",
        type: "checkbox",
        label: "Show favorites only",
      },
    ],
  });

  private async parseSearchManga(
    response: AxiosResponse<PaginatedSeriesResponse<GalleryItem>>,
  ): Promise<SeriesListResponse<Manga>> {
    const thumbServer = await this.thumbServer();
    const { data, config } = response;

    const page = this.toNumberOrNull(new URL(config.url!).searchParams.get("page")) ?? 1;
    const hasMore =
      (data.num_pages != null && data.num_pages > page) ||
      (data.num_pages == null && data.total != null && data.total > data.per_page * page);

    const shortenTitle = this.settings?.[this.TITLE_PREFERENCE_KEY] === "short";
    return {
      data: data.result.map((item) => ({
        url: `/g/${item.id}`,
        title: this.getProperTitle(
          {
            english: item.english_title,
            japanese: item.japanese_title,
            pretty: null,
          },
          shortenTitle,
        ),
        coverImageUrl: item.thumbnail ? `${thumbServer}/${item.thumbnail}` : null,
        isNsfw: true,
        status: "completed",
      })),
      hasMore,
    };
  }

  private async parseMangaDetails(hentai: Hentai): Promise<Manga> {
    const thumbServer = await this.thumbServer();
    const shortenTitle = this.settings?.[this.TITLE_PREFERENCE_KEY] === "short";

    const artists = new Set<string>();
    const authors = new Set<string>();
    const genres = new Set<string>();
    let description = "";

    hentai.tags
      .filter((t) => t.type === "artist")
      .filter(Boolean)
      .forEach((a) => {
        artists.add(a.name);
      });

    hentai.tags
      .filter((t) => t.type === "group")
      .filter(Boolean)
      .forEach((a) => {
        authors.add(a.name);
      });

    hentai.tags
      .filter((t) => t.type === "tag")
      .filter(Boolean)
      .sort((t1, t2) => t1.name.localeCompare(t2.name))
      .forEach((a) => {
        genres.add(a.name);
      });

    const categories = hentai.tags.filter((t) => t.type === "category").filter(Boolean);
    const parodies = hentai.tags.filter((t) => t.type === "parody").filter(Boolean);
    const characters = hentai.tags.filter((t) => t.type === "character").filter(Boolean);

    description = `Full English and Japanese titles: ${hentai.title?.english ?? hentai.title?.pretty ?? ""} ${hentai.title?.japanese ?? ""}<br/><br/>`;

    description += `Pages: ${hentai.num_pages}<br>`;

    description += `Favorited by: ${hentai.num_favorites}<br>`;

    if (categories.length > 0) {
      description += `Categories: ${categories.map((c) => c.name).join(", ")}<br/>`;
    }

    if (parodies.length > 0) {
      description += `Parodies: ${parodies.map((c) => c.name).join(", ")}<br/>`;
    }

    if (characters.length > 0) {
      description += `Characters: ${characters.map((c) => c.name).join(", ")}<br/>`;
    }

    return {
      title: this.getProperTitle(hentai.title, shortenTitle),
      description,
      status: "completed",
      isNsfw: true,
      coverImageUrl: `${thumbServer}/${hentai.thumbnail.path}`,
      url: `/g/${hentai.id}`,
      artists: Array.from(artists),
      authors: Array.from(authors),
      genres: Array.from(genres),
      lastUpdated: this.parseSeriesDate(new Date(hentai.upload_date * 1000).toISOString()),
    };
  }

  private async imageServer(): Promise<string> {
    const config = await this.getNHConfig();
    const randomServer =
      config.image_servers[Math.floor(Math.random() * config.image_servers.length)];
    return randomServer || config.image_servers[0]!;
  }

  private async thumbServer(): Promise<string> {
    const config = await this.getNHConfig();
    const randomThumb =
      config.thumb_servers[Math.floor(Math.random() * config.thumb_servers.length)];
    return randomThumb || config.thumb_servers[0]!;
  }

  private async getNHConfig(): Promise<NHConfig> {
    try {
      const { data } = await this.client.get<NHConfig>(`${this.apiUrl}/config`);

      return data;
    } catch {
      return {
        image_servers: [1, 2, 3, 4].map((i) => `https://i${i}.nhentai.net`),
        thumb_servers: [1, 2, 3, 4].map((i) => `https://t${i}.nhentai.net`),
      };
    }
  }

  private decodeUnicode(str: string): string {
    if (!str.includes("\\u")) return str;

    try {
      return JSON.parse(`"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    } catch {
      return str;
    }
  }

  private getProperTitle(
    titleObject:
      | {
          english: string | null;
          japanese: string | null;
          pretty: string | null;
        }
      | string,
    shortenTitle: boolean,
  ) {
    let title: string;

    if (typeof titleObject === "string") title = titleObject;
    else
      title =
        titleObject.english ?? this.decodeUnicode(titleObject.japanese ?? "") ?? titleObject.pretty;

    if (!title) return "";

    return shortenTitle ? title.replace(this.shortenTitleRegex, "").trim() : title.trim();
  }

  private readonly API_PATH_REGEX = /^\/api\/v2\/.*$/;
  private readonly NHENTAI_HOST = "nhentai.net";

  private readonly TITLE_PREFERENCE_KEY = "titlePreference";
  private readonly PREF_API_KEY_KEY = "pref_api_key";
  private readonly shortenTitleRegex = /(\[[^\]]*\]|[({][^)}]*[)}])/g;
}
