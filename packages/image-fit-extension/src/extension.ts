/**
 * pi-image-fit extension entry point.
 *
 * Registers a single `tool_call` hook that, when the agent reads an
 * image whose byte size or long edge exceeds the configured limits,
 * re-encodes the image to a smaller temp file and rewrites
 * `event.input.path` so the built-in Read attaches the resized bytes.
 *
 * All work is wrapped in try/catch with fall-through: any failure
 * leaves `event.input.path` unmodified and logs a single warning.
 *
 * Spec: pi-image-fit/spec.md (all requirements).
 * Design: design.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type CacheScope,
  ContentCache,
  cacheKey,
  cleanupOrphans,
  cleanupSession,
  ensureDir,
  hasCached,
  scopeFor,
} from "./cache.js";
import { type ImageFitConfig, readConfigFromEnv } from "./policy.js";
// Namespace import so tests can `vi.spyOn(resize, "resizeBuffer")` on the
// `context`-seam path (ESM named imports are read-only live bindings).
import * as resize from "./resize.js";
import {
  isImagePath,
  needsResize,
  outputFormatFor,
  probeDims,
  resizeToFile,
} from "./resize.js";

export default function imageFitExtension(pi: ExtensionAPI): void {
  const config: ImageFitConfig = readConfigFromEnv();

  if (config.disabled) {
    console.log("[pi-image-fit] disabled via PI_IMAGE_FIT_DISABLE");
    return;
  }

  // Best-effort orphan sweep on load. Errors swallowed-and-logged
  // internally. Fire-and-forget — we do not block extension load on it.
  cleanupOrphans().catch(() => {
    /* already logged by cleanupOrphans */
  });

  // Second interception seam: fit oversize ImageContent of any origin
  // (tool_result / user-pasted / historical) before each LLM call. Runs
  // every turn, so it is reload-safe (rescues already-persisted oversize
  // sessions) but must stay cheap — the cheap-probe gate + content-hash
  // cache keep the steady state to a header parse / hash + map lookup.
  const contentCache = new ContentCache();
  pi.on("context", async (event) => {
    try {
      // event.messages is pi's deep copy (safe to mutate in place); the same
      // reference is returned when any block changed. The cast bridges pi's
      // AgentMessage[] and our structural MessageLike[] view.
      const patched = await fitContextMessages(event.messages as MessageLike[], config, contentCache);
      return patched ? { messages: patched as unknown as typeof event.messages } : undefined;
    } catch (err) {
      // Last-resort catch — per-block failures are already isolated and
      // logged inside fitContextMessages; reaching here means something
      // above the block loop threw. Fail open: leave messages unmodified.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[pi-image-fit] WARN context handler error: ${msg}`);
      return undefined;
    }
  });

  // Session scope is established lazily: the first tool_call we see
  // pulls sessionId from ctx.sessionManager (if available) or falls
  // back to `pid-<process.pid>`. We cache the scope per session id so
  // that mid-session changes (resume into a different session) get a
  // fresh dir.
  let cachedScope: { sessionId: string; scope: CacheScope } | null = null;

  function getScopeFor(ctx: unknown): CacheScope {
    const sessionId = readSessionIdFromCtx(ctx);
    if (!cachedScope || cachedScope.sessionId !== sessionId) {
      cachedScope = { sessionId, scope: scopeFor(sessionId) };
    }
    return cachedScope.scope;
  }

  pi.on("tool_call", async (event, ctx) => {
    // Fast-path gates. None of these touch the filesystem.
    if (event.toolName !== "read") return;
    const srcPath = event.input?.path;
    if (typeof srcPath !== "string" || srcPath.length === 0) return;
    if (!isImagePath(srcPath)) return;

    try {
      await maybeResize(srcPath, event, ctx, config, getScopeFor);
    } catch (err) {
      // Last-resort catch — every internal step already logs its own
      // warning, but a thrown error here means we missed one. Log and
      // fall through; event.input.path is whatever the deepest mutation
      // left it (callee responsibility to restore on partial failure).
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[pi-image-fit] WARN unexpected error for ${srcPath}: ${msg}`);
    }
  });

  pi.on("session_shutdown", async () => {
    if (cachedScope) {
      await cleanupSession(cachedScope.scope);
      cachedScope = null;
    }
  });
}

/**
 * Core resize pipeline. Mutates `event.input.path` on success;
 * leaves it untouched on any failure (logs once and returns).
 */
async function maybeResize(
  srcPath: string,
  event: { input: { path: string } },
  ctx: unknown,
  config: ImageFitConfig,
  getScopeFor: (ctx: unknown) => CacheScope,
): Promise<void> {
  // Stat: get bytes + mtime. ENOENT and friends → fall through to
  // built-in Read which produces the appropriate user-facing error.
  let bytes: number;
  let mtimeMs: number;
  try {
    const st = await fs.stat(srcPath);
    if (!st.isFile()) return;
    bytes = st.size;
    mtimeMs = st.mtimeMs;
  } catch (err) {
    // Source file missing or unreadable — let built-in Read handle the error.
    // No warning: this is pi's normal Read-error path, not an extension fault.
    void err;
    return;
  }

  // Byte-size short-circuit: if the source is already under the byte
  // ceiling AND the (presumed) long edge cannot exceed maxEdge without
  // a dimension probe, we'd still need to probe. Probe once and decide.
  const dims = await probeDims(srcPath);
  if (!dims) {
    // Jimp couldn't decode — likely corrupted or unsupported variant.
    // Fall through to built-in Read which will surface the file as-is.
    console.warn(`[pi-image-fit] WARN could not decode ${srcPath}; passing through original`);
    return;
  }

  if (!needsResize({ bytes, maxBytes: config.maxBytes, dims, maxEdge: config.maxEdge })) {
    // Already-small image — pass through untouched. No log line.
    return;
  }

  // Resize is needed. Compute cache key + output path.
  const { ext: outExt } = outputFormatFor(srcPath);
  const absPath = path.resolve(srcPath);
  const key = cacheKey({
    absPath,
    mtimeMs,
    maxEdge: config.maxEdge,
    maxBytes: config.maxBytes,
    quality: config.quality,
  });
  const scope = getScopeFor(ctx);
  const dstPath = scope.filePath(key, outExt);

  // Cache hit: rewrite path, no work.
  if (await hasCached(scope, key, outExt)) {
    event.input.path = dstPath;
    return;
  }

  // Cache miss: ensure dir, resize, rewrite path, log once.
  try {
    await ensureDir(scope.dir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[pi-image-fit] WARN could not create cache dir ${scope.dir}: ${msg}; passing through original`);
    return;
  }

  try {
    const result = await resizeToFile(srcPath, dstPath, {
      maxEdge: config.maxEdge,
      quality: config.quality,
    });
    event.input.path = dstPath;
    console.log(
      `[pi-image-fit] ${srcPath} ${result.srcDims.width}\u00d7${result.srcDims.height} ${formatBytes(bytes)} \u2192 ${result.dstDims.width}\u00d7${result.dstDims.height} ${formatBytes(result.dstBytes)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Defensive cleanup: a partial write would leave a corrupt file
    // matching the cache key, poisoning later reads. Best-effort unlink.
    try {
      await fs.unlink(dstPath);
    } catch {
      /* ignore */
    }
    console.warn(`[pi-image-fit] WARN resize failed for ${srcPath}: ${msg}; passing through original`);
    // event.input.path was not mutated yet — original path stands.
  }
}

/** Minimal structural view of a message block we care about. */
interface ImageBlockLike {
  type: string;
  data: string;
  mimeType: string;
}

/** Minimal structural view of a message carrying content blocks. */
interface MessageLike {
  content?: unknown;
}

/**
 * Role-agnostic `context`-seam core: walk every message's content blocks,
 * fit each oversize `image` block in place, and return the (mutated) message
 * list only when at least one block changed — otherwise `undefined` so pi keeps
 * the original list. Each block is isolated in its own try/catch (fail-open,
 * single WARN per failed block) so one bad image never blocks its siblings.
 *
 * Exported for unit tests (spy on `resize.*` / `ContentCache.prototype.*`).
 * Design: D4 (cheap-probe gate), D5 (role-agnostic traversal), D6 (fail-open).
 */
export async function fitContextMessages(
  messages: readonly MessageLike[],
  config: ImageFitConfig,
  cache: ContentCache,
): Promise<MessageLike[] | undefined> {
  let changed = false;
  for (const message of messages) {
    const content = message?.content;
    // A UserMessage.content may be a plain string (no image) — skip it.
    if (!Array.isArray(content)) continue;
    if (await fitContentBlocks(content, config, cache)) changed = true;
  }
  return changed ? (messages as MessageLike[]) : undefined;
}

/**
 * Fit every oversize image block in one message's content array (in place).
 * Returns true if any block changed. Each block is isolated in its own
 * try/catch so one bad image never blocks its siblings (fail-open, D6).
 */
async function fitContentBlocks(
  content: unknown[],
  config: ImageFitConfig,
  cache: ContentCache,
): Promise<boolean> {
  let changed = false;
  for (const block of content) {
    if (!isImageBlock(block)) continue;
    try {
      const fitted = await fitImageBlock(block, config, cache);
      if (fitted) {
        block.data = fitted.data;
        block.mimeType = fitted.mimeType;
        changed = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[pi-image-fit] WARN could not fit image block (${block.mimeType}): ${msg}`);
    }
  }
  return changed;
}

