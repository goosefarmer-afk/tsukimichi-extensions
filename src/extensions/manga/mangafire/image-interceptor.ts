import type { NetworkInterceptor } from "@/lib/network/types";
import { AxiosHeaders, type AxiosRequestHeaders, type AxiosResponse } from "axios";
import sharp, { type OverlayOptions } from "sharp";

export class ImageInterceptor implements NetworkInterceptor {
  readonly name = "manga-fire-image-interceptor";

  private static readonly SCRAMBLED = "scrambled";
  private static readonly PIECE_SIZE = 200;
  private static readonly MIN_SPLIT_COUNT = 5;

  async onResponse(response: AxiosResponse): Promise<AxiosResponse> {
    const url = response.config.url;
    if (!url) return response;

    const hashIndex = url.indexOf("#");
    if (hashIndex === -1) return response;
    const fragment = url.substring(hashIndex + 1);
    if (!fragment.includes(ImageInterceptor.SCRAMBLED)) return response;

    const offset = this.parseOffset(fragment);
    if (offset === null) return response;

    const inputBuffer = this.toBuffer(response.data);

    const descrambled = await this.descramble(inputBuffer, offset);

    const headers = new AxiosHeaders(response.headers as AxiosRequestHeaders);
    headers.set("Content-Type", "image/jpeg");
    headers.set("Content-Length", descrambled.length);

    return {
      ...response,
      data: descrambled,
      headers,
    };
  }

  private parseOffset(fragment: string): number | null {
    const offsetStr = fragment.substring(fragment.lastIndexOf("_") + 1);
    const offset = Number.parseInt(offsetStr, 10);
    return Number.isNaN(offset) ? null : offset;
  }

  private toBuffer(data: unknown): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }

    return Buffer.from(data as string, "base64");
  }

  private ceilDiv(a: number, b: number): number {
    return Math.ceil(a / b);
  }

  private async descramble(imageBytes: Buffer, offset: number): Promise<Buffer> {
    const metadata = await sharp(imageBytes).metadata();
    const { width, height } = metadata;

    if (!width || !height) throw new Error("Failed to get image dimensions");

    const pieceWidth = Math.min(
      ImageInterceptor.PIECE_SIZE,
      this.ceilDiv(width, ImageInterceptor.MIN_SPLIT_COUNT),
    );

    const pieceHeight = Math.min(
      ImageInterceptor.PIECE_SIZE,
      this.ceilDiv(height, ImageInterceptor.MIN_SPLIT_COUNT),
    );

    const xMax = this.ceilDiv(width, pieceWidth) - 1;
    const yMax = this.ceilDiv(height, pieceHeight) - 1;

    const tasks: Promise<OverlayOptions>[] = [];

    for (let y = 0; y <= yMax; y++) {
      for (let x = 0; x <= xMax; x++) {
        const xDst = pieceWidth * x;
        const yDst = pieceHeight * y;
        const w = Math.min(pieceWidth, width - xDst);
        const h = Math.min(pieceHeight, height - yDst);

        const xSrc = pieceWidth * (x === xMax ? x : (xMax - x + offset) % xMax);
        const ySrc = pieceHeight * (y === yMax ? y : (yMax - y + offset) % yMax);

        tasks.push(
          sharp(imageBytes)
            .extract({ left: xSrc, top: ySrc, width: w, height: h })
            .toBuffer()
            .then((input) => ({ input, left: xDst, top: yDst })),
        );
      }
    }

    const composite = await Promise.all(tasks);

    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: {
          red: 0,
          green: 0,
          blue: 0,
        },
      },
    })
      .composite(composite)
      .jpeg({ quality: 90 })
      .toBuffer();
  }
}
