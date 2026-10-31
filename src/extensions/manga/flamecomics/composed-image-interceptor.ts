import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import sharp from "sharp";
import type { NetworkInterceptor } from "@/lib/network/types";
import axios from "axios";

export class ComposedImageInterceptor implements NetworkInterceptor {
  readonly name = "ComposedImageInterceptor";

  async onRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    const url = config.url;
    if (!url || !url.endsWith(this.COMPOSED_SUFFIX)) return config;

    const imageUrls = decodeURIComponent(url).slice(0, -this.COMPOSED_SUFFIX.length).split("|");

    config.adapter = (async (cfg) => {
      const buffers = await Promise.all(
        imageUrls.map(async (url) => {
          const response = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
          return Buffer.from(response.data);
        }),
      );

      const metas = await Promise.all(buffers.map((buf) => sharp(buf).metadata()));

      const width = metas.reduce((sum, m) => sum + (m.width ?? 0), 0);
      const height = metas[metas.length - 1]?.height ?? 0;

      let left = 0;
      const composites = buffers.map((buf, i) => {
        const entry = { input: buf, left, top: 0 };
        left += metas[i]?.width ?? 0;
        return entry;
      });

      const output = await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite(composites)
        .png()
        .toBuffer();

      return {
        data: output,
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": this.CONTENT_TYPE,
          "Content-Length": output.length,
        },
        config: cfg,
        request: null,
      } satisfies AxiosResponse;
    }) satisfies AxiosAdapter;

    return config;
  }

  private readonly COMPOSED_SUFFIX = "?composed";

  private readonly CONTENT_TYPE = "image/png";
}
