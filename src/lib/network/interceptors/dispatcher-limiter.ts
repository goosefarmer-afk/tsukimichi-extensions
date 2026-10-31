import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import type { NetworkInterceptor } from "../types";
import { Semaphore } from "async-mutex";

export interface DispatcherLimiterOptions {
  /**
   * Global cap on requests in flight at once across all hosts.
   */
  maxRequests: number;

  /**
   * Cap on requests in flight at once per host.
   */
  maxRequestsPerHost: number;
}

export class DispatcherLimiter implements NetworkInterceptor {
  readonly name = "dispatcher-limiter";

  private readonly global: Semaphore;
  private readonly hostLimit: number;

  private readonly hostMap = new Map<string, Semaphore>();

  // stable lifecycle tracking
  private readonly inflight = new WeakMap<InternalAxiosRequestConfig, () => void>();

  constructor(options: { maxRequests: number; maxRequestsPerHost: number }) {
    if (options.maxRequests <= 0 || options.maxRequestsPerHost <= 0) {
      throw new Error("DispatcherLimiter: limits must be > 0");
    }

    this.hostLimit = options.maxRequestsPerHost;
    this.global = new Semaphore(options.maxRequests);
  }

  async onRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    const host = this.hostOf(config);
    const hostSem = this.hostSemaphore(host);

    const [, releaseGlobal] = await this.global.acquire();

    let releaseHost: () => void | undefined;

    try {
      // then host
      [, releaseHost] = await hostSem.acquire();
    } catch (err) {
      releaseGlobal();
      throw err;
    }

    const releaseAll = () => {
      try {
        releaseHost?.();
      } finally {
        releaseGlobal();
      }
    };

    this.inflight.set(config, releaseAll);

    return config;
  }

  onResponse(response: AxiosResponse): AxiosResponse {
    this.release(response.config);
    return response;
  }

  onResponseError(error: any): any {
    this.release(error?.config);
    return Promise.reject(error);
  }

  private release(config: InternalAxiosRequestConfig | undefined) {
    if (!config) return;

    const fn = this.inflight.get(config);
    if (!fn) return;

    fn();
    this.inflight.delete(config);
  }

  private hostSemaphore(host: string): Semaphore {
    let sem = this.hostMap.get(host);
    if (!sem) {
      sem = new Semaphore(this.hostLimit);
      this.hostMap.set(host, sem);
    }
    return sem;
  }

  private hostOf(config: InternalAxiosRequestConfig): string {
    try {
      return new URL(config.url ?? "").hostname;
    } catch {
      return "unknown-host";
    }
  }
}
