import crypto from "node:crypto";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";

import type { NetworkInterceptor } from "@/lib/network/types";

interface ConfigWithDecryptionData extends InternalAxiosRequestConfig {
  _decryption?: { key: string; iv: string };
}

export class MangaUpImageInterceptor implements NetworkInterceptor {
  readonly name = "MangaUpImageInterceptor";

  async onRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    if (!config.url) return config;

    const url = new URL(config.url, config.baseURL);
    const key = url.searchParams.get("key");
    const iv = url.searchParams.get("iv");

    if (!key || !iv) return config;

    (config as ConfigWithDecryptionData)._decryption = { key, iv };

    return config;
  }

  async onResponse(response: AxiosResponse): Promise<AxiosResponse> {
    const config = response.config as ConfigWithDecryptionData;
    const decryption = config._decryption;

    if (!decryption || !response.status || response.status < 200 || response.status >= 300) {
      return response;
    }

    if (!response.data) return response;

    try {
      response.data = this.decryptData(response.data, decryption.key, decryption.iv);

      return response;
    } catch {
      return response;
    }
  }

  private decryptData(data: any, keyHex: string, ivHex: string): ArrayBuffer {
    let dataBuffer: Buffer;

    if (data instanceof ArrayBuffer) {
      dataBuffer = Buffer.from(data);
    } else if (Buffer.isBuffer(data)) {
      dataBuffer = data;
    } else if (typeof data === "string") {
      dataBuffer = this.isHexString(data) ? this.decodeHex(data) : Buffer.from(data, "utf-8");
    } else {
      throw new Error("Unsupported data type");
    }

    const secretKey = this.decodeHex(keyHex);
    const ivBuffer = this.decodeHex(ivHex);

    if (![16, 24, 32].includes(secretKey.length)) {
      throw new Error("Invalid AES key size. Must be 16, 24, or 32 bytes.");
    }

    if (ivBuffer.length !== 16) {
      throw new Error("Invalid IV size. Must be 16 bytes.");
    }

    const algorithm = `aes-${secretKey.length * 8}-cbc`;

    const decipher = crypto.createDecipheriv(algorithm, secretKey, ivBuffer);

    // Equivalent to Kotlin's AES/CBC/PKCS5Padding.
    decipher.setAutoPadding(true);

    const decrypted = Buffer.concat([decipher.update(dataBuffer), decipher.final()]);

    return decrypted.buffer.slice(
      decrypted.byteOffset,
      decrypted.byteOffset + decrypted.byteLength,
    );
  }

  private decodeHex(hex: string): Buffer {
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error("Invalid hex string");
    }

    return Buffer.from(hex, "hex");
  }

  private isHexString(str: string): boolean {
    return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
  }
}
