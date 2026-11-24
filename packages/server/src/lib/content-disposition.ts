/**
 * Build a header-safe `Content-Disposition: attachment` value for a file name.
 *
 * - `filename="…"`: every char outside printable ASCII (0x20-0x7E, so CR/LF
 *   too), plus `"` and `\`, becomes `_` — no header injection, no quoted-string
 *   escapes.
 * - `filename*=UTF-8''…`: RFC 5987 `attr-char` percent-encoding. `encodeURIComponent`
 *   leaves `' ( ) *` literal, which are not `attr-char`, so they are encoded too
 *   (`!` and `~` are legal and stay literal).
 *
 * See change: add-file-download.
 */
export function contentDispositionAttachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
