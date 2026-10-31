import * as crypto from "crypto";

interface AaReqPayload {
  v: number;
  ts: number;
  epoch: number;
  buildId: string;
  qh: string;
  k?: string;
}

export class MKissaCrypto {
  private static readonly TAG_LENGTH = 128;
  private static readonly HASH_ALGO = "sha256";
  private static readonly HMAC_ALGO = "sha256";

  private static readonly KEY_SIZE = 32;
  static readonly SEED_COUNT = 4;
  private static readonly SEED_SIZE = this.KEY_SIZE / this.SEED_COUNT;

  private static readonly IV_SIZE = 12;
  private static readonly HEADER_SIZE = 1 + this.IV_SIZE;

  private static readonly WINDOW_MS = 5 * 60 * 1000;

  private static readonly EPOCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly EPOCH_GRACE_MS = 24 * 60 * 60 * 1000;

  private static readonly SALT_MUL = 105;
  private static readonly SALT_ADD = 199;
  private static readonly FRAG_MUL = 68;
  private static readonly FRAG_ADD = 109;
  private static readonly BOOT_PREFIX = "3CPUb1AFbS:";

  static sha256Hex(value: string): string {
    return crypto.createHash(this.HASH_ALGO).update(value, "utf-8").digest("hex");
  }

  private static maskCandidates(buildId: string, seeds: string[]): Uint8Array[] {
    const mask = MKissaCrypto.deriveMask(buildId, seeds);
    if (mask) return [mask];

    return [];
  }

  /**
   * `seeds XOR f(buildId) XOR f(position)`; both inputs change on every site rebuild.
   */
  static deriveMask(buildId: string, seeds: string[]): Uint8Array | null {
    if (buildId.length === 0 || seeds.length !== this.SEED_COUNT) return null;

    const stream = new Uint8Array(this.KEY_SIZE);
    for (let i = 0; i < this.KEY_SIZE; i++) {
      stream[i] =
        (buildId.charCodeAt(i % buildId.length) ^
          ((i * MKissaCrypto.SALT_MUL + MKissaCrypto.SALT_ADD) & 0xff)) &
        0xff;
    }

    const mask = new Uint8Array(this.KEY_SIZE);
    for (let index = 0; index < seeds.length; index++) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(Buffer.from(seeds[index]!, "base64"));
      } catch {
        return null;
      }

      if (bytes.length < this.SEED_SIZE) return null;

