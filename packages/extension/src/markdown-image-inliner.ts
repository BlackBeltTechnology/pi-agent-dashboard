/**
 * Markdown image inliner for the bridge.
 *
 * Scans assistant message text for fully-closed `![alt](src)` markdown image
 * tokens, reads any local-path file references, hashes the bytes, and
 * rewrites the token to `![alt](pi-asset:<hash>)`. Bytes ride out of band
 * via `asset_register` events (one per unique hash per session). The text
 * itself only ever carries the short `pi-asset:<hash>` token, keeping
 * streaming `message_update` events bandwidth-bounded.
 *
 * The core helper `inlineMessageText` is **pure** — all I/O is delegated to
 * the injected `readFile` callback so tests can drive every branch with
 * memory fixtures. The bridge wires `readFile = node:fs.readFileSync` plus
 * a per-session `alreadyEmitted: Set<string>` of hashes already shipped.
 *
 * See change: chat-markdown-local-images-and-math.
 */
import { createHash } from "node:crypto";
import path from "node:path";

/** Per-image hard cap (decision D8). */
export const MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024;
/** Per-message cumulative cap on **newly-inlined** asset bytes (decision D8). */
export const MAX_PER_MESSAGE_BYTES = 20 * 1024 * 1024;

/** MIME allowlist keyed by lowercased extension. Decision D8. */
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
};

/** Matches a fully-closed `![alt](src)` markdown image token. */
const IMAGE_TOKEN_RE = /!\[([^\]\n]*)\]\(([^)\n\s]+)\)/g;

export interface ParsedImageToken {
  /** The full original `![alt](src)` substring. */
  token: string;
  alt: string;
  src: string;
  /** Start offset within the input text. */
  index: number;
  length: number;
}

/**
 * Find every fully-closed `![alt](src)` token in `text`. Partial tokens
 * (e.g. `![alt](/path/x` without closing `)`) are NOT returned — the
 * regex requires the closing paren. Tokens spanning newlines are NOT
 * returned (markdown doesn't allow newlines inside the URL portion).
 */
export function parseImageTokens(text: string): ParsedImageToken[] {
  const out: ParsedImageToken[] = [];
  let match: RegExpExecArray | null;
  IMAGE_TOKEN_RE.lastIndex = 0;
  while ((match = IMAGE_TOKEN_RE.exec(text)) !== null) {
    out.push({
      token: match[0],
      alt: match[1] ?? "",
      src: match[2] ?? "",
      index: match.index,
      length: match[0].length,
    });
  }
  return out;
}

/**
 * Returns true iff `src` looks like a local filesystem path (i.e. NOT an
 * already-resolved web URL, data URL, blob URL, fragment, or pre-rewritten
 * `pi-asset:<hash>` token). Idempotency hinges on `pi-asset:` returning
 * `false` here.
 */
export function isLocalSrc(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:")) return false;
  if (src.startsWith("blob:")) return false;
  if (src.startsWith("http://")) return false;
  if (src.startsWith("https://")) return false;
  if (src.startsWith("pi-asset:")) return false;
  if (src.startsWith("#")) return false;
  // `file://` prefix — treat the rest as a local path.
  return true;
}

/**
 * Resolve `src` to an absolute path against `cwd`. `file://` prefix is
 * stripped. Absolute paths pass through. Relative paths resolve against
 * `cwd`.
 */
export function resolveLocalPath(src: string, cwd: string): string {
  let raw = src;
  if (raw.startsWith("file://")) raw = raw.slice("file://".length);
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(cwd, raw);
}

/**
 * Detect MIME from the file extension (case-insensitive). Returns null
 * if the extension is not in the image allowlist.
 */
