import type { Anime, Episode, ExtensionClientConstructorOptions } from "@tsukimichi/common";
import * as cheerio from "cheerio";

import { AnikotoTheme } from "@/lib/multi-src/anime/anikoto-theme";
import manifest from "./manifest.json" with { type: "json" };

export class AnimeSuge extends AnikotoTheme {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
      mirrors: ["https://animesuge.cz"],
    });
  }

  protected override get popularAnimeSelector(): string {
    return "div.item > div.inner";
  }

  protected override parseAnimeDetails(html: string, url: URL): Anime {
    const details = super.parseAnimeDetails(html, url);

    const $ = cheerio.load(html);

    const genres = $('div:contains("Genre:") > span > a')
      .get()
      .map((el) => $(el).text().trim())
      .filter(Boolean);

    details.genres = genres;

    if (details.description) {
      details.description = details.description.replaceAll("\n", "<br>");
    }

    details.rating = this.toNumberOrNull(
      $('div.scores b[itemprop="ratingValue"]').text().trim(),
      true,
    );

    return details;
  }

  protected override episodeFromElement(
    element: cheerio.Cheerio<any>,
    animeUrl: string,
  ): Episode | null {
    const episode = super.episodeFromElement(element, animeUrl);

    const ids = element.attr("data-ids");
    if (!ids) return null;

    let title = element.attr("title") || "";

    let episodeNumber = this.toNumberOrNull(
      element.attr("data-num")?.replace("Episode ", ""),
      true,
    );
    if (episodeNumber === null) {
      episodeNumber =
        this.toNumberOrNull(element.attr("data-slug"), true) ??
        this.toNumberOrNull(element.text().trim(), true);
    }

    if (episodeNumber === null) return null;

    const baseTitle = `Episode ${episodeNumber}`;

    if (!title) {
      title = baseTitle;
    }

    if (
      // If the title doesn't contain the episode number, add it
      // e.g. "The Day I Became a Shinigami" -> "Episode 1: The Day I Became a Shinigami"
      !title.includes(baseTitle)
    ) {
      title = `${baseTitle}: ${title}`;
    }

    const malId = element.attr("data-mal");
    const slug = element.attr("data-slug");
    const timestamp = element.attr("data-timestamp");

    const epUrl = `${animeUrl.replace(this.EP_URL_SUFFIX_REGEX, "")}/ep-${episodeNumber}`;

    const urlParams = new URLSearchParams({
      ids,
      epUrl,
    });
    if (malId) urlParams.set("malId", malId);
    if (slug) urlParams.set("slug", slug);
    if (timestamp) urlParams.set("timestamp", timestamp);

    if (episode) {
      episode.title = title;
      episode.episodeNumber = episodeNumber;
      episode.url = decodeURIComponent(urlParams.toString());
    }

    return episode;
  }

  protected override listingCoverSelector = "a.poster img";
  protected override animeDetailsCoverSelector = "div#media-info div.poster img";
  protected override animeDetailsDescriptionSelector = "div.description div.full";
  protected override episodeListSelector = "div.range div > a";

  protected override serverSelector(type: string): string {
    return `div[data-type="${type}"] div.server-list > div`;
  }
}
