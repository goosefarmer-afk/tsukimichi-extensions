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
  type TriStateFilterValue,
} from "@tsukimichi/common";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { BaseMangaScraper } from "@/generic/base-manga-scraper";
import {
  type AllChaptersResponse,
  type AtsumaruBrowseMangaResponse,
  type AtsumaruChapterPagesResponse,
  type AtsumaruMangaPage,
  type AtsumaruSearchResponse,
  toChapter,
  toManga,
} from "./dto";
import {
  ATSUMARU_GENRE_OPTIONS,
  ATSUMARU_MANGA_TYPE_OPTIONS,
  ATSUMARU_STATUS_OPTIONS,
  ATSUMARU_TAG_OPTIONS,
  ATSUMARU_SORT_OPTIONS,
} from "./filters";
import manifest from "./manifest.json";
import { StringUtils } from "@/utils/string";

export class Atsumaru extends BaseMangaScraper {
  private $preferences: Preferences;
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.$preferences = options.$context!.createPreferences!();
  }

  private SCANLATION_MAP: Record<string, string> = {
    cmobi7ow00007bqqma8a2th5i: "Alpha",
    cmo94ws0c000adsr5dt323ygf: "Delta",
    cmgzl23bz6tqtm191k28dbjh8: "Gamma",
  };

  private showAdult() {
    return this.$preferences.getBoolean(
      this.PREF_SHOW_ADULT_CONTENT_KEY,
      this.PREF_SHOW_ADULT_CONTENT_DEFAULT,
    );
  }

  // ========================= Search =========================
  override searchSeries: SearchSeries<Manga> = async (query, options) => {
    const { page = 1, filters } = options ?? {};

    const url = new URL("collections/manga/documents/search", this.baseUrl);
    url.searchParams.set("q", query?.trim() || "*");

    const includedGenres = new Set<string>();
    const excludedGenres = new Set<string>();
    const includedTags = new Set<string>();
    const excludedTags = new Set<string>();
    const typesList = new Set<string>();
    const statusList = new Set<string>();
    let sort: string | null = null;
    let minChapters: number | null = null;
    let year: number | null = null;

    const filterBy: string[] = [];
    filterBy.push("hidden:!=true");

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (typeof value === "string" && value === "any") continue;

      switch (type) {
        case "multi-select":
          if (value.length > 0) {
            value.forEach((v) => {
              if (v !== "any") {
                if (filter.key === "types") typesList.add(v.toString());
                else if (filter.key === "status") statusList.add(v.toString());
              }
            });
          }
          break;

        case "select":
          if (filter.key === "sort" && value?.trim()) {
            sort = `${value}:desc`;
          }

          break;

        case "text":
          if (value?.trim()) {
            if (filter.key === "year") year = this.toNumberOrNull(value);
            else if (filter.key === "min-chapters") minChapters = this.toNumberOrNull(value);
          }
          break;

        case "tri-state-checkbox":
          if (Array.isArray(value) && value.length > 0) {
            (value as TriStateFilterValue[]).forEach((item) => {
              if (item.state === "include") {
                if (filter.key === "genres") includedGenres.add(item.value.toString());
                else if (filter.key === "tags") includedTags.add(item.value.toString());
              }
              if (item.state === "exclude") {
                if (filter.key === "genres") excludedGenres.add(item.value.toString());
                else if (filter.key === "tags") excludedTags.add(item.value.toString());
              }
            });
          }
          break;
        default:
          break;
      }
    }

    if (includedGenres.size > 0) {
      filterBy.push(
        Array.from(includedGenres.values())
          .map((id) => `genreIds:=\`${id}\``)
          .join(" && "),
      );
    }

    if (excludedGenres.size > 0) {
      filterBy.push(
        `genreIds:!=[${Array.from(excludedGenres.values())
          .map((id) => `\`${id}\``)
          .join(",")}]`,
      );
    }

    if (includedTags.size > 0) {
      filterBy.push(
        Array.from(includedTags.values())
          .map((id) => `tagIds:=\`${id}\``)
          .join(" && "),
      );
    }

    if (excludedTags.size > 0) {
      filterBy.push(
        `tagIds:!=[${Array.from(excludedTags.values())
          .map((id) => `\`${id}\``)
          .join(",")}]`,
      );
    }

    if (typesList.size > 0) {
      filterBy.push(
        `type:=[${Array.from(typesList.values())
          .map((type) => `\`${type}\``)
          .join(",")}]`,
      );
    }

    if (statusList.size > 0) {
      filterBy.push(
        `status:=[${Array.from(statusList.values())
          .map((status) => `\`${status}\``)
          .join(",")}]`,
      );
    }

    if (year != null) filterBy.push(`releaseYear:=[${year}]`);

    if (minChapters != null) filterBy.push(`minChapters:>=${minChapters}`);

    const showAdult = await this.showAdult();

    if (!showAdult) {
      filterBy.push(`isAdult:=${showAdult}`);
    }

    filterBy.push("(mbContentRating:=[`Safe`,`Suggestive`,`Erotica`] || mbContentRating:!=*)");
    filterBy.push("views:>0");

    url.searchParams.set("filter_by", filterBy.join(" && "));

    if (sort) url.searchParams.set("sort_by", sort);

    if (query?.trim()) {
      url.searchParams.set("query_by", "title,englishTitle,otherNames,authors");
      url.searchParams.set("query_by_weights", "4,3,2,1");
      url.searchParams.set("num_types", "4,3,2,1");
    }

    url.searchParams.set("page", page.toString());
    url.searchParams.set("per_page", "40");

    const { data } = await this.client.get<AtsumaruSearchResponse>(url.toString(), {
      headers: this.apiHeadersBuilder(),
    });

    const items = data.hits.map((item) =>
      toManga({
        manga: item.document,
        extensionMetadata: this.extensionMetadata,
      }),
    );

    const hasMore = page * data.request_params.per_page < data.found;

    return {
      data: items,
      hasMore,
    };
  };

  // ========================= Popular =========================
  override getPopularSeries: GetPopularSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("api/home2/popular", this.baseUrl);
    url.searchParams.set(
      "types",
      ATSUMARU_MANGA_TYPE_OPTIONS.map((option) => option.value).join(","),
    );
    url.searchParams.set("timeframe", "daily");

    if (await this.showAdult()) {
      url.searchParams.set("adult", "1");
    }

    const offset = (page - 1) * this.BROWSE_LIMIT;
    url.searchParams.set("offset", offset.toString());

    url.searchParams.set("limit", this.BROWSE_LIMIT.toString());
    url.searchParams.set("mediums", "Comic");

    const { data } = await this.client.get<AtsumaruBrowseMangaResponse>(url.toString(), {
      headers: this.apiHeadersBuilder(),
    });

    const items = data.items.map((manga) =>
      toManga({
        manga,
        extensionMetadata: this.extensionMetadata,
      }),
    );

    return {
      data: items,
      hasMore: true,
    };
  };

  // ========================= Latest =========================
  override getLatestSeries: GetLatestSeries<Manga> = async (options) => {
    const { page = 1 } = options ?? {};

    const url = new URL("api/home2/recentlyUpdated", this.baseUrl);
    url.searchParams.set(
      "types",
      ATSUMARU_MANGA_TYPE_OPTIONS.map((option) => option.value).join(","),
    );

    if (await this.showAdult()) {
      url.searchParams.set("adult", "1");
    }

    const offset = (page - 1) * this.BROWSE_LIMIT;
    url.searchParams.set("offset", offset.toString());

    url.searchParams.set("limit", this.BROWSE_LIMIT.toString());
    url.searchParams.set("mediums", "Comic");

    const { data } = await this.client.get<AtsumaruBrowseMangaResponse>(url.toString(), {
      headers: this.apiHeadersBuilder(),
    });

    const items = data.items.map((manga) =>
      toManga({
        manga,
        extensionMetadata: this.extensionMetadata,
      }),
    );

    return {
      data: items,
      hasMore: true,
    };
  };

  // ========================= Series details =========================
  override getSeries: GetSeries<Manga> = async (mangaId) => {
    const url = new URL("api/manga/page", this.baseUrl);
    url.searchParams.set("id", mangaId);

    const { data } = await this.client.get<AtsumaruMangaPage>(url.toString(), {
      headers: this.apiHeadersBuilder(),
    });

    return toManga({
      manga: data.mangaPage,
      extensionMetadata: this.extensionMetadata,
    });
  };

  // ========================= Chapters =========================
  override getChapters: GetMangaChapters = async (mangaId) => {
    const { data } = await this.chapterListRequest(mangaId);

    return data.chapters
      .map((chapter) =>
        toChapter({
          chapter,
          mangaId,
          getSanlationName: (id) => (id ? this.SCANLATION_MAP[id] : undefined),
        }),
      )
      .toReversed();
  };

  private chapterListRequest(mangaId: string): Promise<AxiosResponse<AllChaptersResponse>> {
    const url = new URL("api/manga/allChapters", this.baseUrl);
    url.searchParams.set("mangaId", mangaId);
    url.searchParams.set("sort", "asc");
    console.log(url.toString());
    // url.searchParams.set("page", page.toString());

    return this.client.get(url.toString(), {
      headers: this.apiHeadersBuilder(),
    });
  }

  override getChapterPages: GetChapterPages = async (url) => {
    const [mangaId, chapterId] = url.split("/");

    if (!(mangaId && chapterId)) {
      throw new Error("Invalid chapter URL");
    }

    const urlObj = new URL("api/read/chapter", this.baseUrl);
    urlObj.searchParams.set("mangaId", mangaId);
    urlObj.searchParams.set("chapterId", chapterId);

    const { data } = await this.client.get<AtsumaruChapterPagesResponse>(urlObj.toString(), {
      headers: this.apiHeadersBuilder(),
    });

    return data.readChapter.pages.map((page, index) => {
      let url: string;
      if (page.image.startsWith("http")) url = page.image;
      else if (page.image.startsWith("//")) url = `https:${page.image}`;
      else
        url = `${this.baseUrl}/static/${StringUtils.removePrefix(StringUtils.removePrefix(page.image, "/"), "static/")}`;

      url = url.replace(this.PROTOCOL_REGEX, "https://cdn.");
      return {
        index,
        url,
      };
    });
  };

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "types",
        label: "Manga Type",
        type: "multi-select",
        options: ATSUMARU_MANGA_TYPE_OPTIONS,
        multiple: true,
        renderAs: "select",
      },
      {
        key: "status",
        label: "Status",
        type: "multi-select",
        options: ATSUMARU_STATUS_OPTIONS,
        multiple: true,
        renderAs: "select",
      },
      {
        key: "sort",
        label: "Sort By",
        type: "select",
        options: ATSUMARU_SORT_OPTIONS,
      },
      {
        key: "year",
        label: "Year",
        type: "text",
        placeholder: "e.g. 2020",
        defaultValue: "",
      },
      {
        key: "minChapters",
        label: "Minimum Chapters",
        type: "text",
        placeholder: "e.g. 10",
        defaultValue: "",
      },
      {
        key: "genres",
        label: "Genres",
        type: "tri-state-checkbox",
        options: ATSUMARU_GENRE_OPTIONS,
        multiple: true,
      },
      {
        key: "tags",
        label: "Tags",
        type: "tri-state-checkbox",
        options: ATSUMARU_TAG_OPTIONS,
        multiple: true,
      },
    ],
  });

  override getSettingsFilters: GetSettingsFilters = () => [
    {
      key: this.PREF_SHOW_ADULT_CONTENT_KEY,
      label: "Show Adult Content",
      type: "toggle",
      description: "Enable to show adult content in the listing",
      defaultValue: this.PREF_SHOW_ADULT_CONTENT_DEFAULT,
    },
  ];

  private apiHeadersBuilder(): AxiosHeaders {
    const headers = new AxiosHeaders();
    headers.set("Accept", "*/*");
    headers.set("Host", new URL(this.baseUrl).hostname);
    headers.set("Content-Type", "application/json");
    return headers;
  }

  private readonly BROWSE_LIMIT = 40;

  private PROTOCOL_REGEX = /^https?:?\/\//;

  private readonly PREF_SHOW_ADULT_CONTENT_KEY = "prefShowAdultContent";
  private readonly PREF_SHOW_ADULT_CONTENT_DEFAULT = false;
}