      const base = index * this.SEED_SIZE;
      for (let offset = 0; offset < this.SEED_SIZE; offset++) {
        mask[base + offset] =
          ((bytes[offset]! & 0xff) ^
            (stream[base + offset]! & 0xff) ^
            ((index * MKissaCrypto.FRAG_MUL + offset * MKissaCrypto.FRAG_ADD) & 0xff)) &
          0xff;
      }
    }

    return mask?.every((byte) => byte === 0) ? null : mask;
  }

  static async deriveKey(mask: Uint8Array, partB: Uint8Array): Promise<crypto.webcrypto.CryptoKey> {
    const keyBytes = new Uint8Array(this.KEY_SIZE);
    for (let i = 0; i < this.KEY_SIZE; i++) {
      const maskByte = mask[i % mask.length]! & 0xff;
      const partBByte = partB[i % partB.length]! & 0xff;
      keyBytes[i] = partBByte ^ maskByte;
    }

    return await crypto.webcrypto.subtle.importKey(
      "raw",
      keyBytes.buffer,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }

  /**
   * `x-aa-boot`, checked by the bootstrap endpoint before it hands out `partB`.
   */
  static bootToken(args: {
    mask: Uint8Array;
    buildId: string;
    epoch: number;
    keyGroup: string;
    refererHost: string;
    lane: string;
  }): string {
    const { mask, buildId, epoch, keyGroup, refererHost, lane } = args;
    const inner = this.hmac(mask, `${this.BOOT_PREFIX}${buildId}`);

    // let message = `${buildId}:${keyGroup}:${refererHost}:${epoch}`;
    // if (lane.length > 0) {
    //   message += `:${lane}`;
    // }

    // const hmacResult = this.hmac(inner, message);

    const message = [refererHost, epoch.toString(), keyGroup, lane, buildId].join("|");
    return Buffer.from(this.hmac(inner, message)).toString("hex");
  }

  static bootTokenCandidates(
    mask: Uint8Array,
    buildId: string,
    epoch: number,
    keyGroup: string,
    refererHost: string,
    lane: string,
  ): string[] {
    return [this.bootToken({ mask, buildId, epoch, keyGroup, refererHost, lane })];
  }

  /**
   * Oldest first: during the grace window the server still mints `partB` for the previous.
   */
  static epochCandidates(now: number = Date.now()): number[] {
    const current = Math.floor(now / this.EPOCH_WINDOW_MS);
    const inGrace = now - current * this.EPOCH_WINDOW_MS < this.EPOCH_GRACE_MS && current > 0;
    return inGrace ? [current - 1, current] : [current];
  }

  /**
   * Fallback for a device clock off by more than the grace window.
   */
  static skewedEpochCandidates(now: number = Date.now()): number[] {
    const current = Math.floor(now / this.EPOCH_WINDOW_MS);
    const candidates = [current + 1, current - 1]
      .filter((c) => c > 0)
      .filter((c) => !this.epochCandidates(now).includes(c));
    return candidates;
  }

  static async buildAaReq(
    key: crypto.webcrypto.CryptoKey,
    epoch: number,
    buildId: string,
    queryHash: string,
    lane: string,
  ): Promise<string> {
    const ts = Math.floor(Date.now() / this.WINDOW_MS) * this.WINDOW_MS;

    // Derived, not random: the server recomputes the same one to decrypt.
    const ivInput = `${epoch}:${buildId}:${queryHash}:${ts}:${lane}`;
    // const ivHash = crypto.createHash("sha256").update(hashInput, "utf-8").digest();
    // const iv = new Uint8Array(ivHash.subarray(0, this.IV_SIZE));
    const iv = new Uint8Array(
      crypto.createHash("sha256").update(ivInput, "utf-8").digest(),
    ).subarray(0, this.IV_SIZE);

    const payload: AaReqPayload = {
      v: 1,
      ts,
      epoch,
      buildId,
      qh: queryHash,
      k: lane,
    };

    const payloadStr = JSON.stringify(payload);
    const payloadBuffer = Buffer.from(payloadStr, "utf-8");

    const encryptedData = await crypto.webcrypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: this.TAG_LENGTH,
      },
      key,
      payloadBuffer,
    );

    const encryptedBytes = new Uint8Array(encryptedData);
    const blob = new Uint8Array(this.HEADER_SIZE + encryptedBytes.length);
    blob[0] = 1;
    blob.set(iv, 1);
    blob.set(encryptedBytes, this.HEADER_SIZE);

    return Buffer.from(blob).toString("base64");
  }

  static async decrypt(
    base64Payload: string,
    materialKey: crypto.webcrypto.CryptoKey,
  ): Promise<string | null> {
    let blob: Uint8Array;
    try {
      blob = new Uint8Array(Buffer.from(base64Payload, "base64"));
    } catch {
      return null;
    }

    if (blob.length < this.HEADER_SIZE) return null;

    // const version = blob[0]! & 0xff;
    const iv = new Uint8Array(blob.subarray(1, this.HEADER_SIZE));
    const encryptedData = blob.subarray(this.HEADER_SIZE);

    // const keys = [materialKey, await this.legacyKey(version)];

    // if (version === 1) {
    //   try {
    //     const legacyKey = await this.legacyKey(version);
    //     keys.push(legacyKey);
    //   } catch {}
    // }

    // for (const key of keys) {
    //   try {
    //     const decrypted = await crypto.webcrypto.subtle.decrypt(
    //       {
    //         name: "AES-GCM",
    //         iv,
    //         tagLength: this.TAG_LENGTH,
    //       },
    //       key,
    //       encryptedData,
    //     );

    //     return new TextDecoder("utf-8").decode(decrypted);
    //   } catch {
    //     // Continue to next key
    //     continue;
    //   }
    // }

    // return null;

    try {
      const decrypted = await crypto.webcrypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          tagLength: this.TAG_LENGTH,
        },
        materialKey,
        encryptedData,
      );

      return new TextDecoder("utf-8").decode(decrypted);
    } catch {
      return null;
    }
  }

  private static hmac(key: Uint8Array, message: string): Uint8Array {
    const hmac = crypto.createHmac(this.HMAC_ALGO, key).update(message, "utf-8").digest();
    return new Uint8Array(hmac);
  }
}
