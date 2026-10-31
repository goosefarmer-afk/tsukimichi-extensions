import type { SubtitleTrack, Video } from "@tsukimichi/common";
import { AxiosHeaders, type AxiosInstance } from "axios";
import crypto from "node:crypto";

import type { AnikotoTheme } from ".";
import {
  deserializeMegaPlaySources,
  deserializeSources,
  type MapperServer,
  type MegaPlaySourcesResponse,
  type SourcesResponse,
  type VideoServer,
} from "./types";
import { substringAfter, substringBefore } from "@/utils/string";
import { parallelCatchingFlatMap } from "@/utils/map";

export class AnikotoExtractor {
  constructor(
    private theme: AnikotoTheme,
    private client: AxiosInstance,
  ) {}

  async extractVideos(html: string, query: string, episodeUrl: string): Promise<Video[]> {
    const servers = this.theme.parseServerList(html);
    const mapperServers = await this.fetchMapperServers(query);
    servers.push(...mapperServers);

    return await parallelCatchingFlatMap(
      servers,
      async (server) => await this.extractVideo(server, episodeUrl),
      {
        onError: (error, item, index) => {
          console.error(
            `Failed to extract video for server ${item.name} at index ${index}: ${error.message}`,
          );
        },
      },
    );
  }

  private async fetchMapperServers(query: string): Promise<VideoServer[]> {
    if (!this.theme.hasMapper) return [];

    const servers: VideoServer[] = [];

    const malId = substringBefore(substringAfter(query, "&malId=", ""), "&");
    const slug = substringBefore(substringAfter(query, "&slug=", ""), "&");
    const timestamp = substringBefore(substringAfter(query, "&timestamp=", ""), "&");

    if (malId?.trim() && slug?.trim() && timestamp?.trim()) {
      const mapperHeaders = new AxiosHeaders();
      mapperHeaders.set("Accept", "application/json, text/javascript, */*;");
      mapperHeaders.set("Referer", `${this.theme.baseUrl}/`);
      mapperHeaders.set("Origin", this.theme.baseUrl);

      const apiUrl = new URL(
        `${this.theme.mapperUrl}/mal/${malId}/${slug}/${timestamp}`,
        this.theme.baseUrl,
      );
      try {
        const { data } = await this.client.get<Record<string, MapperServer> | null>(
          apiUrl.toString(),
          {
            headers: mapperHeaders,
          },
        );
        if (!data) return [];

        for (const [key, value] of Object.entries(data)) {
          if (key.toLowerCase() === "status") continue;
          const serverName = this.theme.mapMapperServerName(key);

          for (const [type, typeLabel] of Object.entries({
            sub: "H-Sub",
            dub: "A-Dub",
          })) {
            const linkObj = value?.[type as keyof typeof value];
            if (!linkObj) continue;

            const link = linkObj.url;
            if (!link) continue;

            servers.push({
              name: serverName,
              serverId: link,
              type: typeLabel,
            });
          }
        }

        return servers;
      } catch {}
    }

    return [];
  }

  private async extractVideo(server: VideoServer, epUrl: string): Promise<Video[]> {
    const embedLink = server.serverId.startsWith("http")
      ? server.serverId
      : await this.theme.getEmbedLink(server.serverId, epUrl);

    if (this.isMegaPlayServer(server.name) || this.isMegaPlayeUrl(embedLink)) {
      return await this.extractFromMegaPlay(embedLink, server);
    }

    if (embedLink.includes("mewcdn.online/player/plyr.php")) {
      return await this.extractFromMewcdnPlayer(embedLink, server);
    }
    if (
      embedLink.endsWith(".m3u8") ||
      (embedLink.includes(".m3u8") && !embedLink.includes("/stream/"))
    ) {
      return await this.extractDirectM3u8(embedLink, server);
    }

    const videos = await this.extractFromPlayer(embedLink, server);
    return videos;
  }

  private async extractFromMewcdnPlayer(embedLink: string, server: VideoServer): Promise<Video[]> {
    const fragment = substringBefore(substringAfter(embedLink, "#"), "#");
    if (!fragment) throw new Error("No fragment found in mewcdn player URL");

    const rawM3u8 = Buffer.from(fragment, "base64").toString("utf-8").trim();

    if (!rawM3u8.startsWith("http"))
      throw new Error("Invalid m3u8 URL decoded from mewcdn fragment");

    const pageHeaders = new AxiosHeaders();
    pageHeaders.set("Referer", `${this.theme.baseUrl}/`);

    const { data: html } = await this.client.get<string>(embedLink, { headers: pageHeaders });

    const hostMap = this.parseHostMap(html);
    const m3u8 = this.applyHostMap(rawM3u8, hostMap);

    if (server.name.endsWith("-")) server.name = server.name.slice(0, -1);
    const videoHeaders = {
      referer: "https://mewcdn.online/",
      origin: "https://mewcdn.online",
    };

    const videos = [
      {
        url: m3u8,
        headers: videoHeaders,
        label: `[${server.type}] ${server.name}`,
        type: "application/vnd.apple.mpegurl",
      },
    ];

    return videos;
  }

