import { AxiosHeaders } from "axios";
import type { AxiosInstance } from "axios";
import { Mutex } from "async-mutex";
import crypto from "node:crypto";
import { MKissaCrypto } from "./mkissa-crypto";
import type { AaApiError } from "./types";
import { MKissaBundle } from "./mkissa-bundle";
import { STREAM_HASH } from "./queries";

interface AaCryptoBootstrap {
  partB: string;
  epoch: number;
  k?: string;
}

export interface BuildInfo {
  buildId: string;
  seeds: string[];
}

interface Handshake {
  build: BuildInfo;
  mask: Uint8Array;
  bootstrap: AaCryptoBootstrap;
}

interface BootstrapResult {
  bootstrap: AaCryptoBootstrap | null;
  stale: boolean;
  mask?: Uint8Array | null;
}

export class MKissaKeyManager {
  private cachedMaterial: Material | null = null;
  private materialMutex = new Mutex();

  private storedBuild: string;

  constructor(
    private client: AxiosInstance,
    private headers: AxiosHeaders,
    private settings: Record<string, unknown>,
    private siteUrl: string,
    private apiUrl: string,
  ) {
    const storedBuild = this.settings[MKissaKeyManager.PREF_BUILD_KEY];
    this.storedBuild = typeof storedBuild === "string" ? storedBuild : "";
  }

  async material(forceRefresh = false): Promise<Material> {
    const enteredAt = Date.now();

    if (!forceRefresh) {
      const cached = this.cachedMaterial;
      if (cached && !this.isExpired(cached)) {
        return cached;
      }
    }

    return this.materialMutex.runExclusive(async () => {
      const cached = this.cachedMaterial;
      if (cached && cached.fetchedAt > enteredAt && (!forceRefresh || !this.isExpired(cached))) {
        return cached;
      }

      const handshake = await this.handshake();
      if (!handshake) {
        console.error("Failed to handshake.");
        throw new Error(MKissaKeyManager.MATERIAL_ERROR);
      }

      let partB: Uint8Array;
      try {
        partB = new Uint8Array(Buffer.from(handshake.bootstrap.partB, "base64"));
      } catch {
        console.error("Failed to parse partB.");
        throw new Error(MKissaKeyManager.MATERIAL_ERROR);
      }

      if (partB.length < 32) {
        console.error("Invalid partB.");
        throw new Error(MKissaKeyManager.MATERIAL_ERROR);
      }

      // Only after the server accepted it, so a bad parse cannot wedge every later launch.
      this.storedBuild = this.serializeBuild(handshake.build);
      // Not the bootstrap's switchAt: it can already be past while the epoch is live.
      const now = Date.now();
      const material = new Material(
        await MKissaCrypto.deriveKey(handshake.mask, partB),
        handshake.bootstrap.epoch,
        handshake.build.buildId,
        now + MKissaKeyManager.MATERIAL_TTL_MS,
        now,
      );

      this.cachedMaterial = material;
      return material;
    });
  }

  aaReq(material: Material): Promise<string> {
    return MKissaCrypto.buildAaReq(
      material.key,
      material.epoch,
      material.buildId,
      STREAM_HASH,
      MKissaKeyManager.ANIME_LANE,
    );
  }

  decrypt(tobeparsed: string, material: Material): Promise<string | null> {
    return MKissaCrypto.decrypt(tobeparsed, material.key);
  }

  invalidate(): void {
    this.cachedMaterial = null;
  }

  /** Used when the streams API rejects a token the bootstrap minted, which it cannot detect. */
  invalidateBuild(): void {
    this.storedBuild = "";
    this.cachedMaterial = null;
  }

  static isCryptoError(json: AaApiError): boolean {
    try {
      return (
        json.errors?.some((e) => e.extensions?.code?.startsWith("AA_CRYPTO") ?? false) ?? false
      );
    } catch {
      return false;
    }
  }

  static apiErrorMessage(json: any): string | null {
    if (MKissaKeyManager.isCryptoError(json)) return null;
    const message = (json as AaApiError).errors?.[0]?.message || null;

    return message === this.CAPTCHA_ERROR
      ? `Open the watch page in the BrowserWindow and complete the CAPTCHA. If the error persists, MKissa is probably rate limiting this network (${this.CAPTCHA_ERROR}). Browsing works; streams should return on their own after a while`
      : message;
  }

