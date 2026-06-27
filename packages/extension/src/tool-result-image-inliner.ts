/**
 * Tool-result image inliner for the bridge (Fix B).
 *
 * At `tool_execution_end`, a CLI tool (e.g. the `browser` skill's `screenshot`
 * command run via `bash`) surfaces its output as a TEXT result that references
 * a saved image by absolute path — e.g. `Screenshot saved: /…/shot.png`. The
 * dashboard linkifies that path; clicking it 403s for an out-of-repo artifact.
 *
 * This module detects absolute paths to existing local image files in a tool
 * result and inlines their bytes as `type:"image"` content blocks — the same
 * shape the `Read`-tool inline path already produces and the client already
 * renders. The consumed path is stripped from the text so the dashboard shows
 * exactly one inline image (not an image plus a dead link). Over-cap /
 * non-existent / non-image paths are left as text and fall back to the
 * artifact-serving route (Fix A).
 *
 * Pure: all I/O goes through the injected `readFile` callback (same one the
 * markdown inliner uses), so tests drive every branch with memory fixtures.
 *
 * See change: inline-agent-screenshot-artifacts.
 */
import path from "node:path";
import {
  inlineLocalImagePath,
  MAX_PER_IMAGE_BYTES,
  MAX_PER_MESSAGE_BYTES,
  type ReadFileOutcome,
} from "./markdown-image-inliner.js";

/** Default cap on images inlined per tool result (decision D2). */
export const MAX_IMAGES_PER_RESULT = 4;

/** Recognized image extensions (matches the inliner's MIME allowlist). */
const IMAGE_EXT = "png|jpe?g|gif|webp|svg|avif|bmp";

/**
 * Matches an absolute path ending in a recognized image extension.
 * POSIX: `/…/name.png`. Windows: `C:\…\name.png` or `C:/…/name.png`.
 * Path runs stop at whitespace — screenshot artifact paths have no spaces.
 */
const ABS_IMAGE_PATH_RE = new RegExp(
  `(?:[A-Za-z]:[\\\\/]|/)[^\\s)"']+\\.(?:${IMAGE_EXT})`,
  "gi",
);

/** An inlined image content block (same shape the client reducer extracts). */
export interface ImageContentBlock {
  type: "image";
  data: string;
  mimeType: string;
}

export interface InlineToolResultImagesOptions {
  /** Synchronous file-read callback (same shape as the markdown inliner). */
  readFile: (absolutePath: string) => ReadFileOutcome;
  /** Override the per-image cap. Default `MAX_PER_IMAGE_BYTES`. */
  maxPerImageBytes?: number;
  /** Override the per-result cumulative cap. Default `MAX_PER_MESSAGE_BYTES`. */
  maxPerMessageBytes?: number;
  /** Override the per-result image-count cap. Default `MAX_IMAGES_PER_RESULT`. */
  maxImagesPerResult?: number;
  /**
   * Containment gate. When provided, a candidate path is inlined only if this
   * predicate returns true (the bridge wires it to the artifact-root allowlist
   * so arbitrary tool-echoed paths are NOT read/inlined). Disallowed paths are
   * left as text → artifact-serving fallback. When omitted, no path restriction.
   */
  isAllowedPath?: (absPath: string) => boolean;
}

export interface InlineToolResultImagesResult {
  /**
   * Rewritten result. When at least one image is inlined, this is a
   * content-block array `[{type:"text",text}, {type:"image",…}, …]`. When
   * nothing is inlined, the original `result` is returned unchanged.
   */
  result: unknown;
  /** Number of images inlined. */
  inlinedCount: number;
}

/** Decoded byte length of a base64 string, accounting for `=` padding. */
function base64DecodedBytes(b64: string): number {
  if (b64.length === 0) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Extract a single display string from a tool result (string or content array). */
function resultToText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const content = (result as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      return content
        .filter((c: any) => c?.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text as string)
        .join("\n");
    }
  }
  return "";
}

/**
 * Scan a tool result for absolute image paths that resolve to existing files
 * and inline them as `type:"image"` content blocks. Returns the (possibly
 * rewritten) result and the number of images inlined.
 */
export function inlineToolResultImages(
  result: unknown,
  opts: InlineToolResultImagesOptions,
): InlineToolResultImagesResult {
  const text = resultToText(result);
  if (!text) return { result, inlinedCount: 0 };

  const maxImages = opts.maxImagesPerResult ?? MAX_IMAGES_PER_RESULT;
  const maxPerMessage = opts.maxPerMessageBytes ?? MAX_PER_MESSAGE_BYTES;

  // Collect unique absolute image-path candidates in first-seen order.
  const candidates: string[] = [];
  const seen = new Set<string>();
  ABS_IMAGE_PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ABS_IMAGE_PATH_RE.exec(text)) !== null) {
    const p = m[0];
    if (!path.isAbsolute(p) || seen.has(p)) continue;
    seen.add(p);
    candidates.push(p);
  }
  if (candidates.length === 0) return { result, inlinedCount: 0 };

  const blocks: ImageContentBlock[] = [];
  const consumedPaths: string[] = [];
  let bytesInThisResult = 0;

  for (const absPath of candidates) {
    if (blocks.length >= maxImages) break;
    // Containment gate BEFORE any disk read: skip paths outside the allowlist.
    if (opts.isAllowedPath && !opts.isAllowedPath(absPath)) continue;
    const outcome = inlineLocalImagePath(absPath, {
      readFile: opts.readFile,
      maxPerImageBytes: opts.maxPerImageBytes,
    });
    if ("ok" in outcome) continue; // ReadFileError: missing / non-image / too-large → leave as text
    // Per-result cumulative budget (padding-aware decoded byte count).
    const size = base64DecodedBytes(outcome.data);
    if (bytesInThisResult + size > maxPerMessage) continue; // over budget → leave as text
    bytesInThisResult += size;
    blocks.push({ type: "image", data: outcome.data, mimeType: outcome.mimeType });
    consumedPaths.push(absPath);
  }

  if (blocks.length === 0) return { result, inlinedCount: 0 };

  // Strip each consumed path so it is NOT also linkified (D5).
  const stripPaths = (s: string): string => {
    let out = s;
    for (const p of consumedPaths) out = out.split(p).join("");
    return out;
  };

  // Preserve the original result shape: when it already carried a content
  // array, keep every block (incl. non-text / metadata) and only strip paths
  // inside text blocks, then append the new image blocks. A bare string result
  // becomes a single stripped text block plus the images.
  let content: unknown[];
  if (result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).content)) {
    const orig = (result as Record<string, unknown>).content as any[];
    content = [
      ...orig.map((c) =>
        c?.type === "text" && typeof c.text === "string" ? { ...c, text: stripPaths(c.text) } : c,
      ),
      ...blocks,
    ];
  } else {
    content = [{ type: "text", text: stripPaths(text) }, ...blocks];
  }

  return {
    result: { content },
    inlinedCount: blocks.length,
  };
}
