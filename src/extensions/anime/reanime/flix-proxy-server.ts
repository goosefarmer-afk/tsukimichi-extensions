import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Transform, type TransformCallback } from "node:stream";
import axios, { AxiosHeaders, type AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import { convert } from "@/lib/subs-convert";
import { LRUCache } from "@/utils/lru-cache";
import type { FlixcloudChapter } from "./types";

export interface VideoChapters {
  intro?: FlixcloudChapter;
  outro?: FlixcloudChapter;
  chapters?: FlixcloudChapter[];
}

export class FlixProxyServer {
  private server: Server | null = null;
  private listeningPort = 0;

  private segmentMask: Buffer;
  private readonly headers: Record<string, string>;

  private readonly proxyClient: AxiosInstance;

  private static readonly FLIX_CLOUD_URL = "https://flixcloud.cc";
  private static readonly ENC_DEC_URL = "https://enc-dec.app";
  private static readonly DEC_API = `${this.ENC_DEC_URL}/api`;

  private segmentsCache = new LRUCache<string, VideoChapters>({ maxSize: 30 });

  private static readonly MAX_SUBTITLE_BYTES = 512 * 1024;

  constructor(
    headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
    segmentMask: Buffer,
  ) {
    this.headers = this.normalizeHeaders(headers);
    this.segmentMask = Buffer.from(segmentMask);

    const client = axios.create({
      timeout: 30_000,
      maxRedirects: 0,
      validateStatus: () => true,
    });

    axiosRetry(client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      shouldResetTimeout: true,
      retryCondition: (error) => {
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
          return true;
        }

        if (!error.response) return true;

        const status = error.response?.status ?? 0;

        return [408, 429].includes(status) && status >= 500;
      },
    });

    this.proxyClient = client;
  }

  updateSegmentMask(newMask: Buffer): void {
    if (!newMask.equals(this.segmentMask)) {
      this.segmentMask = newMask;
    }
  }

  async start(): Promise<number> {
    if (this.server) {
      return this.port;
    }

    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);

      this.server!.listen(0, "127.0.0.1", () => {
        const address = this.server!.address();

        if (!address || typeof address === "string") {
          reject(new Error("Could not determine listening port"));
          return;
        }

        this.listeningPort = address.port;
        resolve();
      });
    });

    return this.port;
  }

  get isAlive(): boolean {
    return this.server !== null && this.listeningPort > 0 && this.server?.listening === true;
  }

  async stop(): Promise<void> {
    if (!this.isAlive) return;

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    this.server = null;
    this.listeningPort = 0;
  }

  get port(): number {
    return this.listeningPort;
  }

  createProxyUrl(originalUrl: string, wPayload: string): string {
    const params = new URLSearchParams({
      url: originalUrl,
      w_payload: wPayload,
    });

    return `http://127.0.0.1:${this.port}/proxy?${params}`;
  }

  createSubtitleProxyUrl(originalUrl: string): string {
    const params = new URLSearchParams({
      url: originalUrl,
      w_payload: "",
    });

    return `http://127.0.0.1:${this.port}/proxy?${params}`;
  }

  createChaptersProxyUrl(dataLink: string, segments: VideoChapters) {
    this.segmentsCache.set(dataLink, segments);

    return `http://127.0.0.1:${this.port}/chapters?link=${encodeURIComponent(dataLink)}`;
  }

  wrapInDecApi(originalUrl: string, wPayload: string): string {
    if (originalUrl.includes(FlixProxyServer.ENC_DEC_URL)) {
      return originalUrl;
    }

    const encodedUrl = encodeURIComponent(originalUrl);
    const encodedWPayload = encodeURIComponent(wPayload);

    return `${FlixProxyServer.DEC_API}/parse-flixcloud?url=${encodedUrl}&w_payload=${encodedWPayload}`;
  }

  private ensureToken(segmentUrl: string, parentUrl: string): string {
    try {
      const segment = new URL(segmentUrl);

      let token = segment.searchParams.get("token");
      let currentUrl = parentUrl;

      if (!token) {
        for (let i = 0; i < 3; i++) {
          const current = new URL(currentUrl);

          token ??= current.searchParams.get("token");

          if (token) break;

          const nestedUrl = current.searchParams.get("url");

          if (!nestedUrl) break;

          currentUrl = nestedUrl;
        }
      }

      if (token && !segment.searchParams.has("token")) {
        segment.searchParams.set("token", token);
      }

      return segment.toString();
    } catch {
      return segmentUrl;
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setResponseHeaders(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

      if (requestUrl.pathname === "/chapters") {
        const link = requestUrl.searchParams.get("link");

        if (!link) {
          this.sendText(res, 400, "Missing link");
          return;
        }

        const data = this.segmentsCache.get(link);

        if (!data) {
          this.sendText(res, 404, "Segments not found");
          return;
        }

        const formatTimestamp = (seconds: number) => {
          const hours = Math.floor(seconds / 3600);
          const minutes = Math.floor((seconds % 3600) / 60);
          const secs = seconds % 60;

          return `${hours.toString().padStart(2, "0")}:${minutes
            .toString()
            .padStart(2, "0")}:${secs.toFixed(3).padStart(6, "0")}`;
        };

        const chapters: FlixcloudChapter[] = [];
        const addChapter = (chapter?: FlixcloudChapter | null) => {
          if (chapter?.start == null || chapter?.end == null) return;

          const title = chapter.title?.trim() || "Chapter";

          const exists = chapters.some(
            (existing) =>
              existing.start === chapter.start &&
              existing.end === chapter.end &&
              (existing.title?.trim() || "Chapter") === title,
          );

          if (!exists) {
            chapters.push({
              start: chapter.start,
              end: chapter.end,
              title,
            });
          }
        };

        for (const chapter of data.chapters ?? []) {
          addChapter(chapter);
        }

        addChapter(data.intro);
        addChapter(data.outro);
        if (chapters.length === 0) {
          this.sendText(res, 404, "Segments not found");
          return;
        }

        let content = "WEBVTT\n\n";
        for (const chapter of chapters) {
          content += `${formatTimestamp(chapter.start!)} --> ${formatTimestamp(chapter.end!)}\n`;
          content += `${chapter.title}\n\n`;
        }

        res.writeHead(200, {
          "content-type": "text/vtt; charset=utf-8",
          "content-length": Buffer.byteLength(content),
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
        });

        res.end(content);
        return;
      }

      if (requestUrl.pathname !== "/proxy") {
        this.sendText(res, 404, "Not found");
        return;
      }

      const url = requestUrl.searchParams.get("url");

      if (!url) {
        this.sendText(res, 400, "Missing url");
        return;
      }

      const wPayload = requestUrl.searchParams.get("w_payload") ?? "";

      const isSubtitle = url.includes("/subtitles/");

      if (isSubtitle) {
        if (!url.startsWith("https://")) {
          this.sendText(res, 400, "Subtitle URL must be https");
          return;
        }

        const proxyHeaders = this.buildSubtitleHeaders();

        await this.serveSubtitle(url, proxyHeaders, res);

        return;
      }

      const isManifest = url.includes(".m3u8");

      const isMasterManifest =
        isManifest &&
        (url.includes("master.m3u8") ||
          (url.includes("flixcloud.cc") &&
            !url.includes("audio.m3u8") &&
            !url.includes("video.m3u8")));

      const finalUrl = isMasterManifest ? this.wrapInDecApi(url, wPayload) : url;

      const proxyHeaders = this.buildProxyHeaders(url);

      if (!isManifest) {
        await this.serveSegment(finalUrl, proxyHeaders, req, res);
      } else {
        await this.serveManifest(url, finalUrl, wPayload, proxyHeaders, res);
      }
    } catch (error) {
      const axiosError = axios.isAxiosError(error);

      const isTimeout = axiosError && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT");

      this.sendText(res, isTimeout ? 503 : 500, String(error));
    }
  }

  private buildSubtitleHeaders(): Record<string, string> {
    return {
      ...this.headers,
      accept: "*/*",
      origin: FlixProxyServer.FLIX_CLOUD_URL,
      referer: `${FlixProxyServer.FLIX_CLOUD_URL}/`,
    };
  }

  private buildProxyHeaders(url: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.headers,

      accept: "*/*",
    };

    delete headers.origin;
    delete headers.referer;
    delete headers["sec-fetch-dest"];
    delete headers["sec-fetch-mode"];
    delete headers["sec-fetch-site"];
    delete headers["accept-encoding"];

    if (url.includes(FlixProxyServer.ENC_DEC_URL)) {
      headers.origin = FlixProxyServer.ENC_DEC_URL;
      headers.referer = `${FlixProxyServer.ENC_DEC_URL}/`;
    } else {
      headers.origin = FlixProxyServer.FLIX_CLOUD_URL;
      headers.referer = `${FlixProxyServer.FLIX_CLOUD_URL}/`;
      headers["sec-fetch-dest"] = "empty";
      headers["sec-fetch-mode"] = "cors";
      headers["sec-fetch-site"] = "same-site";
    }

    return headers;
  }

  private async serveSegment(
    finalUrl: string,
    proxyHeaders: Record<string, string>,
    clientReq: IncomingMessage,
    clientRes: ServerResponse,
  ): Promise<void> {
    const upstreamHeaders: Record<string, string> = {
      ...proxyHeaders,
    };

    if (typeof clientReq.headers.range === "string") {
      upstreamHeaders.range = clientReq.headers.range;
    }

    const headers = new AxiosHeaders(upstreamHeaders);

    const response = await this.proxyClient.get(finalUrl, {
      headers: {
        ...headers.toJSON(),
        "Accept-Encoding": null,
        "User-Agent": null,
      },
      responseType: "stream",
    });

    if (response.status < 200 || response.status >= 300) {
      response.data.destroy?.();
      console.error("[FlixProxyServer] CDN Error", response.status, response.statusText);
      this.sendText(clientRes, response.status, `CDN Error: ${response.status}`);
      return;
    }

    const upstream = response.data as IncomingMessage;

    const transform = new FlixcloudSegmentTransform(this.segmentMask);

    clientRes.statusCode = response.status;

    clientRes.setHeader("Content-Type", "video/mp2t");

    if (response.headers["accept-ranges"]) {
      clientRes.setHeader("Accept-Ranges", response.headers["accept-ranges"]);
    }

    if (response.headers["content-range"]) {
      clientRes.setHeader("Content-Range", response.headers["content-range"]);
    }

    upstream.on("error", (error) => {
      transform.destroy(error);
    });

    transform.on("error", (error) => {
      if (!clientRes.headersSent) {
        this.sendText(clientRes, 500, String(error));
      } else {
        clientRes.destroy(error);
      }
    });

    upstream.pipe(transform).pipe(clientRes);
  }

  private setResponseHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader(
      "Access-Control-Expose-Headers",
      ["Content-Length", "Content-Range", "Content-Type", "Accept-Ranges"].join(", "),
    );
  }

  private async serveSubtitle(
    subtitleUrl: string,
    proxyHeaders: Record<string, string>,
    res: ServerResponse,
  ): Promise<void> {
    const response = await this.proxyClient.get<IncomingMessage>(subtitleUrl, {
      headers: proxyHeaders,
      responseType: "stream",
    });

    if (response.status < 200 || response.status >= 300) {
      const stream = response.data as IncomingMessage;

      let errorSnippet = "";

      try {
        errorSnippet = (await this.readStreamWithLimit(stream, 1024))
          .toString("utf8")
          .slice(0, 300);
      } catch {
        stream.destroy();
      }

      this.sendText(res, response.status, `Subtitle Error: ${response.status} ${errorSnippet}`);

      return;
    }

    const stream = response.data;

    const contentLength = Number(response.headers["content-length"]);

    if (Number.isFinite(contentLength) && contentLength > FlixProxyServer.MAX_SUBTITLE_BYTES) {
      stream.destroy();

      this.sendText(res, 500, "Subtitle too large");
      return;
    }

    let bytes: Buffer;

    try {
      bytes = await this.readStreamWithLimit(stream, FlixProxyServer.MAX_SUBTITLE_BYTES);
    } catch {
      this.sendText(res, 500, "Subtitle too large");
      return;
    }

    const content = bytes.toString("utf8").replace(/^\uFEFF/, "");

    try {
      const format = this.detectSubtitleFormat(subtitleUrl, content);

      const vtt = convert(content, format, "vtt");

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(vtt));
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "*");

      res.end(vtt);
    } catch (error) {
      this.sendText(
        res,
        500,
        `Subtitle conversion failed: ${Error.isError(error) ? error.message : "Unknown error"}`,
      );
    }
  }

  private detectSubtitleFormat(subtitleUrl: string, content: string): "srt" | "vtt" | "ass" {
    const pathname = new URL(subtitleUrl).pathname;
    if (pathname.endsWith(".ass") || pathname.endsWith(".ssa")) return "ass";

    if (pathname.endsWith(".srt")) return "srt";

    if (pathname.endsWith(".vtt")) return "vtt";

    if (/^WEBVTT(?:\s|$)/i.test(content)) return "vtt";

    if (/\[Script Info\]/i.test(content) || /\[Events\]/i.test(content)) return "ass";

    if (/\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(content)) return "srt";

    throw new Error("Unknown subtitle format");
  }

  private readStreamWithLimit(stream: IncomingMessage, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;

      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;

        if (total > maxBytes) {
          stream.destroy();

          reject(new Error(`Stream exceeds ${maxBytes} byte limit`));

          return;
        }

        chunks.push(chunk);
      });

      stream.once("end", () => {
        resolve(Buffer.concat(chunks));
      });

      stream.once("error", reject);
    });
  }

  private async serveManifest(
    url: string,
    finalUrl: string,
    wPayload: string,
    proxyHeaders: Record<string, string>,
    res: ServerResponse,
  ): Promise<void> {
    const response = await this.proxyClient.get(finalUrl, {
      headers: proxyHeaders,
      responseType: "stream",
    });

    const stream = response.data;

    if (response.status < 200 || response.status >= 300) {
      const errorBody = await this.readStreamWithLimit(stream, 1024 * 1024);

      this.sendText(res, response.status, `Manifest Error: ${errorBody.toString("utf8")}`);

      return;
    }

    const bodyText = (await this.readStreamWithLimit(stream, 10 * 1024 * 1024)).toString("utf8");

    let parentUrl: URL;

    if (url.includes(FlixProxyServer.ENC_DEC_URL)) {
      const wrapped = new URL(url);
      const nestedUrl = wrapped.searchParams.get("url");

      parentUrl = nestedUrl ? new URL(nestedUrl) : wrapped;
    } else {
      parentUrl = new URL(url);
    }

    const modifiedText = bodyText
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return "";
        }

        if (trimmed.startsWith("#")) {
          let cleanedLine = trimmed;

          if (trimmed.startsWith("#EXT-X-STREAM-INF")) {
            cleanedLine = this.fixBandwidth(cleanedLine);
          }

          if (cleanedLine.includes('URI="')) {
            cleanedLine = cleanedLine.replace(/URI="(.*?)"/, (_match, uri: string) => {
              let resolvedUri = new URL(uri, parentUrl).toString();

              resolvedUri = this.ensureToken(resolvedUri, url);

              return `URI="${this.createProxyUrl(resolvedUri, wPayload)}"`;
            });
          }

          return cleanedLine;
        }

        let resolvedUrl = new URL(trimmed, parentUrl).toString();

        resolvedUrl = this.ensureToken(resolvedUrl, url);

        return this.createProxyUrl(resolvedUrl, wPayload);
      })
      .join("\n");

    res.statusCode = 200;

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");

    res.end(modifiedText);
  }

  private sendText(res: ServerResponse, status: number, body: string): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }

    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain");
    res.end(body);
  }

  private fixBandwidth(line: string): string {
    const peakMatch = line.match(/BANDWIDTH=(\d+)/);
    const avgMatch = line.match(/AVERAGE-BANDWIDTH=(\d+)/);

    const peakBw = peakMatch ? Number(peakMatch[1]) : null;

    const avgBw = avgMatch ? Number(avgMatch[1]) : null;

    if (peakBw !== null && peakBw < 100_000) {
      const finalBw = avgBw !== null && avgBw > 100_000 ? avgBw : peakBw * 1000;

      return line.replace(/BANDWIDTH=\d+/, `BANDWIDTH=${finalBw}`);
    }

    return line;
  }

  private normalizeHeaders(
    headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === "string") {
        result[key.toLowerCase()] = value;
      } else if (Array.isArray(value)) {
        result[key.toLowerCase()] = value.join(", ");
      }
    }

    return result;
  }
}

