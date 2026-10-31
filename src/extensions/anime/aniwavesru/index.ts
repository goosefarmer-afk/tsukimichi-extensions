import type { Anime, ExtensionClientConstructorOptions, GetFilterConfig } from "@tsukimichi/common";
import type { AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { AnikotoTheme } from "@/lib/multi-src/anime/anikoto-theme";
import { FILTERS } from "./filters";
import manifest from "./manifest.json";

// TODO: make it independent source
export class AniwavesRU extends AnikotoTheme {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
      mirrors: ["https://aniwaves.ru"],
    });
  }

  protected override latestAnimeRequest(options?: Record<string, any>): Promise<AxiosResponse> {
    const { page = 1 } = options ?? {};

    const url = new URL("updated", this.baseUrl);
    url.searchParams.set("page", page.toString());

    return this.client.get<string>(url.toString());
  }

  protected override popularAnimeRequest(options?: Record<string, any>): Promise<AxiosResponse> {
    const { page = 1 } = options ?? {};

    const url = new URL("filter", this.baseUrl);
    url.searchParams.set("keyword", "");
    url.searchParams.set("sort_by", "m_view");
    url.searchParams.set("page", page.toString());

    return this.client.get<string>(url.toString());
  }

  protected override parseAnimeDetails(html: string, url: URL): Anime {
    const details = super.parseAnimeDetails(html, url);

    const $ = cheerio.load(html);

    let description = details.description || "";

    const scoreText = $('div.meta div:contains("Scores: ") > span')
      .text()
      .trim()
      .replace("Scores:", "")
      .trim()
      .split("/")[0];
    const scores = this.toNumberOrNull(scoreText, true);
    if (scores != null) description += `<br>Scores: ${scores}`;

    details.description = description;
    details.rating = scores;
    return details;
  }

  override async getEmbedLink(serverId: string, epUrl: string): Promise<string> {
    const headers = this.headersBuilders();
    headers.set("Accept", "application/json, text/javascript, */*;");
    headers.set("Referer", new URL(epUrl, this.baseUrl).href);
    headers.set("X-Requested-With", "XMLHttpRequest");

    const url = new URL("ajax/sources", this.baseUrl);
    url.searchParams.set("id", serverId);

    const { data } = await this.client.get(url.toString(), { headers });

    if (!data.result?.url) throw new Error("Embed link not found");
    return data.result.url;
  }

  override getFilterConfig: GetFilterConfig = () => ({
    filters: FILTERS,
  });
  override hasMapper = false;

  protected override animeDetailsCoverSelector = "#w-info div.poster img";
}

// const client = new AniwavesRU();
// client
//   .getVideos(
//     "ids=82540&eps=22&epUrl=/watch/tensei-shitara-slime-datta-ken-4th-season-82540/ep-22&malId=22&slug=22&timestamp=2026-09-10+15:00:00",
//   )
//   .then(console.log);
