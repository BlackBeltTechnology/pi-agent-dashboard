/**
 * Blob path resolution + containment guard for the `GET /api/plugins/invoicebot/blob`
 * route. Given a request `cwd` and a `handle`, resolve the target file under
 * `<cwd>/.pi/flows/invoicebot-state/blobs/` and REFUSE anything that escapes it.
 *
 * Two-stage containment (design D2):
 *   1. lexical — `resolve(root, handle)` must stay under `root` (defeats `..`
 *      segments and absolute-path handles, which `resolve` would otherwise honor).
 *   2. real-path — `realpathSync(target)` must stay under `realpathSync(root)`
 *      (defeats symlink escape).
 *
 * The engine emits handles shaped `blobs/<hash>_<basename>`; a single leading
 * `blobs/` (or `blobs\`) segment is stripped before resolution so both the full
 * handle and a bare basename work. See change: serve-invoice-original-blob.
 */
import { realpathSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

/** Outcome of {@link resolveBlobPath}. `abs` is a real, contained, regular-file path. */
export type BlobResolution =
  | { ok: true; abs: string }
  | { ok: false; reason: "invalid-input" | "traversal" | "not-found" };

/** True when `p` is `root` itself is NOT allowed — only strict descendants count. */
function isInside(root: string, p: string): boolean {
  return p.startsWith(root + sep);
}

/**
 * Resolve `handle` to a contained absolute file path under the workspace blob store.
 * Never throws; every failure maps to a typed `reason` (route maps to 400/403/404).
 */
export function resolveBlobPath(cwd: unknown, handle: unknown): BlobResolution {
  if (typeof cwd !== "string" || cwd.trim() === "" || cwd.includes("\0")) {
    return { ok: false, reason: "invalid-input" };
  }
  if (typeof handle !== "string" || handle.trim() === "" || handle.includes("\0")) {
    return { ok: false, reason: "invalid-input" };
  }

  const root = resolve(cwd, ".pi/flows/invoicebot-state/blobs");
  const rel = handle.replace(/^blobs[/\\]+/, "");
  const target = resolve(root, rel);

  // Stage 1 — lexical containment (catches `..` and absolute-path handles).
  if (!isInside(root, target)) return { ok: false, reason: "traversal" };

  // Stage 2 — real-path containment (catches symlink escape) + existence.
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (!isInside(realRoot, real)) return { ok: false, reason: "traversal" };

  try {
    if (!statSync(real).isFile()) return { ok: false, reason: "not-found" };
  } catch {
    return { ok: false, reason: "not-found" };
  }

  return { ok: true, abs: real };
}

/**
 * Build a header-safe `Content-Disposition` value for an inline blob response.
 *
 * HTTP header values are Latin-1, so interpolating a filename raw makes Node
 * reject the whole response with `ERR_INVALID_CHAR` (→ 500) the moment the name
 * carries a non-Latin-1 character such as `ő`. The filename is also untrusted
 * input, so it must never be able to inject a quote, a CR/LF or an extra header.
 *
 * Emits the RFC 6266 §4.3 pairing whenever sanitisation loses information:
 *   `inline; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded>`
 * — old clients read the sanitised fallback, modern clients prefer `filename*`
 * and recover the exact original name. A filename that is already header-safe
 * ASCII yields the plain `inline; filename="<name>"` form unchanged, so the
 * existing success contract for ordinary documents is byte-identical.
 *
 * The fallback is built by ALLOW-list (printable US-ASCII minus `"`, `\`, `/`),
 * because a missed deny-list entry would be header injection whereas a missed
 * allow-list entry is only an underscore. The result is ASCII by construction,
 * so it cannot re-introduce the defect. See change:
 * fix-blob-content-disposition-encoding.
 */
export function contentDispositionFor(filename: string): string {
  // Allow-list: printable US-ASCII except the quote, backslash and path
  // separator. Control chars (incl. CR/LF/TAB/NUL) and every non-ASCII byte are
  // outside the range and therefore replaced.
  let fallback = "";
  for (const ch of filename) {
    const code = ch.codePointAt(0) ?? 0;
    fallback += code >= 0x20 && code <= 0x7e && ch !== '"' && ch !== "\\" && ch !== "/" ? ch : "_";
  }
  // Never emit an empty parameter (a fully non-ASCII name sanitises to `___`,
  // but a genuinely empty input would produce `filename=""`).
  if (fallback.trim() === "") fallback = "document";

  // RFC 5987 `attr-char` is stricter than encodeURIComponent, which leaves
  // !'()* raw — percent-encode those five explicitly.
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  // Already header-safe ASCII: keep the plain, unchanged form.
  if (fallback === filename) return `inline; filename="${fallback}"`;

  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Map a filename/extension to a Content-Type; unknown → octet-stream (design D3). */
export function contentTypeFor(pathOrExt: string): string {
  switch (extname(pathOrExt).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
