import type { ExtensionClientConstructorOptions, GetFilterConfig, Video } from "@tsukimichi/common";
import type { AxiosRequestConfig } from "axios";
import { OkruExtractor } from "@/lib/extractors/okru";
import { StreamWishExtractor } from "@/lib/extractors/stream-wish";
import { AnimeStream } from "@/lib/multi-src/anime/animestream";
import manifest from "./manifest.json";
import * as cheerio from "cheerio";
import { PlaylistUtils } from "@/lib/playlist-utils";
import { VidaraExtractor } from "./extractors/vidra-extractor";
import { RumblePlayerExtractor } from "@/lib/extractors/rumble-player-extractor";
import { Mp4UploadExtractor } from "@/lib/extractors/mp4-upload-extractor";
import { DoodExtractor } from "@/lib/extractors/dood-extractor";
import { DailyMotionExtractor } from "@/lib/extractors/daily-motion";
import { StringUtils } from "@/utils/string";

export class AnimeKhor extends AnimeStream {
  private playlistUtils: PlaylistUtils;
  private vidaraExtractor: VidaraExtractor;
  private rumbleExtractor: RumblePlayerExtractor;
  private mp4UploadExtractor: Mp4UploadExtractor;
  private doodExtractor: DoodExtractor;
  private dailymotionExtractor: DailyMotionExtractor;

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });

    this.playlistUtils = new PlaylistUtils(this.client);
    this.vidaraExtractor = new VidaraExtractor(this.client);
    this.rumbleExtractor = new RumblePlayerExtractor(this.client);
    this.mp4UploadExtractor = new Mp4UploadExtractor(this.client);
    this.doodExtractor = new DoodExtractor(this.client);
    this.dailymotionExtractor = new DailyMotionExtractor(this.client);
  }

  protected override async getVideoList(url: string, name: string): Promise<Video[]> {
    let prefix = `${name} - `;

    if (url.includes("dailymotion.com") || name.toLowerCase().includes("vidplayer")) {
      let cleanUrl: string;
      if (url.includes("dailymotion.com/embed/embed-")) {
        const id = StringUtils.substringBefore(
          StringUtils.substringAfter(url, "dailymotion.com/embed/embed-"),
          ".",
        );
        cleanUrl = `https://www.dailymotion.com/embed/video/${id}`;
      } else {
        cleanUrl = url;
      }
      return this.dailymotionExtractor.videosFromUrl({ url: cleanUrl, prefix });
    }

    if (url.includes("ok.ru")) {
      const okruExtractor = new OkruExtractor(this.client);
      return okruExtractor.getVideos(url, prefix);
    }

    if (
      url.includes("vidara") ||
      url.includes("vidvara") ||
      name.toLowerCase().includes("daraplayer")
    ) {
      return this.vidaraExtractor.videosFromUrl(url, prefix);
    }

    if (url.includes("emturbovid") || url.includes("turbovid") || url.includes("turboviplay")) {
      const { data: html } = await this.client.get<string>(url);
      const $ = cheerio.load(html);
      let videoUrl: string | null = null;

      videoUrl = $("#video_player[data-hash]").first().attr("data-hash") || null;

      if (videoUrl?.endsWith(".m3u8")) {
        return this.playlistUtils.extractFromHls({
          playlistUrl: videoUrl,
          videoNameGen: (q) => `${prefix}${q}`,
          referer: `${this.baseUrl}/`,
          videoHeaders: {
            Referer: `${this.baseUrl}/`,
          },
        });
      }

      return [];
    }

    if (url.includes("rumble.com")) {
      return this.rumbleExtractor.getVideos(url, this.headersBuilders(), prefix);
    }

    if (url.includes("mp4upload")) {
      return this.mp4UploadExtractor.videosFromUrl({
        url,
        prefix,
        headers: this.headersBuilders(),
      });
    }

    if (url.includes("dood") || url.includes("do0od") || url.includes("ds2play")) {
      return this.doodExtractor.getVideosFromUrl({
        url,
        prefix,
      });
    }

    if (url.includes("streamwish") || url.includes("wish")) {
      const docHeaders = this.headersBuilders();
      docHeaders.set("Referer", `${this.baseUrl}/`);

      const streamwishExtractor = new StreamWishExtractor(this.client);
      return streamwishExtractor.videosFromUrl({
        url,
        videoNameGen: (q) => `${prefix}${q}`,
        headers: docHeaders,
      });
    }

    return [];
  }

  async getVideo(
    data: {
      url: string;
      extensionId: string;
      referer: string;
      videoProxyProtocol: string;
      headers?: Record<string, string>;
    },
    config?: AxiosRequestConfig,
  ): Promise<Response> {
    const axiosResponse = await this.client.request({
      url: data.url,
      ...config,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Host: new URL(data.url).host,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        Orgin: data.url.includes("ok.ru") ? "https://ok.ru" : new URL(data.referer).origin,
        Referer: data.url.includes("ok.ru") ? "https://ok.ru" : data.referer,
      },
    });

    const headers = new Headers();
    for (const [key, value] of Object.entries(axiosResponse.headers)) {
      headers.set(key, value);
    }

    const response = new Response(axiosResponse.data, {
      status: axiosResponse.status,
      statusText: axiosResponse.statusText,
      headers,
    });

    return response;
  }

  override getFilterConfig: GetFilterConfig = () => ({
    header: "Ignored if search query is provided",
    // TODO: Add filters
    filters: [],
  });
}
