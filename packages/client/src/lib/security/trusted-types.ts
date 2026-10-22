/**
 * Trusted Types policy set for the dashboard client
 * (change: harden-client-sinks, design D5/D6/D8).
 *
 * Named policies — every app-owned sink uses one of these:
 *   - `pi-sanitized-html`  `(html, profile)` → DOMPurify with the shared profile
 *                          config (`shared/sanitize-profiles.ts`).
 *   - `pi-mermaid-parse`   wrap only — the colorize `DOMParser` pass in
 *                          `MermaidBlock` (inert document; the final sanitize
 *                          still runs before injection).
 *   - `pi-worker-url`      same-origin `/sw.js` or `/assets/<file>.m?js`
 *                          (+ dev-server worker paths in DEV builds).
 *
 * `default` — safety net for library internals only. Mode-aware: the server
 * states the mode in `<meta name="pi-trusted-types">`; a missing / unknown meta
 * reads as `report`. In `report` (and `off`) every method returns its input
 * unchanged and only counts the hit — output is byte-identical. In `enforce`:
 * tag-free text passes, `<svg…` uses the Mermaid profile, other HTML the
 * HTML+SVG+MathML profile, `createScript` → `null`, `createScriptURL` → the
 * worker-URL allowlist or `null`.
 *
 * Sanitization ALWAYS runs for `pi-sanitized-html`, with or without browser
 * Trusted Types support; only the final wrapping differs (trusted value vs the
 * sanitized string).
 *
 * The violation reporter batches `securitypolicyviolation` events and default
 * hits to the authenticated `POST /api/csp-violations` (no content samples).
 *
 * Allowlisted raw-sink home for `scripts/check-client-sinks.mjs`.
 */
import {
  DEFAULT_HTML_PROFILE,
  keepColWidthStyleOnly,
  MERMAID_SVG_PROFILE,
  SANITIZE_PROFILES,
  type SanitizeProfile,
} from "@blackbelt-technology/pi-dashboard-shared/sanitize-profiles.js";
import DOMPurify from "dompurify";

export type TrustedTypesMode = "off" | "report" | "enforce";

/** Opaque trusted script URL (`TrustedScriptURL` where supported). */
export type TrustedScriptUrlValue = string | { readonly __trustedScriptUrl: never };

interface TtPolicy {
  createHTML(input: string, ...args: unknown[]): TrustedHTML;
  createScript?(input: string, ...args: unknown[]): unknown;
  createScriptURL(input: string, ...args: unknown[]): TrustedScriptUrlValue;
}
interface TtPolicyOptions {
  createHTML?: (input: string, ...args: unknown[]) => string | null;
  createScript?: (input: string, ...args: unknown[]) => string | null;
  createScriptURL?: (input: string, ...args: unknown[]) => string | null;
}
interface TtFactory {
  createPolicy(name: string, options: TtPolicyOptions): TtPolicy;
}

export const POLICY_SANITIZED_HTML = "pi-sanitized-html";
export const POLICY_MERMAID_PARSE = "pi-mermaid-parse";
export const POLICY_WORKER_URL = "pi-worker-url";

// ── mode ────────────────────────────────────────────────────────────────────

/** Read the served mode; missing or unknown meta → `report` (output-neutral). */
export function readTrustedTypesMode(doc: Document | undefined = globalThis.document): TrustedTypesMode {
  const v = doc?.querySelector('meta[name="pi-trusted-types"]')?.getAttribute("content")?.trim();
  return v === "off" || v === "enforce" ? v : "report";
}

// ── script URL allowlist ────────────────────────────────────────────────────

export interface ScriptUrlContext {
  origin: string;
  /** `import.meta.env.DEV`: also accept dev-server worker paths. */
  dev: boolean;
  /** Workspace root served under `/@fs/` in dev (no trailing slash). */
  fsRoot?: string;
}

const PROD_SCRIPT_PATH = /^\/(?:sw\.js|assets\/[^/]+\.m?js)$/;

