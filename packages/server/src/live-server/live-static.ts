/**
 * Static-target serving for `/live/<id>/~c/<token>/<path>`.
 *
 * Every refusal is a bare 404 (a caller cannot tell "missing" from "forbidden").
 * The checks, in order, follow the `harden-path-matcher-vs-router` checklist:
 *
 *  1. the path is decoded exactly ONCE; a decoded segment that still carries an
 *     encoded `/`, `.` or `\` (double encoding), a NUL / control character, a
 *     backslash, an empty / `.` / `..` segment is refused;
 *  2. dot segments (`.git`, `.env`, …), `node_modules` and secret-like names
 *     (`isCredentialName`) are refused in every segment;
 *  3. only the web-asset allowlist (`isStaticWebAsset`) is served — no `.map`,
 *     no `.txt`, no databases;
 *  4. the REAL path (symlinks resolved) must lie inside the REAL root, and its
 *     own segments pass the same name checks — a symlink out of the root is a 404;
 *  5. the raw file-read gate (`gate`) is re-run on the real path for EVERY
 *     request, so a revoked grant or pin takes effect on the next request;
 *  6. the opened handle must be a regular file (checked on the handle itself).
 *
 * Streams from the file handle with single-`Range` support, never buffering a
 * file. See change: improve-canvas-html-and-url-ux (design D1, D2).
 */
import fs from "node:fs";
import path from "node:path";
import {
  isCredentialName,
  isStaticWebAsset,
  type StaticTarget,
} from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface StaticServeDeps {
  /** The raw file-read gate for an absolute real path under `cwd`. `true` = admitted. */
  gate: (cwd: string, absPath: string) => Promise<boolean>;
  /** Called with the real path of an HTML document about to be served in full (the origin scan reads it later). */
  onHtmlServed?: (realPath: string) => void;
}

const MIME: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

/** Content type for a served file name (`application/octet-stream` for the unreachable fallthrough). */
function mimeOf(name: string): string {
  const i = name.lastIndexOf(".");
  return (i >= 0 ? MIME[name.slice(i + 1).toLowerCase()] : undefined) ?? "application/octet-stream";
}

const CONTROL = /[\u0000-\u001f\u007f]/;
const DOUBLE_ENCODED = /%(?:2e|2f|5c|00)/i;

/** A single name that a static target must never serve (dot, dependency dir, credential-like). */
function isForbiddenName(name: string): boolean {
  if (name.startsWith(".")) return true;
  if (name.toLowerCase() === "node_modules") return true;
  return isCredentialName(name);
}

/** Is one DECODED request segment unsafe (empty, dot, backslash, control, double-encoded, drive-like)? */
function isUnsafeSegment(seg: string): boolean {
  if (seg === "" || seg === "." || seg === "..") return true;
  if (seg.includes("\\") || CONTROL.test(seg) || DOUBLE_ENCODED.test(seg)) return true;
  return process.platform === "win32" && seg.includes(":");
}

/**
 * Decode the request path once and split it into safe segments, or `null`.
 * `pathname` is the raw pathname after the capability prefix (leading `/`, no query).
 * A path ending in `/` (or the root) maps to `index.html`.
 */
export function safeSegments(pathname: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/")) return null;
  const trailingSlash = decoded.endsWith("/");
  const segments = decoded.slice(1).split("/");
  if (trailingSlash) segments.pop();
  if (segments.some(isUnsafeSegment)) return null;
  if (trailingSlash || segments.length === 0) segments.push("index.html");
  if (segments.some(isForbiddenName)) return null;
  return isStaticWebAsset(segments[segments.length - 1]) ? segments : null;
}

const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

type RangeResult = { kind: "full" } | { kind: "range"; start: number; end: number } | { kind: "unsatisfiable" };

/** Parse a single `bytes=` range; anything else (multi-range, bad syntax) serves the full body. */
function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header || size === 0) return { kind: "full" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: "full" };
  const [, a, b] = m;
  if (a === "" && b === "") return { kind: "full" };
  if (a === "") {
    const n = Number(b);
    if (n === 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isSafeInteger(start) || start >= size) return { kind: "unsatisfiable" };
  if (end < start) return { kind: "full" };
  return { kind: "range", start, end };
}

/**
 * Resolve the request to the REAL path of a servable file, or `null`: realpath containment
 * inside the real root, name checks on the resolved name, then the raw-read gate.
 */
async function locateFile(target: StaticTarget, segments: string[], deps: StaticServeDeps): Promise<string | null> {
  let realRoot: string;
  let real: string;
  try {
    realRoot = await fs.promises.realpath(target.root);
    real = await fs.promises.realpath(path.join(realRoot, ...segments));
  } catch {
    return null;
  }
  if (!isInside(real, realRoot)) return null;
  // The symlink-resolved name must be servable too (`ok.html -> .env` is not).
  const realSegments = path.relative(realRoot, real).split(path.sep);
  if (realSegments.some(isForbiddenName) || !isStaticWebAsset(realSegments[realSegments.length - 1])) return null;
  return (await deps.gate(target.cwd, real)) ? real : null;
}

/** Open `real` and verify, on the handle itself, that it is a regular file. */
async function openRegular(real: string): Promise<{ fh: fs.promises.FileHandle; size: number } | null> {
  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(real, "r");
  } catch {
    return null;
  }
  try {
    const st = await fh.stat();
    if (st.isFile()) return { fh, size: st.size };
  } catch {
    /* fall through to close */
  }
  await fh.close().catch(() => undefined);
  return null;
}

/** Tell the origin scan which HTML document is about to be served in full. */
function noteHtmlServed(deps: StaticServeDeps, method: string, real: string): void {
  if (method === "GET" && /\.html?$/i.test(real)) deps.onHtmlServed?.(real);
}

/**
 * Serve `rest` (the path + query after the capability prefix) from `target`.
 * `extraHeaders` carries the CSP set built from the token's policy.
 */
export async function serveStatic(
  request: FastifyRequest,
  reply: FastifyReply,
  target: StaticTarget,
  rest: string,
  extraHeaders: Record<string, string>,
  deps: StaticServeDeps,
): Promise<FastifyReply> {
  const notFound = () => reply.code(404).send({ error: "live-server target not found" });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply.code(405).header("allow", "GET, HEAD").send({ error: "method not allowed" });
  }
  const q = rest.search(/[?#]/);
  const segments = safeSegments(q >= 0 ? rest.slice(0, q) : rest);
  const real = segments ? await locateFile(target, segments, deps) : null;
  const opened = real ? await openRegular(real) : null;
  if (!real || !opened) return notFound();
  const { fh, size } = opened;
  noteHtmlServed(deps, request.method, real);

  const headers: Record<string, string> = {
    ...extraHeaders,
    "content-type": mimeOf(real),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "accept-ranges": "bytes",
  };
  const range = parseRange(request.headers.range, size);
  if (range.kind === "unsatisfiable") {
    await fh.close();
    return reply.code(416).headers({ ...headers, "content-range": `bytes */${size}` }).send();
  }
  const start = range.kind === "range" ? range.start : 0;
  const end = range.kind === "range" ? range.end : size - 1;
  headers["content-length"] = String(size === 0 ? 0 : end - start + 1);
  if (range.kind === "range") headers["content-range"] = `bytes ${start}-${end}/${size}`;
  reply.code(range.kind === "range" ? 206 : 200).headers(headers);
  if (request.method === "HEAD" || size === 0) {
    await fh.close();
    return reply.send();
  }
  // The stream owns the handle and closes it on end / error / client abort.
  return reply.send(fh.createReadStream({ start, end, autoClose: true }));
}
