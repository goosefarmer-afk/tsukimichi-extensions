import type { InternalAxiosRequestConfig } from "axios";
import type { NetworkInterceptor } from "../types";
import BottleNeck from "bottleneck";

export interface RateLimiterOptions {
  /**
   * Max number of requests allowed per window
   */
  maxRequests: number;

  /**
   * Window length in ms, e.g. 1000 for "1.seconds"
   */
  perMilliseconds: number;

  /**
   * Max requests in flight at once.
   *
   * @default maxRequests
   */
  maxConcurrent?: number;

  /**
   * Max requests allowed to sit in the queue waiting for a slot.
   */
  maxQueueSize?: number;

  /**
   * Function to determine if a request should be rate limited.
   * @param url - The request URL as string
   * @returns boolean - true to apply rate limiting, false to bypass
   */
  shouldLimit?: (url: string) => boolean;
}

export class RateLimiter implements NetworkInterceptor {
  readonly name = "RateLimiter";

  private limiter: BottleNeck;
  private shouldLimit?: (url: string) => boolean;

  constructor(options: RateLimiterOptions) {
    const {
      maxRequests,
      perMilliseconds,
      maxConcurrent = maxRequests,
      maxQueueSize,
      shouldLimit,
    } = options;

    if (maxRequests <= 0 || perMilliseconds <= 0) {
      throw new Error("RateLimiter: maxRequests and perMilliseconds must both be > 0");
    }

    this.shouldLimit = shouldLimit;

    this.limiter = new BottleNeck({
      reservoir: maxRequests,
      reservoirRefreshAmount: maxRequests,
      reservoirRefreshInterval: perMilliseconds,
      maxConcurrent,
      ...(maxQueueSize != null
        ? {
            highWater: maxQueueSize,
            strategy: BottleNeck.strategy.OVERFLOW,
          }
        : {}),
    });

    this.limiter.on("error", (err) => {
      console.error(`[${this.name}] internal scheduling error:`, err);
    });
  }

  async onRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    const url = config.url;
    if (typeof this.shouldLimit === "function" && !this.shouldLimit(url!)) return config;

    return this.limiter.schedule(() => Promise.resolve(config));
  }

  stop(options?: BottleNeck.StopOptions): Promise<void> {
    return this.limiter.stop(options);
  }
}
