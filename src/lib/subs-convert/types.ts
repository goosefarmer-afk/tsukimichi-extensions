/**
 * Common internal representation that every parser produces and every
 * serializer consumes. Keeping formatting as *structured* runs (instead of
 * inline strings with embedded tags) is what lets us convert cleanly between
 * ASS / SRT / VTT without leftover braces, stray override tags, or duplicated
 * text -- the problems that naive regex-based converters run into.
 */

/** Supported subtitle container formats. */
export type SubtitleFormat = "ass" | "ssa" | "srt" | "vtt";

/** A single contiguous run of text that shares the same formatting. */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeout?: boolean;
  /** Hex color, e.g. "#RRGGBB". Only emitted if `preserveColor` option is on. */
  color?: string | undefined;
}

/** One visual line inside a cue (lines are separated by \N, VTT/SRT newlines, etc). */
export interface CueLine {
  runs: TextRun[];
}

/** A single subtitle entry with a start/end time and one or more lines. */
export interface Cue {
  /** Start time in milliseconds. */
  start: number;
  /** End time in milliseconds. */
  end: number;
  lines: CueLine[];
  /** Original ASS style name, if the source was ASS/SSA. Passed through best-effort. */
  styleName?: string | undefined;
  /** Raw VTT cue settings string (e.g. "position:10%,line:0 align:left"), VTT only. */
  vttSettings?: string | undefined;
  /** Optional VTT cue identifier line. */
  vttIdentifier?: string | undefined;
}

/** Top-level document containing an ordered list of cues. */
export interface SubtitleDocument {
  /** Ordered list of subtitle cues. */
  cues: Cue[];
}

/** Options shared by parsers, serializers and the {@link convert} pipeline. */
export interface ConvertOptions {
  /**
   * Whether to emit color as <font color="#RRGGBB">...</font> tags in SRT/VTT
   * output. This is a widely-supported but non-standard extension. Default: false.
   */
  preserveColor?: boolean;
  /**
   * ASS "WrapStyle"-agnostic handling of the \n (soft break) tag. If true,
   * \n is treated as a real line break (like \N). If false (default), \n is
   * collapsed to a single space, which matches how most renderers treat it
   * when not in no-word-wrap mode.
   */
  treatSoftBreakAsNewline?: boolean;
  /**
   * Style name to assign to generated ASS "Dialogue" lines when converting
   * *into* ASS from a format that has no concept of named styles.
   */
  defaultAssStyleName?: string;
  /**
   * Drop cues whose rendered text is empty/whitespace-only after
   * conversion. This is common with ASS typesetting/karaoke-decoration
   * lines that are pure vector drawings (`{\p1}...{\p0}`) with no real
   * text -- they parse "successfully" but have nothing to show, and
   * without this they end up as blank entries in the output. Default: true.
   */
  dropEmptyCues?: boolean;
  /**
   * Style names (case-insensitive, exact match) to exclude entirely,
   * regardless of whether they contain text. Handy for stripping whole
   * typesetting/sign tracks (e.g. ["Signs", "SS_OP1", "SS_OP1R"]) that you
   * don't want in the output at all. Default: [] (no exclusions).
   */
  excludeStyles?: string[];
}

/** Default values for {@link ConvertOptions}. */
export const DEFAULT_OPTIONS: Required<ConvertOptions> = {
  preserveColor: false,
  treatSoftBreakAsNewline: false,
  defaultAssStyleName: "Default",
  dropEmptyCues: true,
  excludeStyles: [],
};
