/**
 * Browser-safe resolution of a LOCAL markdown image `src` to a `/api/file/raw`
 * URL, for on-disk markdown preview surfaces that supply an `imageBase`.
 *
 * Returns `null` for any non-local src (URI scheme, protocol-relative `//`,
 * fragment `#`) so the caller falls through to a verbatim `<img>`. No
 * `node:path` — the repo forbids it in client code; resolution is POSIX and
 * browser-safe. Server `/api/file/raw` containment is the traversal defense,
 * NOT this helper (a `../`-escaping src still returns a rawUrl → server 403s).
 *
 * See change: fix-markdown-preview-relative-images.
 */
import { rawUrl } from "./raw-url.js";

export interface ImageBase {
  cwd: string;
  dir: string;
}

/** POSIX dirname: everything before the last "/". `""` for a bare filename. */
export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Collapse "." and ".." segments over "/" (POSIX, browser-safe). */
function collapse(path: string): string {
  const isAbs = path.startsWith("/");
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbs) out.push("..");
      // absolute path: a leading ".." cannot climb above root → drop it.
    } else {
      out.push(seg);
    }
  }
  return (isAbs ? "/" : "") + out.join("/");
}

export function resolveLocalImageSrc(src: string, imageBase: ImageBase): string | null {
  if (!src) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null; // URI scheme (http:, data:, blob:, pi-asset:, file:, cid:, mailto:, C:)
  if (src.startsWith("//")) return null; // protocol-relative
  if (src.startsWith("#")) return null; // fragment
  // Relative → join dir + src (collapse dedupes any doubled "/"); POSIX-absolute
  // (`/…`) is used verbatim (only "."/".." collapsed), never re-joined to dir.
  const resolved = src.startsWith("/") ? collapse(src) : collapse(`${imageBase.dir}/${src}`);
  return rawUrl({ kind: "file", cwd: imageBase.cwd, path: resolved });
}
