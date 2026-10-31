import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { glob } from "glob";
import { defineConfig, type Options } from "tsup";

type ExtensionType = "anime" | "manga";

const copyManifest = (type: ExtensionType) => {
  return {
    name: `copy-manifest-${type}`,
    buildEnd: async () => {
      console.log(`Copying ${type} manifest files...`);

      const manifestFiles = glob.sync(`src/extensions/${type}/**/manifest.json`);
      const iconFiles = glob.sync(`src/extensions/${type}/**/icon.png`);

      for (const file of manifestFiles) {
        const extName = path.basename(path.dirname(file));
        const outputDir = `dist/${type}/${extName}`;
        const outputManifest = `${outputDir}/manifest.json`;

        if (!existsSync(outputDir)) {
          await fs.mkdir(outputDir, { recursive: true });
        }

        await fs.copyFile(file, outputManifest);
      }

      for (const file of iconFiles) {
        const extName = path.basename(path.dirname(file));
        const outputDir = `dist/${type}/${extName}`;
        if (!existsSync(outputDir)) {
          await fs.mkdir(outputDir, { recursive: true });
        }

        await fs.copyFile(file, `${outputDir}/icon.png`);
      }
    },
  };
};

const createConfig = (type: ExtensionType): Options => {
  const noExternal = [
    "@tsukimichi/common",
    "cheerio",
    "axios",
    "tough-cookie",
    "axios-cookiejar-support",
    "axios-retry",
    "crypto-js",
    "async-mutex",
    "bottleneck",
  ];

  if (type === "anime") {
    noExternal.push("unpacker", "quickjs-emscripten", "hls-parser");
  }

  if (type === "manga") {
    noExternal.push("php-serialize", "protobufjs");
  }

  // Get all extension directories
  const extensionDirs = glob.sync(`src/extensions/${type}/*/`).map((dir) => path.basename(dir));

  const entries: Record<string, string> = {};
  for (const name of extensionDirs) {
    entries[`${name}/index`] = `src/extensions/${type}/${name}/index.ts`;
  }

  return {
    entry: entries,
    format: ["cjs"],
    minify: true,
    dts: false,
    splitting: false,
    sourcemap: false,
    bundle: true,
    clean: true,
    outDir: `dist/${type}`,
    target: "es2024",
    tsconfig: "./tsconfig.json",
    external: ["electron", "sharp", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    plugins: [copyManifest(type)],
    noExternal,
    loader: {
      ".txt": "text",
    },
  };
};

const buildType = process.env.BUILD_TYPE || "all";

const types: ExtensionType[] =
  buildType === "all" ? ["anime", "manga"] : [buildType as ExtensionType];

export default () => {
  const configs = [];

  for (const type of types) {
    console.log(`Processing ${type} extensions...`);
    const config = createConfig(type);

    // Skip empty configs
    if (config.entry && Object.keys(config.entry).length > 0) {
      configs.push(defineConfig(config));
    }
  }

  if (configs.length === 0) {
    console.log("No extensions to build");
    return [];
  }

  return configs.length === 1 ? configs[0] : configs;
};
