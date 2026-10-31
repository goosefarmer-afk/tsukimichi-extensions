import { PlaylistUtils } from "@/lib/playlist-utils";
import type { Video } from "@tsukimichi/common";
import type { AxiosHeaders, AxiosInstance } from "axios";
import * as cheerio from "cheerio";

export class RumblePlayerExtractor {
  private playlistUtils: PlaylistUtils;

  constructor(private client: AxiosInstance) {
    this.playlistUtils = new PlaylistUtils(client);
  }

  async getVideos(url: string, headers: AxiosHeaders, prefix = ""): Promise<Video[]> {
    const { data: doc } = await this.client.get<string>(url, { headers });
    const $ = cheerio.load(doc);

    const regex = /"hls"\s*:\s*{\s*"url"\s*:\s*"([^"]+)"/;

    const script = $("script").first().html();

    if (!script) throw new Error("Script not found");

    const match = script.match(regex);

    if (!match?.[1]) throw new Error("Video URL not found");

    const videoUrl = match[1].replace(/\\/g, "");

    return this.playlistUtils.extractFromHls({
      playlistUrl: videoUrl,
      videoNameGen: (q) => `${prefix} ${q}`,
      subtitleList: [],
      referer: url,
    });
  }
}
