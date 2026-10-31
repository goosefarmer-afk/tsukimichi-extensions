import type { ExtensionClientConstructorOptions } from "@tsukimichi/common";

import manifest from "./manifest.json";
import { AnikotoTheme } from "@/lib/multi-src/anime/anikoto-theme";

export class KotoKai extends AnikotoTheme {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
      mirrors: [
        "https://animekaitv.to",
        "https://anikaitv.to",
        "https://animekai.se",
        "https://anikai.se",
      ],
    });
  }
}
