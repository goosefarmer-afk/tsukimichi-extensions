import type { AudioTrack, SubtitleTrack, Video } from "@tsukimichi/common";
import type { AxiosInstance } from "axios";
import { PlaylistUtils } from "@/lib/playlist-utils";

export class AllAnimeExtractor {
  private playlistUtils: PlaylistUtils;
  constructor(private client: AxiosInstance) {
    this.playlistUtils = new PlaylistUtils(this.client);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 0) return "0 B";

    const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];

    let i = 0;

    while (bytes >= 1000 && i < units.length - 1) {
      bytes /= 1000;
      i++;
    }

    return `${bytes.toFixed(2).replace(/\.00$/, "")} ${units[i]}`;
  }

  async videoFromUrl(url: string, name: string, endPoint: string): Promise<Video[]> {
    const videos: Video[] = [];

    const clockUrl = `${endPoint}${url.replace("/clock?", "/clock.json?")}`;

    const { data: linkedJson, status } = await this.client.get<VideoLink>(clockUrl, {
      validateStatus: () => true,
    });

    if (status !== 200) return videos;

    for (const link of linkedJson.links) {
      const subtitles: SubtitleTrack[] = [];
      if (link.subtitles?.length) {
        link.subtitles.forEach((sub) => {
          subtitles.push({
            kind: "subtitles",
            label: sub.label || sub.lang,
            lang: sub.lang,
            url: sub.src,
          });
        });
      }

      if (link.mp4) {
        videos.push({
          label: `Original (${name} - ${link.resolutionStr})`,
          url: link.link,
          subtitleTracks: subtitles,
          type: "video/mp4",
        });
      } else if (link.hls) {
        const data = await this.playlistUtils.extractFromHls({
          playlistUrl: link.link,
          videoNameGen: (q) => `${name} - ${q}`,
          subtitleList: subtitles,
          masterHeaders: {
            Accept: "*/*",
            Host: new URL(link.link).host,
            Origin: endPoint,
            Referer: `${endPoint}/`,
          },
        });

        data.forEach((v) => {
          videos.push(v);
        });
      } else if (link.crIframe) {
        for (const stream of link.portData?.streams ?? []) {
          if (stream.format === "adaptive_dash") {
            videos.push({
              url: stream.url,
              label: `Original (AC - Dash${stream.hardsub_lang.trim() ? `- Hardsub: ${stream.hardsub_lang.trim()}` : ""})`,
              subtitleTracks: subtitles,
            });
          } else if (stream.format === "adaptive_hls") {
            const data = await this.playlistUtils.extractFromHls({
              playlistUrl: stream.url,
              videoNameGen: (q) => `${name} - ${q}`,
              subtitleList: subtitles,
            });

            videos.push(...data);
          }
        }
      } else if (link.dash) {
        const audioTracks: AudioTrack[] = [];

        link.rawUrls?.audios?.forEach((audio) => {
          audioTracks.push({
            kind: "audio",
            label: this.formatBytes(audio.bandwidth ?? 0),
            url: audio.url,
          });

          link.rawUrls?.vids?.forEach((video) => {
            videos.push({
              url: video.url,
              label: `${name} - ${video.height} ${this.formatBytes(video.bandwidth ?? 0)}`,
              audioTracks,
              subtitleTracks: subtitles,
              headers: {
                Accept: "*/*",
              },
            });
          });
        });
      }
    }

    return videos;
  }
}

export interface VersionResponse {
  episodeIframeHead: string;
}

export interface VideoLink {
  links: Link[];
}

export interface Link {
  link: string;
  hls?: boolean | null;
  mp4?: boolean | null;
  dash?: boolean | null;
  crIframe?: boolean | null;
  resolutionStr: string;
  subtitles?: Subtitles[] | null;
  rawUrls?: RawUrl | null;
  portData?: Stream | null;
}

export interface Subtitles {
  lang: string;
  src: string;
  label?: string | null;
}

export interface Stream {
  streams: StreamObject[];
}

export interface StreamObject {
  format: string;
  url: string;
  audio_lang: string;
  hardsub_lang: string;
}

export interface RawUrl {
  vids?: DashStreamObject[] | null;
  audios?: DashStreamObject[] | null;
}

export interface DashStreamObject {
  bandwidth: number;
  height: number;
  url: string;
}
