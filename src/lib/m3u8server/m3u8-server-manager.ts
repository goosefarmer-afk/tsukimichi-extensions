import type { AxiosInstance } from "axios";
import { M3u8HttpServer } from ".";

export class M3u8ServerManager {
  #server: M3u8HttpServer | null = null;

  constructor(
    private client: AxiosInstance,
    private fallBackClient?: AxiosInstance,
  ) {}

  async startServer(port = 0) {
    if (this.#server !== null) {
      console.log("Server is already running");
      return;
    }

    try {
      this.#server = new M3u8HttpServer(this.client, {
        port,
        fallbackClient: this.fallBackClient,
      });

      await this.#server.start();

      console.log(`Server started on port: ${this.#server.getPort()}`);
    } catch (error) {
      console.error(`Failed to start server: ${(error as Error).message}`);
      this.#server = null;
      throw error;
    }
  }

  stopServer() {
    this.#server?.stop();
    this.#server = null;
    console.log("M3u8 server stopped");
  }

  isRunning() {
    return this.#server?.isServerRunning() ?? false;
  }

  getServerUrl(): string | null {
    if (this.#server) {
      return `http://localhost:${this.#server.getPort()}`;
    }

    return null;
  }

  processM3u8Url(m3u8Url: string, referer?: string, userAgent?: string) {
    return this.#server?.createLocalUrl(m3u8Url, referer, userAgent);
  }
}
