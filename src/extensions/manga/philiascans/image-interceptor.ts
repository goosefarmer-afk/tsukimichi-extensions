import type { NetworkInterceptor } from "@/lib/network/types";
import { AxiosHeaders, type AxiosResponse } from "axios";
import sharp from "sharp";
import crypto from "crypto";

export class ImageInterceptor implements NetworkInterceptor {
  readonly name = "philia-image-interceptor";

  private readonly AES_MAGIC = Buffer.from("ff02", "hex");
  private readonly CHACHA_MAGIC = Buffer.from("ff03", "hex");
  private readonly AES4_MAGIC = Buffer.from("ff04", "hex");
  private readonly SCRAMBLED_REGEX = /.*_s\.[^.]+$/;

  async onResponse(response: AxiosResponse): Promise<AxiosResponse> {
    const urlStr = response.config?.url;
    if (!urlStr || response.status !== 200) {
      return response;
    }

    const url = new URL(urlStr, "http://localhost:8080");

    const filename = url.pathname.split("/").pop() || "";
    if (!this.SCRAMBLED_REGEX.test(filename)) {
      return response;
    }

    let source = response.data;
    if (source instanceof ArrayBuffer) {
      source = Buffer.from(source);
    }
    if (!Buffer.isBuffer(source)) {
      return response;
    }

    const isScrambled = url.searchParams.get("isScrambled");
    const mimeType = url.searchParams.get("mime") || "image/jpeg";
    let chapterKeyB64 = url.searchParams.get("chapterKeyB64");
    const gridSizeStr = url.searchParams.get("gridSize");
    const payloadA = url.searchParams.get("payloadA");
    const payloadB = url.searchParams.get("payloadB");
    const pageIndexStr = url.searchParams.get("pageIndex");

    if (!chapterKeyB64 || !gridSizeStr || !pageIndexStr) {
      return response;
    }

    // Prevent URL decoding from converting base64 '+' into spaces
    chapterKeyB64 = decodeURIComponent(chapterKeyB64);
    // chapterKeyB64 = chapterKeyB64.replace(/ /g, "+");

    const gridSize = parseInt(gridSizeStr, 10);
    const pageIndex = parseInt(pageIndexStr, 10);

    let chapterKey: Buffer;
    if (payloadA && payloadA.trim() !== "" && payloadB && payloadB.trim() !== "") {
      const a = Buffer.from(payloadA.replace(/ /g, "+"), "base64");
      const b = Buffer.from(payloadB.replace(/ /g, "+"), "base64");
      chapterKey = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) {
        chapterKey[i] = a[i]! ^ b[i]!;
      }
    } else {
      chapterKey = Buffer.from(chapterKeyB64, "base64");
    }

    if (source.length < 2) return response;
    const isAesScheme = source[0] === this.AES_MAGIC[0] && source[1] === this.AES_MAGIC[1];
    const isChachaScheme = source[0] === this.CHACHA_MAGIC[0] && source[1] === this.CHACHA_MAGIC[1];
    const isAes4Scheme = source[0] === this.AES4_MAGIC[0] && source[1] === this.AES4_MAGIC[1];
    const hasSchemeMagic = isAesScheme || isChachaScheme || isAes4Scheme;

    if (hasSchemeMagic && source.length < 6) return response;
    if (!hasSchemeMagic && source.length < 4) return response;

    let offset = 0;
    if (hasSchemeMagic) offset += 2; // Skip magic bytes

    const originalWidth = source.readUInt16BE(offset);
    const originalHeight = source.readUInt16BE(offset + 2);
    offset += 4; // Skip dimensional header

    const payload = source.subarray(offset);

    let plainSource: Buffer;
    if (isAes4Scheme) {
      plainSource = this.aesCtrDecrypt(chapterKey, pageIndex, "aesctr4:", payload);
    } else if (isChachaScheme) {
      plainSource = this.chacha20Decrypt(chapterKey, pageIndex, payload);
    } else if (isAesScheme) {
      plainSource = this.aesCtrDecrypt(chapterKey, pageIndex, "aesctr:", payload);
    } else {
      plainSource = this.xorKeystream(chapterKey, pageIndex, payload);
    }

