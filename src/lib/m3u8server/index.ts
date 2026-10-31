import * as http from "http";
import * as crypto from "crypto";
import * as url from "url";
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import { Readable } from "stream";
import { parse, stringify, types } from "hls-parser";
import { AutoDetector } from "./auto-detector";

interface RequestHeaders {
  [key: string]: string;
}

class UpstreamStatusException extends Error {
  constructor(
    public code: number,
    public url: string,
    message: string,
    public override cause?: Error,
  ) {
    super(`HTTP ${code} for ${url}: ${message}`);
    this.name = "UpstreamStatusException";
  }
}

interface M3u8HttpServerOptions {
  port?: number;
  fallbackClient?: AxiosInstance;
}

export class M3u8HttpServer {
  private server: http.Server | null = null;
  private port: number;
  private isRunning = false;
  private fallbackClient?: AxiosInstance;
  private readonly tag = "M3u8HttpServer";

  constructor(
    private client: AxiosInstance,
    options: M3u8HttpServerOptions = {},
  ) {
    this.port = options.port || 0;
    this.fallbackClient = options.fallbackClient;
  }

  getPort(): number {
    return this.port;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = http.createServer((req, res) => {
          this.handleRequest(req, res).catch((err) => {
            console.error(`${this.tag} Error in request handler:`, err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end("Internal Server Error");
            }
          });
        });

        this.server.listen(this.port, () => {
          const address = this.server?.address();
          if (address && typeof address !== "string") {
            this.port = address.port;
          }
          this.isRunning = true;
          console.log(`${this.tag} M3U8 HTTP Server started on port ${this.port}`);
          resolve();
        });

        this.server.on("error", (err) => {
          console.error(`${this.tag} Failed to start server:`, err.message);
          reject(err);
        });
      } catch (err) {
        console.error(`${this.tag} Failed to start server:`, (err as Error).message);
        reject(err);
      }
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.isRunning = false;
      console.log(`${this.tag} M3U8 HTTP Server stopped`);
    }
  }

  isServerRunning(): boolean {
    return this.isRunning;
  }

  getHealthStatus(): string {
    return this.isRunning
      ? `M3U8 HTTP Server is running on port ${this.port}`
      : "M3U8 HTTP Server is not running";
  }

  createLocalUrl(m3u8Url: string, referer?: string, userAgent?: string): string {
    return this.proxyM3u8Url(m3u8Url, this.port, referer, userAgent);
  }

  // ---------- request handling ----------

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const reqUrl = req.url || "";
    const parsedUrl = url.parse(reqUrl, true);
    const path = parsedUrl.pathname || "";

    try {
      let response: {
        statusCode: number;
        headers: Record<string, string>;
        body: string | Buffer | Readable;
      };

      if (path.startsWith("/m3u8")) {
        response = await this.handleM3u8Request(req, parsedUrl);
      } else if (path.startsWith("/segment")) {
        response = await this.handleSegmentRequest(req, parsedUrl);
      } else if (path.startsWith("/health")) {
        response = this.handleHealthRequest();
      } else {
        response = {
          statusCode: 404,
          headers: { "Content-Type": "text/plain" },
          body: "Not Found",
        };
      }

      res.statusCode = response.statusCode;
      for (const [key, value] of Object.entries(response.headers)) {
        res.setHeader(key, value);
      }

      if (typeof response.body === "string" || Buffer.isBuffer(response.body)) {
        res.end(response.body);
      } else if (response.body instanceof Readable) {
        response.body.pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      console.error(`${this.tag} Error handling request:`, err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
        res.end(`Error: ${(err as Error).message}`);
      }
    }
  }

  private async handleM3u8Request(
    req: http.IncomingMessage,
    parsedUrl: url.UrlWithParsedQuery,
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: string | Buffer }> {
    const urlParam = parsedUrl.query.url as string;
    const fallbackReferer = parsedUrl.query.referer as string | undefined;
    const fallbackUserAgent = parsedUrl.query.useragent as string | undefined;

    const headers = this.extractHeadersFromRequest(req, fallbackReferer, fallbackUserAgent);

    if (!urlParam || urlParam.trim() === "") {
      console.warn(`${this.tag} Missing URL parameter in M3U8 request`);
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain" },
        body: "Missing url parameter",
      };
    }

    try {
      const processedContent = await this.processM3u8Content(urlParam, headers);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        body: processedContent,
      };
    } catch (err) {
      if (err instanceof UpstreamStatusException) {
        console.warn(`${this.tag} Upstream HTTP ${err.code} for ${urlParam}: ${err.message}`);
        return this.passThroughStatus(err);
      }
      console.error(`${this.tag} Error processing M3U8:`, (err as Error).message);
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain" },
        body: `Error: ${(err as Error).message}`,
      };
    }
  }

  private async handleSegmentRequest(
    req: http.IncomingMessage,
    parsedUrl: url.UrlWithParsedQuery,
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: string | Buffer }> {
    const urlParam = parsedUrl.query.url as string;
    const keyUrl = parsedUrl.query.key as string | undefined;
    const iv = parsedUrl.query.iv as string | undefined;
    const fallbackReferer = parsedUrl.query.referer as string | undefined;
    const fallbackUserAgent = parsedUrl.query.useragent as string | undefined;

    const headers = this.extractHeadersFromRequest(req, fallbackReferer, fallbackUserAgent);

    if (!urlParam || urlParam.trim() === "") {
      console.warn(`${this.tag} Missing URL parameter in segment request`);
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain" },
        body: "Missing url parameter",
      };
    }

    try {
      const segmentData = await this.processSegmentUrl(urlParam, headers, keyUrl, iv);
      return {
        statusCode: 200,
        headers: { "Content-Type": "video/mp2t" },
        body: segmentData,
      };
    } catch (err) {
      if (err instanceof UpstreamStatusException) {
        console.warn(
          `${this.tag} Upstream segment HTTP ${err.code} for ${urlParam}: ${err.message}`,
        );
        return this.passThroughStatus(err);
      }
      console.error(`${this.tag} Error processing segment:`, (err as Error).message);
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain" },
        body: `Error: ${(err as Error).message}`,
      };
    }
  }

  private handleHealthRequest(): {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  } {
    const status = this.getHealthStatus();
    console.log(`${this.tag} Health status: ${status}`);
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: status,
    };
  }

  // ---------- header extraction ----------

  private extractHeadersFromRequest(
    req: http.IncomingMessage,
    fallbackReferer?: string,
    fallbackUserAgent?: string,
  ): RequestHeaders {
    const headers: RequestHeaders = {};

    const relevantHeaders = [
      "user-agent",
      "referer",
      "origin",
      "accept",
      "accept-language",
      "accept-encoding",
      "connection",
      "cache-control",
      "pragma",
    ];
    if (req.headers) {
      for (const [key, value] of Object.entries(req.headers)) {
        const lowerKey = key.toLowerCase();
        if (relevantHeaders.includes(lowerKey) && value) {
          headers[lowerKey] = Array.isArray(value) ? value.join(", ") : value;
        }
      }
    }

    if (fallbackUserAgent && fallbackUserAgent.trim() !== "") {
      headers["user-agent"] = fallbackUserAgent;
    }
    if (fallbackReferer && fallbackReferer.trim() !== "") {
      headers["referer"] = fallbackReferer;
    }

    return headers;
  }

  // ---------- m3u8 processing ----------

  private async processM3u8Content(url: string, headers: RequestHeaders = {}): Promise<string> {
    try {
      const m3u8Content = await this.fetchM3u8Content(url, headers);
      const referer = headers["referer"];
      const userAgent = headers["user-agent"];
      return this.modifyM3u8Content(m3u8Content, url, this.port, referer, userAgent);
    } catch (err) {
      if (err instanceof UpstreamStatusException) {
        console.warn(`${this.tag} Upstream ${err.code} from processM3u8Content for ${url}`);
        throw err;
      }
      console.error(`${this.tag} Error processing M3U8 URL:`, (err as Error).message);
      throw new UpstreamStatusException(
        503,
        url,
        `Error processing m3u8: ${(err as Error).message}`,
        err as Error,
      );
    }
  }

  private modifyM3u8Content(
    content: string,
    manifestUrl: string,
    port: number,
    referer?: string | null,
    userAgent?: string | null,
  ): string {
    const playlist = parse(content);
    return playlist.isMasterPlaylist
      ? this.rewriteMasterPlaylist(playlist, manifestUrl, port, referer, userAgent)
      : this.rewriteMediaPlaylist(playlist, manifestUrl, port, referer, userAgent);
  }

  private rewriteMasterPlaylist(
    playlist: types.MasterPlaylist,
    manifestUrl: string,
    port: number,
    referer?: string | null,
    userAgent?: string | null,
  ): string {
    const proxy = (uri: string) =>
      this.proxyM3u8Url(this.resolveUri(manifestUrl, uri), port, referer, userAgent);

    for (const variant of playlist.variants) {
      if (variant.uri) variant.uri = proxy(variant.uri);
      for (const group of [variant.audio, variant.subtitles, variant.closedCaptions]) {
        for (const rend of group ?? []) {
          if (rend.uri) rend.uri = proxy(rend.uri);
        }
      }
    }

    for (const sk of playlist.sessionKeyList ?? []) {
      if (sk.uri) sk.uri = proxy(sk.uri);
    }

    return stringify(playlist);
  }

  private rewriteMediaPlaylist(
    playlist: types.MediaPlaylist,
    manifestUrl: string,
    port: number,
    referer?: string | null,
    userAgent?: string | null,
  ): string {
    for (const seg of playlist.segments ?? []) {
      const abs = this.resolveUri(manifestUrl, seg.uri);

      if (abs.toLowerCase().includes(".m3u8")) {
        seg.uri = this.proxyM3u8Url(abs, port, referer, userAgent);
        continue;
      }

      let local = `http://localhost:${port}/segment?url=${encodeURIComponent(abs)}`;

      const key = seg.key;
      if (key?.method === "AES-128" && key.uri) {
        const absKey = this.resolveUri(manifestUrl, key.uri);
        const ivHex = key.iv
          ? Buffer.from(key.iv).toString("hex")
          : seg.mediaSequenceNumber.toString(16).padStart(32, "0");
        local += `&key=${encodeURIComponent(absKey)}&iv=${ivHex}`;
      }

      if (seg.map?.uri) {
        seg.map.uri = this.resolveUri(manifestUrl, seg.map.uri);
      }

      if (referer?.trim()) local += `&referer=${encodeURIComponent(referer)}`;
      if (userAgent?.trim()) local += `&useragent=${encodeURIComponent(userAgent)}`;

      seg.uri = local;
    }

    return stringify(playlist);
  }

  private resolveUri(base: string, uri: string): string {
    if (/^https?:\/\//i.test(uri)) return uri;
    try {
      return new URL(uri, base).toString();
    } catch {
      return uri;
    }
  }

  private proxyM3u8Url(
    url: string,
    serverPort: number,
    referer?: string | null,
    userAgent?: string | null,
  ): string {
    let out = `http://localhost:${serverPort}/m3u8?url=${encodeURIComponent(url)}`;
    if (referer?.trim()) out += `&referer=${encodeURIComponent(referer)}`;
    if (userAgent?.trim()) out += `&useragent=${encodeURIComponent(userAgent)}`;
    return out;
  }

  private passThroughStatus(err: UpstreamStatusException): {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  } {
    let statusCode: number;
    switch (err.code) {
      case 401:
      case 403:
      case 404:
      case 429:
      case 500:
      case 503:
        statusCode = err.code;
        break;
      default:
        statusCode = err.code >= 400 && err.code < 500 ? 400 : 500;
    }
    return {
      statusCode,
      headers: { "Content-Type": "text/plain" },
      body: `Upstream ${err.code} for ${err.url}\n${err.message}`,
    };
  }

  // ---------- segment processing ----------

  private async processSegmentUrl(
    url: string,
    headers: RequestHeaders = {},
    keyUrl?: string,
    iv?: string,
  ): Promise<Buffer> {
    try {
      const rawSegment = await this.fetchSegmentBytes(url, headers);

      let plaintext: Buffer;
      if (keyUrl && iv) {
        const keyBytes = await this.fetchSegmentBytes(keyUrl, headers);
        plaintext = this.decryptAes128Cbc(rawSegment, keyBytes, iv);
      } else {
        plaintext = rawSegment;
      }

      const isValidTs = AutoDetector.isMpegTsValid(plaintext);
      const stripped = this.stripInterleavedJunk(plaintext);
      const isValidAfter = AutoDetector.isMpegTsValid(stripped);

      if (isValidTs && !isValidAfter) {
        console.warn(`${this.tag} WARNING: Stripping made the segment invalid!`);
      }

      return stripped;
    } catch (err) {
      if (err instanceof UpstreamStatusException) {
        console.warn(`${this.tag} Segment fetch upstream ${err.code} for ${url}`);
        throw err;
      }
      console.error(`${this.tag} Error processing segment URL:`, (err as Error).message);
      throw new UpstreamStatusException(
        503,
        url,
        `Error processing segment: ${(err as Error).message}`,
        err as Error,
      );
    }
  }

  private async fetchSegmentBytes(url: string, headers: RequestHeaders): Promise<Buffer> {
    const config: AxiosRequestConfig = {
      ...this.client,
      url,
      headers: { ...this.client.defaults.headers.common, ...headers },
      responseType: "arraybuffer",
    };

    try {
      const response = await axios(config);
      return Buffer.from(response.data);
    } catch (err) {
      const axiosError = err as AxiosError;
      if (axiosError.response) {
        throw new UpstreamStatusException(
          axiosError.response.status,
          url,
          "Failed to fetch segment",
        );
      }
      throw err;
    }
  }

  private stripInterleavedJunk(fullData: Buffer): Buffer {
    const skipRanges = AutoDetector.detectInterleavedSkips(fullData);
    if (skipRanges.length === 0) return fullData;

    const buffers: Buffer[] = [];
    let cursor = 0;

    for (const range of skipRanges) {
      if (range.last + 1 > cursor) {
        buffers.push(fullData.subarray(cursor, range.last + 1));
      }
      cursor = range.last + 1;
    }

    if (cursor < fullData.length) {
      buffers.push(fullData.subarray(cursor));
    }

    return Buffer.concat(buffers);
  }

  private decryptAes128Cbc(data: Buffer, key: Buffer, iv: string): Buffer {
    if (key.length !== 16) {
      throw new Error(`Invalid AES-128 key length: ${key.length}`);
    }

    const normalizedIv = this.normalizeHlsIv(iv);
    if (normalizedIv.length !== 32) {
      throw new Error(`Invalid AES-128 IV length: ${normalizedIv.length}`);
    }

    try {
      const ivBuffer = Buffer.from(normalizedIv, "hex");
      const decipher = crypto.createDecipheriv("aes-128-cbc", key, ivBuffer);
      decipher.setAutoPadding(true);
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (err) {
      throw new Error(`Failed to decrypt AES-128 segment: ${(err as Error).message}`);
    }
  }

  private normalizeHlsIv(iv: string): string {
    return iv.replace(/^0x/i, "").padStart(32, "0");
  }

  // ---------- m3u8 fetching ----------

  private async fetchM3u8Content(url: string, headers: RequestHeaders = {}): Promise<string> {
    const config: AxiosRequestConfig = {
      ...this.client,
      url,
      headers: { ...this.client.defaults.headers.common, ...headers },
      responseType: "text",
    };

    try {
      const response = await axios(config);
      if (!response.data || response.data.trim() === "") {
        throw new UpstreamStatusException(502, url, "Empty response body");
      }
      return response.data;
    } catch (err) {
      const axiosError = err as AxiosError;
      if (axiosError.response) {
        throw new UpstreamStatusException(axiosError.response.status, url, "Failed to fetch m3u8");
      }

      if (this.fallbackClient) {
        console.warn(
          `${this.tag} Primary client failed for ${url}: ${(err as Error).message}; attempting fallback`,
        );

        try {
          const fallbackConfig: AxiosRequestConfig = {
            ...this.fallbackClient,
            url,
            headers: { ...this.fallbackClient.defaults.headers.common, ...headers },
            responseType: "text",
          };
          const fallbackResponse = await axios(fallbackConfig);
          if (!fallbackResponse.data || fallbackResponse.data.trim() === "") {
            throw new UpstreamStatusException(502, url, "Empty fallback body");
          }
          return fallbackResponse.data;
        } catch (fbErr) {
          const fbAxiosError = fbErr as AxiosError;
          if (fbAxiosError.response) {
            throw new UpstreamStatusException(
              fbAxiosError.response.status,
              url,
              `Fallback failed: ${(err as Error).message}`,
            );
          }
          throw new UpstreamStatusException(
            503,
            url,
            `Both primary and fallback failed (primary=${(err as Error).message}; fallback=${(fbErr as Error).message})`,
          );
        }
      }

      throw new UpstreamStatusException(
        503,
        url,
        `Primary client failed: ${(err as Error).message}`,
      );
    }
  }
}
