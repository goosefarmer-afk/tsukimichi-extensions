import type { ElectronCookie } from "@tsukimichi/common";
import { session } from "electron";

export async function getCookiesForExtension(
  extensionId: string,
  filter?: {
    url?: string;
    name?: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    session?: boolean;
    httpOnly?: boolean;
  },
): Promise<ElectronCookie[]> {
  const cookies = await session.fromPartition(`persist:${extensionId}`).cookies.get(filter || {});
  return cookies;
}
