import { isAxiosError, type Method } from "axios";
import type { NetworkInterceptor } from "../types";
import { HttpError } from "@/errors/http-error";

export class ErrorNormalizer implements NetworkInterceptor {
  readonly name = "error-normalizer";

  onResponseError(error: unknown): Promise<never> {
    if (isAxiosError(error)) {
      const { response, config } = error;
      console.log("Request url", decodeURIComponent(config?.url || ""));
      console.log("Request headers", config?.headers?.toJSON());
      console.log("Response headers", response?.headers?.toJSON());
      // console.log("Response", response?.data);

      return Promise.reject(
        new HttpError({
          method: (config?.method?.toString() as Method) ?? "GET",
          status: response?.status,
          statusText: error.message,
        }),
      );
    }

    if (Error.isError(error)) {
      return Promise.reject(error);
    }

    return Promise.reject(new Error(String(error)));
  }
}
