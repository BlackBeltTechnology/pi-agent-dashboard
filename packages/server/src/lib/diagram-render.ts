/**
 * Diagram render proxy: resolves permitted Kroki endpoint, encodes diagram source,
 * fetches SVG from upstream, sanitizes SVG with DOMPurify, and caches responses.
 *
 * See OpenSpec change: diagram-rendering (design D3, D4, D5).
 */
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { resolveKrokiEndpoint, type KrokiConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { createSemaphore } from "@blackbelt-technology/pi-dashboard-shared/semaphore.js";

// Lazy DOMPurify loader to avoid jsdom side-effects at server boot (mirrors eml.ts pattern)
type DomPurify = (typeof import("isomorphic-dompurify"))["default"];
let _purify: DomPurify | null = null;
async function getPurify(): Promise<DomPurify> {
  return (_purify ??= (await import("isomorphic-dompurify")).default);
}

/** 512 KB pre-deflate source size cap (design D3) */
export const DIAGRAM_SOURCE_CAP = 512 * 1024;

/** Allowed diagram type whitelist (v1: plantuml only, design D3) */
const ALLOWED_DIAGRAM_TYPES = new Set(["plantuml"]);

/** Abort timeout for upstream Kroki requests (10 seconds, design D3) */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** Upstream concurrency cap */
const upstreamSemaphore = createSemaphore(8);

export function encodeDiagramSource(source: string): string {
  const deflated = zlib.deflateSync(Buffer.from(source, "utf-8"), { level: 9 });
  return deflated.toString("base64url");
}

const MAX_DIAGRAM_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB response cap

async function sanitizeSvg(svg: string): Promise<string> {
  const purify = await getPurify();
  return purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script", "style"],
    FORBID_ATTR: ["onclick", "onload", "onerror", "onmouseover", "onmouseout"],
  });
}

// ── In-memory LRU cache ─────────────────────────────────────────────────────
// Keyed sha256(type + "\0" + source + "\0" + endpoint), bounded to 100 entries / 20 MB total bytes
const CACHE_MAX_ENTRIES = 100;
const CACHE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

interface CacheEntry {
  key: string;
  svg: string;
  bytes: number;
}
const renderCache: CacheEntry[] = [];
let totalCacheBytes = 0;

function computeCacheKey(type: string, source: string, endpoint: string): string {
  return createHash("sha256")
    .update(`${type}\0${source}\0${endpoint}`)
    .digest("hex");
}

function getCachedRender(key: string): string | undefined {
  const idx = renderCache.findIndex((e) => e.key === key);
  if (idx >= 0) {
    const [hit] = renderCache.splice(idx, 1);
    renderCache.unshift(hit);
    return hit.svg;
  }
  return undefined;
}

function setCachedRender(key: string, svg: string): void {
  const bytes = Buffer.byteLength(svg, "utf-8");
  const idx = renderCache.findIndex((e) => e.key === key);
  if (idx >= 0) {
    const [existing] = renderCache.splice(idx, 1);
    totalCacheBytes -= existing.bytes;
  }

  renderCache.unshift({ key, svg, bytes });
  totalCacheBytes += bytes;

  while (renderCache.length > CACHE_MAX_ENTRIES || totalCacheBytes > CACHE_MAX_BYTES) {
    const evicted = renderCache.pop();
    if (evicted) totalCacheBytes -= evicted.bytes;
  }
}

export function clearDiagramCache(): void {
  renderCache.length = 0;
  totalCacheBytes = 0;
}

export type DiagramRenderResult =
  | { success: true; svg: string }
  | { success: false; code: "unavailable" | "bad_request" | "upstream_failure"; error: string; statusCode: number };

interface DiagramRenderOptions {
  krokiConfig?: KrokiConfig;
  envOverride?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * Render diagram source via Kroki upstream or cache.
 */
export async function renderDiagram(
  type: string,
  source: string,
  options: DiagramRenderOptions = {},
): Promise<DiagramRenderResult> {
  // Validate type whitelist first (pre-upstream, pre-encoding)
  if (!ALLOWED_DIAGRAM_TYPES.has(type)) {
    return {
      success: false,
      code: "bad_request",
      error: `Unsupported diagram type: ${type}`,
      statusCode: 400,
    };
  }

  // Check source size cap (pre-upstream, pre-encoding)
  const byteLength = Buffer.byteLength(source, "utf-8");
  if (byteLength > DIAGRAM_SOURCE_CAP) {
    return {
      success: false,
      code: "bad_request",
      error: `Diagram source exceeds maximum size of ${DIAGRAM_SOURCE_CAP} bytes`,
      statusCode: 413,
    };
  }

  // Resolve endpoint via resolution ladder
  const endpoint = resolveKrokiEndpoint(options.krokiConfig, options.envOverride);
  if (!endpoint) {
    return {
      success: false,
      code: "unavailable",
      error: "Diagram rendering unavailable: no Kroki endpoint configured or permitted",
      statusCode: 503,
    };
  }

  // Check cache
  const key = computeCacheKey(type, source, endpoint);
  const cached = getCachedRender(key);
  if (cached !== undefined) {
    return { success: true, svg: cached };
  }

  // Encode source
  const encoded = encodeDiagramSource(source);
  const url = `${endpoint}/${type}/svg/${encoded}`;

  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const fetchImpl = options.fetchFn ?? fetch;

  const start = Date.now();
  try {
    const rawSvg = await upstreamSemaphore.run(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Upstream returned HTTP ${res.status}`);
        }
        if (!res.body) {
          return await res.text();
        }

        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > MAX_DIAGRAM_RESPONSE_BYTES) {
              await reader.cancel();
              throw new Error("Upstream response exceeded 5MB size cap");
            }
            chunks.push(value);
          }
        }

        const combined = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return new TextDecoder().decode(combined);
      } finally {
        clearTimeout(timer);
      }
    });

    const sanitized = await sanitizeSvg(rawSvg);
    setCachedRender(key, sanitized);
    return { success: true, svg: sanitized };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[diagram-render] upstream failure after ${latencyMs}ms: ${msg}`);
    return {
      success: false,
      code: "upstream_failure",
      error: `Upstream diagram render failed: ${msg}`,
      statusCode: 502,
    };
  }
}
