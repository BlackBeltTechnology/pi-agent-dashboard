/**
 * Escape a string for use inside one GFM table cell. Pure (no Node imports) so
 * both server and client can use it.
 *
 * Order matters: `\` first (so the `\` added for `|` is not doubled), then `|`,
 * then every line ending (CRLF, lone CR, LF — each is a CommonMark line ending
 * that would otherwise split the row) to one space.
 */
export function escapeMdTableCell(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r\n?|\n/g, " ");
}
