import type { SubtitleTrack, Video } from "@tsukimichi/common";
import { AxiosHeaders, type AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import { unpack } from "unpacker";
import { PlaylistUtils } from "@/lib/playlist-utils";

export class FilemoonExtractor {
  private playlistUtils: PlaylistUtils;
  constructor(private client: AxiosInstance) {
    this.playlistUtils = new PlaylistUtils(client);
  }

  async videosFromUrl(options: {
    url: string;
    prefix?: string;
    headers?: AxiosHeaders;
  }): Promise<Video[]> {
    const { url, prefix = "Filemoon - ", headers } = options;

    let urlObj = new URL(url);

    const videoHeaders = new AxiosHeaders(headers);
    videoHeaders.set("Referer", url);
    videoHeaders.set("Origin", urlObj.origin);

    const { data: html } = await this.client.get(url, { headers });

    const $ = cheerio.load(html);

    const jsEvalScript = $("script:contains(eval):contains(m3u8)").first();

    let jsEval: string;

    if (jsEvalScript.length > 0) {
      jsEval = jsEvalScript.html() || "";
    } else {
      const iframeUrl = $("iframe[src]").attr("src")!;

      urlObj = new URL(iframeUrl);

      const { data: iframeHtml } = await this.client.get(iframeUrl, {
        headers,
      });

      const $iframe = $(iframeHtml);
      jsEval = $iframe.find("script:contains(eval):contains(m3u8)").first().html() || "";
    }

    const unpacked = unpack(jsEval);

    const masterUrl = unpacked?.trim()
      ? unpacked.split('{file:"')[1]?.split('"}')[0]?.trim()
      : null;

    if (!masterUrl) return [];

    const subtitleTracks: SubtitleTrack[] = [];

    let subUrl = urlObj.searchParams.get("sub.info");

    if (!subUrl) {
      const match = unpacked.split("fetch('")[1]?.split("').")[0]?.trim();
      if (match) subUrl = match;
    }

    if (subUrl) {
      try {
        const { data: subtitles } = await this.client.get<{ file: string; label: string }[]>(
          subUrl,
          { headers: videoHeaders },
        );

        subtitles.forEach((sub) => {
          subtitleTracks.push({
            url: sub.file,
            kind: "captions",
            label: sub.label,
            lang: "",
          });
        });
      } catch {
        //  ignore
      }
    }

    const videos = await this.playlistUtils.extractFromHls({
      playlistUrl: masterUrl,
      referer: `https://${urlObj.host}/`,
      subtitleList: subtitleTracks,
      videoNameGen: (q) => `${prefix}${q}`,
    });

    return videos;
  }
}
