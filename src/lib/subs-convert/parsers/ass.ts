import {
  type Cue,
  type CueLine,
  type TextRun,
  type ConvertOptions,
  DEFAULT_OPTIONS,
} from "../types";
import { assTimeToMs } from "../time";
import { assColorToHex } from "../assColor";

/**
 * Matches one ASS override tag inside a {...} block, capturing its name and
 * a single "argument" if present -- either a parenthesised argument list
 * (\pos(x,y), \t(...), \move(...), \fad(...), \clip(...)), a color literal
 * (&HBBGGRR&), or a bare number (\b1, \fs20, \frz15.5, -\bord2).
 *
 * This is intentionally permissive: unknown/unsupported tags are matched and
 * discarded rather than leaking into the output, which is the root cause of
 * the "{\q2\i1}" leftovers seen from naive regex strippers.
 */
const TAG_RE = /\\([a-zA-Z]+)(\((?:[^()]|\([^()]*\))*\)|&H[0-9A-Fa-f]+&|-?\d+(?:\.\d+)?)?/g;

/** Mutable formatting state accumulated while parsing ASS override blocks. */
interface RunState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeout: boolean;
  color?: string | undefined;
}

/**
 * Creates a fresh run state with no formatting active.
 * @returns New {@link RunState} with all flags disabled
 */
function freshState(): RunState {
  return { bold: false, italic: false, underline: false, strikeout: false };
}

/**
 * Parses the text field of a single ASS Dialogue line into structured cue lines.
 * Strips override tags, drawing commands and comments, and turns `\N` / `\n` / `\h`
 * into real line breaks / spaces / hard spaces.
 * @param raw - Raw ASS text field (may contain `{...}` overrides and `\N` breaks)
 * @param opts - Conversion options (controls soft-break `\n` handling)
 * @returns Parsed cue lines with styled runs
 */
export function parseAssText(raw: string, opts: Required<ConvertOptions>): CueLine[] {
  const lines: CueLine[] = [{ runs: [] }];
  let state = freshState();
  let buffer = "";
  let drawingMode = false;

  const runStyleEquals = (run: TextRun, s: RunState): boolean =>
    !!run.bold === s.bold &&
    !!run.italic === s.italic &&
    !!run.underline === s.underline &&
    !!run.strikeout === s.strikeout &&
    run.color === s.color;

  const flush = () => {
    if (buffer.length === 0) return;
    const line = lines[lines.length - 1]!;
    const lastRun = line.runs[line.runs.length - 1];
    if (lastRun && runStyleEquals(lastRun, state)) {
      // merge into previous run of identical style for cleaner output
      lastRun.text += buffer;
    } else {
      line.runs.push({ text: buffer, ...state });
    }
    buffer = "";
  };

  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw[i];

    if (ch === "{") {
      const close = raw.indexOf("}", i + 1);
      const block = close === -1 ? raw.slice(i + 1) : raw.slice(i + 1, close);
      flush();
      applyOverrideBlock(block, state, (drawing) => (drawingMode = drawing));
      i = close === -1 ? n : close + 1;
      continue;
    }

    if (drawingMode) {
      // Inside \p1.. drawing mode the "text" is vector drawing data, not
      // real subtitle text -- skip it entirely rather than emit garbage.
      i++;
      continue;
    }

    if (ch === "\\" && raw[i + 1] === "N") {
      flush();
      lines.push({ runs: [] });
      i += 2;
      continue;
    }
    if (ch === "\\" && raw[i + 1] === "n") {
      if (opts.treatSoftBreakAsNewline) {
        flush();
        lines.push({ runs: [] });
      } else {
        buffer += " ";
      }
      i += 2;
      continue;
    }
    if (ch === "\\" && raw[i + 1] === "h") {
      buffer += "\u00A0";
      i += 2;
      continue;
    }

    buffer += ch;
    i++;
  }
  flush();

  // Drop wholly-empty trailing/leading lines caused by stray \N, keep interior ones.
  while (lines.length > 1 && lines[0]!.runs.length === 0) lines.shift();
  while (lines.length > 1 && lines[lines.length - 1]!.runs.length === 0) lines.pop();
  return lines;
}

/**
 * Applies a single ASS override block (`{...}`) to the current formatting state.
 * @param block - Content inside `{` and `}` (without braces)
 * @param state - Mutable run state to update
 * @param setDrawing - Callback to toggle drawing mode (`\p`)
 */
