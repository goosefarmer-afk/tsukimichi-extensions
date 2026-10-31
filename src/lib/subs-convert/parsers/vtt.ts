import type { Cue } from "../types";
import { vttTimeToMs } from "../time";
import { parseInlineTags } from "./inlineTags";

const TIME_LINE_RE =
  /(\d{1,2}(?::\d{2}){1,2}[.,]\d{1,3})\s*-{2,3}>\s*(\d{1,2}(?::\d{2}){1,2}[.,]\d{1,3})(.*)$/;

/**
 * Parses WebVTT subtitle content into cues.
 * @param input - Raw VTT file content (with or without `WEBVTT` header)
 * @returns Parsed cues sorted by start time; malformed blocks are skipped
 */
export function parseVtt(input: string): Cue[] {
  const normalized = input.replace(/\r\n|\r/g, "\n").replace(/^\uFEFF/, "");
  const blocks = normalized.split(/\n{2,}/);

  const cues: Cue[] = [];
  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (block.length === 0) continue;
    if (/^WEBVTT/i.test(block)) continue;
    if (/^NOTE(\s|$)/i.test(block)) continue;
    if (/^STYLE(\s|$)/i.test(block)) continue;
    if (/^REGION(\s|$)/i.test(block)) continue;

    const lines = block.split("\n");
    let idx = 0;
    let identifier: string | undefined;

    if (!TIME_LINE_RE.test(lines[idx] ?? "")) {
      // First line is a cue identifier, not a time range.
      identifier = lines[idx];
      idx++;
    }

    const timeLine = lines[idx];
    if (!timeLine) continue;
    const m = timeLine.match(TIME_LINE_RE);
    if (!m) continue;
    idx++;

    const settings = m[3]?.trim() || undefined;
    const textLines = lines.slice(idx);

    try {
      const start = vttTimeToMs(m[1]!);
      const end = vttTimeToMs(m[2]!);
      const cueLines = textLines.map((l) => parseInlineTags(stripTimestampTags(l)));
      cues.push({
        start,
        end,
        lines: cueLines.length ? cueLines : [{ runs: [] }],
        vttIdentifier: identifier,
        vttSettings: settings,
      });
    } catch {
      continue;
    }
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/**
 * Removes VTT karaoke-style inline timestamp tags (e.g. `<00:00:01.500>`).
 * @param line - Raw cue text line
 * @returns Line with timestamp tags stripped
 */
function stripTimestampTags(line: string): string {
  return line.replace(/<\d{1,2}(:\d{2}){1,2}[.,]\d{1,3}>/g, "");
}