/** Same-origin `/sw.js` or a single `/assets/` `.js`/`.mjs` file; dev adds Vite worker paths. */
export function isAllowedScriptUrl(raw: string, ctx: ScriptUrlContext): boolean {
  let url: URL;
  try {
    url = new URL(raw, ctx.origin);
  } catch {
    return false;
  }
  if (url.origin !== new URL(ctx.origin).origin) return false;
  const path = url.pathname;
  if (path.startsWith("/api/")) return false;
  if (PROD_SCRIPT_PATH.test(path)) return true;
  if (!ctx.dev) return false;
  if (path.includes("/../") || path.includes("/./")) return false;
  if (path.startsWith("/node_modules/.vite/") || path.startsWith("/src/")) return true;
  const root = ctx.fsRoot?.replace(/\/+$/, "");
  return !!root && path.startsWith(`/@fs${root.startsWith("/") ? "" : "/"}${root}/`);
}

declare const __PI_DEV_FS_ROOT__: string | undefined;

function scriptUrlContext(): ScriptUrlContext {
  const env = (import.meta as { env?: { DEV?: boolean } }).env;
  return {
    origin: globalThis.location?.origin ?? "http://localhost",
    dev: env?.DEV === true,
    fsRoot: typeof __PI_DEV_FS_ROOT__ === "string" ? __PI_DEV_FS_ROOT__ : undefined,
  };
}

// ── sanitizing ──────────────────────────────────────────────────────────────

function assertPurify(): void {
  // An unsupported DOMPurify returns its input unchanged — never a pass-through.
  if (DOMPurify.isSupported !== true) throw new Error("sanitizer unavailable: DOMPurify has no DOM support");
}

/** Sanitize `html` with a shared profile. Throws (fail closed) when DOMPurify is unsupported. */
export function sanitizeWithProfile(html: string, profile: SanitizeProfile): string {
  assertPurify();
  const cfg = SANITIZE_PROFILES[profile];
  if (profile !== "asciidoc") return DOMPurify.sanitize(html, cfg) as string;
  // Hooks are global; add → sanitize → remove has no await, so it cannot interleave.
  DOMPurify.addHook("uponSanitizeAttribute", keepColWidthStyleOnly as never);
  try {
    return DOMPurify.sanitize(html, cfg) as string;
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute", keepColWidthStyleOnly as never);
  }
}

const XML_PROLOGUE = /^(?:\s+|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!doctype[^>]*>)*/i;

/** `default` createHTML rules in enforce mode (D6). */
export function enforceDefaultHtml(s: string): string {
  if (!s.includes("<")) return s;
  assertPurify();
  const rest = s.replace(XML_PROLOGUE, "");
  const profile = /^<svg[\s>/]/i.test(rest) ? MERMAID_SVG_PROFILE : DEFAULT_HTML_PROFILE;
  return DOMPurify.sanitize(s, profile) as string;
}

// ── e-mail body document (eml profile) ──────────────────────────────────────