  private async extractDirectM3u8(
    m3u8Url: string,
    server: VideoServer,
    referer = `${this.theme.baseUrl}/`,
  ): Promise<Video[]> {
    if (server.name.endsWith("-")) server.name = server.name.slice(0, -1);

    const videoHeaders = {
      referer,
    };

    const videos = [
      {
        url: m3u8Url,
        headers: videoHeaders,
        label: `[${server.type}] ${server.name}`,
        type: "application/vnd.apple.mpegurl",
      },
    ];

    return videos;
  }

  private async extractFromPlayer(
    embedLink: string,
    server: VideoServer,
    pageReferer = `${this.theme.baseUrl}/`,
  ): Promise<Video[]> {
    let host: string;

    try {
      const url = new URL(embedLink);
      host = url.host;
    } catch {
      return [];
    }

    const pageHeaders = new AxiosHeaders();
    pageHeaders.set("Referer", pageReferer);

    const { data: pageBody } = await this.client.get<string>(embedLink, {
      headers: {
        ...pageHeaders,
        "User-Agent": null,
      },
    });

    const dataId = pageBody.match(this.DATA_ID_REGEX)?.[1];
    if (dataId) {
      return await this.fetchSourcesFromApi(dataId, host, embedLink, server);
    }

    if (server.name.toLowerCase().includes("dghg")) {
      const md5Path = pageBody.match(this.PASS_MDF_REGEX)?.[0];
      if (md5Path) {
        const result = await this.extractPassMd5(md5Path, pageBody, host, server);
        if (result) return result;
      }
    }

    const iframeSrc = pageBody.match(this.IFRAME_SRC_REGEX)?.[1];
    if (iframeSrc) {
      const resolveSrc = this.resolveUrl(iframeSrc, embedLink);
      return await this.extractFromPlayer(resolveSrc, server, embedLink);
    }

    const directM3u8 = pageBody.match(this.M3U8_REGEX)?.[0];
    if (directM3u8) {
      return this.extractDirectM3u8(directM3u8, server, `https://${host}/`);
    }

    const sourceSrc = pageBody.match(this.SOURCE_TAG_REGEX)?.[1];
    if (sourceSrc) {
      const resolveSrc = this.resolveUrl(sourceSrc, embedLink);
      return this.extractDirectM3u8(resolveSrc, server, `https://${host}/`);
    }

    const jsVarMatch = pageBody.match(this.JS_VAR_M3U8_REGEX);
    const jsVarUrl = jsVarMatch?.[1] || jsVarMatch?.[2];

    if (jsVarUrl) {
      const resolvedUrl = this.resolveUrl(jsVarUrl, embedLink);
      if (resolvedUrl.includes(".m3u8") || resolvedUrl.includes("/stream/")) {
        try {
          return this.fetchSourcesFromPage(resolvedUrl, server, `https://${host}/`);
        } catch {
          return this.extractDirectM3u8(resolvedUrl, server, `https://${host}/`);
        }
      }
    }

    return [];
  }

  private async fetchSourcesFromApi(
    dataId: string,
    host: string,
    embedLink: string,
    server: VideoServer,
  ): Promise<Video[]> {
    const urlObj = new URL(embedLink);
    const segments = urlObj.pathname.split("/").filter(Boolean);
    const streamType = ["sub", "dub", "hsub"].includes(segments.at(-1) || "")
      ? segments.at(-1)!
      : "";

    const apiHeaders = new AxiosHeaders();
    apiHeaders.set("Accept", "*/*");
    apiHeaders.set("X-Requested-With", "XMLHttpRequest");
    apiHeaders.set("Referer", embedLink);
    apiHeaders.set("Origin", `https://${host}`);
    const data = await this.fetchSourceData(dataId, host, apiHeaders, streamType, server);

    const m3u8 = deserializeSources(data.sources);
    if (!m3u8.startsWith("http")) throw new Error("No valid m3u8 found");

    const subtitles: SubtitleTrack[] =
      data.tracks
        ?.filter((track) => track.kind === "captions")
        .map((track) => ({
          kind: "captions",
          url: track.file,
          label: track.label || "",
          default: track.default || false,
          lang: this.theme.labelToLang(track.label || "") || "und",
        })) ?? [];

    const videoHeaders = {
      referer: `https://${host}/`,
      origin: `https://${host}`,
    };

    return [
      {
        url: m3u8,
        label: `[${server.type}] ${server.name}`,
        headers: videoHeaders,
        subtitleTracks: subtitles,
        intro: data.intro ?? undefined,
        outro: data.outro ?? undefined,
      },
    ];
  }

