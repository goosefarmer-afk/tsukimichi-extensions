import { getCookiesForExtension } from "@/lib/cookies";
import { type BrowserWindow, browserWindow, session } from "electron";

export interface CloudflareBypassResult {
  cookies: string;
  userAgent: string;
}

export class CloudflareBypass {
  private static readonly MAX_WAIT_TIME = 30_000;

  constructor(private readonly extensionId: string) {}

  async getCookies(
    pageUrl: string,
    customUserAgent?: string,
  ): Promise<CloudflareBypassResult | null> {
    const partition = `persist:${this.extensionId}`;
    const bypassSession = session.fromPartition(partition);

    const userAgent =
      customUserAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    // Clear cookies from the SAME partition we are going to use.
    await this.clearCookiesForUrl(pageUrl, bypassSession);

    return new Promise<CloudflareBypassResult | null>((resolve) => {
      let resolved = false;
      let timeoutId: NodeJS.Timeout | null = null;

      const win: BrowserWindow = browserWindow.create({
        width: 800,
        height: 600,
        show: true,
        webPreferences: {
          javascript: true,
          partition,
        },
      });

      const finish = (result: CloudflareBypassResult | null) => {
        if (resolved) return;

        resolved = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        bypassSession.cookies.removeListener("changed", cookieChangedHandler);

        if (!win.isDestroyed()) {
          win.destroy();
        }

        resolve(result);
      };

      const cookieChangedHandler = async (
        _event: Electron.Event,
        cookie: Electron.Cookie,
        _cause: string,
        removed: boolean,
      ) => {
        if (resolved || removed) return;

        // Only care about the cookies that indicate the bypass completed.
        if (cookie.name !== "cf_clearance" && cookie.name !== "__ddg2_") {
          return;
        }

        const cookies = await getCookiesForExtension(this.extensionId, {});

        let cookieStr = cookies
          .filter((c) => c.name !== "cf_clearance")
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        cookieStr +=
          cookieStr.length > 0
            ? `; ${cookie.name}=${cookie.value}`
            : `${cookie.name}=${cookie.value}`;
        finish({
          cookies: cookieStr,
          userAgent,
        });
      };

      bypassSession.cookies.on("changed", cookieChangedHandler);

      win.webContents.setUserAgent(userAgent);

      win.webContents.on("render-process-gone", (_event, details) => {
        console.error("Renderer process gone:", details);

        if (!resolved) {
          finish(null);
        }
      });

      // Absolute timeout.
      timeoutId = setTimeout(() => {
        console.log("Cloudflare bypass timed out after", CloudflareBypass.MAX_WAIT_TIME, "ms");

        finish(null);
      }, CloudflareBypass.MAX_WAIT_TIME);

      win.loadURL(pageUrl).catch((error) => {
        /*
         * loadURL() can reject when navigation fails.
         * Don't immediately finish because the cookie event may still
         * occur from the current session.
         */
        console.error("loadURL rejected:", error);
      });
    });
  }

  private async clearCookiesForUrl(
    pageUrl: string,
    bypassSession: Electron.Session,
  ): Promise<void> {
    try {
      const cookies = (
        await Promise.all([
          bypassSession.cookies.get({
            domain: `.${new URL(pageUrl).hostname}`,
          }),
          bypassSession.cookies.get({
            domain: `${new URL(pageUrl).hostname}`,
          }),
        ])
      ).flat();

      console.log(
        "names",
        cookies.map((c) => c.name),
      );

      console.log(`Clearing ${cookies.length} cookies for ${pageUrl}`);

      for (const cookie of cookies) {
        const domain = cookie.domain?.replace(/^\./, "");
        const protocol = cookie.secure ? "https://" : "http://";

        const url = `${protocol}${domain}` + `${cookie.path || "/"}`;

        try {
          await bypassSession.cookies.remove(url, cookie.name);

          console.log(`Cleared cookie: ${cookie.name}`);
        } catch (error) {
          console.error(`Failed to clear cookie ${cookie.name}:`, error);
        }
      }
    } catch (error) {
      console.error("Error clearing cookies:", error);
    }
  }
}
