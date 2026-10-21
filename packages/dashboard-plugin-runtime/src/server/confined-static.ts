/**
 * Realpath-confined static-file helpers shared by `ctx.serveApp` (`app-mount.ts`) and the
 * runtime-client asset registry (content hash + `/plugin-assets`): extension allowlist,
 * realpath containment, `.gz` variant negotiation, request-path segment parsing.
 *
 * Extracted from `app-mount.ts` with no behaviour change.
 *
 * See change: decouple-plugins-from-core (task 6.8, design D13).
 */
import fs from "node:fs";
import path from "node:path";

/** Extension allowlist → content type. Everything else (`.json`, `.map`, `.gz`, …) is refused. */
export const STATIC_MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/**
 * Extensions a runtime plugin client asset root may serve (design D13): code, styles, fonts, images.
 * Narrower than `STATIC_MIME`: no `.html`, no `.wasm`; never `.map` / `.json`.
 */
export const PLUGIN_ASSET_MIME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(STATIC_MIME).filter(([ext]) => ext !== ".html" && ext !== ".wasm"),
);

export function isWithin(child: string, root: string): boolean {
  return child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** `realpath` of the deepest existing ancestor + the not-yet-existing tail (a `dir` may be absent). */
export function canonicalize(p: string): string {
  const abs = path.resolve(p);
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

export function acceptsGzip(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;
  return value.split(",").some((part) => {
    const [name, ...params] = part.trim().split(";");
    if (name.trim().toLowerCase() !== "gzip") return false;
    const q = params.map((s) => s.trim()).find((s) => s.startsWith("q="));
    return q === undefined || Number.parseFloat(q.slice(2)) > 0;
  });
}

export function realFileWithin(file: string, root: string): { real: string; size: number } | null {
  try {
    const real = fs.realpathSync(file);
    if (!isWithin(real, root)) return null;
    const st = fs.statSync(real);
    return st.isFile() ? { real, size: st.size } : null;
  } catch {
    return null;
  }
}

/**
 * Decoded path segments under `prefix`, or null when the request must be refused (NUL, `\\`, bad escape,
 * dotfile / `..`, extension outside `allow`).
 */
export function parseSegments(
  rawPath: string,
  prefix: string,
  allow: Readonly<Record<string, string>> = STATIC_MIME,
): string[] | null {
  if (!rawPath.startsWith(`${prefix}/`)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath.slice(prefix.length + 1));
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter((s) => s !== "");
  // Dotfiles and any `.`/`..` segment: never served, never resolved.
  if (segments.some((s) => s.startsWith("."))) return null;
  const ext = path.extname(segments[segments.length - 1] ?? "").toLowerCase();
  if (ext && !allow[ext]) return null;
  return segments;
}

/** The file variant to send: the `.gz` sibling for a gzip client, else the plain file. `null` → not servable. */
export function pickVariant(
  real: string,
  root: string,
  acceptEncoding: string | string[] | undefined,
): { file: { real: string; size: number }; gzipped: boolean; hasVariant: boolean } | null {
  const plain = realFileWithin(real, root);
  if (!plain) return null;
  const gz = realFileWithin(`${real}.gz`, root);
  if (gz && acceptsGzip(acceptEncoding)) return { file: gz, gzipped: true, hasVariant: true };
  return { file: plain, gzipped: false, hasVariant: gz !== null };
}