  private async fetchSourcesFromPage(
    m3u8Url: string,
    server: VideoServer,
    referer: string,
  ): Promise<Video[]> {
    const pageHeaders = new AxiosHeaders();
    pageHeaders.set("Referer", referer);

    const { data: body } = await this.client.get<string>(m3u8Url, { headers: pageHeaders });

    if (body.trim().startsWith("#EXTM3U")) {
      return this.extractDirectM3u8(m3u8Url, server, referer);
    }

    const m3u8 = body.match(this.M3U8_REGEX)?.[0];
    if (m3u8) return this.extractDirectM3u8(m3u8, server, referer);

    throw new Error("No m3u8 found in page");
  }

  private async fetchSourceData(
    dataId: string,
    host: string,
    apiHeaders: AxiosHeaders,
    streamType: string,
    server: VideoServer,
  ) {
    if (server.name.toLowerCase().includes("vidplay") && this.theme.name.includes("Aniwaves.ru")) {
      const { data } = await this.client.get<SourcesResponse>(
        `https://${host}/embed-1/getSources?id=${dataId}`,
        { headers: apiHeaders },
      );
      return data;
    }

    const primaryResult = await this.client
      .get<SourcesResponse>(
        `https://${host}/stream/getSources?id=${dataId}&type=${streamType}&type=${streamType}`,
        {
          headers: apiHeaders,
          validateStatus: () => true,
        },
      )
      .then((res) => {
        if (res.status !== 200) throw new Error(res.statusText);
        if (!res.data.sources) throw new Error("No sources found");
        return res.data;
      })
      .catch(() => null);

    if (primaryResult) return primaryResult;

    const secondUrl = `https://${host}/embed-0/getSources?id=${dataId}`;
    const secondaryResult = await this.client
      .get<SourcesResponse>(secondUrl, {
        headers: apiHeaders,
        validateStatus: () => true,
      })
      .then((res) => {
        if (res.status !== 200) throw new Error(res.statusText);
        if (!res.data.sources) throw new Error("No sources found");
        return res.data;
      })
      .catch(() => null);

    if (secondaryResult) return secondaryResult;

    const newUrl = `https://${host}/stream/getSourcesNew?id=${dataId}&type=${streamType}&type=${streamType}`;

    const newResult = await this.client.get<SourcesResponse>(newUrl, { headers: apiHeaders });

    return newResult.data;
  }

  private async extractPassMd5(md5Path: string, html: string, host: string, server: VideoServer) {
    const origin = `https://${host}`;

    const { data: cdnUrl } = await this.client.get<string>(`${origin}/${md5Path}`, {
      headers: {
        "User-Agent": null,
        Referer: `${origin}/`,
      },
    });
    if (!cdnUrl.startsWith("http")) return null;

    let token: string | null = null;

    const makePlayMatch = html.match(/makePlay\s*\([^)]*\)\s*\{[\s\S]*?token=([a-zA-Z0-9_-]+)/i);
    if (makePlayMatch?.[1]) token = makePlayMatch[1];
    else {
      const tokenMatches = [...html.matchAll(/token=([a-zA-Z0-9_-]+)/gi)];
      if (tokenMatches.length >= 2) {
        const firstToken = tokenMatches?.[0]?.[1];
        if (firstToken) token = firstToken;
        else {
          const secondToken = tokenMatches?.[1]?.[1];
          if (secondToken) token = secondToken;
        }
      }
    }

    if (!token?.trim()) return null;

    const generateFullToken = () => {
      let randomString = "";
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      const charsLength = chars.length;

      for (let i = 0; i < 10; i++) {
        randomString += chars.charAt(Math.floor(Math.random() * charsLength));
      }

      return `${randomString}?token=${token}&expiry=${Date.now()}`;
    };

    const fullToken = generateFullToken();

    const url = new URL(`${cdnUrl}${fullToken}`);

    const { headers } = await this.client.head(url.toString(), {
      headers: {
        Referer: origin,
        Range: "bytes=0-1",
        "User-Agent": null,
      },
    });
    if (!headers["content-length"]) return null;

    return [
      {
        url: url.toString(),
        label: `${server.name} `,
        headers: {
          Referer: origin,
        },
        type: "video/mp4",
      },
    ];
  }

