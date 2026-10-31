import dns from "node:dns";
import * as https from "node:https";
import type { InternalAxiosRequestConfig } from "axios";
import type { NetworkInterceptor } from "../types";
import type { CookieJar } from "tough-cookie";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise.finally(() => clearTimeout(timeoutId))]);
}

const bootstrapCache = new Map<string, string>();

async function resolveBootstrap(
  hostname: string,
  bootstrapIps: string[],
  timeoutMs = 10000,
): Promise<string | null> {
  if (bootstrapCache.has(hostname)) {
    return bootstrapCache.get(hostname)!;
  }
  for (const bootstrapIp of bootstrapIps) {
    if (bootstrapIp.includes(":")) continue;
    try {
      const resolver = new dns.Resolver();
      resolver.setServers([bootstrapIp]);

      const addresses = await withTimeout(
        new Promise<string[]>((resolve, reject) => {
          resolver.resolve4(hostname, (err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
        }),
        timeoutMs,
      );
      if (addresses.length > 0) {
        bootstrapCache.set(hostname, addresses[0]!);
        return addresses[0]!;
      }
    } catch {
      // try next bootstrap
    }
  }
  return null;
}

// A minimal RFC 8484 DNS wire-format query for an A record.
function buildDnsQuery(hostname: string): Buffer {
  const labels = hostname.split(".");
  // biome-ignore format: off
  const header = Buffer.from([
    0x00,
    0x00, // ID
    0x01,
    0x00, // Flags: RD=1
    0x00,
    0x01, // QDCOUNT: 1
    0x00,
    0x00, // ANCOUNT: 0
    0x00,
    0x00, // NSCOUNT: 0
    0x00,
    0x00, // ARCOUNT: 0
  ]);

  const qnameParts = labels.map((label) => {
    const len = Buffer.alloc(1);
    len.writeUInt8(label.length, 0);
    return Buffer.concat([len, Buffer.from(label)]);
  });
  const qname = Buffer.concat([...qnameParts, Buffer.from([0x00])]);
  const qtype = Buffer.from([0x00, 0x01]); // A record
  const qclass = Buffer.from([0x00, 0x01]); // IN
  return Buffer.concat([header, qname, qtype, qclass]);
}

function parseDnsResponse(buf: Buffer): { ips: string[]; ttl: number } {
  const ancount = buf.readUInt16BE(6);
  if (ancount === 0) return { ips: [], ttl: 0 };

  const ips: string[] = [];
  let minTtl = Number.POSITIVE_INFINITY;
  let offset = 12;

  // Skip question section
  while (offset < buf.length && buf[offset] !== 0) {
    offset += (buf[offset] ?? 0) + 1;
  }
  offset += 5; // null label + qtype + qclass

  for (let i = 0; i < ancount; i++) {
    if (offset >= buf.length) break;

    // Skip name (may be a pointer 0xC0 or label)
    if ((buf[offset] ?? 0) === 0xc0) {
      offset += 2; // pointer
    } else {
      while (offset < buf.length && buf[offset] !== 0) {
        offset += (buf[offset] ?? 0) + 1;
      }
      offset += 1;
    }

    if (offset + 10 > buf.length) break;

    const type = buf.readUInt16BE(offset);
    offset += 2; // type
    offset += 2; // class
    const ttl = buf.readUInt32BE(offset);
    offset += 4; // ttl
    const rdlength = buf.readUInt16BE(offset);
    offset += 2;

    if (type === 1 && rdlength === 4) {
      // A record
      const ip = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
      ips.push(ip);
      minTtl = Math.min(minTtl, ttl);
    }
    offset += rdlength;
  }

  return { ips, ttl: minTtl === Number.POSITIVE_INFINITY ? 0 : minTtl };
}

const dohCache = new Map<string, { ips: string[]; expiresAt: number }>();

async function resolveViaDoH(
  hostname: string,
  dohUrl: string,
  bootstrapIps: string[],
  timeoutMs = 10_000,
): Promise<string[]> {
  const cached = dohCache.get(hostname);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.ips;
  }

  const dohHostname = new URL(dohUrl).hostname;
  const dohServerIp = await resolveBootstrap(dohHostname, bootstrapIps);
  if (!dohServerIp) {
    throw new Error(`Failed to resolve DoH server ${dohHostname} via bootstrap`);
  }

  const query = buildDnsQuery(hostname);
  const url = new URL(dohUrl);

  const { ips, ttl } = await withTimeout(
    new Promise<{ ips: string[]; ttl: number }>((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: dohServerIp,
        port: 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/dns-message",
          Accept: "application/dns-message",
          "Content-Length": query.length,
          Host: dohHostname,
        },
        servername: dohHostname,
        rejectUnauthorized: true,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(parseDnsResponse(Buffer.concat(chunks)));
          } catch (e) {
            reject(new Error(`DoH parse error: ${e}`));
          }
        });
        res.on("error", reject);
      });

      req.on("error", reject);

      req.write(query);
      req.end();
    }),
    timeoutMs,
  );

  if (ips.length > 0) {
    dohCache.set(hostname, {
      ips,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  return ips;
}

export class DoHInterceptor implements NetworkInterceptor {
  readonly name = "doh";

  constructor(
    private readonly dohUrl: string,
    private readonly bootstrapIps: string[],
    private readonly cookieJar: CookieJar,
  ) {}

  async onRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    const parsed = new URL(config.url ?? "");
    const ips = await resolveViaDoH(parsed.hostname, this.dohUrl, this.bootstrapIps);

    if (ips.length > 0) {
      const lookup = (
        _hostname: string,
        _options: unknown,
        callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
      ) => {
        callback(null, ips[0]!, 4);
      };

      // config.httpsAgent = new HttpsCookieAgent({
      //   cookies: { jar: config.jar ?? this.cookieJar },
      //   lookup,
      //   keepAlive: false,
      //   rejectUnauthorized: false,
      // });

      // @ts-expect-error
      config.lookup = lookup;
    }

    return config;
  }
}
