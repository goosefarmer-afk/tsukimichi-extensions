import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";

export interface NetworkInterceptor {
  readonly name: string;

  synchronous?: boolean;

  onRequest?(
    config: InternalAxiosRequestConfig,
  ): Promise<InternalAxiosRequestConfig> | InternalAxiosRequestConfig;

  onResponse?(response: AxiosResponse): Promise<AxiosResponse> | AxiosResponse;

  onResponseError?(error: unknown): Promise<AxiosResponse | never>;
}