  private async extractFromMegaPlay(embedUrl: string, server: VideoServer): Promise<Video[]> {
    const pageHeaders = new AxiosHeaders();
    pageHeaders
      .set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
      .set("Referer", `${this.theme.baseUrl}/`)
      .set("X-Requested-With", "XMLHttpRequest");

    const pageResponse = await this.client.get<string>(embedUrl, {
      headers: pageHeaders,
      validateStatus: () => true,
    });
    if (pageResponse.status !== 200) {
      throw new Error(`MegaPlay page failed: HTTP ${pageResponse.status}`);
    }
    const pageHtml = pageResponse.data;
    const mediaId = this.parseMegaPlayMediaId(pageHtml);
    if (!mediaId) throw new Error("Failed to extract MegaPlay media ID");

    const getSourcesUrl = this.buildMegaPlayGetSourcesUrl(embedUrl, mediaId);
    const apiHeaders = new AxiosHeaders()
      .set("Accept", "application/json,*/*")
      .set("X-Requested-With", "XMLHttpRequest")
      .set("Referer", embedUrl);

    const sourcesResponse = await this.client.get<MegaPlaySourcesResponse>(getSourcesUrl, {
      headers: apiHeaders,
      validateStatus: () => true,
    });
    if (sourcesResponse.status !== 200) {
      throw new Error("MegaPlay getSources failed: HTTP " + sourcesResponse.status);
    }

    const m3u8 = this.processMegaPlaySource(
      sourcesResponse.data.enc,
      deserializeMegaPlaySources(sourcesResponse.data.sources),
    );
    if (!m3u8) throw new Error("Failed to decrypt/find MegaPlay source");

    const subtitleTracks: SubtitleTrack[] =
      sourcesResponse.data.tracks
        ?.filter((t) => !!t.label && !!t.file)
        .map((t) => ({
          kind: "subtitles",
          label: t.label || "",
          lang: this.theme.labelToLang(t.label || "") || "und",
          url: t.file,
        })) ?? [];

    const host = (() => {
      try {
        return new URL(embedUrl).hostname;
      } catch {
        return "megaplay.buzz";
      }
    })();

    let label = server.name;
    if (server.type) {
      label = `[${server.type}] ${label}`;
    }

    const intro = sourcesResponse.data.intro;
    const outro = sourcesResponse.data.outro;

    const video: Video = {
      label,
      url: m3u8,
      type: "application/vnd.apple.mpegurl",
      headers: {
        Referer: `https://${host}/`,
        Origin: `https://${host}`,
      },
      subtitleTracks: subtitleTracks,
      intro: intro?.start && intro.end ? intro : undefined,
      outro: outro?.start && outro.end ? outro : undefined,
    };

    return [video];
  }

  private processMegaPlaySource(enc?: string | null, source?: string | null): string | null {
    let m3u8: string | null = null;
    let wasDecrypted = false;

    if (enc?.trim()) {
      try {
        const keyBytes = Buffer.alloc(32);
        const keySrc = Buffer.from(this.MEGAPLAY_AES_KEY, "utf-8");

        keySrc.copy(keyBytes, 0, 0, Math.min(keySrc.length, 32));

        const iv = Buffer.from(this.MEGAPLAY_AES_IV, "utf-8");

        const base64 = enc.replace(/-/g, "+").replace(/_/g, "/");
        const encrypted = Buffer.from(base64, "base64");

        if (encrypted.length > 0 && encrypted.length % 16 === 0) {
          const decipher = crypto.createDecipheriv("aes-256-cbc", keyBytes, iv);
          const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
          const json = decrypted.toString("utf-8");
          const file = this.FILE_JSON_REGEX.exec(json)?.[1];

          if (file) {
            m3u8 = file;
            wasDecrypted = true;
          }
        }
      } catch (error) {
        console.error(`MegaPlay AES decrypt failed:`, Error.isError(error) ? error.message : error);
      }
    }

    if (!m3u8?.trim()) {
      m3u8 = source ?? null;
    }

    if (!m3u8?.trim()) return null;

    if (!wasDecrypted || this.TOKEN_PARAM_REGEX.test(m3u8)) {
      return m3u8;
    }

    const match = this.PATH_KEY_REGEX.exec(m3u8);
    if (!match) return m3u8;

    const pathKey = `
    ${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}
    `;
    const expiry = Math.floor(Date.now() / 1000) + 90;
    const payload = `${expiry}|${pathKey}`;

    try {
      const signature = crypto
        .createHmac("sha256", Buffer.from(this.MEGAPLAY_TOKEN_SECRET, "utf-8"))
        .update(payload, "utf-8")
        .digest("base64url");

      const payloadB64 = Buffer.from(payload, "utf-8").toString("base64url");

      const token = `${payloadB64}.${signature}`;

      const url = new URL(m3u8);
      url.searchParams.set("token", token);

      return url.toString();
    } catch (e) {
      console.error(`MegaPlay token generation failed:`, Error.isError(e) ? e.message : e);
      return m3u8;
    }
  }

