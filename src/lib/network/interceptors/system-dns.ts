import { promises as dnsPromises } from "node:dns";
import type { InternalAxiosRequestConfig } from "axios";
import type { NetworkInterceptor } from "../types";

export class SystemDnsInterceptor implements NetworkInterceptor {
  readonly name = "system-dns";

  async onRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    const hostname = new URL(config.url ?? "").hostname;

    let address: string;
    try {
      const result = await dnsPromises.lookup(hostname, { family: 4 });
      address = result.address;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      switch (err.code) {
        case "ENOTFOUND":
          throw new Error(
            `Could not resolve host "${hostname}". No address associated with hostname.`,
          );
        case "ENODATA":
          throw new Error(
            `No DNS records found for "${hostname}". The domain exists but has no address records.`,
          );
        case "ETIMEOUT":
          throw new Error(
            `DNS lookup timed out for "${hostname}". Your DNS server may be slow or unreachable.`,
          );
        case "ECONNREFUSED":
          throw new Error(`DNS server refused the connection while resolving "${hostname}".`);
        case "ESERVFAIL":
          throw new Error(
            `DNS server failed while resolving "${hostname}". The server may be temporarily unavailable.`,
          );
        default:
          throw new Error(
            `DNS resolution failed for "${hostname}" (${err.code ?? err.message}). Consider enabling a DoH provider.`,
          );
      }
    }

    // @ts-expect-error custom lookup
    config.lookup = (
      _hostname: string,
      _options: unknown,
      callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
    ) => {
      callback(null, address, 4);
    };

    return config;
  }
}
