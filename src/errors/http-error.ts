import type { Method } from "axios";

export class HttpError extends Error {
  override name = "HttpError";
  public status?: number;

  constructor(options: { method: Method; status?: number; statusText?: string }) {
    const { status, statusText, method } = options;
    let message = `[${method.toUpperCase()}] failed: `;
    message += `${status ?? "No response"}`;
    if (statusText) message += ` - ${statusText}`;

    super(message);

    this.status = status;
  }
}