  private parseMegaPlayMediaId(html: string): string | null {
    const dataId = this.DATA_ID_REGEX.exec(html)?.[1];

    if (dataId) return dataId;

    return this.FILE_ID_REGEX.exec(html)?.[1] ?? null;
  }

  private isMegaPlayServer(serverName: string): boolean {
    const name = serverName.toLowerCase().replace(" ", "").replace("-", "").trim();
    return ["vidstram2", "hd1", "hd2"].includes(name) || name.includes("vidstream");
  }

  private isMegaPlayeUrl(url: string): boolean {
    return this.MEGAPLAY_HOST_REGEX.test(url);
  }

  private buildMegaPlayGetSourcesUrl(embedUrl: string, id: string): string {
    let embedUrlObj: URL;

    try {
      embedUrlObj = new URL(embedUrl);
    } catch {
      embedUrlObj = new URL("https://megaplay.buzz");
    }

    const url = new URL("/stream/getSources", embedUrlObj);
    url.searchParams.set("id", id);

    const s = embedUrlObj.searchParams.get("s");
    if (s) url.searchParams.set("s", s);

    return url.toString();
  }

  private parseHostMap(html: string): Map<string, string> {
    const hostMap = new Map<string, string>();

    const mapMatch = html.match(this.HOST_MAP_REGEX);
    if (!mapMatch?.[1]) return hostMap;

    let entryMatch: RegExpExecArray | null = null;
    while ((entryMatch = this.HOST_ENTRY_REGEX.exec(mapMatch[1]))) {
      hostMap.set(entryMatch[1]!, entryMatch[2]!);
    }
    return hostMap;
  }

  private applyHostMap(url: string, hostMap: Map<string, string>): string {
    let result = url;
    for (const [origin, proxy] of hostMap) {
      if (result.includes(origin)) {
        result = result.replace(origin, proxy);
      }
    }

    return result;
  }

  private resolveUrl(url: string, base: string): string {
    if (url.startsWith("http")) return url;

    try {
      const urlObj = new URL(url, base);
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  private readonly MEGAPLAY_AES_KEY = "i?LMTAx0Q6,:}50U";
  private readonly MEGAPLAY_AES_IV = "W0;27ToaUpl_P%'c";
  private readonly MEGAPLAY_TOKEN_SECRET = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";

  private MEGAPLAY_HOST_REGEX = /megaplay\.[^/]+\/stream\//i;

  private TOKEN_PARAM_REGEX = /[?&]token=/i;
  private PATH_KEY_REGEX = /\/([a-f0-9]{32})\/([a-f0-9]{32})\//i;
  private FILE_ID_REGEX = /File\s+(\d+)/i;
  private FILE_JSON_REGEX = /"file"\s*:\s*"([^"]+)"/;
  private PASS_MDF_REGEX = /pass_md5\/[^'"]+/;
  private HOST_MAP_REGEX = /var HOST_MAP\s*=\s*\{([\s\S]*?)\}/;
  private HOST_ENTRY_REGEX = /'([^']+)'\s*:\s*'([^']+)'/g;
  private DATA_ID_REGEX = /data-id="([^"]+)"/;
  private IFRAME_SRC_REGEX = /<iframe[^>]+src="([^"]+)"/;
  private M3U8_REGEX = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/;
  private SOURCE_TAG_REGEX = /<source[^>]+src="([^"]+\.m3u8[^"]*)"/;
  private JS_VAR_M3U8_REGEX =
    /(?:var|let|const)\s+\w+\s*=\s*["']([^"']*(?:\.m3u8|\/stream\/)[^"']*)["']|(?:file|source|url|src)\s*[:=]\s*["']([^"']*(?:\.m3u8|\/stream\/)[^"']*)["']/g;
}
