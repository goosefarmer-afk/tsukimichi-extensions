import type { Video } from "@tsukimichi/common";
import type { AxiosInstance } from "axios";

export class StreamlareExtractor {
  constructor(private client: AxiosInstance) {}

  async videosFromUrl(options: {
    url: string;
    prefix?: string;
    suffix?: string;
  }): Promise<Video[]> {
    try {
      const { url, prefix = "", suffix = "" } = options;

      const urlObj = new URL(url);
      const segments = urlObj.pathname.split("/").filter(Boolean);

      const id = segments.at(-1)!;

      const { data: playlist } = await this.client.post(
        "https://slwatch.co/api/video/stream/get",
        {
          id,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      const type = playlist.split('"type":"')[1]?.split('"')[0];

      if (type === "hls") {
        const masterPlaylistUrl = playlist
          .split('"file":"')[1]
          ?.split('"')[0]
          ?.replace(/\\\//g, "/");

        const { data: masterPlaylist } = await this.client.get(masterPlaylistUrl!);

        const separator = "#EXT-X-STREAM-INF";
        const parts = masterPlaylist.split(separator).slice(1) as string[];

        return parts.map((part) => {
          const resolutionPart = part.split("RESOLUTION=")[1] || "";
          const quality = `${resolutionPart.split("x")[1]?.split(",")[0] || "0"}p`;

          let urlPart = part.split("\n")[1]?.split("\n")[0]?.trim();

          if (urlPart && !urlPart.startsWith("http")) {
            const base = masterPlaylistUrl.split("master.m3u8")[0];
            urlPart = base + urlPart;
          }

          let label = "";
          if (prefix) {
            label = `${prefix} `;
          }

          label += `Streamlare:${quality}`;

          if (suffix) {
            label += ` ${suffix}`;
          }

          return {
            url: urlPart!,
            label,
          };
        });
      }

      const separator = '"label":"';
      const parts = playlist.split(separator).slice(1) as string[];

      const videos: Video[] = [];

      for (const part of parts) {
        const quality = part.split('","')[0];

        const apiUrl = part.split('"file":"')[1]?.split('"')[0]?.replace(/\\/g, "");

        const response = await this.client.post(apiUrl!);

        const videoUrl = response.request?.res?.responseUrl || response.request?.responseUrl;

        let label = "";
        if (prefix) {
          label = `${prefix} `;
        }

        label += `Streamlare:${quality}`;

        if (suffix) {
          label += ` ${suffix}`;
        }

        videos.push({
          url: videoUrl!,
          label,
        });
      }

      return videos;
    } catch (error) {
      console.warn(`Failed to extract videos from ${options.url}`, error);
      return [];
    }
  }
}
