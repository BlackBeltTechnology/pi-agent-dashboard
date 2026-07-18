/**
 * Restrictive CSP for AUTO-OPENED file-kind documents (change: auto-canvas,
 * Section 8 / Security posture). Pure string transform — unit-testable.
 *
 * Threat model (design doubt-review #9/I): a no-JS document rendered by the
 * DOC-detect auto-open path (no user click) can still `<img src=http://attacker/
 * beacon>` — a NEW egress the manual-click flow lacks. v1 requires auto-open
 * egress ≤ manual-click egress, so an auto-opened document carries a CSP that
 * blocks ALL external subresources.
 *
 * Scope: file-document auto-open ONLY. `canvas()` url/youtube declares render
 * the live URL and are egress-equal-to-manual (excluded — a CSP blocking
 * subresources would break them, S35).
 */

/**
 * CSP that blocks every external subresource while still letting a static
 * document paint: no external images, styles, scripts, fonts, frames, or
 * network. `data:` images and inline styles are permitted (self-contained
 * documents commonly inline both); everything network-facing is `'none'`.
 */
export const AUTO_OPEN_DOC_CSP =
  "default-src 'none'; " +
  "img-src 'self' data:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' data:; " +
  "media-src 'self' data:; " +
  "connect-src 'none'; " +
  "script-src 'none'; " +
  "frame-src 'none'; " +
  "form-action 'none'; " +
  "base-uri 'none'";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${AUTO_OPEN_DOC_CSP}">`;

/**
 * Prepend the restrictive CSP `<meta>` to a document's HTML so an
 * `iframe srcDoc` render enforces it. Inserted immediately after `<head>` when
 * present (so it is the first policy the parser sees), else at the very top of
 * the document (a `<meta>` before any markup still applies to the whole doc).
 * Idempotent for OUR OWN repeated calls: the skip check is POSITION-specific
 * (our exact meta already at the insertion point), NOT a substring search of
 * the whole document — so attacker-controlled policy text embedded elsewhere
 * (e.g. inside a comment or script) can NEVER trick the guard into skipping
 * injection. And since our meta is inserted FIRST (right after `<head>` /
 * leading `<!DOCTYPE>` / top), CSP's multiple-policy intersection means ours is
 * always enforced even if the document carries its own (possibly permissive)
 * CSP meta later.
 */
export function withRestrictiveCsp(html: string): string {
  // Insertion point: after <head>; else after a leading <!DOCTYPE> (so the meta
  // never precedes the doctype → quirks mode); else the very top.
  let idx = 0;
  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch) {
    idx = headMatch.index + headMatch[0].length;
  } else {
    const doctypeMatch = /<!doctype[^>]*>/i.exec(html);
    if (doctypeMatch && doctypeMatch.index === 0) idx = doctypeMatch[0].length;
  }
  // Skip ONLY when our exact meta already sits at the insertion point.
  if (html.startsWith(CSP_META, idx)) return html;
  return html.slice(0, idx) + CSP_META + html.slice(idx);
}