/** Replace `cid:<id>` tokens (src + CSS `url()`) with our same-origin `blob:` URLs only. */
function resolveCidRefs(html: string, cidToBlob: ReadonlyMap<string, string>): string {
  if (cidToBlob.size === 0) return html;
  const own = `blob:${globalThis.location?.origin ?? ""}/`;
  return html.replace(/cid:([^"')\s>]+)/gi, (match, id: string) => {
    const blob = cidToBlob.get(id.toLowerCase());
    return blob?.startsWith(own) ? blob : match;
  });
}

/** Wrap sanitized body HTML in the constant document for the sandboxed iframe. */
function buildSrcDoc(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"></head><body>${bodyHtml}</body></html>`;
}

/** `eml` profile: sanitize the body, resolve cid refs to our blob: URLs, wrap. */
function emlSrcDoc(body: string, cidToBlob: ReadonlyMap<string, string> | undefined): string {
  return buildSrcDoc(resolveCidRefs(sanitizeWithProfile(body, "eml"), cidToBlob ?? new Map()));
}

// ── registry ────────────────────────────────────────────────────────────────

interface State {
  mode: TrustedTypesMode;
  sanitized?: TtPolicy;
  mermaidParse?: TtPolicy;
  workerUrl?: TtPolicy;
  installed: boolean;
}

const state: State = { mode: "report", installed: false };

function factory(): TtFactory | undefined {
  return (globalThis as { trustedTypes?: TtFactory }).trustedTypes;
}

/** Current hit / violation tallies awaiting flush, keyed `directive\0sink\0source`. */
const pending = new Map<string, number>();

function bump(directive: string, sink: string, source: string): void {
  const key = `${directive}\u0000${sink}\u0000${source}`;
  pending.set(key, (pending.get(key) ?? 0) + 1);
}

/** Script URL without query / fragment (keeps `?ni=`, paths and tokens out of counters), plus `:line`. */
export function stripSource(raw: string | undefined | null, line?: number | null): string {
  if (!raw) return "unknown";
  const base = raw.split(/[?#]/)[0];
  return line ? `${base}:${line}` : base;
}

/** First stack frame outside this module, as `url:line` without query / fragment. */
function callerSource(): string {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n").slice(1)) {
    if (line.includes("trusted-types")) continue;
    const m = line.match(/(https?:\/\/[^\s)]+?):(\d+)(?::\d+)?\)?\s*$/);
    if (m) return stripSource(m[1], Number(m[2]));
  }
  return "unknown";
}

function defaultHit(method: string): void {
  bump("trusted-types-default", method, callerSource());
}

/**
 * Register the named policies and exactly one `default` policy. Idempotent;
 * a no-op (beyond reading the mode) when the browser has no Trusted Types.
 */
export function installTrustedTypes(mode: TrustedTypesMode = readTrustedTypesMode()): void {
  state.mode = mode;
  if (state.installed) return;
  state.installed = true;
  const tt = factory();
  if (!tt) return;
  const ctx = scriptUrlContext();
  state.sanitized = tt.createPolicy(POLICY_SANITIZED_HTML, {
    createHTML: (html, profile, cidToBlob) =>
      profile === "eml"
        ? emlSrcDoc(html, cidToBlob as ReadonlyMap<string, string> | undefined)
        : sanitizeWithProfile(html, profile as SanitizeProfile),
  });
  state.mermaidParse = tt.createPolicy(POLICY_MERMAID_PARSE, { createHTML: (svg) => svg });
  state.workerUrl = tt.createPolicy(POLICY_WORKER_URL, {
    createScriptURL: (url) => {
      if (!isAllowedScriptUrl(url, ctx)) throw new TypeError(`pi-worker-url: refused ${url}`);
      return url;
    },
  });
  tt.createPolicy("default", {
    createHTML: (s) => {
      defaultHit("createHTML");
      return state.mode === "enforce" ? enforceDefaultHtml(s) : s;
    },
    createScript: (s) => {
      defaultHit("createScript");
      return state.mode === "enforce" ? null : s;
    },
    createScriptURL: (s) => {
      defaultHit("createScriptURL");
      if (state.mode !== "enforce") return s;
      return isAllowedScriptUrl(s, ctx) ? s : null;
    },
  });
}

// ── helpers used by the sinks ───────────────────────────────────────────────

/** Sanitized HTML for an app-owned sink (trusted value where supported). */
export function trustedSanitizedHtml(html: string, profile: SanitizeProfile): TrustedHTML | string {
  if (state.sanitized) return state.sanitized.createHTML(html, profile);
  return sanitizeWithProfile(html, profile);
}

/**
 * `srcDoc` for the script-less sandboxed e-mail frame: the body re-sanitized
 * with the server's `eml` profile, `cid:` refs resolved to our blob: URLs, in
 * the constant wrapper document.
 */
export function trustedEmlSrcDoc(body: string, cidToBlob: ReadonlyMap<string, string>): TrustedHTML | string {
  if (state.sanitized) return state.sanitized.createHTML(body, "eml", cidToBlob);
  return emlSrcDoc(body, cidToBlob);
}