class FlixcloudSegmentTransform extends Transform {
  private xorIndex = 0;

  private headerBuffer = Buffer.alloc(0);
  private initialized = false;

  private skipBytes = 0;
  private shouldXor = false;

  constructor(private readonly mask: Buffer) {
    super();

    if (mask.length !== 16) {
      throw new Error(`Expected 16-byte XOR mask, got ${mask.length}`);
    }
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      if (!this.initialized) {
        this.headerBuffer = Buffer.concat([this.headerBuffer, chunk]);

        // Need enough bytes to distinguish:
        // PNG = 8 bytes
        // WebP = 12 bytes
        if (this.headerBuffer.length < 13) {
          callback();
          return;
        }

        const headerSize = this.detectHeader(this.headerBuffer);

        this.skipBytes = headerSize;

        const firstPayloadOffset = headerSize;

        this.shouldXor =
          headerSize > 0 &&
          this.headerBuffer.length > firstPayloadOffset &&
          this.headerBuffer[firstPayloadOffset] !== 0x47;

        if (this.shouldXor) {
          const decrypted = this.headerBuffer[firstPayloadOffset]! ^ this.mask[0]!;

          if (decrypted !== 0x47) {
            callback(new Error("XOR key could not be found."));

            return;
          }
        }

        this.initialized = true;

        const payload = this.headerBuffer.subarray(this.skipBytes);

        this.headerBuffer = Buffer.alloc(0);

        this.processPayload(payload);

        callback();
        return;
      }

      this.processPayload(chunk);

      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    try {
      // Handles very short segments.
      if (!this.initialized && this.headerBuffer.length > 0) {
        const headerSize = this.detectHeader(this.headerBuffer);

        this.skipBytes = headerSize;

        const payload = this.headerBuffer.subarray(headerSize);

        if (headerSize > 0 && payload.length > 0 && payload[0] !== 0x47) {
          this.shouldXor = true;

          if ((payload[0]! ^ this.mask[0]!) !== 0x47) {
            callback(new Error("XOR key could not be found."));

            return;
          }
        }

        this.processPayload(payload);
      }

      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  private processPayload(chunk: Buffer): void {
    if (chunk.length === 0) return;

    if (!this.shouldXor) {
      this.push(chunk);
      return;
    }

    const output = Buffer.allocUnsafe(chunk.length);

    for (let i = 0; i < chunk.length; i++) {
      output[i] = chunk[i]! ^ this.mask[this.xorIndex & 15]!;

      this.xorIndex++;
    }

    this.push(output);
  }

  private detectHeader(data: Buffer): number {
    // RIFF....WEBP
    if (
      data.length >= 12 &&
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data[8] === 0x57 &&
      data[9] === 0x45 &&
      data[10] === 0x42 &&
      data[11] === 0x50
    ) {
      return 12;
    }

    // PNG signature
    if (
      data.length >= 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    ) {
      return 8;
    }

    return 0;
  }
}
