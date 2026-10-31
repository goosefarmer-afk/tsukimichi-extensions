import { execSync } from "node:child_process";

const [before, after] = process.argv.slice(2);

if (!after) {
  console.error("Usage: node scripts/get-changed-extensions.js <before-ref> <after-ref>");
  process.exit(1);
}

// If before is empty, undefined, or all zeros, it's an initial push
const isInitialPush =
  !before || before === "undefined" || before === "null" || /^0{40}$/.test(before);

if (isInitialPush) {
  console.log("ALL");
  process.exit(0);
}

try {
  // Get the diff between the two commits
  const diff = execSync(`git diff --name-only ${before} ${after}`, { encoding: "utf-8" });
  const changed = new Set();

  for (const line of diff.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Changes to shared code or build config affect every extension.
    // ponytail: rebuilds ALL on any shared change, add an import-graph
    // scanner if full rebuilds get too slow.
    if (
      /^src\/(?!extensions\/)/.test(trimmedLine) ||
      /^(package\.json|pnpm-lock\.yaml|tsup\.config\.ts|tsconfig\.json)$/.test(trimmedLine)
    ) {
      console.log("ALL");
      process.exit(0);
    }

    // Match extensions in src/extensions/anime/name/ or src/extensions/manga/name/
    const match = trimmedLine.match(/^src\/extensions\/(anime|manga)\/([^/]+)\//);
    if (match) {
      changed.add(`${match[1]}:${match[2]}`);
    }
  }

  // Output comma-separated list or empty string if no changes
  const result = [...changed].join(",");
  console.log(result || "");
} catch {
  // If git diff fails, build everything as fallback
  console.log("ALL");
}
