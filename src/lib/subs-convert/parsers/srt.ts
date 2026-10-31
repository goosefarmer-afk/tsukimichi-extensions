import type { Cue } from "../types";
import { srtTimeToMs } from "../time";
import { parseInlineTags } from "./inlineTags";

const TIME_LINE_RE =
  /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-{2,3}>\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/;

/**
 * Parses SRT subtitle content into cues.
 * @param input - Raw SRT file content
 * @returns Parsed cues sorted by start time; malformed blocks are skipped
 */
export function parseSrt(input: string): Cue[] {
  // Normalize line endings and split into blocks on blank lines.
  const normalized = input.replace(/\r\n|\r/g, "\n").replace(/^\uFEFF/, "");
  const blocks = normalized.split(/\n{2,}/);

  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0 || l === "");
    if (lines.length === 0) continue;

    let idx = 0;
    // Optional numeric index line
    if (/^\d+$/.test(lines[idx]?.trim() ?? "")) idx++;

    const timeLine = lines[idx];
    if (!timeLine) continue;
    const m = timeLine.match(TIME_LINE_RE);
    if (!m) continue;
    idx++;

    const textLines = lines.slice(idx);
    // Drop trailing blank lines produced by trailing newlines in the source,
    // but keep any genuinely blank lines *between* text lines.
    while (textLines.length > 0 && textLines[textLines.length - 1]!.trim() === "") {
      textLines.pop();
    }
    try {
      const start = srtTimeToMs(m[1]!);
      const end = srtTimeToMs(m[2]!);
      const cueLines = textLines.map((l) => parseInlineTags(l));
      cues.push({ start, end, lines: cueLines.length ? cueLines : [{ runs: [] }] });
    } catch {
      continue;
    }
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}
