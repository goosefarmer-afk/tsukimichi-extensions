import type { AxiosHeaderValue, AxiosInstance } from "axios";
import { AxiosHeaders } from "axios";
import type { NetworkInterceptor } from "./types";

export class AxiosClientBuilder {
  private interceptors: Map<string, NetworkInterceptor> = new Map();
  private requestHandlerIds: number[] = [];
  private responseHandlerIds: number[] = [];

  constructor(private readonly base: AxiosInstance) {}

  addInterceptor(interceptor: NetworkInterceptor): this {
    this.interceptors.set(interceptor.name, interceptor);
    return this;
  }

  removeInterceptor(name: string): this {
    this.interceptors.delete(name);
    return this;
  }

  hasInterceptor(name: string): boolean {
    return this.interceptors.has(name);
  }

  /**
   * Ejects all previously registered handlers, then re-registers
   * the current interceptor set on the same base instance.
   * Safe to call multiple times — always reflects current state.
   */
  build(): AxiosInstance {
    // Eject old handlers so they don't stack on repeated build() calls
    for (const id of this.requestHandlerIds) {
      this.base.interceptors.request.eject(id);
    }
    for (const id of this.responseHandlerIds) {
      this.base.interceptors.response.eject(id);
    }
    this.requestHandlerIds = [];
    this.responseHandlerIds = [];

    for (const interceptor of this.interceptors.values()) {
      if (typeof interceptor.onRequest === "function") {
        const id = this.base.interceptors.request.use(
          (config) => interceptor.onRequest!(config),
          null,
          {
            synchronous: interceptor.synchronous ?? false,
          },
        );
        this.requestHandlerIds.push(id);
      }
      if (interceptor.onResponse || interceptor.onResponseError) {
        const id = this.base.interceptors.response.use(
          interceptor.onResponse?.bind(interceptor) ?? ((r) => r),
          interceptor.onResponseError?.bind(interceptor),
        );
        this.responseHandlerIds.push(id);
      }
    }

    return this.base;
  }
}

class HeadersBuilder extends AxiosHeaders {
  add(key: string, value: AxiosHeaderValue): this {
    super.set(key, value);
    return this;
  }

  build(): AxiosHeaders {
    return new AxiosHeaders(this.toJSON());
  }
}

export const headersBuilders = new HeadersBuilder();
