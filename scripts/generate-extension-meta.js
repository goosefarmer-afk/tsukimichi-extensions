import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const EXTENSION_TYPE = process.env.EXTENSION_TYPE || "all";

const EXTENSION_TYPES = {
  all: ["anime", "manga"],
  anime: ["anime"],
  manga: ["manga"],
};

const SOURCE_URL_BASE = "https://raw.githubusercontent.com/goosefarmer-afk/tsukimichi-extensions";
const ARTIFACT_URL_BASE = "https://raw.githubusercontent.com/goosefarmer-afk/extensions-repo";

function getZipDownloadUrl(type, dir) {
  return `${ARTIFACT_URL_BASE}/main/extensions/${type}/${dir}.zip`;
}

async function sha256OfZip(type, dir) {
  const zipPath = path.join(process.cwd(), "extensions", type, `${dir}.zip`);
  const data = await fs.readFile(zipPath);
  return createHash("sha256").update(data).digest("hex");
}

async function loadManifests(type) {
  const baseDir = path.join(process.cwd(), "src", "extensions", type);

  const dirs = await fs.readdir(baseDir);
  const manifests = [];

  for (const dir of dirs) {
    const manifestPath = path.join(baseDir, dir, "manifest.json");

    let baseData;
    try {
      const metadata = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      baseData = {
        id: metadata.id,
        name: metadata.name,
        url: metadata.url,
        isManga: metadata.isManga,
        version: metadata.version,
        contentRating: metadata.contentRating,
        lang: metadata.lang,
        iconUrl: `${SOURCE_URL_BASE}/main/src/extensions/${type}/${dir}/icon.png`,
      };
    } catch {
      continue;
    }

    try {
      baseData.downloadUrl = getZipDownloadUrl(type, dir);
      baseData.sha256 = await sha256OfZip(type, dir);
    } catch (error) {
      console.warn(`Skipping ${type}/${dir}: missing zip (${error.message})`);
      continue;
    }

    manifests.push(baseData);
  }

  return manifests;
}

async function main() {
  try {
    const types = EXTENSION_TYPES[EXTENSION_TYPE];

    for (const type of types) {
      const manifests = await loadManifests(type);

      const outputPath = path.join(process.cwd(), `${type}.json`);
      await fs.writeFile(outputPath, JSON.stringify(manifests, null, 2));
      console.log(`${type}.json generated`);
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
