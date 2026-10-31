import crypto from "node:crypto";
import type { Video } from "@tsukimichi/common";
import type { AxiosInstance } from "axios";
import type { Cheerio } from "cheerio";
import * as cheerio from "cheerio";
import { PlaylistUtils } from "@/lib/playlist-utils";
import type { DecryptedData, EncryptedData } from "./types";

export class GogoStreamExtractor {
  private playlistUtils: PlaylistUtils;

  constructor(private client: AxiosInstance) {
    this.playlistUtils = new PlaylistUtils(client);
  }

  async getVideosFromUrl(url: string): Promise<Video[]> {
    try {
      const { data: html } = await this.client.get<string>(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const $ = cheerio.load(html);

      const iv = this.getBytesAfter($("div.wrapper"), "container-");
      const secretKey = this.getBytesAfter($("body[class]"), "container-");
      const decryptionKey = this.getBytesAfter($("div.videocontent"), "videocontent-");

      const rawParams = this.cryptoHandler(
        $("script[data-value]").attr("data-value")!,
        iv,
        secretKey,
        false,
      );

      const decryptedAjaxParams = rawParams.substring(rawParams.indexOf("&") + 1);

      const parsedUrl = new URL(url);
      const host = `${parsedUrl.protocol}//${parsedUrl.host}`;

      const id = parsedUrl.searchParams.get("id");
      if (!id) throw new Error("id not found");

      const encryptedId = this.cryptoHandler(id, iv, secretKey);

      const token = parsedUrl.searchParams.get("token");
      const qualityPrefix = token ? "GogoStream - " : "Vidstreaming - ";

      const ajaxUrl = `${host}/encrypt-ajax.php?id=${encodeURIComponent(
        encryptedId,
      )}&${decryptedAjaxParams}&alias=${id}`;

      const { data: jsonResponse } = await this.client.get(ajaxUrl, {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      const parsed = JSON.parse(jsonResponse) as EncryptedData;
      const encryptedData = parsed.data;

      const decrypted = this.cryptoHandler(encryptedData, iv, decryptionKey, false);

      const finalData = JSON.parse(decrypted) as DecryptedData;
      const sourceList = finalData.source;

      console.log("sourceList", JSON.stringify(sourceList, null, 2));

      const videoList: Video[] = [];

      if (sourceList.length === 1 && sourceList[0]?.type === "hls") {
        const playlistUrl = sourceList[0]!.file;
        const videos = await this.playlistUtils.extractFromHls({
          playlistUrl,
          referer: url,
          videoNameGen: (q) => `${qualityPrefix}${q}`,
        });

        return videos;
      }

      const headers = {
        Referer: url,
      };

      sourceList.forEach((source) => {
        videoList.push({
          label: `${qualityPrefix}${source.label}`,
          url: source.file,
          headers,
        });
      });

      return videoList;
    } catch {
      return [];
    }
  }

  private getBytesAfter($el: Cheerio<any>, item: string) {
    const className = $el.attr("class") || "";

    const after = className.split(item)[1] || "";

    const digitsOnly = after.replace(/\D/g, "");

    console.log(`bytes for ${item}`, digitsOnly);

    return Buffer.from(digitsOnly, "hex");
  }

  private cryptoHandler(str: string, iv: Buffer, secretKey: Buffer, encrypt = true) {
    const alg = "aes-256-cbc";

    if (encrypt) {
      const cipher = crypto.createCipheriv(alg, secretKey, iv);
      let encrypted = cipher.update(str, "utf8", "base64");
      encrypted += cipher.final("base64");
      return encrypted;
    }

    const decipher = crypto.createDecipheriv(alg, secretKey, iv);
    let decrypted = decipher.update(str, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}