  /** Re-scraping starts at the Cloudflare-gated HTML, so cheaper causes are ruled out first. */
  private async handshake(): Promise<Handshake | null> {
    const cached = this.cachedBuild();
    const mask = cached ? MKissaCrypto.deriveMask(cached.buildId, cached.seeds) : null;

    if (cached && mask) {
      const first = await this.bootstrap(cached.buildId, mask, MKissaCrypto.epochCandidates());
      if (first.bootstrap) {
        return { build: cached, mask, bootstrap: first.bootstrap };
      }
      if (!first.stale) return null;

      // A clock off by more than the grace window looks exactly like a stale build.
      const second = await this.bootstrap(
        cached.buildId,
        mask,
        MKissaCrypto.skewedEpochCandidates(),
      );
      if (second.bootstrap) {
        return { build: cached, mask, bootstrap: second.bootstrap };
      }
    }

    const fresh = await this.resolveBuild();
    if (!fresh) return null;

    const freshMask = MKissaCrypto.deriveMask(fresh.buildId, fresh.seeds);
    if (!freshMask) return null;

    const bootstrap = await this.bootstrap(
      fresh.buildId,
      freshMask,
      MKissaCrypto.epochCandidates(),
    );
    if (bootstrap.bootstrap) {
      return { build: fresh, mask: freshMask, bootstrap: bootstrap.bootstrap };
    }

    return null;
  }

  /** `GET /client-crypto/v1/bootstrap?buildId=&k=`, gated by an HMAC of the client mask. */
  private async bootstrap(
    buildId: string,
    mask: Uint8Array,
    epochs: number[],
  ): Promise<BootstrapResult> {
    const host = new URL(this.siteUrl).host;
    const url = `${this.apiUrl.replace(/\/+$/, "")}${MKissaKeyManager.BOOTSTRAP_PATH}`;

    let sawStale = false;

    for (const epoch of epochs) {
      const bootToken = MKissaCrypto.bootToken({
        mask,
        buildId,
        epoch,
        keyGroup: MKissaKeyManager.KEY_GROUP,
        refererHost: host,
        lane: MKissaKeyManager.ANIME_LANE,
      });
      const headers = new AxiosHeaders();
      headers.set("x-build-id", buildId);
      headers.set("x-aa-boot", bootToken);
      headers.set("Origin", this.siteUrl);
      headers.set("Referer", `${this.siteUrl}/`);

      try {
        const response = await this.client.get(url, {
          headers,
          params: {
            buildId,
            k: MKissaKeyManager.ANIME_LANE,
          },
        });

        const bootstrap = response.data as AaCryptoBootstrap;
        // A partB from another lane would silently derive the wrong key.
        if (bootstrap.k != null && bootstrap.k !== MKissaKeyManager.ANIME_LANE) {
          continue;
        }
        return { bootstrap, stale: false, mask };
      } catch (error: any) {
        if (error.response?.status && MKissaKeyManager.STALE_CODES.has(error.response.status)) {
          sawStale = true;
        }
        continue;
      }
    }

    return { bootstrap: null, stale: sawStale };
  }

  private cachedBuild(): BuildInfo | null {
    const buildId = this.storedBuild.split(MKissaKeyManager.FIELD_SEPARATOR)[0] || "";
    if (!buildId) return null;

    const seeds =
      this.storedBuild.split(MKissaKeyManager.FIELD_SEPARATOR)[1]?.split(",").filter(Boolean) || [];
    if (seeds.length !== MKissaCrypto.SEED_COUNT) return null;

    return { buildId, seeds };
  }

