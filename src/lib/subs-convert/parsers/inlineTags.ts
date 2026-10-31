import type { CueLine, TextRun } from "../types";

/**
 * Parses a single text line with HTML-like inline formatting into a structured cue line.
 * Supports `<b>`, `<i>`, `<u>`, `<font color="#RRGGBB">`, and strips VTT-only tags
 * like `<c>`/`<v>` while preserving their text content.
 * @param line - Raw text line potentially containing inline tags
 * @returns Parsed cue line with styled runs; empty runs are omitted
 */
export function parseInlineTags(line: string): CueLine {
  const runs: TextRun[] = [];
  let bold = false;
  let italic = false;
  let underline = false;
  let color: string | undefined;

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const pushText = (text: string) => {
    if (text.length === 0) return;
    const last = runs[runs.length - 1];
    if (
      last &&
      !!last.bold === bold &&
      !!last.italic === italic &&
      !!last.underline === underline &&
      last.color === color
    ) {
      last.text += text;
    } else {
      runs.push({ text, bold, italic, underline, color });
    }
  };

  while ((m = tagRe.exec(line))) {
    const [full, tagNameRaw, attrs] = m;
    pushText(decodeEntities(line.slice(lastIndex, m.index)));
    lastIndex = m.index + full.length;
    const isClose = full.startsWith("</");
    const tagName = tagNameRaw!.toLowerCase();

    switch (tagName) {
      case "b":
        bold = !isClose;
        break;
      case "i":
        italic = !isClose;
        break;
      case "u":
        underline = !isClose;
        break;
      case "font": {
        if (isClose) {
          color = undefined;
        } else {
          const colorMatch = attrs?.match(/color\s*=\s*["']?(#?[0-9A-Fa-f]{3,6})["']?/);
          if (colorMatch) {
            let hex = colorMatch[1];
            if (!hex?.startsWith("#")) hex = `#${hex}`;
            color = hex.toUpperCase();
          }
        }
        break;
      }
      // VTT-only cosmetic tags (<c>, <v>, <ruby>, timestamps <00:00:01.000>)
      // carry no cross-format meaning, so we just drop the tag and keep the
      // enclosed text.
      default:
        break;
    }
  }
  pushText(decodeEntities(line.slice(lastIndex)));

  return { runs: runs.filter((r) => r.text.length > 0) };
}

/**
 * Decodes a subset of HTML entities found in SRT/VTT text.
 * @param s - String possibly containing entities (`&amp;`, `&lt;`, etc.)
 * @returns Decoded string
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, "\u00A0");
}
