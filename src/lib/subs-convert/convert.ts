import { type Cue, type SubtitleFormat, type ConvertOptions, DEFAULT_OPTIONS } from "./types";
import { parseAss } from "./parsers/ass";
import { parseSrt } from "./parsers/srt";
import { parseVtt } from "./parsers/vtt";
import { serializeAss } from "./serializers/ass";
import { serializeSrt } from "./serializers/srt";
import { serializeVtt } from "./serializers/vtt";

/**
 * Checks whether a cue contains only empty/whitespace text.
 * @param cue - Cue to inspect
 * @returns `true` if every run in every line is empty or whitespace-only
 */
export function isCueTextEmpty(cue: Cue): boolean {
  return cue.lines.every((line) => line.runs.every((run) => run.text.trim().length === 0));
}

/**
 * Filters cues according to {@link ConvertOptions}.
 * Removes cues on excluded styles and, when `dropEmptyCues` is set, cues with no visible text.
 * @param cues - Input cues
 * @param options - Filtering options (merged with {@link DEFAULT_OPTIONS})
 * @returns Filtered cue array (new array, original not mutated)
 */
export function filterCues(cues: Cue[], options: ConvertOptions = {}): Cue[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const excludeSet = new Set(opts.excludeStyles.map((s) => s.toLowerCase()));
  return cues.filter((cue) => {
    if (excludeSet.size > 0 && cue.styleName && excludeSet.has(cue.styleName.toLowerCase())) {
      return false;
    }
    if (opts.dropEmptyCues && isCueTextEmpty(cue)) {
      return false;
    }
    return true;
  });
}

/**
 * Derives a deduplication key from the plain text content of a cue.
 * @param cue - Cue to key
 * @returns Joined plain-text key (lines separated by `\n`)
 */
function cueTextKey(cue: Cue): string {
  return cue.lines.map((l) => l.runs.map((r) => r.text).join("")).join("\n");
}

/**
 * Merges adjacent cues with identical text that overlap or are within 90ms of each other.
 * Keeps a single cue spanning the contiguous range instead of many duplicated blocks.
 * @param cues - Input cues (unsorted allowed)
 * @returns Deduplicated cue array sorted by start time
 */
export function dedupeCues(cues: Cue[]): Cue[] {
  if (cues.length <= 1) return cues;
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Cue[] = [];
  const lastByKey = new Map<string, Cue>();

  for (const cur of sorted) {
    const key = cueTextKey(cur);
    const prev = lastByKey.get(key);
    if (prev && cur.start <= prev.end + 90) {
      prev.end = Math.max(prev.end, cur.end);
      prev.start = Math.min(prev.start, cur.start);
    } else {
      const clone: Cue = {
        ...cur,
        lines: cur.lines.map((l) => ({ runs: l.runs.map((r) => ({ ...r })) })),
      };
      out.push(clone);
      lastByKey.set(key, clone);
    }
  }

  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/**
 * Parses subtitle content into an array of cues.
 * @param input - Raw subtitle file content
 * @param format - Source format to parse
 * @param options - Parsing options (e.g. `treatSoftBreakAsNewline` for ASS)
 * @returns Parsed cues sorted by start time
 * @throws {Error} If the format is unsupported
 */
export function parse(input: string, format: SubtitleFormat, options: ConvertOptions = {}): Cue[] {
  switch (format) {
    case "ass":
    case "ssa":
      return parseAss(input, options);
    case "srt":
      return parseSrt(input);
    case "vtt":
      return parseVtt(input);
    default:
      throw new Error(`Unsupported source format: ${format}`);
  }
}

/**
 * Serializes cues to a subtitle format string.
 * @param cues - Cues to serialize
 * @param format - Target format
 * @param options - Serialization options (e.g. `preserveColor`, `defaultAssStyleName`)
 * @returns Serialized subtitle file content
 * @throws {Error} If the format is unsupported
 */
export function serialize(
  cues: Cue[],
  format: SubtitleFormat,
  options: ConvertOptions = {},
): string {
  switch (format) {
    case "ass":
    case "ssa":
      return serializeAss(cues, options);
    case "srt":
      return serializeSrt(cues, options);
    case "vtt":
      return serializeVtt(cues, options);
    default:
      throw new Error(`Unsupported target format: ${format}`);
  }
}

/**
 * Converts subtitle content from one format to another.
 * Parses, filters/dedupes, then serializes in a single pipeline.
 * @param input - Raw source subtitle content
 * @param from - Source format
 * @param to - Target format
 * @param options - Conversion options applied to filtering and serialization
 * @returns Converted subtitle file content in the target format
 * @example
 * ```ts
 * const vtt = convert(assContent, 'ass', 'vtt');
 * ```
 */
export function convert(
  input: string,
  from: SubtitleFormat,
  to: SubtitleFormat,
  options: ConvertOptions = {},
): string {
  const cues = dedupeCues(filterCues(parse(input, from, options), options));
  return serialize(cues, to, options);
}

/**
 * Detects a subtitle format from a file extension.
 * @param ext - File extension with or without leading dot (e.g. `.srt`, `vtt`)
 * @returns Detected subtitle format
 * @throws {Error} If the extension does not map to a known format
 */
export function detectFormatFromExtension(ext: string): SubtitleFormat {
  const clean = ext.replace(/^\./, "").toLowerCase();
  if (clean === "ass" || clean === "ssa" || clean === "srt" || clean === "vtt") {
    return clean as SubtitleFormat;
  }
  throw new Error(`Cannot detect subtitle format from extension ".${clean}"`);
}
