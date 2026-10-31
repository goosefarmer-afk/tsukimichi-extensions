import type { SubtitleTrack, Video } from "@tsukimichi/common";
import type { AxiosHeaders, AxiosInstance } from "axios";
import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import { unpack } from "unpacker";
import { Deobfuscator } from "@/lib/deobfuscators/synchrony";
import { PlaylistUtils } from "@/lib/playlist-utils";

export class StreamWishExtractor {
  private playlistUtils: PlaylistUtils;

  constructor(private client: AxiosInstance) {
    this.playlistUtils = new PlaylistUtils(client);
  }

  async videosFromUrl(options: {
    url: string;
    headers: AxiosHeaders;
    videoNameGen?: (q: string) => string;
  }): Promise<Video[]> {
    const { url, videoNameGen = (q) => `StreamWish - ${q}`, headers } = options;
    const embedUrl = this.getEmberUrl(url);

    const { data: html } = await this.client.get(embedUrl, {
      headers,
    });

    let doc = html;

    const $ = cheerio.load(doc, {
      baseURI: new URL(embedUrl).origin,
    });

    const script = $('body > script[src*="/main.js"]').first();

    if (script.length > 0) {
      const scriptUrl = script.prop("src")!;
      const { data: scriptContent } = await this.client.get(scriptUrl, {
        headers,
      });

      const deobfuscatedScript = await new Deobfuscator().deobfuscateScript(scriptContent);

      if (!deobfuscatedScript) return [];

      const dmcaServer = this.extractServerList(this.dmcaServersRegex, deobfuscatedScript);
      const mainServer = this.extractServerList(this.mainServersRegex, deobfuscatedScript);
      const rulesServer = this.extractServerList(this.rulesServersRegex, deobfuscatedScript);

      const destination = this.getDestinationServer(
        new URL(scriptUrl).hostname,
        rulesServer,
        mainServer,
        dmcaServer,
      );
      if (!destination) return [];

      const redirectUrl = new URL(embedUrl);
      redirectUrl.hostname = destination;

      doc = await this.client.get(this.getEmberUrl(redirectUrl.toString())).then((r) => r.data);
    }

    const scriptBody = this.extractScriptBody(cheerio.load(doc));
    if (!scriptBody) return [];

    const masterUrl = this.m3u8Regex.exec(scriptBody)?.[0];
    if (!masterUrl) return [];

    const subtitles = this.extractSubtitles(scriptBody);

    return await this.playlistUtils.extractFromHls({
      playlistUrl: masterUrl,
      referer: `https://${new URL(url).hostname}/`,
      videoNameGen,
      subtitleList: subtitles,
    });
  }

  private getDestinationServer(
    host: string,
    rulesServers: string[],
    mainServers: string[],
    dmcaServers: string[],
  ): string | null {
    if (rulesServers.includes(host)) {
      return mainServers.length > 0
        ? mainServers[Math.floor(Math.random() * mainServers.length)]!
        : null;
    }
    return dmcaServers.length > 0
      ? dmcaServers[Math.floor(Math.random() * dmcaServers.length)]!
      : null;
  }

  private extractServerList(regex: RegExp, script: string): string[] {
    const match = script.match(regex)?.[1];
    if (!match) return [];

    return match
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s.length > 0);
  }

  private extractScriptBody(doc: CheerioAPI): string | null {
    const scriptElement = doc("script").filter((_, el) => {
      return doc(el).html()?.includes("m3u8") ?? false;
    });

    if (scriptElement.length === 0) return null;

    let scriptContent = scriptElement.html() || "";

    if (scriptContent.includes("eval(function(p,a,c")) {
      scriptContent = unpack(scriptContent);
    }

    return scriptContent;
  }

  private getEmberUrl(url: string): string {
    if (url.includes("/f/")) {
      const videoId = url.split("/f/")[1];
      return `https://streamwish.com/${videoId}`;
    }

    return url;
  }

  private extractSubtitles(script: string): SubtitleTrack[] {
    try {
      const subtitleStr = script
        .substring(script.indexOf("tracks") + "tracks".length)
        ?.split("[")[1]
        ?.split("]")[0];

      const fixedSubtitleStr = subtitleStr?.replace(this.fixTrackRegex, (match) => `"${match}"`);

      const tracks = JSON.parse(`[${fixedSubtitleStr}]`);

      return tracks
        .filter((t: any) => (t.kind || "").toLowerCase() === "captions")
        .map((t: any) => ({
          kind: "captions",
          label: t.label || "",
          url: t.file,
          lang: "",
        }));
    } catch {
      return [];
    }
  }

  private dmcaServersRegex = /dmca\s*=\s*\[(.*?)]/s;
  private mainServersRegex = /main\s*=\s*\[(.*?)]/s;
  private rulesServersRegex = /rules\s*=\s*\[(.*?)]/s;

  private m3u8Regex = /https[^"]*m3u8[^"]*/;
  private fixTrackRegex = /(?<!")(file|kind|label)(?!")/;
}