function isImageBlock(block: unknown): block is ImageBlockLike {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "image" &&
    typeof (block as { data?: unknown }).data === "string" &&
    typeof (block as { mimeType?: unknown }).mimeType === "string"
  );
}

/**
 * Fit a single oversize image block. Returns the replacement
 * `{ data, mimeType }` on resize (or cache hit), or `null` when the block is
 * already within limits (the steady-state path — no hash, no jimp decode).
 * Throws only on an undecodable oversize block (caller logs one WARN).
 */
async function fitImageBlock(
  block: ImageBlockLike,
  config: ImageFitConfig,
  cache: ContentCache,
): Promise<{ data: string; mimeType: string } | null> {
  const buf = Buffer.from(block.data, "base64");
  const bytes = resize.estimateBytesFromBase64(block.data);

  // Cheap header dims; jimp fallback only if the header can't be parsed.
  let dims = resize.probeDimsFromHeader(buf);
  if (!dims) {
    dims = await resize.probeDimsFromBuffer(buf);
    if (!dims) {
      // Undecodable. Only a candidate (oversize by bytes) is worth a WARN;
      // a within-byte-limit block we cannot size is left as-is, silently.
      if (bytes > config.maxBytes) throw new Error("undecodable image bytes");
      return null;
    }
  }

  if (!needsResize({ bytes, maxBytes: config.maxBytes, dims, maxEdge: config.maxEdge })) {
    return null; // within limits — no hash, no cache, no decode
  }

  // Oversize candidate: hash → cache lookup → resize on miss.
  const key = cache.keyFor(block.data, block.mimeType, config);
  const hit = cache.get(key);
  if (hit) return hit;

  const { format, mime } = resize.outputFormatForMime(block.mimeType);
  const { data } = await resize.resizeBuffer(
    buf,
    { maxEdge: config.maxEdge, quality: config.quality },
    format,
  );
  const entry = { data: data.toString("base64"), mimeType: mime };
  cache.set(key, entry);
  return entry;
}

function readSessionIdFromCtx(ctx: unknown): string {
  try {
    const sm = (ctx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager;
    if (sm && typeof sm.getSessionId === "function") {
      const id = sm.getSessionId();
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    /* ignore */
  }
  return `pid-${process.pid}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
