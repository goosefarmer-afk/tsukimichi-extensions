import path from "node:path";
import type {
  AudioTrack,
  AuxiliaryTrack,
  HttpHeaders,
  Segment,
  SubtitleTrack,
  Video,
} from "@tsukimichi/common";
import type { AxiosInstance } from "axios";
import * as cheerio from "cheerio";

interface Track {
  url: string;
  lang: string;
  label?: string;
}

export class PlaylistUtils {
  constructor(
    private client: AxiosInstance,
    private headers: HttpHeaders = {},
  ) {}

  extractFromHls(options: {
    playlistUrl: string;
    videoNameGen: (quality: string) => string;
    referer?: string;
    masterHeaders?: HttpHeaders;
    videoHeaders?: HttpHeaders;
    subtitleList?: Track[];
    audioList?: Track[];
    tracks?: AuxiliaryTrack[];
    toStandardQuality?: (quality: string) => string;
    intro?: Segment;
    outro?: Segment;
    poster?: string;
  }): Promise<Video[]> {
    const {
      playlistUrl,
      referer = this.toDefaultReferer(playlistUrl),
      masterHeaders = this.headers,
      videoHeaders = this.headers,
      videoNameGen = (quality) => quality,
      subtitleList = [],
      audioList = [],
      tracks = [],
      toStandardQuality,
      intro,
      outro,
      poster,
    } = options;

    const masterHeadersGen = (baseHeaders: HttpHeaders, ref: string) => {
      const isEmptyHeader = Object.keys(masterHeaders).length === 0;
      return isEmptyHeader ? this.generateMasterHeaders(baseHeaders, ref) : masterHeaders;
    };

    const videoHeadersGen = (baseHeaders: HttpHeaders, ref: string) => {
      const isEmptyHeader = Object.keys(videoHeaders).length === 0;
      return isEmptyHeader ? this.generateMasterHeaders(baseHeaders, ref) : videoHeaders;
    };

    return this.extractFromHlsAdvance({
      playlistUrl,
      referer,
      masterHeadersGen,
      videoHeadersGen,
      videoNameGen,
      subtitleList,
      audioList,
      tracks,
      toStandardQuality,
      intro,
      outro,
      poster,
    });
  }

