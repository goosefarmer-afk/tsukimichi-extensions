import type { CueLine, TextRun, ConvertOptions } from '../types';

/**
 * Escapes HTML-significant characters in plain text.
 * @param s - Raw text
 * @returns Escaped text safe for SRT/VTT output
 */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Renders a single run wrapped in the minimal set of tags needed to express
 * its formatting, in a fixed nesting order (font color outer, then bold,
 * then italic, then underline) so output is always well-formed even when
 * runs differ only in one attribute.
 */
function renderRun(run: TextRun, opts: Required<ConvertOptions>): string {
  let text = escapeText(run.text);
  if (run.underline) text = `<u>${text}</u>`;
  if (run.italic) text = `<i>${text}</i>`;
  if (run.bold) text = `<b>${text}</b>`;
  if (opts.preserveColor && run.color) text = `<font color="${run.color}">${text}</font>`;
  return text;
}

/**
 * Renders a cue line's runs to SRT/VTT inline-tagged text.
 * @param line - Cue line to render
 * @param opts - Conversion options (`preserveColor` controls `<font>` wrapping)
 * @returns Joined line text with minimal formatting tags
 */
export function renderCueLine(line: CueLine, opts: Required<ConvertOptions>): string {
  return line.runs.map((r) => renderRun(r, opts)).join('');
}
