import type { SubtitleTrack, Video } from "@tsukimichi/common";
import { AxiosHeaders, type AxiosInstance } from "axios";
import { createHash } from "node:crypto";

import { PlaylistUtils } from "@/lib/playlist-utils";
import { substringAfter, substringBefore } from "@/utils/string";
import { decrypt } from "@/lib/crypto";
import type { VideoDto } from "../types";

export class KickAssAnimeExtractor {
  constructor(private client: AxiosInstance) {}

  private getVideoHeaders(url: string): AxiosHeaders {
    const host = new URL(url).hostname;

    const headers = new AxiosHeaders();
    headers.set("Accept", "*/*");
    headers.set("Accept-Language", "en-US,en;q=0.9");
    headers.set("Origin", `https://${host}`);
    headers.set("Sec-Fetch-Dest", "empty");
    headers.set("Sec-Fetch-Mode", "cors");
    headers.set("Sec-Fetch-Site", "same-site");
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    return headers;
  }

  private fixUrl(raw: string, base: string): string {
    const trimmed = raw.trim();

    if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
      return trimmed.replace(this.httpRegex, "$1//");
    }
    if (trimmed.startsWith("//")) return `https://${trimmed.substring(2)}`;
    if (trimmed.startsWith("/")) {
      const urlObj = new URL(base);
      return `${urlObj.protocol}//${urlObj.host}${trimmed}`;
    }

