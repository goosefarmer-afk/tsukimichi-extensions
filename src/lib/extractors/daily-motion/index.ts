import { StringUtils } from "@/utils/string";
import type { SubtitleTrack, Video } from "@tsukimichi/common";
import { AxiosHeaders, type AxiosInstance } from "axios";
import {
  serializeSubtitle,
  type DailyQuality,
  type ProtectedResponse,
  type TokenResponse,
  type VideosFromProtectedUrlOptions,
} from "./types";

export class DailyMotionExtractor {
  constructor(private client: AxiosInstance) {}

  async videosFromUrl({
    url,
    prefix = "Dailymotion",
    baseUrl = "",
    password,
  }: {
    url: string;
    prefix?: string;
    baseUrl?: string;
    password?: string;
  }): Promise<Video[]> {
    const { data: html } = await this.client.get<string>(url, {
      responseType: "text",
      headers: { Referer: `${this.DAILYMOTION_URL}/` },
    });

    const internalData = StringUtils.substringBefore(
      StringUtils.substringAfter(html, '"dmInternalData":'),
      "</script>",
    );
    const ts = StringUtils.substringBefore(StringUtils.substringAfter(internalData, '"ts":'), ",");
    const v1st = StringUtils.substringBefore(
      StringUtils.substringAfter(internalData, '"v1st":'),
      ",",
    );
    const videoQuery = (() => {
      const urlObj = new URL(url);
      return urlObj.searchParams.get("video") || urlObj.pathname.split("/").filter(Boolean).at(-1);
    })();

    if (!videoQuery) {
      return [];
    }

    const jsonUrl = new URL(`player/metadata/video/${videoQuery}`, this.DAILYMOTION_URL);
    jsonUrl.searchParams.set("locale", "en-US");
    jsonUrl.searchParams.set("dmV1st", v1st);
    jsonUrl.searchParams.set("dmTs", ts);
    jsonUrl.searchParams.set("is_native_app", "0");

    const { data } = await this.client.get<DailyQuality>(jsonUrl.toString());

    if (data.qualities != null && data.error == null) {
      return this.videosFromDailyResponse(data, prefix);
    }
    if (data.error?.type === "password_protected" && data.id) {
      return this.videosFromProtectedUrl({
        baseUrl,
        url,
        html,
        password,
        prefix,
        ts,
        v1st,
        videoId: data.id,
      });
    }
    return [];
  }

  private async videosFromProtectedUrl({
    url,
    prefix,
    videoId,
    html,
    ts,
    v1st,
    baseUrl,
    password,
  }: VideosFromProtectedUrlOptions): Promise<Video[]> {
    const postUrl = `${this.GRAPHQL_URL}/oauth/token`;
    const clientId = StringUtils.substringBefore(
      StringUtils.substringAfter(html, 'client_id":"'),
      '"',
    );
    const clientSecret = StringUtils.substringBefore(
      StringUtils.substringAfter(html, 'client_secret":"'),
      '"',
    );
    const scope = StringUtils.substringBefore(
      StringUtils.substringAfter(html, 'client_scope":"'),
      '"',
    );

    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      traffic_segment: ts,
      visitor_id: v1st,
      grant_type: "client_credentials",
      scope,
    });

    const { data: tokenData } = await this.client.post<TokenResponse>(postUrl, form, {
      headers: { Referer: `${this.DAILYMOTION_URL}/` },
    });
    const idHeaders = new AxiosHeaders()
      .set("Accept", "application/json, text/plain, */*")
      .set("Authorization", `${tokenData.token_type} ${tokenData.access_token}`);

    const idData = JSON.stringify({
      query: `query playerPasswordQuery($videoId:String!,$password:String!){video(xid:$videoId,password:$password){id xid}}`,
      variables: {
        videoId: videoId,
        password: password,
      },
    });

    const { data: idResponse } = await this.client.post<ProtectedResponse>(
      `${this.GRAPHQL_URL}/`,
      idData,
      { headers: idHeaders },
    );
    const idParsed = idResponse.data.video;

    const dmvk = StringUtils.substringBefore(StringUtils.substringAfter(html, 'dmvk":"'), '"');

    const getVideoIdUrl = new URL(`player/metadata/video/${idParsed.xid}`);
    getVideoIdUrl.searchParams.set("embedder", `${baseUrl}/`);
    getVideoIdUrl.searchParams.set("locale", "en-US");
    getVideoIdUrl.searchParams.set("dmV1st", v1st);
    getVideoIdUrl.searchParams.set("dmTs", ts);
    getVideoIdUrl.searchParams.set("is_native_app", "0");
    const getVideoIdHeaders = {
      ...this.headers(),
      Cookie: `dmvk=${dmvk}; ts=${ts}; v1st=${v1st}; usprivacy=1---; client_token=${tokenData.access_token}`,
      Referer: url,
    };

    const { data: qualityData } = await this.client.get<DailyQuality>(getVideoIdUrl.toString(), {
      headers: getVideoIdHeaders,
    });

    return this.videosFromDailyResponse(qualityData, prefix);
  }

  private videosFromDailyResponse(data: DailyQuality, prefix: string): Video[] {
    prefix = prefix.trim();

    const auto = data.qualities?.auto[0];
    if (!auto) return [];
    const masterUrl = auto.url;
    if (!masterUrl) {
      return [];
    }

    const serializedSubtitles = serializeSubtitle(data.subtitles?.data);
    const subtitleTracks: SubtitleTrack[] = serializedSubtitles?.map((s) => ({
      kind: "subtitles",
      label: s.label,
      url: s.urls[0]!,
      lang: s.label,
    }));

    return [
      {
        label: prefix.endsWith("-") ? prefix.slice(0, -1).trim() : prefix,
        url: masterUrl,
        subtitleTracks,
        headers: this.headers(),
        type: auto.type === "application/x-mpegURL" ? "application/vnd.apple.mpegurl" : auto.type,
      },
    ];
  }

  private headers() {
    return {
      Accept: "*/*",
      Referer: `${this.DAILYMOTION_URL}/`,
      Origin: this.DAILYMOTION_URL,
    };
  }

  private readonly DAILYMOTION_URL = "https://www.dailymotion.com";
  private readonly GRAPHQL_URL = "https://graphql.api.dailymotion.com";
}
