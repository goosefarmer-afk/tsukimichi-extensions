import type { SubtitleTrack, Video } from "@tsukimichi/common";
import type { AxiosInstance } from "axios";
import * as cheerio from "cheerio";

export class VidaraExtractor {
  constructor(private client: AxiosInstance) {}

  async videosFromUrl(url: string, prefix = ""): Promise<Video[]> {
    const fileCode = this.FILECODE_REGEX.exec(url)?.[1];
    if (!fileCode) return [];

    const defaultOrigin = (() => {
      try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.host}`;
      } catch {
        if (url.includes("vidara.to")) return "https://vidara.to";
        return "https://vidvara.fit";
      }
    })();

    let origin: string;
    try {
      const { data: doc } = await this.client.get(url);
      const $ = cheerio.load(doc);
      const script = $('script:contains("MIRROR_ORIGIN")').first().html() || "";
      origin = this.ORIGIN_REGEX.exec(script)?.[1] || defaultOrigin;
    } catch {
      origin = defaultOrigin;
    }

    const apiUrl = `${origin}/api/stream`;

    const { data } = await this.client.post<VidaraResponse>(
      apiUrl,
      {
        fileCode,
        device: "web",
      },
      { headers: { Referer: url, Origin: origin } },
    );

    if (!data.streaming_url) return [];

    const subtitleTracks: SubtitleTrack[] = (data.subtitles ?? [])
      .filter((s) => s.file_path && s.language)
      .map((s) => ({
        kind: "subtitles",
        url: s.file_path!,
        label: s.language!,
        lang: s.language!,
      }));

    return [
      {
        label: prefix || "Vidara",
        url: data.streaming_url,
        subtitleTracks,
        type: "application/vnd.apple.mpegurl",
        headers: { Referer: `${origin}/` },
      },
    ];
  }

  private readonly FILECODE_REGEX = /\/[ev]\/([a-zA-Z0-9]+)/;
  private readonly ORIGIN_REGEX = /MIRROR_ORIGIN\s*=\s*['"]([^'"]+)/;
}

interface VidaraSubtitle {
  file_path: string | null;
  language: string | null;
}

interface VidaraResponse {
  streaming_url: string;
  subtitles: VidaraSubtitle[] | null;
}