    if (isScrambled !== "1" || isChachaScheme || isAes4Scheme) {
      const headers = new AxiosHeaders(response.headers as any);
      headers.set("Content-Type", mimeType);
      response.data = plainSource;
      response.headers = headers;
      return response;
    }

    try {
      const finalBuffer = await this.unscramble(
        plainSource,
        chapterKey,
        pageIndex,
        gridSize,
        originalWidth,
        originalHeight,
        mimeType,
      );

      const headers = new AxiosHeaders(response.headers as any);
      headers.set("Content-Type", mimeType);
      response.headers = headers;

      response.data = finalBuffer;
    } catch (error) {
      console.error("[ImageInterceptor] Failed to unscramble image:", error);
      // Fallback to plain decrypted source if processing fails
      response.data = plainSource;
    }

    return response;
  }

  private initMac(key: Buffer, data: string): Buffer {
    return crypto.createHmac("sha256", key).update(data, "utf8").digest();
  }

  private aesCtrDecrypt(
    chapterKey: Buffer,
    pageIndex: number,
    prefix: string,
    data: Buffer,
  ): Buffer {
    const derivedKey = this.initMac(chapterKey, `${prefix}${pageIndex}`);
    const iv = Buffer.alloc(16, 0);
    const decipher = crypto.createDecipheriv("aes-256-ctr", derivedKey, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  private xorKeystream(chapterKey: Buffer, pageIndex: number, data: Buffer): Buffer {
    const result = Buffer.from(data);
    const numBlocks = Math.ceil(result.length / 32);
    for (let i = 0; i < numBlocks; i++) {
      const hash = this.initMac(chapterKey, `page:${pageIndex}:${i}`);
      const base = i * 32;
      const length = Math.min(32, result.length - base);
      for (let j = 0; j < length; j++) {
        result[base + j]! ^= hash[j]!;
      }
    }
    return result;
  }

  private chacha20Decrypt(chapterKey: Buffer, pageIndex: number, data: Buffer): Buffer {
    const key = this.initMac(chapterKey, `cc:${pageIndex}`);
    const nonce = Buffer.alloc(12, 0);
    const result = Buffer.from(data);
    let counter = 0;
    let offset = 0;

    while (offset < result.length) {
      const block = this.chacha20Block(key, nonce, counter++);
      const len = Math.min(64, result.length - offset);
      for (let i = 0; i < len; i++) {
        result[offset + i]! ^= block[i]!;
      }
      offset += 64;
    }
    return result;
  }

  private chacha20Block(key: Buffer, nonce: Buffer, counter: number): Buffer {
    const state = new Uint32Array(16);
    state[0] = 0x61707865;
    state[1] = 0x3320646e;
    state[2] = 0x79622d32;
    state[3] = 0x6b206574;
    for (let i = 0; i < 8; i++) state[4 + i] = key.readUInt32LE(i * 4);
    state[12] = counter;
    state[13] = nonce.readUInt32LE(0);
    state[14] = nonce.readUInt32LE(4);
    state[15] = nonce.readUInt32LE(8);

    const working = new Uint32Array(state);

    const quarterRound = (a: number, b: number, c: number, d: number) => {
      working[a] = (working[a]! + working[b]!) >>> 0;
      working[d] = this.rotateLeft(working[d]! ^ working[a], 16);
      working[c] = (working[c]! + working[d]) >>> 0;
      working[b] = this.rotateLeft(working[b]! ^ working[c], 12);
      working[a] = (working[a] + working[b]) >>> 0;
      working[d] = this.rotateLeft(working[d] ^ working[a], 8);
      working[c] = (working[c] + working[d]) >>> 0;
      working[b] = this.rotateLeft(working[b] ^ working[c], 7);
    };

    for (let i = 0; i < 10; i++) {
      quarterRound(0, 4, 8, 12);
      quarterRound(1, 5, 9, 13);
      quarterRound(2, 6, 10, 14);
      quarterRound(3, 7, 11, 15);
      quarterRound(0, 5, 10, 15);
      quarterRound(1, 6, 11, 12);
      quarterRound(2, 7, 8, 13);
      quarterRound(3, 4, 9, 14);
    }

    const block = Buffer.alloc(64);
    for (let i = 0; i < 16; i++) {
      block.writeUInt32LE((working[i]! + state[i]!) >>> 0, i * 4);
    }
    return block;
  }

  private rotateLeft(value: number, shift: number): number {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
  }

  private async unscramble(
    imageBuffer: Buffer,
    chapterKey: Buffer,
    pageIndex: number,
    gridSize: number,
    originalWidth: number,
    originalHeight: number,
    mimeType: string,
  ): Promise<Buffer> {
    const image = sharp(imageBuffer);
    const { width, height } = await image.metadata();
    if (!width || !height) throw new Error("Failed to determine image dimensions");

    const tileWidth = Math.floor(width / gridSize);
    const tileHeight = Math.floor(height / gridSize);
    const gridSizeSq = gridSize * gridSize;

    const c = new Int32Array(gridSizeSq);
    for (let i = 0; i < gridSizeSq; i++) c[i] = i;

    if (gridSizeSq >= 2) {
      const tilesSig = this.initMac(chapterKey, `tiles:${pageIndex}`);
      let nCounter = 0;
      let rBuf = Buffer.alloc(0);
      let aIndex = 8;

      const nextRandom = (): number => {
        if (aIndex >= 8) {
          rBuf = this.initMac(tilesSig, `perm:${nCounter++}`) as any;
          aIndex = 0;
        }
        const val = rBuf.readUInt32LE(aIndex * 4);
        aIndex++;
        return val;
      };

      for (let idx = gridSizeSq - 1; idx >= 1; idx--) {
        const randomVal = nextRandom();
        const swapIdx = randomVal % (idx + 1);
        const temp = c[idx]!;
        c[idx] = c[swapIdx]!;
        c[swapIdx] = temp;
      }
    }

    const w = new Int32Array(gridSizeSq);
    for (let i = 0; i < gridSizeSq; i++) {
      w[c[i]!] = i;
    }

    const channels = 4; // ARGB_8888 Equivalent mapping (RGBA)
    const raw = await image.ensureAlpha().raw().toBuffer();

    // Allocate based on the padded width/height, not the original dimensions.
    // This prevents the copied byte-blocks from shifting out of stride and wrapping around the rows.
    const destRaw = Buffer.alloc(width * height * channels, 0);

    for (let t = 0; t < gridSizeSq; t++) {
      const srcIdx = w[t];
      const srcX = (srcIdx! % gridSize) * tileWidth;
      const srcY = Math.floor(srcIdx! / gridSize) * tileHeight;
      const dstX = (t % gridSize) * tileWidth;
      const dstY = Math.floor(t / gridSize) * tileHeight;

      for (let row = 0; row < tileHeight; row++) {
        const srcOffset = ((srcY + row) * width + srcX) * channels;
        const dstOffset = ((dstY + row) * width + dstX) * channels;

        // Copy block-by-block
        if (
          dstOffset + tileWidth * channels <= destRaw.length &&
          srcOffset + tileWidth * channels <= raw.length
        ) {
          raw.copy(destRaw, dstOffset, srcOffset, srcOffset + tileWidth * channels);
        }
      }
    }

    let finalImage = sharp(destRaw, {
      raw: { width, height, channels },
    });

    if (originalWidth < width || originalHeight < height) {
      finalImage = finalImage.extract({
        left: 0,
        top: 0,
        width: originalWidth,
        height: originalHeight,
      });
    }

    const mt = mimeType.toLowerCase();
    switch (mt) {
      case "image/jpeg":
      case "image/jpg":
        return finalImage.jpeg({ quality: 90 }).toBuffer();

      case "image/png":
        return finalImage.png({ quality: 100 }).toBuffer();

      default:
        return finalImage.webp({ quality: 100 }).toBuffer();
    }
  }
}
