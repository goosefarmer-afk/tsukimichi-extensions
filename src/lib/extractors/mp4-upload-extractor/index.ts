import type { Video } from "@tsukimichi/common";
import { AxiosHeaders, type AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import { unpack } from "unpacker";

export class Mp4UploadExtractor {
  constructor(private client: AxiosInstance) {}

  async videosFromUrl(options: {
    url: string;
    headers: AxiosHeaders;
    prefix?: string;
    suffix?: string;
  }): Promise<Video[]> {
    const { url, headers, prefix = "", suffix = "" } = options;

    const newHeaders = new AxiosHeaders(headers);
    newHeaders.set("Referer", "https://mp4upload.com/");

    const { data: html } = await this.client.get(url, {
      headers: newHeaders,
    });

    const $ = cheerio.load(html);

    let script: string | null = null;

    const $evalScript = $("script:contains(eval):contains(p,a,c,k,e,d)").first();

    if ($evalScript.length > 0) {
      script = unpack($evalScript.text());
    } else {
      // fallback: script containing player.src
      const $playerScript = $("script:contains(player.src)").first();
      if ($playerScript.length > 0) {
        script = $playerScript.text();
      } else {
        return [];
      }
    }

    if (!script) return [];

    const srcMatch = script.match(/\.src\((.*?)\)/) || script.match(/src:\s*["']([^"']+)["']/);

    const videoUrl = srcMatch?.[1]?.replace(/['"]/g, "") ?? "";
    if (!videoUrl) return [];

    const qualityMatch = script.match(/\WHEIGHT=(\d+)/);
    const resolution = qualityMatch ? `${qualityMatch[1]}p` : "Unknown resolution";

    const quality = `${prefix}Mp4Upload - ${resolution}${suffix}`;

    const videoHeaders = {
      Referer: "https://mp4upload.com/",
      Host: new URL(videoUrl).host,
    };

    return [
      {
        url: videoUrl,
        label: quality,
        headers: videoHeaders,
        type: "video/mp4",
      },
    ];
  }
}
