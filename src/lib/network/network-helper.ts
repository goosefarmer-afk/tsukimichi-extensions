import axios, { type AxiosInstance } from "axios";
import axiosRetry, { isNetworkOrIdempotentRequestError } from "axios-retry";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

import { AxiosClientBuilder } from "./axios";
import { DoHInterceptor } from "./interceptors/doh";
import { ErrorNormalizer } from "./interceptors/error-normalizer";
import { SystemDnsInterceptor } from "./interceptors/system-dns";
import type { NetworkInterceptor } from "./types";
import { CloudflareInterceptor } from "../cloudflare-interceptor";

export const PREF_DOH_CLOUDFLARE = "cloudflare";
export const PREF_DOH_GOOGLE = "google";
export const PREF_DOH_ADGUARD = "adguard";
export const PREF_DOH_QUAD9 = "quad9";
export const PREF_DOH_ALIDNS = "alidns";
export const PREF_DOH_DNSPOD = "dnspod";
export const PREF_DOH_360 = "360";
export const PREF_DOH_QUAD101 = "quad101";
export const PREF_DOH_MULLVAD = "mullvad";
export const PREF_DOH_CONTROLD = "controld";
export const PREF_DOH_NJALLA = "njalla";
export const PREF_DOH_SHECAN = "shecan";
export const PREF_DOH_LIBREDNS = "libredns";

const DOH_URLS: Record<string, string> = {
  [PREF_DOH_CLOUDFLARE]: "https://cloudflare-dns.com/dns-query",
  [PREF_DOH_GOOGLE]: "https://dns.google/dns-query",
  [PREF_DOH_ADGUARD]: "https://dns-unfiltered.adguard.com/dns-query",
  [PREF_DOH_QUAD9]: "https://dns.quad9.net/dns-query",
  [PREF_DOH_ALIDNS]: "https://dns.alidns.com/dns-query",
  [PREF_DOH_DNSPOD]: "https://doh.pub/dns-query",
  [PREF_DOH_360]: "https://doh.360.cn/dns-query",
  [PREF_DOH_QUAD101]: "https://dns.twnic.tw/dns-query",
  [PREF_DOH_MULLVAD]: "https://doh.mullvad.net/dns-query",
  [PREF_DOH_CONTROLD]: "https://freedns.controld.com/p0",
  [PREF_DOH_NJALLA]: "https://dns.njal.la/dns-query",
  [PREF_DOH_SHECAN]: "https://free.shecan.ir/dns-query",
  [PREF_DOH_LIBREDNS]: "https://doh.libredns.gr/dns-query",
};

const BOOTSTRAP_DNS: Record<string, string[]> = {
  [PREF_DOH_CLOUDFLARE]: [
    "162.159.36.1",
    "162.159.46.1",
    "1.1.1.1",
    "1.0.0.1",
    "162.159.132.53",
    "2606:4700:4700::1111",
    "2606:4700:4700::1001",
    "2606:4700:4700::0064",
    "2606:4700:4700::6400",
  ],
  [PREF_DOH_GOOGLE]: ["8.8.4.4", "8.8.8.8", "2001:4860:4860::8888", "2001:4860:4860::8844"],
  [PREF_DOH_ADGUARD]: ["94.140.14.140", "94.140.14.141", "2a10:50c0::1:ff", "2a10:50c0::2:ff"],
  [PREF_DOH_QUAD9]: ["9.9.9.9", "149.112.112.112", "2620:fe::fe", "2620:fe::9"],
  // [PREF_DOH_ALIDNS]: ["223.5.5.5", "223.6.6.6", "2400:3200::1", "2400:3200:baba::1"],
  [PREF_DOH_DNSPOD]: ["1.12.12.12", "120.53.53.53"],
  [PREF_DOH_360]: [
    "101.226.4.6",
    "218.30.118.6",
    "123.125.81.6",
    "140.207.198.6",
    "180.163.249.75",
    "101.199.113.208",
    "36.99.170.86",
  ],
  [PREF_DOH_QUAD101]: ["101.101.101.101", "2001:de4::101", "2001:de4::102"],
  [PREF_DOH_MULLVAD]: ["194.242.2.2", "2a07:e340::2"],
  [PREF_DOH_CONTROLD]: ["76.76.2.0", "76.76.10.0", "2606:1a40::", "2606:1a40:1::"],
  [PREF_DOH_NJALLA]: ["95.215.19.53", "2001:67c:2354:2::53"],
  [PREF_DOH_SHECAN]: ["178.22.122.100", "185.51.200.2"],
  [PREF_DOH_LIBREDNS]: ["116.202.176.26", "2a01:4f8:1c0c:8274::1"],
};

export interface NetworkPreferences {
  dohProvider?: () => string;
  defaultUserAgent?: () => string;
  extensionId: string;
}

export const ms = (n: number) => n;
/**
 * Convert seconds to milliseconds
 * @param n - seconds
 */
export const seconds = (n: number) => n * 1000;
export const minutes = (n: number) => n * 60 * 1000;

export class NetworkHelper {
  readonly cookieJar: CookieJar;

  readonly nonCloudflareClientBuilder: AxiosClientBuilder;

  readonly clientBuilder: AxiosClientBuilder;

  private readonly dnsInterceptor: NetworkInterceptor;

  constructor(private readonly preferences: NetworkPreferences) {
    this.cookieJar = new CookieJar();
    const dohProvider = this.preferences?.dohProvider?.() || "cloudflare";
    const dohUrl = dohProvider ? DOH_URLS[dohProvider] : null;
    const bootstrapIps = dohUrl ? (BOOTSTRAP_DNS[dohProvider!] ?? []) : [];

    this.dnsInterceptor =
      dohUrl && bootstrapIps.length > 0
        ? new DoHInterceptor(dohUrl, bootstrapIps, this.cookieJar)
        : new SystemDnsInterceptor();

    const nonCloudflareBase = this.createAxiosBase();
    const clientBase = this.createAxiosBase();

    this.nonCloudflareClientBuilder = new AxiosClientBuilder(nonCloudflareBase);

    this.clientBuilder = new AxiosClientBuilder(clientBase);
  }

  newBuilder(): AxiosClientBuilder {
    const base = this.createAxiosBase();
    return new AxiosClientBuilder(base).addInterceptor(this.dnsInterceptor);
  }

  private createAxiosBase(): AxiosInstance {
    const base = wrapper(
      axios.create({
        timeout: 30_000,
        withCredentials: true,
        jar: this.cookieJar,
        headers: {
          "Accept-Encoding": "gzip, deflate, br",
        },
      }),
    );
    axiosRetry(base, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) =>
        isNetworkOrIdempotentRequestError(error) ||
        [429, 503].includes(error.response?.status ?? 0),
    });
    // const cached = setupCache(base, {
    //   ttl: 60_000,
    //   storage: buildMemoryStorage(false, 200),
    //   staleIfError: true,
    //   methods: ["get"],
    //   interpretHeader: true,
    // });
    return base;
  }

  get nonCloudflareClient(): AxiosInstance {
    return this.nonCloudflareClientBuilder
      .addInterceptor(this.dnsInterceptor)
      .addInterceptor(new ErrorNormalizer())
      .build();
  }

  get client(): AxiosInstance {
    return this.clientBuilder
      .addInterceptor(this.dnsInterceptor)
      .addInterceptor(new CloudflareInterceptor(this.nonCloudflareClient, this.preferences))
      .addInterceptor(new ErrorNormalizer())
      .build();
  }
}
