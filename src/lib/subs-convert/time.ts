/** Time helpers. Internal representation is always milliseconds (integer). */

/**
 * Pads a number with leading zeros.
 * @param n - Number to pad
 * @param width - Minimum width of the output string
 * @returns Zero-padded string representation
 */
function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

/**
 * Parses an ASS timestamp string into milliseconds.
 * @param t - Timestamp in `H:MM:SS.CC` format (centiseconds, e.g. `0:01:02.03`)
 * @returns Time in milliseconds
 * @throws {Error} If the timestamp does not match `H:MM:SS.CC`
 */
export function assTimeToMs(t: string): number {
  const m = t.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) throw new Error(`Invalid ASS timestamp: "${t}"`);
  const [, h, mi, s, cs] = m;
  return (
    Number.parseInt(h!, 10) * 3600000 +
    Number.parseInt(mi!, 10) * 60000 +
    Number.parseInt(s!, 10) * 1000 +
    Number.parseInt(cs!, 10) * 10
  );
}

/**
 * Formats milliseconds as an ASS timestamp.
 * @param ms - Time in milliseconds (clamped to >= 0 and rounded)
 * @returns Timestamp string in `H:MM:SS.CC` format (unpadded hour, centiseconds)
 */
export function msToAssTime(ms: number): string {
  ms = Math.max(0, Math.round(ms / 10) * 10);
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const mi = Math.floor(ms / 60000);
  ms -= mi * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  const cs = ms / 10;
  return `${h}:${pad(mi, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

/**
 * Parses an SRT timestamp string into milliseconds.
 * @param t - Timestamp in `HH:MM:SS,mmm` format (also tolerates `.` as separator)
 * @returns Time in milliseconds
 * @throws {Error} If the timestamp does not match `HH:MM:SS,mmm`
 */
export function srtTimeToMs(t: string): number {
  const m = t.trim().match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) throw new Error(`Invalid SRT timestamp: "${t}"`);
  const [, h, mi, s, ms] = m;
  const msPadded = ms!.padEnd(3, "0").slice(0, 3);
  return (
    Number.parseInt(h!, 10) * 3600000 +
    Number.parseInt(mi!, 10) * 60000 +
    Number.parseInt(s!, 10) * 1000 +
    Number.parseInt(msPadded, 10)
  );
}

/**
 * Formats milliseconds as an SRT timestamp.
 * @param ms - Time in milliseconds (clamped to >= 0 and rounded)
 * @returns Timestamp string in `HH:MM:SS,mmm` format
 */
export function msToSrtTime(ms: number): string {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const mi = Math.floor(ms / 60000);
  ms -= mi * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  return `${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

/**
 * Parses a VTT timestamp string into milliseconds.
 * @param t - Timestamp in `HH:MM:SS.mmm` or `MM:SS.mmm` format
 * @returns Time in milliseconds
 * @throws {Error} If the timestamp does not match the expected VTT format
 */
export function vttTimeToMs(t: string): number {
  const m = t.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) throw new Error(`Invalid VTT timestamp: "${t}"`);
  const [, h, mi, s, ms] = m;
  const msPadded = ms!.padEnd(3, "0").slice(0, 3);
  return (
    (h ? Number.parseInt(h, 10) : 0) * 3600000 +
    Number.parseInt(mi!, 10) * 60000 +
    Number.parseInt(s!, 10) * 1000 +
    Number.parseInt(msPadded, 10)
  );
}

/**
 * Formats milliseconds as a VTT timestamp.
 * @param ms - Time in milliseconds (clamped to >= 0 and rounded)
 * @returns Timestamp string in `HH:MM:SS.mmm` format
 */
export function msToVttTime(ms: number): string {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const mi = Math.floor(ms / 60000);
  ms -= mi * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  return `${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}
