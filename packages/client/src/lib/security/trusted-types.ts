/**
 * Trusted Types policy set for the dashboard client
 * (change: harden-client-sinks, design D5/D6/D8).
 *
 * Named policies — every app-owned sink uses one of these:
 *   - `pi-sanitized-html`  `(html, profile)` → DOMPurify with the shared profile
 *                          config (`shared/sanitize-profiles.ts`).
 *   - `pi-worker-url`      same-origin `/sw.js` or `/assets/<file>.m?js`
 *                          (+ dev-server worker paths in DEV builds).
 *
 * `default` — safety net for library internals only. Mode-aware: the server
 * states the mode in `<meta name="pi-trusted-types">`; a missing / unknown meta
 * reads as `report`. In `report` (and `off`) every method returns its input
 * unchanged and counts the hit — output is byte-identical. In `enforce`:
 * tag-free text passes, `<svg…` uses the Mermaid profile, other HTML the
 * HTML+SVG+MathML profile, `createScript` → `null`, `createScriptURL` → the
 * worker-URL allowlist or `null`.
 *
 * Shadow evaluation (report mode only; change: add-trusted-types-shadow-enforce):
 * each `default` call is additionally classified into one of six {@link SHADOW_OUTCOMES}
 * — what `enforce` WOULD do — without changing the returned value, the `default`-hit
 * counts, or throwing into the sink. HTML runs through a SEPARATE DOMPurify instance
 * (own `removed` / config state) whose inert parse goes through one module-private,
 * parse-only policy (`pi-shadow-parse`, never exported, never applied to a sink).
 * Cost is bounded by an exact-string LRU memo and a per-window budget; outcomes feed
 * a fixed-key aggregate sent with each report (never a content sample).
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
  type PurifyProfileConfig,
  SANITIZE_PROFILES,
  type SanitizeProfile,
} from "@blackbelt-technology/pi-dashboard-shared/sanitize-profiles.js";
import DOMPurify, { type Config as PurifyConfig, type DOMPurify as PurifyInstance } from "dompurify";

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

const POLICY_SANITIZED_HTML = "pi-sanitized-html";
const POLICY_WORKER_URL = "pi-worker-url";
/** Private, parse-only policy that feeds the shadow sanitizer's inert parse (identity; same shape as DOMPurify's own). */
const POLICY_SHADOW_PARSE = "pi-shadow-parse";

// ── mode ────────────────────────────────────────────────────────────────────

/** Read the served mode; missing or unknown meta → `report` (output-neutral). */
export function readTrustedTypesMode(doc: Document | undefined = globalThis.document): TrustedTypesMode {
  const v = doc?.querySelector('meta[name="pi-trusted-types"]')?.getAttribute("content")?.trim();
  return v === "off" || v === "enforce" ? v : "report";
}

// ── script URL allowlist ────────────────────────────────────────────────────

interface ScriptUrlContext {
  origin: string;
  /** `import.meta.env.DEV`: also accept dev-server worker paths. */
  dev: boolean;
  /** Workspace root served under `/@fs/` in dev (no trailing slash). */
  fsRoot?: string;
}

const PROD_SCRIPT_PATH = /^\/(?:sw\.js|assets\/[^/]+\.m?js)$/;

