import type { ExtensionClientConstructorOptions } from "@tsukimichi/common";
import manifest from "./manifest.json";
import { MangaKSource } from "@/lib/multi-src/manga/mangak";

export class ToonilyME extends MangaKSource {
  private readonly API_URL = "https://api.toontop.io";

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
    });
  }
}
