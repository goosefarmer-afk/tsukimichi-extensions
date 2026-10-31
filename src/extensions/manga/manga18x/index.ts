import type {
  ExtensionClientConstructorOptions,
  GetFilterConfig,
  SelectFilter,
} from "@tsukimichi/common";

import { Madara } from "@/lib/multi-src/manga/madara";
import { MANGA_18X_ORDER_BY_OPTIONS } from "./filters";
import manifest from "./manifest.json";

export class Manga18x extends Madara {
  constructor(options?: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }

  override getFilterConfig: GetFilterConfig = () => {
    return {
      filters: [
        {
          key: "m_orderby",
          label: "Order By",
          options: MANGA_18X_ORDER_BY_OPTIONS,
          type: "select",
        } as SelectFilter,
      ],
    };
  };

  protected override get searchSeriesSelector(): string {
    return "div.c-tabs-item__content, .manga__item";
  }

  protected override get popularSeriesSelector(): string {
    return this.searchSeriesSelector;
  }

  protected override get latestSeriesSelector(): string {
    return this.searchSeriesSelector;
  }

  protected override seriesDetailsGenreSelector = "a[href*='/manga-genre/']";
  protected override seriesDetailsArtistSelector = "a[href*='/manga-artist/']";
  protected override seriesDetailsAuthorSelector = "a[href*='/manga-author/']";

  protected override get searchSeriesNextPageSelector(): string {
    return '.wp-pagenavi a.nextpostslink[rel="next"]';
  }
  protected override get mangaSubString(): string {
    return "manga";
  }
  protected override seriesSelector = ".tab-summary";

  protected override useNewChapterEndpoint = true;
}
