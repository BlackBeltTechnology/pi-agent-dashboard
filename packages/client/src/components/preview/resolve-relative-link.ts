/**
 * Browser-safe resolution of a RELATIVE markdown anchor `href` into a file mention (change: rich-chat-links, D7).
 *
 * A relative href has no scheme and does not start with `#`, `/` or `//`. It is percent-decoded, its query dropped,
 * `#L<n>` read as the line and any other fragment ignored. It is joined with the base — the previewed document's
 * directory (`ImageBase.dir`, cwd-relative or absolute) in a file preview, else the chat session cwd — and expressed
 * as a cwd-relative mention, or an absolute one when it falls outside the cwd. Containment is NOT decided here: the
 * mention goes through `context.fileLink`, i.e. the same resolver + grant gate as any typed mention.
 * POSIX only (no `node:path` in client code).
 */
import { collapse, type ImageBase } from "./resolve-local-image-src.js";

export interface RelativeMention {
  path: string;
  line?: number;
  absolute: boolean;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const UNSAFE = /[\\\u0000-\u001f]/; // a backslash or a control character
const LINE_FRAGMENT = /^L(\d+)(?:-L?\d+)?$/;

/** True for an href that is a relative path (not a fragment, root-relative, protocol-relative or any scheme). */
export function isRelativeHref(href: string): boolean {
  return href !== "" && !href.startsWith("#") && !href.startsWith("/") && !SCHEME.test(href);
}

/** The decoded path (query dropped) and the fragment of a relative href; `null` when undecodable or empty/unsafe. */
function splitHref(href: string): { path: string; fragment: string } | null {
  const hashAt = href.indexOf("#");
  const fragment = hashAt === -1 ? "" : href.slice(hashAt + 1);
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const rawPath = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  try {
    const path = decodeURIComponent(rawPath);
    return path && !UNSAFE.test(path) ? { path, fragment } : null;
  } catch {
    return null;
  }
}

/** `path` joined onto the base directory; a result that climbs out of the cwd is made absolute. */
function joinOnBase(path: string, base: ImageBase): string {
  const cwd = base.cwd.replace(/\/+$/, "");
  const joined = collapse(base.dir ? `${base.dir}/${path}` : path);
  const escapes = joined === ".." || joined.startsWith("../");
  return cwd && escapes ? collapse(`${cwd}/${joined}`) : joined;
}

/**
 * Resolve `href` against `base` (`cwd` + optional document `dir`); `null` when it is not a relative path, cannot be
 * decoded, or has no path left (e.g. `?x=1`).
 */
export function resolveRelativeMention(href: string, base: ImageBase): RelativeMention | null {
  if (!isRelativeHref(href)) return null;
  const parts = splitHref(href);
  if (!parts) return null;
  const resolved = joinOnBase(parts.path, base);
  if (!resolved || resolved === "/") return null;
  const lineMatch = LINE_FRAGMENT.exec(parts.fragment);
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  const cwd = base.cwd.replace(/\/+$/, "");
  if (!resolved.startsWith("/")) return { path: resolved, line, absolute: false };
  if (cwd && resolved.startsWith(`${cwd}/`)) return { path: resolved.slice(cwd.length + 1), line, absolute: false };
  return { path: resolved, line, absolute: true };
}
