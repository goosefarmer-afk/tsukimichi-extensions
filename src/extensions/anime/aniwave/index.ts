import { AnikotoTheme } from "@/lib/multi-src/anime/anikoto-theme";
import type { ExtensionClientConstructorOptions } from "@tsukimichi/common";
import manifest from "./manifest.json";

export class AniWave extends AnikotoTheme {
  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
      mirrors: ["https://animewave.to", "https://aniwave.cz"],
    });
  }

  protected override animeDetailsCoverSelector = "#w-info div.poster imgs";
}