  async extractFromHlsAdvance(options: {
    playlistUrl: string;
    referer: string;
    masterHeadersGen: (baseHeaders: HttpHeaders, referer: string) => HttpHeaders;
    videoHeadersGen: (baseHeaders: HttpHeaders, referer: string, videoUrl: string) => HttpHeaders;
    subtitleList?: Track[];
    audioList?: Track[];
    tracks?: AuxiliaryTrack[];
    videoNameGen: (quality: string) => string;
    toStandardQuality?: (quality: string) => string;
    intro?: Segment;
    outro?: Segment;
    poster?: string;
  }): Promise<Video[]> {
    const {
      playlistUrl,
      referer = this.toDefaultReferer(playlistUrl),
      masterHeadersGen = (baseHeaders, referer) => this.generateMasterHeaders(baseHeaders, referer),
      videoHeadersGen = (baseHeaders, referer, _videoUrl) =>
        this.generateMasterHeaders(baseHeaders, referer),
      videoNameGen = (quality) => quality,
      subtitleList = [],
      audioList = [],
      tracks = [],
      toStandardQuality = (q) => this.stnQuality(q),
      intro,
      outro,
      poster,
    } = options;

    const masterHeaders = masterHeadersGen(this.headers, referer);
    const { data: masterPlaylist } = await this.client.get<string>(playlistUrl, {
      headers: masterHeaders,
    });

    if (!masterPlaylist?.includes(this.PLAYLIST_SEPARATOR)) {
      return [
        {
          label: videoNameGen("Video"),
          url: playlistUrl,
          headers: masterHeaders,
          subtitleTracks: this.convertTracksToSubtitles(subtitleList),
          audioTracks: this.convertTracksToAudio(audioList),
          tracks: [],
          poster,
        },
      ];
    }

    const masterUrlBase = new URL(playlistUrl);
    masterUrlBase.pathname = `${path.dirname(masterUrlBase.pathname)}/`;

    const subtitleTracks: SubtitleTrack[] = [
      ...subtitleList.map((s) => ({
        ...s,
        label: s.label || s.lang?.toUpperCase(),
        kind: (s as any).kind || ("subtitles" as const),
      })),
      ...Array.from(masterPlaylist.matchAll(this.SUBTITLE_REGEX))
        .map((m) => {
          const attributes = Object.fromEntries(
            [...m[0].matchAll(/([A-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
          );

          const uri = attributes.URI;

          if (!uri) return null;
          const url = this.getAbsoluteUrl(uri, playlistUrl, masterUrlBase.toString());

          if (!url) return null;

          const alreadyExist = subtitleList.find((t) => t.url === url);

          if (alreadyExist) return null;

          return {
            url,
            kind: "subtitles" as const,
            label: attributes.NAME,
            lang: attributes.LANGUAGE || this.labelToLang(attributes.NAME) || "und",
          };
        })
        .filter((track) => track !== null),
    ];

    // const audioTracks: AudioTrack[] = [
    //   ...this.convertTracksToAudio(audioList),
    //   ...(Array.from(masterPlaylist.matchAll(this.AUDIO_REGEX))
    //     .map((m) => {
    //       console.log("matcher", m);
    //       if (!m[2]) return null;
    //       const url = this.getAbsoluteUrl(m[2], playlistUrl, masterUrlBase.toString());
    //       if (!url) return null;

    //       return {
    //         label: m[1],
    //         url,
    //         kind: "audio",
    //       } as AudioTrack;
    //     })
    //     .filter((track) => track !== null) as AudioTrack[]),
    // ];

    const audioTracks: AudioTrack[] = [
      ...this.convertTracksToAudio(audioList),

      ...(Array.from(
        masterPlaylist.matchAll(this.AUDIO_REGEX).map((m) => {
          const line = m[0];

          const attributes = Object.fromEntries(
            [...line.matchAll(/([A-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
          );

          const name = attributes.NAME;
          const uri = attributes.URI;

          if (!uri) return null;

          const url = this.getAbsoluteUrl(uri, playlistUrl, masterUrlBase.toString());

          if (!url) return null;
          return {
            label: name || "",
            lang: attributes.LANGUAGE,
            url,
            kind: "audio",
          };
        }),
      ).filter((track) => track !== null) as AudioTrack[]),
    ];

    const streams = masterPlaylist.split(this.PLAYLIST_SEPARATOR).slice(1);

    const videos: Array<{ bandwidth: number | null; video: Video }> = [];

    for (const stream of streams) {
      const codecMatch = stream.match(this.CODECS_REGEX)?.[1];
      if (codecMatch?.[1]) {
        const codec = codecMatch[1];
        // FIXME: Why skip mp4a?
        if (codec.startsWith("mp4a")) continue;
      }

      let resolution: string | undefined;

      const resolutionMatch = stream.match(this.RESOLUTION_REGEX)?.[1];
      let qualityNum: number | undefined = undefined;

      if (resolutionMatch) {
        const qualityMatch = this.QUALITY_REGEX.exec(resolutionMatch)?.[1];
        if (qualityMatch) {
          const standardQuality = toStandardQuality(qualityMatch);
          const qNum = Number.parseInt(qualityMatch, 10);
          if (!Number.isNaN(qNum)) qualityNum = qNum;
          resolution = standardQuality
            ? `${standardQuality} (${resolutionMatch})`
            : resolutionMatch;
        } else {
          resolution = resolutionMatch;
        }
      }

      const bandwidthMatch = this.BANDWIDTH_REGEX.exec(stream)?.[1];
      const bandwidth = bandwidthMatch ? Number.parseInt(bandwidthMatch, 10) : null;
      const bandwidthFormatted = bandwidth ? this.formatBytes(bandwidth) : null;

      const streamNameParts = [resolution, bandwidthFormatted].filter(Boolean);
      const streamName = streamNameParts.length > 0 ? streamNameParts.join(" - ") : "Video";

      const lines = stream.split("\n");
      const urlLine = lines.find((line, idx) => idx > 0 && line.trim() && !line.startsWith("#"));
      if (!urlLine) continue;

      const videoUrl = this.getAbsoluteUrl(urlLine.trim(), playlistUrl, masterUrlBase.toString());
      if (!videoUrl) continue;

      videos.push({
        bandwidth,
        video: {
          url: videoUrl,
          label: videoNameGen(streamName),
          headers: videoHeadersGen(this.headers, referer, videoUrl),
          subtitleTracks: this.convertTracksToSubtitles(subtitleTracks),
          // @ts-expect-error
          audioTracks: this.convertTracksToAudio(audioTracks),
          tracks,
          intro,
          outro,
          type: "application/x-mpegURL",
          quality: qualityNum,
          poster,
        },
      });
    }

    videos.sort((a, b) => {
      const bwA = a.bandwidth ?? 0;
      const bwB = b.bandwidth ?? 0;
      return bwB - bwA;
    });

    return videos.map((v) => v.video);
  }

  extractFromDash(options: {
    mpdUrl: string;
    videoNameGen: (quality: string) => string;
    referer?: string;
    mpdHeaders?: HttpHeaders;
    videoHeaders?: HttpHeaders;
    subtitleList?: Track[];
    audioList?: Track[];
    toStandardQuality?: (quality: string) => string;
  }): Promise<Video[]> {
    let {
      mpdUrl,
      videoNameGen = (quality) => quality,
      referer,
      mpdHeaders = this.headers,
      videoHeaders = this.headers,
      subtitleList = [],
      audioList = [],
      toStandardQuality,
    } = options;
    referer ||= this.toDefaultReferer(mpdUrl);

    const mpdHeadersGen = (baseHeaders: HttpHeaders, ref: string) => {
      const isEmptyHeader = Object.keys(mpdHeaders).length === 0;
      return isEmptyHeader ? this.generateMasterHeaders(baseHeaders, ref) : mpdHeaders;
    };

    const videoHeadersGen = (baseHeaders: HttpHeaders, ref: string) => {
      const isEmptyHeader = Object.keys(videoHeaders).length === 0;
      return isEmptyHeader ? this.generateMasterHeaders(baseHeaders, ref) : videoHeaders;
    };
    return this.extractFromDashAdvanced({
      mpdUrl,
      videoNameGen: (videoRes, bandwidth) => {
        const bw = this.formatBytes(Number.parseInt(bandwidth, 10) || null);
        return `${videoNameGen(videoRes)} - ${bw}`;
      },
      referer,
      mpdHeadersGen,
      videoHeadersGen,
      subtitleList,
      audioList,
      toStandardQuality,
    });
  }

  async extractFromDashAdvanced(options: {
    mpdUrl: string;
    videoNameGen: (quality: string, bandwidth: string) => string;
    referer?: string;
    mpdHeadersGen: (baseHeaders: HttpHeaders, referer: string) => HttpHeaders;
    videoHeadersGen: (baseHeaders: HttpHeaders, referer: string, videoUrl: string) => HttpHeaders;
    subtitleList: Track[];
    audioList: Track[];
    toStandardQuality?: (quality: string) => string;
  }): Promise<Video[]> {
    const {
      mpdUrl,
      videoNameGen,
      referer = this.toDefaultReferer(mpdUrl),
      audioList = [],
      subtitleList = [],
      toStandardQuality = (q) => this.stnQuality(q),
      mpdHeadersGen,
      videoHeadersGen,
    } = options;

    const mpdHeaders = mpdHeadersGen(this.headers, referer);
    const { data: mpdData } = await this.client.get(mpdUrl, {
      headers: mpdHeaders,
    });

    const $ = cheerio.load(mpdData, { xml: { xmlMode: true } });

    const extractMediaUrl = ($el: cheerio.Cheerio<any>) => {
      const directUrl = $el.text();
      if (directUrl.trim()) return directUrl.trim();

      const segmentTemplate = $el.find("SegmentTemplate");
      if (segmentTemplate.length) {
        const initialization = segmentTemplate.attr("initialization");
        if (initialization) {
          if (initialization.startsWith("http")) return initialization;

          const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);
          return new URL(initialization, baseUrl).toString();
        }
      }

      const media = segmentTemplate.attr("media");
      if (media) {
        const startNum = segmentTemplate.attr("startNumber") || "1";
        const mediaUrl = media.replace(/\$Number\$/g, startNum).replace(/\$\$/, "");

        if (mediaUrl.startsWith("http")) return mediaUrl;

        const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);
        return new URL(mediaUrl, baseUrl).toString();
      }

      return "";
    };

    const audioTracks = [...audioList];

    $('Representation[mimeType*="audio"]').each((_, el) => {
      const $el = $(el);
      const bandwidth = $el.attr("bandwidth");
      const bw = bandwidth ? Number.parseInt(bandwidth, 10) : null;
      const quality = $el.attr("quality");
      const audioSamplingRate = $el.attr("audioSamplingRate");

      let label = "";

      if (quality) label = quality.charAt(0).toUpperCase() + quality.slice(1);
      else if (bw) label = this.formatBytes(bw);
      else label = "audio";

      if (audioSamplingRate) label += ` ${audioSamplingRate}Hz`;

      const audioUrl = extractMediaUrl($el);

      if (audioUrl) {
        audioTracks.push({
          url: audioUrl,
          lang: label,
        });
      }
    });

    const videos: Video[] = [];
    $('Representation[mimeType*="video"]').each((_, el) => {
      const $el = $(el);
      const bandwidth = $el.attr("bandwidth");
      const height = $el.attr("height") || "";
      const width = $el.attr("width") || "";
      const quality = $el.attr("quality");
      const frameRate = $el.attr("frameRate");

      let qualityString = height;

      if (!qualityString && quality) qualityString = quality;

      const standardQuality = toStandardQuality(height);

      let res = standardQuality;
      if (width && height) res = `${standardQuality} (${width}x${height})`;
      else if (quality) res = `${standardQuality} (${quality})`;

      if (frameRate) res += ` @${frameRate}fps`;

      const videoUrl = extractMediaUrl($el);

      if (videoUrl) {
        videos.push({
          url: videoUrl,
          label: videoNameGen(res, bandwidth || ""),
          headers: videoHeadersGen(this.headers, referer, videoUrl),
          audioTracks: this.convertTracksToAudio(audioTracks),
          subtitleTracks: this.convertTracksToSubtitles(subtitleList),
          type: "application/dash+xml",
        });
      }
    });
    return videos;
  }

  async fixSubtitles(subtitleList: Track[]): Promise<Track[]> {
    const fixed: Track[] = [];

    for (const track of subtitleList) {
      try {
        const { data: subData } = await this.client.get(track.url);
        const fixedData = subData.replace(this.SUBTITLE_REGEX, (match: string, p1: string) =>
          this.cleanSubtitleData([match, p1]),
        );

        const dataUrl = `data:text/vtt;base64,${Buffer.from(fixedData).toString("base64")}`;

        fixed.push({
          url: dataUrl,
          lang: track.lang,
        });
      } catch {
        fixed.push(track);
      }
    }

    return fixed;
  }

  private cleanSubtitleData(match: RegExpMatchArray): string {
    const lineCount = (match[1]?.match(/\n/g) || []).length;
    return `\n${"&nbsp;\n".repeat(lineCount - 1)}`;
  }

  private generateMasterHeaders(baseHeaders: HttpHeaders, referer: string): HttpHeaders {
    const headers = { ...baseHeaders };
    headers["Accept"] = "*/*";
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        headers["Origin"] = refererUrl.origin;
        headers["Referer"] = referer;
      } catch {
        // ignore
      }
    }

    return headers;
  }

  private formatBytes(bytes?: number | null): string {
    if (bytes == null) return "";

    if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB/s`;
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB/s`;
    if (bytes >= 1000) return `${(bytes / 1000).toFixed(2)} KB/s`;
    if (bytes > 1) return `${bytes}/s`;

    if (bytes === 1) return `${bytes} byte/s`;

    return "";
  }

  protected toDefaultReferer(input: string): string {
    try {
      const urlObj = new URL(input);
      return `${urlObj.protocol}//${urlObj.host}/`;
    } catch {
      return "";
    }
  }

  protected stnQuality(quality: string): string {
    const numQuality = Number.parseInt(quality.trim(), 10);
    if (Number.isNaN(numQuality)) return quality;

    const result = this.STANDARD_QUALITIES.reduce((prev, curr) =>
      Math.abs(curr - numQuality) < Math.abs(prev - numQuality) ? curr : prev,
    );

    return `${result}p`;
  }

  private getAbsoluteUrl(url: string, playlistUrl: string, masterBase: string): string | null {
    if (!url) return null;

    if (url.startsWith("http")) return url;

    if (url.startsWith("//")) return `https:${url}`;

    if (url.startsWith("/")) {
      const playlistUrlObj = new URL(playlistUrl);
      return `${playlistUrlObj.protocol}//${playlistUrlObj.host}${url}`;
    }
    return new URL(url, masterBase).toString();
  }

  private convertTracksToSubtitles(tracks: Track[]): SubtitleTrack[] {
    return tracks.map((t) => ({
      url: t.url,
      label: t.label || t.lang,
      lang: this.labelToLang(t.lang) || t.lang,
      kind: "subtitles",
    }));
  }

  private convertTracksToAudio(tracks: Track[]): AudioTrack[] {
    return tracks.map((t) => ({
      url: t.url,
      label: t.label || t.lang,
      lang: t.lang,
      kind: "audio",
    }));
  }

  private labelToLang(label: string): string | undefined {
    if (!label) return undefined;

    const normalized = label
      .toLowerCase()
      .replace(/[()]/g, "")
      .replace(/[_\s-]+/g, " ")
      .trim();

    const tokens = normalized.split(" ");

    for (const token of tokens) {
      const isoMatch = token.match(/^([a-z]{2})([a-z]{2})?$/);
      if (isoMatch?.[1]) {
        const lang = isoMatch[1].toLowerCase();
        const region = isoMatch[2]?.toUpperCase();
        return region ? `${lang}-${region}` : lang;
      }
    }

    const langKey = tokens.find((t) => t in this.LANG_MAP);
    if (!langKey) return undefined;
    const lang = this.LANG_MAP[langKey as keyof typeof this.LANG_MAP];

    const regionKey = tokens.find((t) => t in this.REGION_MAP);
    const region = regionKey ? this.REGION_MAP[regionKey] : undefined;

    if (lang === "zh" && region) {
      const script = this.CHINESE_LANG_SCRIPT_MAP[region] || "Hans";
      return `${lang}-${script}-${region.toUpperCase()}`;
    }

    return region ? `${lang}-${region.toUpperCase()}` : lang;
  }

  // ======================== Constants ========================
  private readonly STANDARD_QUALITIES = [144, 240, 360, 480, 720, 1080, 1440, 2160];
  private readonly PLAYLIST_SEPARATOR = "#EXT-X-STREAM-INF:";
  // private readonly SUBTITLE_REGEX = /#EXT-X-MEDIA:TYPE=SUBTITLES.*?NAME="(.*?)".*?URI="(.*?)"/g;
  private readonly SUBTITLE_REGEX = /#EXT-X-MEDIA:TYPE=SUBTITLES[^\r\n]*/g;
  private readonly AUDIO_REGEX = /#EXT-X-MEDIA:TYPE=AUDIO[^\r\n]*/g;
  // private readonly AUDIO_REGEX = /#EXT-X-MEDIA:TYPE=AUDIO.*?NAME="(.*?)".*?URI="(.*?)"/g;
  private readonly CODECS_REGEX = /CODECS="([^"]+)"/;
  private readonly RESOLUTION_REGEX = /RESOLUTION=([xX\d]+)/;
  private readonly QUALITY_REGEX = /[xX](\d+)/;
  private readonly BANDWIDTH_REGEX = /BANDWIDTH=(\d+)/;
  private FIX_SUBTITLE_REGEX = /(\n{2,})(?!(?:\d+:)*\d+(?:\.\d+)?\s-+>\s(?:\d+:)*\d+(?:\.\d+)?)/gm;

  private readonly LANG_MAP = {
    english: "en",
    spanish: "es",
    french: "fr",
    german: "de",
    italian: "it",
    portuguese: "pt",
    russian: "ru",
    chinese: "zh",
    japanese: "ja",
    korean: "ko",
    arabic: "ar",
    indonesian: "id",
    bahasa: "id",
    malay: "ms",
    thai: "th",
    vietnamese: "vi",
    vietnam: "vi",
  } as const;

  private readonly REGION_MAP: Record<string, string> = {
    mexico: "mx",
    mx: "mx",
    brazil: "br",
    br: "br",
    unitedstates: "us",
    us: "us",
    uk: "gb",
    england: "gb",
    egypt: "eg",
    saudi: "sa",
    indonesia: "id",
    malaysia: "my",
    vietnam: "vn",
  };

  protected readonly CHINESE_LANG_SCRIPT_MAP: Record<string, string> = {
    hk: "Hant",
    tw: "Hant",
    cn: "Hans",
  };
}
