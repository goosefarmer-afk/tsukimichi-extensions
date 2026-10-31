# Contributing

This guide explains how this repository works and how to add or update a Tsukimichi extension.
Please **read it carefully** if you are a new contributor or lack experience with the required
languages and knowledge.

## Prerequisites

Before you start, please note that the ability to use following technologies is **required** and
that existing contributors will not actively teach these to you.

- Basic [Electron](https://electronjs.org)
- [HTML](https://developer.mozilla.org/en-US/docs/Web/HTML)
- [CSS selectors](https://developer.mozilla.org/en-US/docs/Web/CSS)
- [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript) / [TypeScript](https://www.typescriptlang.org/)
- [Node.js](https://nodejs.org)
- [pnpm](https://pnpm.io)
- Web scraping
    - [Axios](https://axios-http.com/)
    - [Cheerio](https://cheerio.js.org/)

### Tools

- [Visual Studio Code](https://code.visualstudio.com/) or other code editor
- A computer and a recent version of Tsukimichi installed (for testing)

## Getting started

1. Fork the repository and clone your fork.
2. Install dependencies with pnpm:
   ```
   pnpm install
   ```
3. Verify everything works:
   ```
   pnpm typecheck
   pnpm lint
   ```
4. Create a branch for your work and open a PR against `main` when done.

## Project structure

```
scripts/                              Build & CI helper scripts
  archiver.js                         Zips built extensions into extensions/<type>/*.zip
  generate-extension-meta.js          Regenerates anime.json / manga.json (downloadUrl + sha256)
  get-changed-extensions.js           Lists extensions changed between two git refs
src/
  extensions/
    anime/<name>/                     One folder per anime extension
    manga/<name>/                     One folder per manga extension
  generic/
    base-anime-scraper.ts             Base class for standalone anime extensions
    base-manga-scraper.ts             Base class for standalone manga extensions
  lib/
    multi-src/anime/                  Shared themes: Anikoto, AnimeStream, AnimeKai, Zoro
    multi-src/manga/                  Shared themes: Madara, MadTheme, MangaBox, MangaReader, MangaK
    extractors/                       Video/stream extractors (Kwik, Megacloud, Dood, ...)
    network/                          NetworkHelper, rate limiters, interceptors
  utils/                              Shared utilities (string, map, language)
extensions/                           Built & zipped output (committed by the publish workflow)
anime.json / manga.json               Registry files (committed by the publish workflow)
```

## How extensions work

An extension is a TypeScript class that implements the client interface from
[`@tsukimichi/common`](https://www.npmjs.com/package/@tsukimichi/common). Tsukimichi loads the
built bundle, reads the manifest, instantiates the exported class, and calls its methods to fetch
series, chapters/episodes, and media.

### Extension folder

Every extension lives in its own folder and must contain:

| File         | Required | Purpose                                                |
| ------------ | -------- | ------------------------------------------------------ |
| `index.ts`   | yes      | Exports the extension class                            |
| `manifest.json` | yes   | Metadata: id, name, url, flags, version                |
| `icon.png`   | yes      | Extension icon used in the app                         |

Optional files used by larger extensions: `filters.ts` (filter option lists), `dto.ts` (API
response types), `extractors/`, `kwik-extractor.ts`, etc.

### manifest.json

Example:

```json
{
  "id": "be7645dc-c8ad-40a0-a99d-3b7628557ea7",
  "name": "MangaDex",
  "url": "https://mangadex.org",
  "isManga": true,
  "extClass": "MangaDex",
  "isNsfw": false,
  "lang": "multi",
  "description": "",
  "version": "1.0.0",
  "apiUrl": "",
  "supportsPopular": true,
  "supportsLatest": true,
  "iconUrl": "./icon.png"
}
```

Key fields:

- `id` — a random **UUID**. Generate one with `node -e "console.log(crypto.randomUUID())"`. Never
  reuse an existing id, and **never change it once a PR with the extension has been merged to
  `main`** — the id is the key that links user library entries to the extension, so changing it
  breaks every existing user's library. Treat it as permanent.
- `name` — display name of the extension.
- `url` — the main site URL. This becomes `baseUrl` on the base scraper. If the site has
  multiple mirror URLs, still set this to the primary one and add a mirror setting (see
  [Settings and filters](#settings-and-filters)).
- `isManga` — `true` for manga, `false` for anime.
- `extClass` — must match the exported class name exactly.
- `isNsfw` — whether the extension contains any NSFW content.
- `lang` — the site's primary language as an [ISO 639-1](https://en.wikipedia.org/wiki/ISO_639-1)
  code (e.g. `"en"`, `"es"`, `"fr"`, `"ja"`), or `"multi"` if the site supports multiple
  languages.
- `version` — semver string, bump it when you change an extension.
- `supportsPopular` / `supportsLatest` — must match what your class actually implements.
- `minAppVersion` — only set if the extension needs a specific minimum Tsukimichi version.

### index.ts

The class extends either a base scraper or a multi-source theme.

**Manga** — extend [`BaseMangaScraper`](src/generic/base-manga-scraper.ts) for a standalone
site, or reuse a shared theme under `src/lib/multi-src/manga/` when the site runs a known CMS:

```ts
export class WebtoonsCom extends BaseMangaScraper {
  constructor(options: ExtensionClientConstructorOptions) {
    super({ ...options, metadata: manifest });
  }
  // override searchSeries, getLatestSeries, getPopularSeries, getSeries, getChapters, getChapterPages
}
```

**Anime** — extend [`BaseAnimeScraper`](src/generic/base-anime-scraper.ts) for a standalone
site, or reuse a shared theme under `src/lib/multi-src/anime/`:

```ts
export class AniWave extends AnikotoTheme {
  constructor(options: ExtensionClientConstructorOptions) {
    super({ ...options, metadata: manifest, mirrors: ["https://animewave.to", "https://aniwave.cz"] });
  }
}
```

**Standalone anime extensions** must implement: `getSeries`, `getEpisodes`, `searchSeries`,
`getPopularSeries`, `getLatestSeries`, `getVideos`. `getMetadata` and `getImage` have defaults.

**Standalone manga extensions** must implement: `searchSeries`, `getSeries`, `getChapters`,
`getPopularSeries`, `getLatestSeries`, `getChapterPages`. `getMetadata`, `getImage`,
`getFilterConfig`, and `getSettingsPreference` have defaults.

Use path aliases — `@/*` maps to `./src/*` (e.g. `@/generic/base-manga-scraper`,
`@/lib/multi-src/manga/madara`, `@/lib/network/network-helper`). Always use the type-only import
for types from `@tsukimichi/common`.

### Helpers available on the base scrapers

Both base classes provide utilities you are encouraged to reuse:

- `client` — configured `AxiosInstance` (manga: also `fetchWithRetry` with timeout/backoff).
- `network` — `NetworkHelper` for building custom clients/interceptors.
- `detectNsfw({ title, description, genres, tags })` — keyword-based NSFW detection
  (see `src/lib/constants.ts` for the keyword list).
- `parseSeriesDate()` / `parseRelativeDate()` — parses relative dates ("5 days ago", "hace 2
  horas", "昨天", ...) into ISO strings.
- `getOwnText($el)` — text of an element excluding nested element text.
- `headersBuilders()` — axios headers with a `Referer` set to `baseUrl`.
- `slugify(input)` — URL slug from a title.
- `addEpisodeNavigation()` / `addChapterNavigation()` — sorts and links prev/next entries.
- Manga: `getImageHeaders()`, `getLargestNumber()`, `extractSourceIdsFromUrl()`,
  `extractChapterNumber()`, `getValidRating()`, `normalizeUrl()`.
- Anime: `labelToLang()`, `toAbsoluteUrl()`.

If a site uses the same CMS/theme as an existing extension, prefer extending the shared theme over
duplicating scraping logic. Check `src/lib/multi-src/` first.

### Settings and filters

- Implement `getSettingsPreference()` to expose user options (domain mirrors, quality, language).
  See `animepahe` (mirror + HLS toggle) or `mangadex` (title language, content ratings).
- Implement `getFilterConfig()` to expose search filters. Supported types: `select`,
  `multi-select`, `sort`, `text`. See `mangadex` for a full example.
- Read setting values from `this.settings` (keyed by the `key` you defined) and `this.preferences`
  where provided by the theme/base.

### Multiple URLs / mirrors

If a site is reachable through several URLs, do **not** hardcode a single one. Expose a `select`
setting so users can pick the mirror, defaulting to the first entry. Follow the `animepahe`
pattern:

```ts
override getSettingsPreference: GetSettingsPreference = () => ({
  extensionId: this.extensionMetadata.id,
  extensionName: this.extensionMetadata.name,
  settings: [
    {
      key: this.PREF_DOMAIN_KEY,
      type: "select",
      label: "Preferred domain",
      description: "It's recommended to restart the app after changing this setting.",
      options: this.DOMAIN_LIST.map((d) => ({
        label: new URL(d).hostname,
        value: d,
      })),
      defaultValue: this.DEFAULT_DOMAIN,
    },
  ],
});

private usePreferredDomain(): string {
  const preferredDomain = this.settings?.[this.PREF_DOMAIN_KEY];
  if (preferredDomain && this.DOMAIN_LIST.includes(preferredDomain)) {
    return preferredDomain;
  }
  return this.DEFAULT_DOMAIN;
}

private readonly DOMAIN_LIST = [
  "https://animepahe.com",
  "https://animepahe.org",
  "https://animepahe.pw",
];
private readonly PREF_DOMAIN_KEY = "preferred-domain";
private readonly DEFAULT_DOMAIN = this.DOMAIN_LIST[0]!;
```

Apply the chosen domain in the constructor and when building request URLs:

```ts
constructor(options: ExtensionClientConstructorOptions) {
  super({ ...options, metadata: manifest });
  this.baseUrl = this.usePreferredDomain();
}
```

For themes that already support mirrors (`AnikotoTheme`, `KaliScan`, ...), pass the mirror list to
the theme's constructor or override `getSettingsPreference` accordingly instead of reimplementing
the selection logic.

### NSFW rules

- If the site hosts NSFW content set `containsNsfwContent: true`; set `isNsfwFocused: true` only
  for hentai-focused sites.
- Use `this.detectNsfw(...)` on series that mix SFW/NSFW content so the app can filter them.
- Never hardcode other extensions' UUIDs or internal metadata; everything must come from the
  manifest.

## TypeScript conventions

The project uses a strict `tsconfig.json`. In particular:

- `noImplicitOverride` — use the `override` keyword when overriding base methods.
- `verbatimModuleSyntax` — use `import type { ... }` for type-only imports.
- `noUnusedParameters` / `noUnusedIndexedAccess` — keep code free of unused params (prefix
  throwaway ones with `_`).
- No semicolon-free style disputes: the repo is formatted with `oxfmt` and linted with `oxlint`
  (`pnpm lint`).

## Building and testing

### Scripts

| Command                 | What it does                                   |
| ----------------------- | ---------------------------------------------- |
| `pnpm dev`              | Watch build of all extensions                  |
| `pnpm build`            | Build all extensions into `dist/`              |
| `pnpm build:anime`      | Build only anime extensions                    |
| `pnpm build:manga`      | Build only manga extensions                    |
| `pnpm archive`          | Zip `dist/*` into `extensions/*.zip`           |
| `pnpm bundle`           | build + archive + regenerate registries        |
| `pnpm typecheck`        | `tsc --noEmit`                                 |
| `pnpm lint`             | `oxlint`                                       |

### Building a single extension

You can limit the build to specific extensions with the `EXTENSIONS` env var. Entries are
`<type>:<name>` or `<name>`, comma-separated:

```
EXTENSIONS="manga:mangadex,anime:aniwave" BUILD_TYPE=all pnpm exec tsup --config tsup.config.ts
```

### Before opening a PR

Run and make sure all pass:

```
pnpm typecheck
pnpm lint
pnpm build
```

Then load the built output in the Tsukimichi app (or via the app's extension loader) and manually
verify: search, series details, chapters/episodes, page/video loading, filters, and settings.

## CI / automated workflows

This repo has three GitHub Actions workflows:

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — runs on every PR. It detects which
  extensions changed, builds only those (or all when shared code changed), and runs `pnpm typecheck`.
- [`.github/workflows/publish.yml`](.github/workflows/publish.yml) — runs on every push to `main`.
  Builds changed extensions, zips them into `extensions/` via `scripts/archiver.js`, regenerates
  `anime.json` / `manga.json` via `scripts/generate-extension-meta.js`, and commits the output.
- [`.github/workflows/delete-merged-branch.yml`](.github/workflows/delete-merged-branch.yml) —
  deletes branches after their PRs merge.

How change detection works (`scripts/get-changed-extensions.js`):

- A diff is computed between the PR base and head (or the previous commit on `main`).
- Changes inside `src/extensions/<type>/<name>/` rebuild only that extension.
- Changes to shared code (`src/` outside `extensions/`), `package.json`, `pnpm-lock.yaml`,
  `tsup.config.ts`, or `tsconfig.json` trigger a full rebuild of **ALL** extensions.
- An initial push (no previous commit) also builds everything.

**Important:** the `extensions/` folder and the `anime.json`/`manga.json` registries are
auto-generated and committed by the publish workflow. Do **not** commit them manually in PRs.
Only push your source changes under `src/extensions/` (and `src/lib/` if you added shared code).

## Pull request guidelines

- Branch from `main`, name the branch after what you're changing (e.g. `feat/mangaplus`,
  `fix/animepahe`).
- One extension per PR. If you add several unrelated extensions, split them into separate PRs.
- Keep the diff focused — don't reformat unrelated files.
- Bump the `version` in `manifest.json` whenever you change an extension's behavior.
- When introducing a new shared theme or extractor, place it under `src/lib/` and reuse it in your
  own extension.

## Adding a new extension — checklist

1. Create `src/extensions/{anime|manga}/<name>/`.
2. Add `index.ts`, `manifest.json`, and `icon.png`.
3. Generate a fresh UUID for `manifest.id`; set `extClass` to the exported class name.
4. Set `lang` to the site's ISO 639-1 code, or `"multi"` for multi-language sites.
5. Extend the matching base scraper, or a shared theme from `src/lib/multi-src/`.
6. Implement all required methods; reuse base helpers where possible.
9. Run `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
10. Test the built extension in Tsukimichi.
11. Open a PR; CI will build your extension automatically.
