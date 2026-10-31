import type { NetworkInterceptor } from "@/lib/network/types";
import type { InternalAxiosRequestConfig } from "axios";

export class VrfSignerInterceptor implements NetworkInterceptor {
  readonly name = "VrfSignerInterceptor";

  private readonly TABLE_1 =
    "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==";

  private readonly KEY_1 = "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=";

  private readonly TABLE_2 =
    "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==";

  private readonly KEY_2 = "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==";

  private readonly TABLE_3 =
    "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==";

  private readonly KEY_3 = "DELOJgPsVaCcblDtTGMdHzM=";

  private readonly STAGES: { table: Uint8Array; key: Uint8Array; iv: number }[];

  constructor() {
    this.STAGES = [
      {
        table: Buffer.from(this.TABLE_1, "base64"),
        key: Buffer.from(this.KEY_1, "base64"),
        iv: 0x5a,
      },
      {
        table: Buffer.from(this.TABLE_2, "base64"),
        key: Buffer.from(this.KEY_2, "base64"),
        iv: 0x35,
      },
      {
        table: Buffer.from(this.TABLE_3, "base64"),
        key: Buffer.from(this.KEY_3, "base64"),
        iv: 0xba,
      },
    ];
  }

  onRequest(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
    const url = config.url;
    if (!url) return config;

    const urlObj = new URL(url);

    if (urlObj.pathname.startsWith("/api")) {
      const params: [string, string][] = [];
      urlObj.searchParams.forEach((value, key) => {
        params.push([key, value]);
      });

      params.sort(([a], [b]) => a.localeCompare(b));

      const sortedQueryUrl = this.buildSortedQuery(urlObj.pathname, params);

      const signature = this.sign(sortedQueryUrl);

      urlObj.searchParams.set("vrf", signature);

      config.url = urlObj.toString();
      return config;
    }

    return config;
  }

  private sign(path: string): string {
    let data = Buffer.from(path, "utf-8");

    for (const stage of this.STAGES) {
      data = this.encryptState(data, stage.table, stage.key, stage.iv);
    }

    return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  private buildSortedQuery(pathname: string, params: [string, string][]): string {
    let result = pathname.replace("/api", "");

    if (params.length > 0) {
      result += "?";
      let lastKey = "";
      let index = 0;

      const queryString = params
        .map(([key, value]) => {
          let newKey = key;
          if (key.endsWith("[]")) {
            if (lastKey !== key) index = 0;

            lastKey = key;
            newKey = key.replace("[]", `[${index++}]`);
          }
          return `${newKey}=${value}`;
        })
        .join("&");

      result += queryString;
    }

    return result;
  }

  private encryptState(
    data: Uint8Array,
    table: Uint8Array,
    key: Uint8Array,
    iv: number,
  ): Buffer<ArrayBuffer> {
    const out = Buffer.alloc(data.length);
    let prev = iv;
    const keySize = key.length;

    for (let i = 0; i < data.length; i++) {
      const dataByte = data[i]! & 0xff;
      const keyByte = key[i % keySize]! & 0xff;
      const tableIndex = (dataByte ^ keyByte ^ prev) & 0xff;
      prev = table[tableIndex]! & 0xff;
      out[i] = prev;
    }

    return out;
  }
}