function applyOverrideBlock(block: string, state: RunState, setDrawing: (d: boolean) => void) {
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(block))) {
    const name = m[1];
    const arg = m[2];
    switch (name) {
      case "i":
        state.italic = arg === undefined || arg === "" ? true : arg !== "0";
        break;
      case "b":
        if (arg === undefined || arg === "") state.bold = true;
        else state.bold = arg !== "0";
        break;
      case "u":
        state.underline = arg === undefined || arg === "" ? true : arg !== "0";
        break;
      case "s":
        state.strikeout = arg === undefined || arg === "" ? true : arg !== "0";
        break;
      case "c":
      case "1c": {
        if (arg) {
          const hex = assColorToHex(arg);
          if (hex) state.color = hex;
        }
        break;
      }
      case "p": {
        const level = arg ? parseInt(arg, 10) : 0;
        setDrawing(!!level && level > 0);
        break;
      }
      case "r":
        // Reset to style defaults. We don't track per-style defaults, so
        // reset to the "no override" baseline.
        state.bold = false;
        state.italic = false;
        state.underline = false;
        state.strikeout = false;
        state.color = undefined;
        break;
      default:
        // Unsupported/positional/animation tags (\pos, \move, \fad, \t,
        // \fn, \fs, \bord, \shad, \alpha, \an, \k, \clip, ...) are
        // intentionally discarded -- they have no text-format equivalent.
        break;
    }
  }
}

/** Parsed ASS section with dynamic format columns and rows. */
interface AssSection {
  format: string[];
  rows: string[][];
}

/**
 * Splits an ASS event line on commas, preserving commas inside the final `Text` field.
 * @param format - Lowercased format column names (defines field count)
 * @param line - Raw event line content after the `Dialogue:` / `Comment:` prefix
 * @returns Array of field values aligned to `format` length
 */
function splitAssLine(format: string[], line: string): string[] {
  // Split on commas but keep the final field (Text) intact, since it may
  // itself contain commas.
  const parts = line.split(",");
  const head = parts.slice(0, format.length - 1);
  const tail = parts.slice(format.length - 1).join(",");
  return [...head, tail];
}

/**
 * Parses ASS/SSA subtitle content into cues.
 * @param input - Raw ASS/SSA file content
 * @param options - Parsing options (e.g. `treatSoftBreakAsNewline`)
 * @returns Parsed cues sorted by start time; malformed lines are skipped
 */
export function parseAss(input: string, options: ConvertOptions = {}): Cue[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rawLines = input.split(/\r\n|\n/);

  let currentSection = "";
  const events: AssSection = { format: [], rows: [] };

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith(";")) continue; // comment line

    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch?.[1]) {
      currentSection = sectionMatch[1].toLowerCase();
      continue;
    }

    if (currentSection === "events") {
      if (/^format\s*:/i.test(line)) {
        events.format = line
          .slice(line.indexOf(":") + 1)
          .split(",")
          .map((s) => s.trim().toLowerCase());
        continue;
      }
      if (/^(dialogue|comment)\s*:/i.test(line)) {
        const isComment = /^comment\s*:/i.test(line);
        const content = line.slice(line.indexOf(":") + 1).trim();
        if (events.format.length === 0) {
          // No Format line seen (malformed file) -- assume the standard v4+ order.
          events.format = [
            "layer",
            "start",
            "end",
            "style",
            "name",
            "marginl",
            "marginr",
            "marginv",
            "effect",
            "text",
          ];
        }
        // Keep comment karaoke source lines (Effect=kara) - they contain the
        // full lyric with {\k} tags; skip other comments.
        const tmpRow = splitAssLine(events.format, content);
        const tmpEffectIdx = events.format.indexOf("effect");
        const eff = tmpEffectIdx !== -1 ? (tmpRow[tmpEffectIdx] ?? "").trim().toLowerCase() : "";
        if (isComment) {
          if (eff !== "kara") continue;
        }
        events.rows.push(tmpRow);
      }
    }
  }

  const startIdx = events.format.indexOf("start");
  const endIdx = events.format.indexOf("end");
  const textIdx = events.format.indexOf("text");
  const styleIdx = events.format.indexOf("style");

  const effectIdx = events.format.indexOf("effect");
  const cues: Cue[] = [];
  for (const row of events.rows) {
    if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;
    const startStr = row[startIdx]?.trim();
    const endStr = row[endIdx]?.trim();
    const text = row[textIdx] ?? "";
    if (!startStr || !endStr) continue;
    try {
      const start = assTimeToMs(startStr);
      const end = assTimeToMs(endStr);
      const lines = parseAssText(text, opts);
      // Skip per-syllable karaoke effect fragments (Effect=fx) that have
      // real text - they cause duplication (many overlapping word cues).
      // Keep fx rows that are empty/drawing-only so dropEmptyCues option
      // still governs them (test expects empty fx kept when keepEmpty).
      const eff = effectIdx !== -1 ? (row[effectIdx] ?? "").trim().toLowerCase() : "";
      if (eff === "fx") {
        const isEmpty = lines.every((l) => l.runs.every((r) => r.text.trim().length === 0));
        if (!isEmpty) continue;
      }
      cues.push({
        start,
        end,
        lines,
        styleName: styleIdx !== -1 ? row[styleIdx]?.trim() : undefined,
      });
    } catch {
      // Skip malformed dialogue lines rather than failing the whole file.
      continue;
    }
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}
