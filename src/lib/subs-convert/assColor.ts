/**
 * ASS colors are stored as &HBBGGRR& (or &HAABBGGRR& with an alpha byte),
 * i.e. byte order reversed compared to normal RGB hex. These helpers convert
 * to/from a normal "#RRGGBB" string used in our internal representation.
 */

/**
 * Converts an ASS color literal to a CSS hex string.
 * @param raw - ASS color literal (e.g. `&H00FF00&`, `&HBBGGRR&` or `&HAABBGGRR&` with alpha)
 * @returns Hex color string in `#RRGGBB` format (uppercase), or `undefined` if unparseable
 */
export function assColorToHex(raw: string): string | undefined {
  const m = raw.match(/&H([0-9A-Fa-f]{1,8})&?/);
  if (!m) return undefined;
  let hex = m[1]!.padStart(6, "0");
  // If 8 hex digits, the leading 2 are alpha -- drop them.
  if (hex.length > 6) hex = hex.slice(hex.length - 6);
  const bb = hex.slice(0, 2);
  const gg = hex.slice(2, 4);
  const rr = hex.slice(4, 6);
  return `#${rr}${gg}${bb}`.toUpperCase();
}

/**
 * Converts a CSS hex color to an ASS color literal.
 * @param hex - Hex color string (e.g. `#RRGGBB`)
 * @returns ASS color literal in `&HBBGGRR&` format; returns `&H00FFFFFF&` for invalid input
 */
export function hexToAssColor(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9A-Fa-f]{6})$/);
  if (!m) return "&H00FFFFFF&";
  const rr = m[1]?.slice(0, 2);
  const gg = m[1]?.slice(2, 4);
  const bb = m[1]?.slice(4, 6);
  return `&H${bb}${gg}${rr}`.toUpperCase() + "&";
}
