import type { Video } from "@tsukimichi/common";
import type { AxiosInstance } from "axios";
import { AxiosHeaders } from "axios";
import * as cheerio from "cheerio";
import unpacker from "unpacker";

export class KwikExtractor {
  private cookies = "";

  constructor(private client: AxiosInstance) {}

  private readonly KWIK_PARAMS_REGEX = /\("(\w+)",\d+,"(\w+)",(\d+),(\d+),\d+\)/;
  private readonly KWIK_FORM_ACTION_REGEX = /action="([^"]+)"/;
  private readonly KWIK_FORM_TOKEN_REGEX = /value="([^"]+)"/;

  async getHlsStreamVideo(kwikUrl: string, referer: string, quality = ""): Promise<Video> {
    const { data: html } = await this.client.get(kwikUrl, {
      headers: this.pageHeaders(referer),
    });

    const $ = cheerio.load(html);

    const scriptTag = $("script")
      .filter((_, el) => {
        const scriptText = $(el).text();
        return scriptText?.includes("eval(function(p,a,c,k,e,d");
      })
      .first();
    const packedScript = scriptTag.html();

    if (!packedScript) {
      throw new Error("Could not find packed script");
    }

    if (!unpacker.detect(packedScript)) {
      throw new Error("Invalid p.a.c.k.e.r data.");
    }

    const unpacked = unpacker.unpack(packedScript);
    const cleaned = unpacked.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    const match = cleaned.match(/const\s+source\s*=\s*['"]([^'"]+)['"]/);

    if (match?.[1]) {
      return {
        label: quality,
        url: match[1],
        headers: {
          Origin: "https://kwik.cx",
          Referer: "https://kwik.cx/",
        },
        type: "application/x-mpegURL",
      };
    }

    throw new Error("HLS stream URL not found in unpacked script");
  }

  async getStreamUrlFromKwik(paheUrl: string): Promise<string> {
    const redirectResp = await this.client.get(`${paheUrl}/i`, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const locationHeader = redirectResp.headers["location"] as string;

    if (!locationHeader) {
      throw new Error("No redirect location found");
    }

    const kwikUrl = `https://${locationHeader.split("https://").pop()}`;

    const fContentResponse = await this.client.get(kwikUrl, {
      headers: {
        Referer: "https://kwik.cx/",
      },
    });

    const setCookie = fContentResponse.headers["set-cookie"];

    if (setCookie) {
      const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie || "";

      this.cookies += cookieStr.replace("path=/;", "");
    }

    const fContentString = fContentResponse.data as string;

    const match = this.KWIK_PARAMS_REGEX.exec(fContentString);

    if (!match) {
      throw new Error("Failed to extract kwik params");
    }

    const [_, fullString, key, v1, v2] = match;

    const decrypted = this.decrypt(
      fullString!,
      key!,
      Number.parseInt(v1!, 10),
      Number.parseInt(v2!, 10),
    );

    const uriMatch = this.KWIK_FORM_ACTION_REGEX.exec(decrypted);
    const tokenMatch = this.KWIK_FORM_TOKEN_REGEX.exec(decrypted);
    if (!(uriMatch?.[1] && tokenMatch?.[1])) {
      throw new Error("Failed to extract uri or token");
    }

    const uri = uriMatch[1];
    const token = tokenMatch[1];

    let kwikLocation: string | null = null;
    let code = 419;
    let tries = 0;
    const MAX_TRIES = 10;

    while (code !== 302 && tries < MAX_TRIES) {
      const formData = new URLSearchParams({ _token: token });

      try {
        const response = await this.client.post(uri, formData, {
          headers: {
            Referer: fContentResponse.request?.res?.responseUrl || kwikUrl,
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: this.cookies,
          },
          maxRedirects: 0,
          validateStatus: () => true,
        });

        kwikLocation = response?.headers["location"];
        code = response?.status as number;

        console.log(`Attempt ${tries}: status=${code}, location=${kwikLocation}`);
      } finally {
        tries++;
      }
    }

    if (!kwikLocation) {
      throw new Error(`Failed to extract stream URL after ${tries} attempts.`);
    }

    return kwikLocation;
  }

  private decrypt(fullString: string, key: string, v1: number, v2: number): string {
    const keyIndexMap = new Map<string, number>();
    [...key].forEach((char, idx) => {
      keyIndexMap.set(char, idx);
    });

    const sb: string[] = [];
    let i = 0;
    const toFind = key[v2]!;

    while (i < fullString.length) {
      const nextIndex = fullString.indexOf(toFind, i);
      if (nextIndex === -1) break;

      const decodedCharStrArr: string[] = [];
      for (let j = i; j < nextIndex; j++) {
        const char = fullString[j];
        const index = keyIndexMap.get(char!);
        decodedCharStrArr.push(index !== undefined ? index.toString() : "-1");
      }

      i = nextIndex + 1;

      const decodedCharStr = decodedCharStrArr.join("");
      const decodedChar = String.fromCharCode(Number.parseInt(decodedCharStr, v2) - v1);
      sb.push(decodedChar);
    }

    return sb.join("");
  }

  private pageHeaders(referer: string, cookies = ""): AxiosHeaders {
    const headers = new AxiosHeaders();
    headers.set("Referer", referer);
    headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    headers.set("Accept-Language", "en-US,en;q=0.9");
    if (cookies.trim()) {
      headers.set("Sec-Fetch-Dest", "document");
      headers.set("Sec-Fetch-Site", "same-site");
      headers.set("Cookie", cookies);
    } else {
      headers.set("Sec-Fetch-Dest", "iframe");
      headers.set("Sec-Fetch-Site", "cross-origin");
    }
    headers.set("Sec-Fetch-Mode", "navigate");

    return headers;
  }
}