export function mimeFromExtension(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

/**
 * Hash file bytes to a 16-hex-char identifier (sha256 truncated). Decision D4.
 */
export function hashBytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

/** Format a byte count to a one-decimal MB string for placeholder text. */
function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Bridge-side per-file read result; thin enough to mock in tests. */
export interface ReadFileResult {
  ok: true;
  bytes: Buffer;
}
export interface ReadFileError {
  ok: false;
  /**
   * ENOENT/EACCES/EISDIR/EOTHER come from the `readFile` callback. EACCES is
   * folded into ENOENT in placeholder text. NOT_IMAGE / TOO_LARGE are emitted
   * by `inlineLocalImagePath` after a successful read (unsupported extension /
   * over the per-image byte cap). See change: inline-agent-screenshot-artifacts.
   */
  kind: "ENOENT" | "EACCES" | "EISDIR" | "EOTHER" | "NOT_IMAGE" | "TOO_LARGE";
}
export type ReadFileOutcome = ReadFileResult | ReadFileError;

export interface InlineOptions {
  /** Synchronous file-read callback. Bridge wires this to `node:fs.readFileSync` + `fs.statSync`. */
  readFile: (absolutePath: string) => ReadFileOutcome;
  /** Working directory used to resolve relative srcs. */
  cwd: string;
  /**
   * Per-session set of hashes for which an `asset_register` has already been
   * emitted. The inliner checks-then-adds so dedup is automatic across
   * multiple message events within the same session.
   */
  alreadyEmitted: Set<string>;
  /** Override the per-image cap. Default `MAX_PER_IMAGE_BYTES`. */
  maxPerImageBytes?: number;
  /** Override the per-message cap. Default `MAX_PER_MESSAGE_BYTES`. */
  maxPerMessageBytes?: number;
}

export interface AssetToEmit {
  hash: string;
  mimeType: string;
  /** Base64-encoded bytes ready for the `asset_register` message. */
  data: string;
}

/** Options for the single-path inliner. */
export interface InlineLocalImageOptions {
  /** Synchronous file-read callback (same shape as `InlineOptions.readFile`). */
  readFile: (absolutePath: string) => ReadFileOutcome;
  /** Override the per-image cap. Default `MAX_PER_IMAGE_BYTES`. */
  maxPerImageBytes?: number;
}

/**
 * Inline a single local image path to an `AssetToEmit` (base64 + mime + hash).
 * Pure: all I/O goes through `opts.readFile`. Returns a `ReadFileError` when
 * the file is missing / unreadable (`ENOENT`/`EACCES`/`EISDIR`/`EOTHER` from
 * the callback), is not a recognized image extension (`NOT_IMAGE`), or exceeds
 * the per-image byte cap (`TOO_LARGE`). Discriminate the union on the `ok`
 * field: a success has no `ok`, a failure has `ok: false`.
 *
 * Distinct from `inlineMessageText`: no `alreadyEmitted` dedup, no per-message
 * budget, no placeholder rewriting — single path in, asset-or-error out. Used
 * by the bridge to inline path-referenced image tool results at
 * `tool_execution_end`. See change: inline-agent-screenshot-artifacts.
 */
export function inlineLocalImagePath(
  absPath: string,
  opts: InlineLocalImageOptions,
): AssetToEmit | ReadFileError {
  const outcome = opts.readFile(absPath);
  if (!outcome.ok) return outcome;
  const mime = mimeFromExtension(absPath);
  if (!mime) return { ok: false, kind: "NOT_IMAGE" };
  const maxPerImage = opts.maxPerImageBytes ?? MAX_PER_IMAGE_BYTES;
  if (outcome.bytes.length > maxPerImage) return { ok: false, kind: "TOO_LARGE" };
  return {
    hash: hashBytes(outcome.bytes),
    mimeType: mime,
    data: outcome.bytes.toString("base64"),
  };
}

export interface InlineResult {
  /** The rewritten text with every applicable token replaced. */
  rewritten: string;
  /** Newly-discovered assets to emit BEFORE the message_update / message_end. */
  assetsToEmit: AssetToEmit[];
}

/**
 * Pure inliner. Scans `text` for image tokens; rewrites local-path tokens
 * either to `![alt](pi-asset:<hash>)` (success) or to a visible placeholder
 * text (file too large / unsupported MIME / read error / message budget
 * exhausted). Tokens with web/data/blob/pi-asset/# srcs pass through
 * unchanged. Idempotent — re-running on already-rewritten text yields the
 * same output (because `pi-asset:` returns `false` from `isLocalSrc`).
 */
export function inlineMessageText(text: string, opts: InlineOptions): InlineResult {
  const tokens = parseImageTokens(text);
  if (tokens.length === 0) {
    return { rewritten: text, assetsToEmit: [] };
  }

  const maxPerImage = opts.maxPerImageBytes ?? MAX_PER_IMAGE_BYTES;
  const maxPerMessage = opts.maxPerMessageBytes ?? MAX_PER_MESSAGE_BYTES;

  const assetsToEmit: AssetToEmit[] = [];
  let bytesInThisMessage = 0;

  // Build the rewritten string by stitching segments separated by token
  // replacements. Walk tokens left-to-right; tokens that pass through
  // unchanged keep their original substring.
  const out: string[] = [];
  let cursor = 0;

  for (const tok of tokens) {
    // Append the segment before this token verbatim.
    out.push(text.slice(cursor, tok.index));
    cursor = tok.index + tok.length;

    if (!isLocalSrc(tok.src)) {
      // External / data: / pi-asset: / fragment — pass through unchanged.
      out.push(tok.token);
      continue;
    }

    const absPath = resolveLocalPath(tok.src, opts.cwd);

    // Order matters here:
    //   1. readFile FIRST so EISDIR / ENOENT / EACCES are reported with
    //      their proper placeholders even when the path has no extension
    //      (e.g. `/home/me` resolving to a directory).
    //   2. mimeFromExtension after a successful read so an existing file
    //      with a non-image extension reports "unsupported image type"
    //      rather than a generic read failure.
    //   3. hashBytes so we can consult `alreadyEmitted` BEFORE the
    //      per-image and per-message caps. Already-registered assets bypass
    //      caps because their bytes were paid for on the previous emission.
    //   4. Per-image cap and per-message budget gate ONLY new emissions.
    const outcome = opts.readFile(absPath);
    if (!outcome.ok) {
      // EACCES is folded into ENOENT placeholder to avoid leaking permission
      // existence. EISDIR / EOTHER use the generic "read failed" wording.
      if (outcome.kind === "ENOENT" || outcome.kind === "EACCES") {
        out.push(`[image not found: ${tok.src}]`);
      } else {
        out.push(`[image read failed: ${tok.src}]`);
      }
      continue;
    }

    const mime = mimeFromExtension(absPath);
    if (!mime) {
      out.push(`[unsupported image type: ${tok.src}]`);
      continue;
    }

    const hash = hashBytes(outcome.bytes);

    if (opts.alreadyEmitted.has(hash)) {
      // Bytes already shipped earlier in the session — only the token rewrites.
      // Caps are bypassed: dedup means no new bytes go on the wire.
      out.push(`![${tok.alt}](pi-asset:${hash})`);
      continue;
    }

    const size = outcome.bytes.length;
    if (size > maxPerImage) {
      out.push(`[image too large: ${tok.src} (${formatMB(size)} MB)]`);
      continue;
    }

    // New asset. Check the per-message budget before committing.
    if (bytesInThisMessage + size > maxPerMessage) {
      out.push(`[message asset budget exhausted: ${tok.src}]`);
      continue;
    }

    bytesInThisMessage += size;
    opts.alreadyEmitted.add(hash);
    assetsToEmit.push({
      hash,
      mimeType: mime,
      data: outcome.bytes.toString("base64"),
    });
    out.push(`![${tok.alt}](pi-asset:${hash})`);
  }

  out.push(text.slice(cursor));
  return { rewritten: out.join(""), assetsToEmit };
}