/** Same-origin `/sw.js` or a single `/assets/` `.js`/`.mjs` file; dev adds Vite worker paths. */
function isAllowedScriptUrl(raw: string, ctx: ScriptUrlContext): boolean {
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
function sanitizeWithProfile(html: string, profile: SanitizeProfile): string {
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

/** The enforce-mode profile for `s` (XML prologue stripped, then an `<svg` test): shared by enforce and the shadow classifier. */
function enforceProfileFor(s: string): PurifyProfileConfig {
  return /^<svg[\s>/]/i.test(s.replace(XML_PROLOGUE, "")) ? MERMAID_SVG_PROFILE : DEFAULT_HTML_PROFILE;
}

/** `default` createHTML rules in enforce mode (D6). */
function enforceDefaultHtml(s: string): string {
  if (!s.includes("<")) return s;
  assertPurify();
  return DOMPurify.sanitize(s, enforceProfileFor(s)) as string;
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
  workerUrl?: TtPolicy;
  /** Module-private parse-only policy for the shadow sanitizer; never exported, never applied to a sink. */
  shadowParse?: TtPolicy;
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

/** The server's `source.length` limit (UTF-16 code units): a longer source would make it reject the whole report. */
const SOURCE_MAX = 512;

/** Script URL without query / fragment (keeps `?ni=`, paths and tokens out of counters), plus `:line`; at most {@link SOURCE_MAX} units. */
function stripSource(raw: string | undefined | null, line?: number | null): string {
  if (!raw) return "unknown";
  const base = raw.split(/[?#]/)[0];
  return (line ? `${base}:${line}` : base).slice(0, SOURCE_MAX);
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

/** Count one `default` invocation; returns its caller source (reused by shadow evaluation). */
function defaultHit(method: string): string {
  const source = callerSource();
  bump("trusted-types-default", method, source);
  return source;
}

// ── shadow evaluation (report mode; change: add-trusted-types-shadow-enforce) ──

/** What `enforce` WOULD do with a `default`-policy input. Keep in step with the server's `SHADOW_OUTCOMES`. */
export const SHADOW_OUTCOMES = [
  "would-block-script",
  "would-block-script-url",
  "would-alter-html",
  "would-throw-html",
  "not-evaluated",
  "shadow-error",
] as const;
type ShadowOutcome = (typeof SHADOW_OUTCOMES)[number];

const SHADOW_DIRECTIVE = "trusted-types-shadow";
const DEFAULT_DIRECTIVE = "trusted-types-default";

/** Running per-outcome totals not yet acknowledged by the server (the aggregate sent with each report). */
const shadowTotals = Object.fromEntries(SHADOW_OUTCOMES.map((o) => [o, 0])) as Record<ShadowOutcome, number>;

function shadowCount(outcome: ShadowOutcome, source: string): void {
  shadowTotals[outcome] += 1;
  bump(SHADOW_DIRECTIVE, outcome, source);
}

/** Memo: exact input string → outcome (`null` = enforcement leaves it intact). LRU, bounded by entries and key units. */
const MEMO_MAX_ENTRIES = 512;
const MEMO_MAX_UNITS = 4 * 1024 * 1024;
/** Per-window classification budget (a window = {@link FLUSH_INTERVAL_MS}). */
const BUDGET_MAX_COUNT = 200;
const BUDGET_MAX_UNITS = 2 * 1024 * 1024;
const BUDGET_MAX_MS = 50;
/** Distinct skipped inputs remembered per window; past it every sighting counts (over-count, never a silent miss). */
const SKIP_SET_MAX = 1024;
/** Head elements DOMPurify's default parse puts in `<head>`, which a body-only serialization silently drops. */
const LEADING_HEAD = /^<(?:style|link|meta|title|base|script|noscript|template)[\s>/]/i;

const memo = new Map<string, ShadowOutcome | null>();
let memoUnits = 0;
let windowStart: number | undefined;
let windowCount = 0;
let windowUnits = 0;
let windowMs = 0;
const windowSkipped = new Set<string>();
/** True while shadow evaluation runs: a nested `default` callback returns its input untouched and counts nothing. */
let inShadow = false;
let shadowPurify: PurifyInstance | undefined;

/** The classifier's own DOMPurify instance: its `removed` / config state never touches the shared instance. */
function shadowInstance(): PurifyInstance {
  shadowPurify ??= (DOMPurify as unknown as (w: Window) => PurifyInstance)(window);
  return shadowPurify;
}

function shadowSanitize(inst: PurifyInstance, s: string, profile: PurifyProfileConfig, forceBody: boolean): string {
  const cfg: PurifyConfig = { ...(profile as PurifyConfig), ...(forceBody ? { FORCE_BODY: true } : {}) };
  if (state.shadowParse) cfg.TRUSTED_TYPES_POLICY = state.shadowParse as unknown as PurifyConfig["TRUSTED_TYPES_POLICY"];
  return inst.sanitize(s, cfg) as string;
}

function renewWindow(now: number): void {
  if (windowStart !== undefined && now - windowStart < FLUSH_INTERVAL_MS) return;
  windowStart = now;
  windowCount = 0;
  windowUnits = 0;
  windowMs = 0;
  windowSkipped.clear();
}

/** Two-pass HTML test (D2). Throws: `would-throw-html` from pass 1, anything else is a classifier fault. */
function classifyHtml(s: string, inst: PurifyInstance): ShadowOutcome | null {
  const profile = enforceProfileFor(s);
  if (inst.isSupported !== true) return "would-throw-html";
  let pass1: string;
  let removed: number;
  try {
    pass1 = shadowSanitize(inst, s, profile, false);
    removed = inst.removed.length;
  } catch {
    return "would-throw-html";
  }
  if (removed > 0) return "would-alter-html";
  if (!LEADING_HEAD.test(s.replace(XML_PROLOGUE, ""))) return null;
  // Leading head content: pass 2 keeps it in the body, so a difference (or a removal) means pass 1 dropped it silently.
  const pass2 = shadowSanitize(inst, s, profile, true);
  return pass2 !== pass1 || inst.removed.length > 0 ? "would-alter-html" : null;
}

function memoStore(s: string, outcome: ShadowOutcome | null): void {
  memo.set(s, outcome);
  memoUnits += s.length;
  while (memo.size > MEMO_MAX_ENTRIES || memoUnits > MEMO_MAX_UNITS) {
    const oldest = memo.keys().next().value as string;
    memo.delete(oldest);
    memoUnits -= oldest.length;
  }
}

/** Classify one HTML input; returns the outcome to count (`null` = none). Never memoizes `not-evaluated` / `shadow-error`. */
function shadowHtmlOutcome(s: string): ShadowOutcome | null {
  if (memo.has(s)) {
    const hit = memo.get(s) as ShadowOutcome | null;
    memo.delete(s);
    memo.set(s, hit); // LRU: most recent last
    return hit;
  }
  renewWindow(performance.now());
  if (windowCount >= BUDGET_MAX_COUNT || windowUnits + s.length > BUDGET_MAX_UNITS || windowMs >= BUDGET_MAX_MS) {
    if (windowSkipped.has(s)) return null;
    if (windowSkipped.size < SKIP_SET_MAX) windowSkipped.add(s);
    return "not-evaluated";
  }
  const t0 = performance.now();
  windowCount += 1;
  windowUnits += s.length;
  try {
    const outcome = classifyHtml(s, shadowInstance());
    memoStore(s, outcome);
    return outcome;
  } finally {
    windowMs += performance.now() - t0;
  }
}

/** Run `fn` as shadow evaluation: re-entry-guarded, never throws; a fault counts `shadow-error`. */
function shadowEvaluate(source: string, fn: () => ShadowOutcome | null): void {
  inShadow = true;
  try {
    const outcome = fn();
    if (outcome) shadowCount(outcome, source);
  } catch {
    shadowCount("shadow-error", source);
  } finally {
    inShadow = false;
  }
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
  state.workerUrl = tt.createPolicy(POLICY_WORKER_URL, {
    createScriptURL: (url) => {
      if (!isAllowedScriptUrl(url, ctx)) throw new TypeError(`pi-worker-url: refused ${url}`);
      return url;
    },
  });
  state.shadowParse = tt.createPolicy(POLICY_SHADOW_PARSE, { createHTML: (s) => s });
  tt.createPolicy("default", {
    createHTML: (s) => {
      if (inShadow) return s;
      const source = defaultHit("createHTML");
      if (state.mode === "enforce") return enforceDefaultHtml(s);
      if (state.mode === "report" && s.includes("<")) shadowEvaluate(source, () => shadowHtmlOutcome(s));
      return s;
    },
    createScript: (s) => {
      if (inShadow) return s;
      const source = defaultHit("createScript");
      if (state.mode === "enforce") return null;
      if (state.mode === "report") shadowEvaluate(source, () => "would-block-script");
      return s;
    },
    createScriptURL: (s) => {
      if (inShadow) return s;
      const source = defaultHit("createScriptURL");
      if (state.mode === "enforce") return isAllowedScriptUrl(s, ctx) ? s : null;
      if (state.mode === "report") shadowEvaluate(source, () => (isAllowedScriptUrl(s, ctx) ? null : "would-block-script-url"));
      return s;
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

/** Script URL for app-owned worker / service-worker registration. Throws when not allowlisted. */
export function trustedWorkerUrl(url: string): TrustedScriptUrlValue {
  if (state.workerUrl) return state.workerUrl.createScriptURL(url);
  if (!isAllowedScriptUrl(url, scriptUrlContext())) throw new TypeError(`pi-worker-url: refused ${url}`);
  return url;
}

// ── violation reporter (D8) ─────────────────────────────────────────────────

export const MAX_REPORT_KEYS = 50;
const FLUSH_INTERVAL_MS = 30_000;
const SINK_MAX = 64;
/** Serialized-report bound: under the server's 8,192-byte body limit with headroom. */
const REPORT_MAX_BYTES = 7_168;
/** Server per-key count limit (`MAX_COUNT`): a larger shadow total is split across reports. */
const SHADOW_CLAMP = 1_000_000;

interface ViolationEntry {
  directive: string;
  sink: string;
  source: string;
  count: number;
}
type ShadowAggregate = Partial<Record<ShadowOutcome, number>>;
interface ViolationReport {
  entries: ViolationEntry[];
  overflow?: number;
  shadow?: ShadowAggregate;
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

const byteLength = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

/** Entry priority: violations, then `default` hits, then per-source shadow detail (shed first). */
const entryRank = (directive: string): number =>
  directive === SHADOW_DIRECTIVE ? 2 : directive === DEFAULT_DIRECTIVE ? 1 : 0;

/** Current shadow totals, non-zero keys only, each clamped to {@link SHADOW_CLAMP}. */
function shadowAggregate(): ShadowAggregate {
  const out: ShadowAggregate = {};
  for (const o of SHADOW_OUTCOMES) if (shadowTotals[o] > 0) out[o] = Math.min(shadowTotals[o], SHADOW_CLAMP);
  return out;
}

/**
 * Drain the pending tallies into one bounded report (`null` when nothing is pending). Entries are taken in
 * priority order up to {@link MAX_REPORT_KEYS} and {@link REPORT_MAX_BYTES}; the rest are summed into `overflow`.
 * The shadow aggregate (≤ 6 small keys) is always included. Shadow totals are NOT drained here: they are
 * acknowledged by {@link flushViolations} only after a 2xx.
 */
function takeReport(): { report: ViolationReport; sentShadow: ShadowAggregate } | null {
  const shadow = shadowAggregate();
  const hasShadow = Object.keys(shadow).length > 0;
  if (pending.size === 0 && !hasShadow) return null;
  const ranked: ViolationEntry[] = [];
  for (const [key, count] of pending) {
    const [directive, sink, source] = key.split("\u0000");
    ranked.push({ directive, sink, source, count });
  }
  pending.clear();
  ranked.sort((a, b) => entryRank(a.directive) - entryRank(b.directive)); // stable: insertion order within a rank
  const shell: ViolationReport = { entries: [], overflow: Number.MAX_SAFE_INTEGER, ...(hasShadow ? { shadow } : {}) };
  let room = REPORT_MAX_BYTES - byteLength(shell);
  const entries: ViolationEntry[] = [];
  let overflow = 0;
  for (const e of ranked) {
    const size = byteLength(e) + 1; // + the separating comma
    if (entries.length < MAX_REPORT_KEYS && size <= room) {
      entries.push(e);
      room -= size;
    } else {
      overflow += e.count;
    }
  }
  const report: ViolationReport = { entries, ...(overflow > 0 ? { overflow } : {}), ...(hasShadow ? { shadow } : {}) };
  return { report, sentShadow: shadow };
}

type FetchFn = (input: string, init: RequestInit) => Promise<unknown>;

/** HTTP status of a fetch outcome (`ok` without a status reads as 200; anything else as a transport failure). */
function statusOf(res: unknown): number {
  const r = res as { status?: unknown; ok?: unknown } | null | undefined;
  if (typeof r?.status === "number") return r.status;
  return r?.ok === true ? 200 : 0;
}

/**
 * Send the pending batch. Never throws. Entries are dropped on any failure; shadow totals are subtracted only
 * after a 2xx. A 400 (schema rejection, which a conforming client never triggers) discards them so it cannot
 * poison later reports, and counts one `shadow-error` so the loss is visible; any other failure keeps them.
 */
export async function flushViolations(fetchFn: FetchFn = (i, init) => fetch(i, init)): Promise<void> {
  const taken = takeReport();
  if (!taken) return;
  let status = 0;
  try {
    status = statusOf(
      await fetchFn("/api/csp-violations", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taken.report),
      }),
    );
  } catch {
    /* dropped — reporting never affects the UI */
  }
  if (status >= 200 && status < 300) {
    for (const o of SHADOW_OUTCOMES) shadowTotals[o] -= taken.sentShadow[o] ?? 0;
  } else if (status === 400) {
    for (const o of SHADOW_OUTCOMES) shadowTotals[o] -= taken.sentShadow[o] ?? 0;
    if (Object.keys(taken.sentShadow).length > 0) shadowTotals["shadow-error"] += 1;
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
  state.workerUrl = undefined;
  state.shadowParse = undefined;
  pending.clear();
  for (const o of SHADOW_OUTCOMES) shadowTotals[o] = 0;
  memo.clear();
  memoUnits = 0;
  windowStart = undefined;
  windowCount = 0;
  windowUnits = 0;
  windowMs = 0;
  windowSkipped.clear();
  inShadow = false;
  shadowPurify = undefined;
}

/** Test seam: the live shadow totals (mutable, to set up clamp cases). */
export function __shadowTotalsForTests(): Record<ShadowOutcome, number> {
  return shadowTotals;
}

/** Test seam: the classifier's own DOMPurify instance (create it, then spy on `sanitize`). */
export function __shadowPurifyForTests(): PurifyInstance {
  return shadowInstance();
}

/** Test seam: total pending default-policy hits. */
export function __defaultHitCountForTests(): number {
  let n = 0;
  for (const [key, count] of pending) if (key.startsWith(`${DEFAULT_DIRECTIVE}\u0000`)) n += count;
  return n;
}