    return trimmed;
  }

  private httpRegex = /^(https?:)\/+/;

  async videosFromUrl(url: string, name: string): Promise<Video[]> {
    let finalUrl = url;

    if (url.includes("/vast")) {
      const urlObj = new URL(url);
      urlObj.pathname = "/cat-player/player";
      finalUrl = urlObj.toString();
    }

    const { data: html } = await this.client.get<string>(finalUrl);
    const cleanHtml = html.replaceAll("&quot;", '"');

    if (cleanHtml.includes('"manifest":[0,')) {
      return this.parseNewPlayer(cleanHtml, finalUrl, name);
    }

    if (!html.includes("cid: '")) return [];

    let finalUrlObj: URL;

    try {
      finalUrlObj = new URL(finalUrl);
    } catch {
      return [];
    }

    const host = finalUrlObj.host;
    const mid = name === "DuckStream" ? "mid" : "id";
    const isBird = name === "BirdStream";

    const query = finalUrlObj.searchParams.get(mid);
    if (!query) return [];

    const keys: Record<string, string> = {
      VidStreaming: "e13d38099bf562e8b9851a652d2043d3",
      DuckStream: "4504447b74641ad972980a6b8ffd7631",
      BirdStream: "4b14d0ff625163e3c9c7a47926484bf2",
      CatStream: "",
    };

    const key = keys[name];
    if (!key) return [];

    const signature = this.getSignature(html, name, query, Buffer.from(key, "utf-8"));
    if (!signature) return [];
    const [sig, timestamp, route] = signature;

    let sourceUrl = `https://${host}${route}?mid=${query}`;
    if (!isBird) sourceUrl += `&e=${timestamp}`;
    sourceUrl += `&sig=${sig}`;

    const { data } = await this.client.get<string>(sourceUrl, {
      headers: {
        Referer: finalUrl,
        Origin: `https://${host}`,
      },
    });

    //     const [encryptedData, ivhex] = data.match(/:"([^"]*)"/)?.[1]
    //   ?.replace(/\\/g, '')
    //   .split(':') ?? [];
    let str = substringAfter(data, ':"');
    str = substringBefore(str, '"');
    str = str.replace("\\", "");

    const [encryptedData, ivHex] = str.split(":");
    const iv = Buffer.from(ivHex!, "hex");

    try {
      const videoObject = JSON.parse(
        decrypt(encryptedData!, Buffer.from(key, "utf-8"), iv),
      ) as VideoDto;

      const videoHeaders = this.getVideoHeaders(finalUrl);
      const headersObj: Record<string, string> = {};

      for (const [key, value] of videoHeaders) {
        if (Array.isArray(value)) headersObj[key] = value.join(",");
        // @ts-expect-error
        else headersObj[key] = value;
      }
      const playlistUtils = new PlaylistUtils(this.client, headersObj);

      const subtitles: SubtitleTrack[] = videoObject.subtitles.map((s) => ({
        kind: "subtitles",
        label: s.name,
        lang: s.language,
        url: s.src,
      }));

      const playlistUrl = this.fixUrl(videoObject.hls || videoObject.dash, finalUrl);

      if (videoObject.hls) {
        return [
          {
            label: name,
            url: playlistUrl,
            subtitleTracks: subtitles,
            type: "application/vnd.apple.mpegurl",
            headers: headersObj,
          },
        ];
      }

      if (videoObject.dash) {
        return playlistUtils.extractFromDash({
          mpdUrl: playlistUrl,
          videoNameGen: (q) => `${name}: ${q}`,
          videoHeaders,
          mpdHeaders: videoHeaders,
          subtitleList: subtitles,
        });
      }

      return [];
    } catch {
      return [];
    }
  }

  private manifestRegex = /manifest":\[0,"(?:https?:)?(\/\/[^"]+)"]/;
  private trackRegex =
    /"language":\[\d+,"([^"]+)"][^}]+?"name":\[\d+,"([^"]+)"][^}]+?"src":\[\d+,"([^"]+)"]/g;

  private async parseNewPlayer(html: string, url: string, name: string): Promise<Video[]> {
    const headers = this.getVideoHeaders(url);
    const headersObj: Record<string, string> = {};

    for (const [key, value] of headers) {
      if (Array.isArray(value)) headersObj[key] = value.join(",");
      // @ts-expect-error
      else headersObj[key] = value;
    }

    const playlistUtils = new PlaylistUtils(this.client, headers);

    const rawManifestUrl = html.match(this.manifestRegex)?.[1];
    if (!rawManifestUrl) return [];

    const manifestUrl = this.fixUrl(rawManifestUrl, url);

    const subtitles: SubtitleTrack[] = [];

    for (const match of html.matchAll(this.trackRegex)) {
      const lang = match[1];
      const subName = match[2];
      const rawSubUrl = match[3]?.replace(/\\\//g, "/");

      if (!lang || !subName || !rawSubUrl) continue;

      const subUrl = this.fixUrl(rawSubUrl, url);

      subtitles.push({
        kind: "subtitles",
        label: subName,
        lang,
        url: subUrl,
      });
    }

    try {
      if (manifestUrl.includes(".m3u8")) {
        return [
          {
            url: manifestUrl,
            type: "application/vnd.apple.mpegurl",
            label: `${name} - HLS`,
            headers: headersObj,
            subtitleTracks: subtitles,
          },
        ];
      }
      return playlistUtils.extractFromDash({
        mpdUrl: manifestUrl,
        videoNameGen: (q) => `${name} - ${q}`,
        subtitleList: subtitles,
        mpdHeaders: headersObj,
        videoHeaders: headersObj,
      });
    } catch {
      return [];
    }
  }

  private decodeHex(str: string): Buffer {
    if (str.length % 2 !== 0) throw new Error("Invalid hex string" + str);
    return Buffer.from(str, "hex");
  }

  private getSignature(
    html: string,
    server: string,
    query: string,
    key: Buffer,
  ): [signature: string, timestamp: string, route: string] | null {
    let order: string[];

    switch (server) {
      case "VidStreaming":
      case "DuckStream":
        order = ["IP", "USERAGENT", "ROUTE", "MID", "TIMESTAMP", "KEY"];
        break;

      case "BirdStream":
        order = ["IP", "USERAGENT", "ROUTE", "MID", "KEY"];
        break;

      default:
        return null;
    }

    const cidHex = html.split("cid: '")[1]?.split("'")[0];
    if (!cidHex) return null;

    const cid = Buffer.from(cidHex, "hex").toString("utf-8").split("|");
    const timestamp = Math.floor(Date.now() / 1000 + 60).toString();
    const route = cid[1]?.replace("player.php", "source.php");

    let signature = "";

    for (const item of order) {
      switch (item) {
        case "IP":
          signature += cid[0];
          break;

        case "USERAGENT":
          signature +=
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.142.86 Safari/537.36";
          break;

        case "ROUTE":
          signature += route;
          break;

        case "MID":
          signature += query;
          break;

        case "TIMESTAMP":
          signature += timestamp;
          break;

        case "KEY":
          signature += key.toString("utf-8");
          break;
      }
    }

    return [this.sha1sum(signature), timestamp, route!];
  }

  private sha1sum(value: string): string {
    return createHash("sha1").update(value, "utf-8").digest("hex");
  }
}