  /** The entry is re-read every time: chunk URLs are immutable, so a rebuild only shows in HTML. */
  private async resolveBuild(): Promise<BuildInfo | null> {
    const appUrl = await this.entryUrlFromSite();
    if (!appUrl) return null;

    let appJs: string;
    try {
      const response = await this.client.get<string>(appUrl, { headers: this.headers });
      appJs = response.data;
    } catch {
      return null;
    }

    // Shared chunks first: that is where it has always lived.
    const chunkRefs = Array.from(appJs.matchAll(MKissaKeyManager.CHUNK_REF_REGEX))
      .map((match) => match[1])
      .filter(Boolean);

    const distinctRefs = distinct(chunkRefs)
      .sort((a, b) => {
        const aScore = a?.includes("/chunks/") ? 1 : 0;
        const bScore = b?.includes("/chunks/") ? 1 : 0;
        return bScore - aScore;
      })
      .slice(0, MKissaKeyManager.MAX_BUILD_CHUNKS);

    for (const ref of distinctRefs) {
      if (!ref) continue;
      const chunkUrl = new URL(ref, appUrl).toString();
      let body: string;

      try {
        const response = await this.client.get<string>(chunkUrl, { headers: this.headers });
        body = response.data;
      } catch {
        continue;
      }

      if (!body.includes(MKissaKeyManager.CRYPTO_CHUNK_MARKER)) continue;
      const result = MKissaBundle.parse(body, MKissaCrypto.SEED_COUNT);
      if (result) return result;
    }

    for (let i = 0; i < distinctRefs.length; i += MKissaKeyManager.BUILD_CHUNK_BATCH) {
      const batch = distinctRefs
        .slice(i, i + MKissaKeyManager.BUILD_CHUNK_BATCH)
        .filter(Boolean) as string[];

      const found = await Promise.all(
        batch
          .map(async (ref) => {
            try {
              const chunkUrl = new URL(ref, appUrl).toString();
              const { data } = await this.client.get<string>(chunkUrl, { headers: this.headers });
              if (!data.includes(MKissaKeyManager.CRYPTO_CHUNK_MARKER)) {
                return null;
              }

              return MKissaBundle.parse(data, MKissaCrypto.SEED_COUNT);
            } catch {
              return null;
            }
          })
          .filter((info) => info !== null),
      );

      if (found.length > 0) {
        return found[0]!;
      }
    }

    return null;
  }

  /** Cloudflare-gated; only needed to locate the CDN app entry. */
  private async entryUrlFromSite(): Promise<string | null> {
    let html: string;
    try {
      const response = await this.client.get<string>(`${this.siteUrl}/`, { headers: this.headers });
      html = response.data;
    } catch {
      return null;
    }

    const match = MKissaKeyManager.APP_ENTRY_REGEX.exec(html);
    return match?.[1] || null;
  }

  private isExpired(material: Material): boolean {
    return Date.now() >= material.expiresAt;
  }

  private serializeBuild(build: BuildInfo): string {
    return `${build.buildId}${MKissaKeyManager.FIELD_SEPARATOR}${build.seeds.join(",")}`;
  }

  private static readonly MATERIAL_ERROR = "Unable to obtain MKissa crypto material";
  private static readonly BOOTSTRAP_PATH = "/client-crypto/v1/bootstrap";

  // 403 invalid_boot_token, 404 unknown_build_id.
  private static readonly STALE_CODES = new Set([403, 404]);

  private static readonly CAPTCHA_ERROR = "NEED_CAPTCHA";

  // The site buckets its hosts; adding a mirror to the domain pref means revisiting this.
  private static readonly KEY_GROUP = "mkissa";
  private static readonly PREF_BUILD_KEY = "client_build_cache";
  private static readonly FIELD_SEPARATOR = "|";
  private static readonly MAX_BUILD_CHUNKS = 40;
  private static readonly BUILD_CHUNK_BATCH = 4;
  private static readonly MATERIAL_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
  private static readonly STREAM_HASH =
    "f4662f4b7510b26795dd53ef824a0bf1740fbbc5d1273fab18222ac831bca8d0";
  static readonly ANIME_LANE = "k7";

  private static readonly APP_ENTRY_REGEX = /import\("([^"]*\/entry\/app\.[^"]*\.js)"\)/;
  private static readonly CHUNK_REF_REGEX = /["'](\.\.?\/[\w./-]+\.js)["']/g;
  private static readonly CRYPTO_CHUNK_MARKER = "aaReq";
}

function distinct<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export class Material {
  constructor(
    public key: crypto.webcrypto.CryptoKey,
    public epoch: number,
    public buildId: string,
    public expiresAt: number,
    public fetchedAt: number,
  ) {}
}
