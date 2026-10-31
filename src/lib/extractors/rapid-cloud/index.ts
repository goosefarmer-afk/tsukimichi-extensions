import type { Segment, Video } from "@tsukimichi/common";
import { Mutex } from "async-mutex";
import type { AxiosInstance } from "axios";
import CryptoJS from "crypto-js";
import { PlaylistUtils } from "@/lib/playlist-utils";

export class RapidCloudExtractor {
  private playlistUtils: PlaylistUtils;

  private readonly SERVER_URLS = ["https://rapid-cloud.co", "some-clouds-which-still-using-old-v6"];
  private readonly SOURCES_URLS = [
    "/embed-2/v2/e-1/getSources?id=",
    "/ajax/embed-6-v2/getSources?id=",
  ];
  private readonly SOURCES_SPLITTER = ["/e-1/", "/embed-6-v2/"];
  private readonly SOURCES_KEY = ["1", "6"];
  private readonly E1_SCRIPT_URL = "/js/player/a/v2/pro/embed-1.min.js";
  private readonly E6_SCRIPT_URL = "/js/player/e6-player-v2.min.js";
  private readonly MUTEX = new Mutex();
  private shouldUpdateKey = false;
  private readonly PREF_KEY_KEY = "megacloud_key_";
  private readonly PREF_KEY_DEFAULT = "[[0, 0]]";
  private preferences: Map<string, string> = new Map();

  constructor(private client: AxiosInstance) {
    this.playlistUtils = new PlaylistUtils(client);
  }

  private async runUnlocked<T>(block: () => Promise<T>): Promise<T> {
    return await this.MUTEX.runExclusive(block);
  }

  private async getKey(type: string): Promise<number[][]> {
    return await this.runUnlocked(async () => {
      if (this.shouldUpdateKey) {
        await this.updateKey(type);
        this.shouldUpdateKey = false;
      }

      const key = this.preferences.get(`${this.PREF_KEY_KEY}${type}`) || this.PREF_KEY_DEFAULT;
      return JSON.parse(key);
    });
  }

  private async updateKey(type: string): Promise<void> {
    const scriptUrl = () => {
      switch (type) {
        case "1":
          return `${this.SERVER_URLS[0]}${this.E1_SCRIPT_URL}`;
        case "6":
          return `${this.SERVER_URLS[0]}${this.E6_SCRIPT_URL}`;
        default: {
          throw new Error("Invalid key type");
        }
      }
    };

    const { data: script } = await this.client.get<string>(scriptUrl(), {
      headers: {
        "Cache-Control": "no-cache",
      },
    });

    const regex = /case\s*0x[0-9a-f]+:(?![^;]*=partKey)\s*\w+\s*=\s*(\w+)\s*,\s*\w+\s*=\s*(\w+);/g;
    const matches = [...script.matchAll(regex)];

    const indexPairs = matches
      .map((match) => {
        const var1 = match[1];
        const var2 = match[2];

        const regexVar1 = new RegExp(`,${var1}=((?:0x)?([0-9a-fA-F]+))`);
        const regexVar2 = new RegExp(`,${var2}=((?:0x)?([0-9a-fA-F]+))`);

        const matchVar1 = regexVar1.exec(script)?.[1]?.replace(/^0x/, "");
        const matchVar2 = regexVar2.exec(script)?.[1]?.replace(/^0x/, "");

        if (matchVar1 && matchVar2) {
          try {
            return [Number.parseInt(matchVar1, 16), Number.parseInt(matchVar2, 16)];
          } catch {
            return null;
          }
        }
        return null;
      })
      .filter((pair): pair is number[] => pair !== null && pair.length > 0);

    const encoded = JSON.stringify(indexPairs);

    this.preferences.set(`${this.PREF_KEY_KEY}${type}`, encoded);
  }

  private async cipherTextCleaner(data: string, type: string): Promise<[string, string]> {
    const indexPairs = await this.getKey(type);
    let password = "";
    let cipherText = data;
    let offset = 0;

    for (const item of indexPairs) {
      const start = item[0]! + offset;
      const end = start + item[1]!;
      const subStr = data.substring(start, end);
      password += subStr;
      cipherText = cipherText.replace(subStr, "");
      offset += item[1]!;
    }

    return [cipherText, password];
  }

