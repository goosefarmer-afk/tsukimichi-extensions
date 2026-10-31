import crypto from "node:crypto";
import type { Segment, Video } from "@tsukimichi/common";
import type { AxiosInstance } from "axios";
import { AxiosHeaders } from "axios";
import { PlaylistUtils } from "@/lib/playlist-utils";

interface TrackDto {
  file: string;
  label: string;
  kind: string;
  default?: boolean;
}

interface SourceResponseDto {
  sources: { file: string; type: string }[];
  encrypted: boolean;
  tracks?: TrackDto[];
  intro?: Segment;
  outro?: Segment;
}

interface VideoDto {
  m3u8: string;
  tracks?: TrackDto[];
  intro?: Segment;
  outro?: Segment;
}

export class MegaCloudExtractor {
  private playlistUtils: PlaylistUtils;
  private megaKey: string | null = null;
  private client: AxiosInstance;
  // private readonly SOURCES_URL = [
  //     "/embed-2/v3/e-1/getSources?id=",
  //     "/ajax/embed-6-v2/getSources?id=",
  // ];
  private readonly SOURCES_URL = "/embed-2/v3/e-1/getSources?id=";
  private readonly SOURCES_SPLITTER = "/e-1/";

  constructor(client: AxiosInstance) {
    this.client = client;
    this.playlistUtils = new PlaylistUtils(this.client);
  }

  async getVideosFromUrl(url: string, name: string, type: string): Promise<Video[]> {
    const videos = await this.getVideoDto(url);

    if (!videos.length) {
      throw new Error("Failed to extract video from URL");
    }

    const subs =
      videos[0]?.tracks
        ?.filter((t) => t.kind === "captions")
        ?.map((t) => ({
          url: t.file,
          lang: t.label || "",
        })) || [];

    const result = await Promise.all(
      videos.flatMap((video) =>
        this.playlistUtils.extractFromHls({
          playlistUrl: video.m3u8,
          referer: `${new URL(url).origin}/`,
          subtitleList: subs,
          videoNameGen: (q) => `${name} - ${q} ${type ? `(${type})` : ""}`,
          intro: video.intro,
          outro: video.outro,
        }),
      ),
    ).then((videos) => videos.flat());

    return result;
    // const masterUrl = video.sources[0]?.file;
    // if (!masterUrl) {
    //     throw new Error("No video source found");
    // }

    // const subs2 = this.playlistUtils.fixSubtitles(
    //     video.tracks
    //         ?.filter((t) => t.kind === "captions")
    //         .map((t) => ({
    //             file: t.file,
    //             label: t.label || "",
    //             kind: t.kind,
    //         })) || [],
    // );

    // const urlObj = new URL(url);

    // return {
    //     sources: video.sources.map((s) => ({ file: s.file })),
    //     subtitles: subs2,
    //     tracks: video.tracks?.filter((t) => t.kind !== "captions"),
    //     intro: video.intro,
    //     outro: video.outro,
    //     referer: `${urlObj.origin}/`,
    // };
  }

  private async getVideoDto(url: string): Promise<VideoDto[]> {
    const urlObj = new URL(url);

    const id = url.split(this.SOURCES_SPLITTER)[1]?.split("?")[0] ?? "";
    if (!id) {
      throw new Error("Failed to extract ID from URL");
    }

    const host = urlObj.host;
    if (!host) {
      throw new Error(`Invalid MegaCloud host: ${url}`);
    }

    const megaCloudServerUrl = `https://${host}`;

    const megaCloudHeaders = () => {
      const headers = new AxiosHeaders();
      headers.set("Accept", "*/*");
      headers.set("X-Requested-With", "XMLHttpRequest");
      headers.set("Referer", `${megaCloudServerUrl}/`);

      return headers;
    };

    const { data: responseNonce } = await this.client.get(url, {
      headers: megaCloudHeaders(),
      responseType: "text",
    });

    const match1 = responseNonce.match(/\b[a-zA-Z0-9]{48}\b/);
    const match2 = responseNonce.match(
      /\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/,
    );

    const nonce = match1?.[0] || (match2?.[1] ? match2[1] + match2[2] + match2[3] : null);

    if (!nonce) throw new Error("Failed to extract nonce from response");

    const uri = `${megaCloudServerUrl}${this.SOURCES_URL}${id}&_k=${nonce}`;

    const srcRes = await this.client.get(uri, {
      headers: megaCloudHeaders(),
      responseType: "json",
    });

    const data: SourceResponseDto = srcRes.data;

    if (!data.encrypted) {
      return data.sources.map((source) => ({
        m3u8: source.file,
        intro: data.intro,
        outro: data.outro,
        tracks: data.tracks,
      }));
    }

    console.log("Decryption required");

    try {
      const ciphered = typeof data.sources === "string" ? data.sources : "";
      const decrypted = await this.tryDecrypting(ciphered);
      const sources: SourceResponseDto["sources"] = JSON.parse(decrypted);

      return sources.map((source) => ({
        m3u8: source.file,
        intro: data.intro,
        outro: data.outro,
        tracks: data.tracks,
      }));
    } catch {
      return [];
    }
  }

