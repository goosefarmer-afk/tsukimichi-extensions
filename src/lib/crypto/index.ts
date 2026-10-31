import crypto from "node:crypto";
export function decryptAES(cipherTextBytes: Buffer, keyBytes: Buffer, ivBytes: Buffer): string {
  try {
    const algo = `aes-${keyBytes.length * 8}-cbc`;
    const decipher = crypto.createDecipheriv(algo, keyBytes, ivBytes);
    const decrypted = Buffer.concat([decipher.update(cipherTextBytes), decipher.final()]);

    return decrypted.toString("utf-8");
  } catch {
    return "";
  }
}

export function decrypt(
  cipherText: string,
  keyBytes: Buffer | Uint8Array,
  ivBytes: Buffer | Uint8Array,
): string {
  const cipherTextBytes = Buffer.from(cipherText, "base64");
  return decryptAES(cipherTextBytes, Buffer.from(keyBytes), Buffer.from(ivBytes));
}
