import type { SubtitleTrack, Video } from "@tsukimichi/common";
import type { AxiosInstance } from "axios";

export class DoodExtractor {
  constructor(private client: AxiosInstance) {}

  async getVideosFromUrl(options: {
    url: string;
    prefix?: string;
    redirect?: boolean;
    externalSub?: SubtitleTrack[];
  }): Promise<Video[]> {
    try {
      const { url, prefix, redirect = true, externalSub = [] } = options;

      const { data, request } = await this.client.get<string>(url, {
        maxRedirects: redirect ? 5 : 0,
      });
      const newUrl = redirect ? request?.res?.responseUrl || url : url;

      const parsedUrl = new URL(newUrl);
      const doodHost = `${parsedUrl.protocol}://${parsedUrl.host}`;

      if (!data.includes("'/pass_md5/'")) return [];

      const title = data.split("<title>")[1]?.split("</title>")[0] || "";
      const quality = title.match(/\d{3,4}p/)?.[0];

      const newQuality = [prefix, `Doodstream ${quality ?? (redirect ? "mirror" : "")}`]
        .filter(Boolean)
        .join(" - ");

      const md5Match = data.match(/\/pass_md5\/[^']*/);
      if (!md5Match) return [];

      const md5 = `${doodHost}${md5Match[0]}`;
      const token = md5.split("/").pop() || "";

      const randomString = this.createHashTable();
      const expiry = Date.now();

      const { data: videoRes } = await this.client.get(md5, {
        headers: {
          Referer: newUrl,
        },
      });

      const videoUrl = `${videoRes}${randomString}?token=${token}&expiry=${expiry}`;

      const headers = {
        "User-Agent": "Tsukimichi/1.0.0",
        Referer: `${doodHost}/`,
      };

      return [
        {
          label: newQuality,
          url: videoUrl,
          headers,
          subtitleTracks: externalSub,
        },
      ];
    } catch (error) {
      console.warn(`Failed to get videos from ${options.url}`, error);
      return [];
    }
  }

  private createHashTable(length = 10): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    let hash = "";
    for (let i = 0; i < length; i++) {
      hash += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return hash;
  }
}
