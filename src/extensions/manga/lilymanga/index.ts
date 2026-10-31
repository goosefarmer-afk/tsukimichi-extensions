import {
  resolveFilterEntries,
  type Chapter,
  type ExtensionClientConstructorOptions,
  type GetFilterConfig,
  type Manga,
} from "@tsukimichi/common";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { Madara } from "@/lib/multi-src/manga/madara";
import {
  LILY_MANGA_ADULT_CONTENT_OPTIONS,
  LILY_MANGA_GENRE_CONDITION_OPTIONS,
  LILY_MANGA_GENRE_OPTIONS,
  LILY_MANGA_STATUS_OPTIONS,
} from "./filters";
import manifest from "./manifest.json";

export class LilyManga extends Madara {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  protected override searchMangaRequest<T>(
    query?: string,
    options?: Record<string, any>,
    requestConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const { page = 1, filters } = options ?? {};
    const url = new URL(`page/${page}`, this.baseUrl);
    url.searchParams.set("s", query?.trim() || "");
    url.searchParams.set("post_type", "wp-manga");

    for (const { type, value, filter } of resolveFilterEntries(
      filters,
      this.getFilterConfig().filters,
    )) {
      if (typeof value === "string" && value.trim() === "any") continue;

      switch (type) {
        case "select":
          url.searchParams.set(filter.key, value?.toString());
          break;
        case "multi-select":
          if (value.length > 0) {
            value.forEach((v) => {
              if (v !== "any") url.searchParams.append(filter.key, v);
            });
          }
          break;
        case "text":
          if (value.trim()) {
            if (filter.key === "release") {
              const yearNum = this.toNumberOrNull(value);
              if (yearNum !== null) {
                url.searchParams.set(filter.key, yearNum.toString());
              }
            } else {
              url.searchParams.set(filter.key, value);
            }
          }
          break;
        default:
          break;
      }
    }

    return this.client.get(url.toString(), requestConfig);
  }

  protected override parseSeriesDetails(html: string, url: URL, query: string): Manga {
    const $ = cheerio.load(html);
    const details = super.parseSeriesDetails(html, url, query);

    details.description = details.description?.replace("\n", "<br>");

    const type = $(".post-content_item:contains('Type') .summary-content").text().trim();

    const prevGenres = details.genres || [];
    if (type) prevGenres.push(type);
    details.genres = prevGenres;

    return details;
  }

  protected override chapterFromElement($el: cheerio.Cheerio<any>): Chapter | null {
    const chapter = super.chapterFromElement($el);

    if (chapter) {
      const lastUpdateText = $el.find("span.chapter-release-date i").text().trim();
      const lastUpdated = this.parseSeriesDate(lastUpdateText);
      chapter.lastUpdated = lastUpdated;
    }

    return chapter;
  }

  protected override async parseChapters(
    html: string,
    mangaUrl: string,
    _addNavigation?: boolean,
  ): Promise<Chapter[]> {
    const chapters = await super.parseChapters(html, mangaUrl, false);

    return [...chapters.reverse()].map((chapter, idx) => {
      const prevChapter = chapters[idx - 1];
      const nextChapter = chapters[idx + 1];

      return {
        ...chapter,
        nextChapter: nextChapter?.url || null,
        previousChapter: prevChapter?.url || null,
      };
    });
  }

  protected override chapterPageRequest<T = any>(query: string): Promise<AxiosResponse<T>> {
    const url = new URL(query, this.baseUrl);

    return this.client.get(url.toString(), { headers: this.headersBuilders() });
  }

  override getFilterConfig: GetFilterConfig = () => ({
    filters: [
      {
        key: "status[]",
        label: "Status",
        options: LILY_MANGA_STATUS_OPTIONS,
        type: "multi-select",
        renderAs: "select",
        multiple: true,
      },
      {
        key: "adult",
        label: "Adult content",
        options: LILY_MANGA_ADULT_CONTENT_OPTIONS,
        type: "select",

        defaultValue: "any",
      },
      {
        key: "genre[]",
        label: "Genres",
        options: LILY_MANGA_GENRE_OPTIONS,
        type: "multi-select",
        renderAs: "checkbox-group",
        multiple: true,
      },
      {
        key: "op",
        label: "Genres condition",
        options: LILY_MANGA_GENRE_CONDITION_OPTIONS,
        type: "select",

        defaultValue: "any",
      },
      {
        key: "author",
        type: "text",
        label: "Author",
        placeholder: "Author name",
        defaultValue: "",
      },
      {
        key: "artist",
        type: "text",
        label: "Artist",
        placeholder: "Artist name",
        defaultValue: "",
      },
      {
        key: "release",
        type: "text",
        label: "Year of Released",
        placeholder: "Release year",
        defaultValue: "",
      },
    ],
  });

  protected override get mangaSubString(): string {
    return "gl";
  }

  protected override seriesDetailsAuthorSelector = "div.author-content a";
  protected override seriesDetailsArtistSelector = "div.artist-content a";
  protected override seriesDetailsGenreSelector = "div.genres-content a";
  protected override alternateTitleDelimiter = ";";

  protected override chapterListItemSelector = "li.wp-manga-chapter";

  protected override useNewChapterEndpoint = true;
}