  private async tryDecrypting(ciphered: string, type: string, attempts = 0): Promise<string> {
    if (attempts > 2) {
      throw new Error("Maximum decryption attempts reached");
    }

    const [cipherText, password] = await this.cipherTextCleaner(ciphered, type);
    const decrypted = CryptoJS.AES.decrypt(cipherText, password).toString(CryptoJS.enc.Utf8);

    if (!decrypted) {
      this.shouldUpdateKey = true;
      // Try again with updated key
      await this.tryDecrypting(ciphered, type, attempts + 1);
    }

    return decrypted;
  }

  async getVideosFromUrl(url: string, name: string, type: string): Promise<Video[]> {
    const videos = await this.getVideoDto(url);

    if (!videos.length) {
      throw new Error("Failed to extract videeos from URL");
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
  }

  private async getVideoDto(url: string): Promise<VideoDto[]> {
    const type = url.includes("rapid-cloud") ? 0 : 1;
    const _keyType = this.SOURCES_KEY[type];

    const id = url.split(this.SOURCES_SPLITTER[type]!)[1]?.split("?")[0]?.split("#")[0];

    if (!id) {
      throw new Error("Failed to extract ID from URL");
    }

    const uri = `${this.SERVER_URLS[type]!}${this.SOURCES_URLS[type]}${id}`;

    const { data } = await this.client.get<SourceResponseDto>(uri);

    const videos: VideoDto[] = [];

    for (const source of data.sources) {
      const encoded = source.file;

      let m3u8: string;

      if (!data.encrypted || encoded.includes(".m3u8")) {
        m3u8 = encoded;
      } else {
        m3u8 = await this.decryptWithNewKey(encoded);
      }

      videos.push({
        m3u8,
        tracks: data.tracks,
        intro: data.intro,
        outro: data.outro,
      });
    }

    return videos;
  }

  private async decryptWithNewKey(ciphered: string): Promise<string> {
    const newKey = await this.requestNewKey();
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
      throw new Error("Rapid key not found in keys.json");
    }

    console.log("RapidCloudExtractor", "Using Rapid Key:", key);
    return key;
  }

  private decryptOpenSSL(encBase64: string, password: string): string {
    try {
      const data = new Uint8Array(Buffer.from(encBase64, "base64"));

      // Check for "Salted__" prefix
      const saltedPrefix = new TextEncoder().encode("Salted__");
      if (!data.slice(0, 8).every((val, idx) => val === saltedPrefix[idx])) {
        throw new Error("Invalid encrypted data format");
      }

      const salt = data.slice(8, 16);
      const [key, iv] = this.opensslKeyIv(new TextEncoder().encode(password), salt);

      const ciphertext = data.slice(16);
      const wordArray = CryptoJS.lib.WordArray.create(Array.from(ciphertext) as any);

      const decrypted = CryptoJS.AES.decrypt(
        { ciphertext: wordArray } as any,
        CryptoJS.lib.WordArray.create(Array.from(key) as any),
        {
          iv: CryptoJS.lib.WordArray.create(Array.from(iv) as any),
          padding: CryptoJS.pad.Pkcs7,
          mode: CryptoJS.mode.CBC,
        },
      );

      return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (e) {
      console.error("Decryption failed:", (e as Error).message);
      throw new Error(`Decryption failed: ${(e as Error).message}`);
    }
  }

  private opensslKeyIv(
    password: Uint8Array,
    salt: Uint8Array,
    keyLen = 32,
    ivLen = 16,
  ): [Uint8Array, Uint8Array] {
    let d = new Uint8Array(0);
    let d_i = new Uint8Array(0);

    while (d.length < keyLen + ivLen) {
      const combined = new Uint8Array(d_i.length + password.length + salt.length);
      combined.set(d_i, 0);
      combined.set(password, d_i.length);
      combined.set(salt, d_i.length + password.length);

      // MD5 hash using CryptoJS
      const wordArray = CryptoJS.lib.WordArray.create(Array.from(combined) as any);
      const hash = CryptoJS.MD5(wordArray);
      d_i = new Uint8Array(
        hash.words.flatMap((word) => [
          (word >>> 24) & 0xff,
          (word >>> 16) & 0xff,
          (word >>> 8) & 0xff,
          word & 0xff,
        ]),
      );

      const newD = new Uint8Array(d.length + d_i.length);
      newD.set(d, 0);
      newD.set(d_i, d.length);
      d = newD;
    }

    return [d.slice(0, keyLen), d.slice(keyLen, keyLen + ivLen)];
  }
}

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