  private async tryDecrypting(ciphered: string): Promise<string> {
    if (this.megaKey) {
      try {
        const decrypted = this.decryptOpenSSL(ciphered, this.megaKey);

        return decrypted;
      } catch (e) {
        console.error("Decryption failed with existing key:", (e as Error).message);
        return await this.decryptWithNewKey(ciphered);
      }
    } else {
      return await this.decryptWithNewKey(ciphered);
    }
  }

  private async decryptWithNewKey(ciphered: string): Promise<string> {
    const newKey = await this.requestNewKey();
    this.megaKey = newKey;
    const decrypted = this.decryptOpenSSL(ciphered, newKey);
    return decrypted;
  }

  private async requestNewKey(): Promise<string> {
    const url =
      "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json";

    const response = await this.client.get(url, {
      validateStatus: (status) => status === 200,
    });

    const jsonStr = response.data;

    if (!jsonStr.trim()) {
      throw new Error("keys.json is empty");
    }

    const keyData = JSON.parse(jsonStr);
    const key = keyData["mega"];

    if (!key) {
      throw new Error("Mega key not found in keys.json");
    }

    this.megaKey = key;
    return key;
  }

  // private decryptOpenSSL(encBase64: string, password: string): string {
  //     try {
  //         const data = new Uint8Array(Buffer.from(encBase64, "base64"));

  //         // Check for "Salted__" prefix
  //         const saltedPrefix = new TextEncoder().encode("Salted__");
  //         if (
  //             !data.slice(0, 8).every((val, idx) => val === saltedPrefix[idx])
  //         ) {
  //             throw new Error("Invalid encrypted data format");
  //         }

  //         const salt = data.slice(8, 16);
  //         const [key, iv] = this.opensslKeyIv(
  //             new TextEncoder().encode(password),
  //             salt,
  //         );

  //         const ciphertext = data.slice(16);
  //         const wordArray = CryptoJS.lib.WordArray.create(
  //             Array.from(ciphertext) as any,
  //         );

  //         const decrypted = CryptoJS.AES.decrypt(
  //             { ciphertext: wordArray } as any,
  //             CryptoJS.lib.WordArray.create(Array.from(key) as any),
  //             {
  //                 iv: CryptoJS.lib.WordArray.create(Array.from(iv) as any),
  //                 padding: CryptoJS.pad.Pkcs7,
  //                 mode: CryptoJS.mode.CBC,
  //             },
  //         );

  //         return decrypted.toString(CryptoJS.enc.Utf8);
  //     } catch (e) {
  //         console.error("Decryption failed:", (e as Error).message);
  //         throw new Error(`Decryption failed: ${(e as Error).message}`);
  //     }
  // }

  // private opensslKeyIv(
  //     password: Uint8Array,
  //     salt: Uint8Array,
  //     keyLen = 32,
  //     ivLen = 16,
  // ): [Uint8Array, Uint8Array] {
  //     let d = new Uint8Array(0);
  //     let d_i = new Uint8Array(0);

  //     while (d.length < keyLen + ivLen) {
  //         const combined = new Uint8Array(
  //             d_i.length + password.length + salt.length,
  //         );
  //         combined.set(d_i, 0);
  //         combined.set(password, d_i.length);
  //         combined.set(salt, d_i.length + password.length);

  //         // MD5 hash using CryptoJS
  //         const wordArray = CryptoJS.lib.WordArray.create(
  //             Array.from(combined) as any,
  //         );
  //         const hash = CryptoJS.MD5(wordArray);
  //         d_i = new Uint8Array(
  //             hash.words.flatMap((word) => [
  //                 (word >>> 24) & 0xff,
  //                 (word >>> 16) & 0xff,
  //                 (word >>> 8) & 0xff,
  //                 word & 0xff,
  //             ]),
  //         );

  //         const newD = new Uint8Array(d.length + d_i.length);
  //         newD.set(d, 0);
  //         newD.set(d_i, d.length);
  //         d = newD;
  //     }

  //     return [d.slice(0, keyLen), d.slice(keyLen, keyLen + ivLen)];
  // }

  private decryptOpenSSL(encBase64: string, password: string): string {
    try {
      const data = Buffer.from(encBase64, "base64");

      // Check OpenSSL header
      if (data.subarray(0, 8).toString("ascii") !== "Salted__") {
        throw new Error("Invalid encrypted data format");
      }

      const salt = data.subarray(8, 16);
      const ciphertext = data.subarray(16);

      const [key, iv] = this.opensslKeyIv(Buffer.from(password, "utf8"), salt);

      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

      return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
    } catch (e) {
      console.error("Decryption failed:", (e as Error).message);
      throw new Error(`Decryption failed: ${(e as Error).message}`);
    }
  }

  private opensslKeyIv(password: Buffer, salt: Buffer, keyLen = 32, ivLen = 16): [Buffer, Buffer] {
    let d = Buffer.alloc(0);
    let d_i = Buffer.alloc(0);

    while (d.length < keyLen + ivLen) {
      d_i = crypto
        .createHash("md5")
        .update(Buffer.concat([d_i, password, salt]))
        .digest() as Buffer<ArrayBuffer>;

      d = Buffer.concat([d, d_i]);
    }

    return [d.subarray(0, keyLen), d.subarray(keyLen, keyLen + ivLen)];
  }
}
