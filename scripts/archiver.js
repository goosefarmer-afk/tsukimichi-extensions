import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";

class ExtensionArchiver {
  constructor(options = {}) {
    const type = options.type || "manga";
    this.config = {
      sourceDir: `./dist/${type}`,
      sourceSrcDir: `./src/extensions/${type}`,
      archiveDir: `extensions/${type}`,
      type,
      ...options,
    };
  }
  async archiveExtensions() {
    console.log("Starting extension archiving process...");

    try {
      await this.setupDirectories();
      const extensions = await this.getExtensions();

      if (extensions.length === 0) {
        console.log(`No ${this.config.type} extensions found to archive`);
        return [];
      }

      console.log(`Found ${extensions.length} ${this.config.type} extensions to archive`);

      const results = await this.processExtensionsInBatches(extensions);

      console.log("All extensions archived successfully!");
      return results;
    } catch (error) {
      console.error(`${this.config.type} archiving failed`, error);
      throw error;
    }
  }

  async processExtensionsInBatches(extensions) {
    const results = [];
    const batchSize = 5;

    for (let i = 0; i < extensions.length; i += batchSize) {
      const batch = extensions.slice(i, i + batchSize);
      const batchPromises = batch.map((ext) => this.createExtensionArchive(ext));
      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          console.error(`Failed to archive ${batch[index]}:`, result.reason.message);
        }
      });
    }

    return results;
  }

  async setupDirectories() {
    const dirs = [this.config.archiveDir];

    for (const dir of dirs) {
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }
    }
  }

  async getExtensions() {
    try {
      const items = await fs.readdir(this.config.sourceSrcDir);
      const extensions = [];

      for (const item of items) {
        const itemPath = path.join(this.config.sourceSrcDir, item);
        const stat = await fs.stat(itemPath);
        if (!stat.isDirectory()) continue;

        try {
          await fs.access(path.join(this.config.sourceDir, item));
          extensions.push(item);
        } catch {
          // not built (partial build) — skip
        }
      }

      return extensions;
    } catch (error) {
      throw new Error(`Failed to read source directory: ${error.message}`);
    }
  }

  async createExtensionArchive(extensionName) {
    const sourcePath = path.join(this.config.sourceDir, extensionName);
    const archivePath = path.join(this.config.archiveDir, `${extensionName}.zip`);

    console.log(`Archiving: ${extensionName}`);

    try {
      await fs.access(sourcePath);
      const stats = await this.createZip(sourcePath, archivePath);

      return {
        name: extensionName,
        archivePath,
        stats,
      };
    } catch (error) {
      throw new Error(`Failed to archive ${extensionName}: ${error.message}`);
    }
  }

  createZip(sourceDir, outputPath) {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath);
      const archive = archiver("zip", {
        zlib: { level: 9 },
      });

      const stats = {
        startTime: Date.now(),
        files: 0,
        size: 0,
      };

      output.on("close", () => {
        stats.endTime = Date.now();
        stats.size = archive.pointer();
        stats.duration = stats.endTime - stats.startTime;

        console.log(
          ` ${path.basename(outputPath)} (${this.formatBytes(stats.size)}, ${stats.duration}ms)`,
        );
        resolve(stats);
      });

      output.on("error", reject);
      archive.on("error", reject);
      archive.on("entry", () => stats.files++);

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  }

  async run() {
    console.log(`Running ${this.config.type} extension archiver...`);

    try {
      const archivedExtensions = await this.archiveExtensions();

      if (archivedExtensions.length === 0) {
        console.log("No extensions to upload");
        return {
          type: this.config.type,
          count: 0,
        };
      }

      console.log(`\n ${this.config.type} archiving completed successfully!`);
      console.log(`Summary: ${archivedExtensions.length} extensions processed`);
      return {
        type: this.config.type,
        count: archivedExtensions.length,
        extensions: archivedExtensions,
      };
    } catch (error) {
      console.error(`${this.config.type} process failed:`, error.message);
      throw error;
    }
  }
}

async function archiveExtensions(types) {
  const results = [];

  for (const type of types) {
    const archiver = new ExtensionArchiver({ type });
    const result = await archiver.run();
    results.push(result);
    console.log(`\n${"=".repeat(60)}\n`);
  }

  return results;
}

async function main() {
  const archiveType = process.env.ARCHIVE_TYPE || "all";

  console.log("Extension Archiver Starting...\n");

  let types = [];

  switch (archiveType) {
    case "anime":
      types = ["anime"];
      break;
    case "manga":
      types = ["manga"];
      break;
    case "all":
      types = ["anime", "manga"];
      break;
    default:
      throw new Error(`Invalid archive type: ${archiveType}`);
  }

  try {
    const results = await archiveExtensions(types);

    console.log("=".repeat(60));
    console.log("ALL ARCHIVING COMPLETED!");
    console.log("=".repeat(60));
    results.forEach((result) => {
      console.log(`  ${result.type}: ${result.count} extensions`);
    });
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Archiving process failed:", error.message);
    process.exit(1);
  }
}

main();
