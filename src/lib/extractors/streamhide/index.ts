import type { SubtitleTrack, Video } from "@tsukimichi/common";
import type { AxiosHeaders, AxiosInstance } from "axios";
import unpacker from "unpacker";

export class StreamHideExtractor {
  private subtitleRegex = /#EXT-X-MEDIA:TYPE=SUBTITLES.*?NAME="(.*?)".*?URI="(.*?)"/g;

  constructor(
    private client: AxiosInstance,
    private headers?: AxiosHeaders,
  ) {}

  async getVideos(url: string): Promise<Video[]> {
    const { data } = await this.client.get<string>(url, {
      headers: this.headers,
    });

    let unpacked: string;
    if (!unpacker.detect(data)) {
      unpacked = data;
    } else {
      unpacked = unpacker.unpack(data);
    }

    const playlistUrl = unpacked.split("sources:")[1]?.split('file:"')[1]?.split('"')[0];

    const { data: playlistData } = await this.client.get(playlistUrl!, {
      headers: this.headers,
    });

    const _subs: SubtitleTrack[] = [...playlistData.matchAll(this.subtitleRegex)].map((match) => {
      const url = this.fixUrl(match[2], playlistUrl!);
      return {
        url: url,
        kind: "captions",
        label: match[1],
        lang: match[1],
      };
    });

    const _separator = "#EXT-X-STREAM-INF";

    return [];
  }

  private fixUrl(urlPart: string, playlistUrl: string) {
    if (!urlPart.startsWith("https:")) {
      return `${playlistUrl.substring(0, playlistUrl.lastIndexOf("/"))}/${urlPart}`;
    }
    return urlPart;
  }
}
