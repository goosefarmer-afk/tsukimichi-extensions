import type { ExtensionClientConstructorOptions } from "@tsukimichi/common";
import { AnikotoTheme } from "@/lib/multi-src/anime/anikoto-theme";
import manifest from "./manifest.json";

export class Anikoto extends AnikotoTheme {
  private readonly apiUrl = "https://anikotoapi.site";

  constructor(options: ExtensionClientConstructorOptions) {
    super({
      ...options,
      metadata: manifest,
      // Mirror list https://anikoto.site/#domains
      mirrors: [
        "https://anikototv.to",
        "https://anikoto.cz",
        "https://anikoto.me",
        "https://anikoto.net",
        "https://anikototv.se",
      ],
    });
  }

  protected override animeDetailsCoverSelector = "#w-info div.poster img";

  protected override listingCoverSelector = "div.poster img";
}
