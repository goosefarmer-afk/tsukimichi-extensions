import type { Video } from "@tsukimichi/common";
import type { AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import { PlaylistUtils } from "@/lib/playlist-utils";

export class OkruExtractor {
  private playlistUtils: PlaylistUtils;
  constructor(private client: AxiosInstance) {
    this.playlistUtils = new PlaylistUtils(client);
  }

  async getVideos(url: string, prefix = ""): Promise<Video[]> {
    const { data: html } = await this.client.get<string>(url);

    const $ = cheerio.load(html);

    const videoString = $("div[data-options]").first().attr("data-options");

    if (!videoString) {
      return [];
    }

    switch (true) {
      case videoString.includes("ondemandHls"): {
        const playlistUrl = this.extractLink(videoString, "ondemandHls");
        if (!playlistUrl) return [];

        return this.playlistUtils.extractFromHls({
          playlistUrl,
          videoNameGen: (q) => `${prefix}[HLS] Okru:${q}`,
          videoHeaders: {
            referer: "https://ok.ru/",
            host: new URL(playlistUrl).hostname,
          },
        });
      }
      case videoString.includes("ondemandDash"): {
        console.log("dash");
        const playlistUrl = this.extractLink(videoString, "ondemandDash");

        if (!playlistUrl) return [];
        return this.playlistUtils.extractFromDash({
          mpdUrl: playlistUrl,
          videoNameGen: (q) => `${prefix}[DASH] Okru:${q}`,
          referer: "https://ok.ru/",
          videoHeaders: {
            referer: "https://ok.ru/",
            host: new URL(playlistUrl).hostname,
          },
        });
      }
      default: {
        return this.videosFromJson(videoString, prefix);
      }
    }
  }

  private videosFromJson(videoString: string, prefix = ""): Video[] {
    const toNumberOrNull = (str?: string) => {
      if (!str) return null;
      const num = Number.parseInt(str, 10);
      return Number.isNaN(num) ? null : num;
    };
    try {
      const data = JSON.parse(videoString);
      const metadata = JSON.parse(data.flashvars?.metadata);

      const videos = metadata?.videos as {
        name: string; // quality name
        url: string;
      }[];

      if (Array.isArray(videos)) {
        return videos.map((v) => {
          const qualityStr = this.fixQuality(v.name);
          return {
            label: `Okru:${qualityStr}`,
            url: v.url,
            headers: {
              referer: "https://ok.ru/",
              host: new URL(v.url).hostname,
            },
            type: "video/mp4",
            quality: toNumberOrNull(qualityStr.replace("p", "")) ?? undefined,
          };
        });
      }
    } catch {
      // ignore
    }

    const arrData = this.VIDEOS_JSON_REGEX.exec(videoString)?.[1];

    if (!arrData) {
      return [];
    }

    return arrData
      .split(this.NAME_REGEX)
      .reverse()
      .map((item) => {
        const videoUrl = this.extractLink(item, "url");

        if (!videoUrl) {
          return null;
        }

        const rawQuality = item.split('"')[0]?.replace(/\\+$/, "");
        const quality = this.fixQuality(rawQuality || "");

        return {
          label: `${prefix.trim() ? prefix + " " : ""}Okru: ${quality}`,
          url: videoUrl,
          headers: {
            Referer: "https://ok.ru/",
            Host: new URL(videoUrl).hostname,
          },
          quality: toNumberOrNull(quality?.replace("p", "")) ?? undefined,
        };
      })
      .filter(Boolean) as Video[];
  }

  private extractLink(str: string, attr: string) {
    const regex = new RegExp(`${attr}(\\\\*")\\s*:\\s*\\1(.*?)\\1`);
    const match = str.match(regex);

    return match?.[2] ? match[2].replace(this.STRING_REGEX, "&") : "";
  }

  private fixQuality(quality: string) {
    const qualities = {
      ultra: "2160p",
      quad: "1440p",
      full: "1080p",
      hd: "720p",
      sd: "480p",
      low: "360p",
      lowest: "240p",
      mobile: "144p",
    };

    return qualities[quality as keyof typeof qualities] || quality;
  }

  private STRING_REGEX = /\\+u0026/g;
  private NAME_REGEX = /\{\s*\\*"name\\*"\s*:\s*\\*"/;
  private VIDEOS_JSON_REGEX = /videos\\*"\s*:\s*\\*\[(.*?)(?:\]|$)/;
}
