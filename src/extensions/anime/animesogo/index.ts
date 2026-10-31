import type { Anime, ExtensionClientConstructorOptions } from "@tsukimichi/common";
import * as cheerio from "cheerio";
import { AnikotoTheme } from "@/lib/multi-src/anime/anikoto-theme";
import manifest from "./manifest.json";
import type { VideoServer } from "@/lib/multi-src/anime/anikoto-theme/types";

export class AnimeSogo extends AnikotoTheme {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
      mirrors: ["https://animesogo.to"],
    });
  }

  protected override parseAnimeDetails(html: string, url: URL): Anime {
    const parsed = super.parseAnimeDetails(html, url);

    const $ = cheerio.load(html);

    let description = parsed.description || "";

    const rating = this.toNumberOrNull($('div:contains("Scores:") > span').text().trim(), true);
    if (rating != null) description += `<br>Rating: ${rating}`;

    parsed.description = description;
    parsed.rating = rating;
    return parsed;
  }

  override parseServerList(html: string): VideoServer[] {
    const $ = cheerio.load(html);

    const servers: VideoServer[] = [];

    $("div.type").each((_, el) => {
      const $el = $(el);
      const type = $el.attr("data-type");
      if (!type) return;

      $el.find("a.server").each((_, serverEl) => {
        const $serverEl = $(serverEl);
        const serverId = $serverEl.attr("data-link-id");
        if (!serverId) return;

        const name = this.extractBaseServerName($serverEl.find("span").first().text().trim());

        servers.push({
          name,
          serverId,
          type: type.charAt(0).toUpperCase() + type.slice(1),
        });
      });
    });

    return servers;
  }

  protected override extractBaseServerName(rawName: string): string {
    const base = super.extractBaseServerName(rawName);
    return base === "Server" ? "Kiwi-Stream" : base;
  }

  protected override useTriStateForGenres = false;

  protected override listingCoverSelector = "a.poster img";

  protected override animeDetailsCoverSelector = "section#w-info div.poster img";
  protected override animeDetailsAlternateTitlesSelector = "div.alias";

  protected override episodeListSelector = "ul.episodes > li > a";
}