/**
 * Wrap-only value for the Mermaid colorize `DOMParser` pass. Import is
 * restricted to `MermaidBlock.tsx` by the sink guard.
 */
export function trustedMermaidParse(svg: string): TrustedHTML | string {
  return state.mermaidParse ? state.mermaidParse.createHTML(svg) : svg;
}

/** Script URL for app-owned worker / service-worker registration. Throws when not allowlisted. */
export function trustedWorkerUrl(url: string): TrustedScriptUrlValue {
  if (state.workerUrl) return state.workerUrl.createScriptURL(url);
  if (!isAllowedScriptUrl(url, scriptUrlContext())) throw new TypeError(`pi-worker-url: refused ${url}`);
  return url;
}

// ── violation reporter (D8) ─────────────────────────────────────────────────

export const MAX_REPORT_KEYS = 50;
export const FLUSH_INTERVAL_MS = 30_000;
const SINK_MAX = 64;

export interface ViolationEntry {
  directive: string;
  sink: string;
  source: string;
  count: number;
}
export interface ViolationReport {
  entries: ViolationEntry[];
  overflow?: number;
}

/** Record one `securitypolicyviolation` event (no content sample kept). */
export function recordViolation(e: {
  effectiveDirective?: string;
  violatedDirective?: string;
  sample?: string;
  sourceFile?: string;
  lineNumber?: number;
}): void {
  const directive = e.effectiveDirective || e.violatedDirective || "unknown";
  const sample = e.sample ?? "";
  const bar = sample.indexOf("|");
  const sink = bar > 0 ? sample.slice(0, bar).slice(0, SINK_MAX) : "unknown";
  bump(directive, sink, stripSource(e.sourceFile, e.lineNumber));
}

/** Drain the pending tallies into one bounded report (`null` when empty). */
export function takeReport(): ViolationReport | null {
  if (pending.size === 0) return null;
  const entries: ViolationEntry[] = [];
  let overflow = 0;
  for (const [key, count] of pending) {
    if (entries.length < MAX_REPORT_KEYS) {
      const [directive, sink, source] = key.split("\u0000");
      entries.push({ directive, sink, source, count });
    } else {
      overflow += count;
    }
  }
  pending.clear();
  return overflow > 0 ? { entries, overflow } : { entries };
}

type FetchFn = (input: string, init: RequestInit) => Promise<unknown>;

/** Send the pending batch. Never throws; a failed send drops the batch. */
export async function flushViolations(fetchFn: FetchFn = (i, init) => fetch(i, init)): Promise<void> {
  const report = takeReport();
  if (!report) return;
  try {
    await fetchFn("/api/csp-violations", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
  } catch {
    /* dropped — reporting never affects the UI */
  }
}

/** Listen for violations and flush every 30 s and on `pagehide`. Off mode: no-op. */
export function startViolationReporter(win: Window = window): () => void {
  if (state.mode === "off") return () => {};
  const onViolation = (e: Event) => recordViolation(e as SecurityPolicyViolationEvent);
  const onHide = () => void flushViolations();
  win.addEventListener("securitypolicyviolation", onViolation);
  win.addEventListener("pagehide", onHide);
  const timer = win.setInterval(() => void flushViolations(), FLUSH_INTERVAL_MS);
  return () => {
    win.removeEventListener("securitypolicyviolation", onViolation);
    win.removeEventListener("pagehide", onHide);
    win.clearInterval(timer);
  };
}

/** Test seam: forget registered policies and pending tallies. */
export function __resetTrustedTypesForTests(): void {
  state.mode = "report";
  state.installed = false;
  state.sanitized = undefined;
  state.mermaidParse = undefined;
  state.workerUrl = undefined;
  pending.clear();
}

/** Test seam: total pending default-policy hits. */
export function __defaultHitCountForTests(): number {
  let n = 0;
  for (const [key, count] of pending) if (key.startsWith("trusted-types-default\u0000")) n += count;
  return n;
}
