/**
 * Baseline Content-Security-Policy (defense in depth). There is no CSP in the
 * server otherwise; this constrains script execution + framing so that even if
 * HTML were ever loaded in the dashboard origin it cannot exfiltrate or reframe
 * the app, complementing the sandboxed live-server iframe (D6/D7).
 *
 * Rollout is staged: `report` (default) emits `Content-Security-Policy-Report-
 * Only` so violations are logged without breaking anything; `enforce` emits the
 * real `Content-Security-Policy`; `off` disables it. Set via
 * `PI_DASHBOARD_CSP=report|enforce|off`.
 *
 * The header is applied to the dashboard's OWN responses only. Proxied/embedded
 * prefixes (`/live/*` sandboxed dev servers) are skipped so their own policies
 * are not overwritten.
 *
 * A `ctx.serveApp` mount response sets its own ENFORCED `Content-Security-Policy`
 * before `onSend`; the hook only adds a header that is absent, so that policy is
 * never overwritten in any mode (report mode additionally gets the baseline
 * `-Report-Only`; off mode registers no hook and the mount sets its own).
 * See change: add-plugin-capability-routes (D7).
 *
 * Trusted Types (`require-trusted-types-for 'script'`) has its own mode,
 * `PI_DASHBOARD_TRUSTED_TYPES=off|report|enforce`; unset follows the baseline
 * (`off` iff `PI_DASHBOARD_CSP=off`, else `report`), so an existing `enforce`
 * deployment never gets TT enforcement by accident. Matching modes append the
 * directive to the baseline header; differing modes set the OTHER header kind
 * with the directive alone (never comma-joined). See change: harden-client-sinks (D7).
 *
 * Strict policy (S3b): identical to the baseline except `script-src 'self' 'nonce-<n>'` (no
 * `'unsafe-inline'`/`'unsafe-eval'`). `report` mode emits baseline + strict as two Report-Only headers;
 * `enforce` emits strict enforcing only. Each carries `report-uri`/`report-to` for its own label (the TT-only
 * header: `trusted-types`) plus a `Reporting-Endpoints` header. The nonce is minted per HTML response by
 * `cspNonceFor(reply)` (memoized; non-HTML responses carry none). A response proxied to Vite
 * (`markViteProxied`) is a dev response: baseline only (legacy `script-src`), no strict, no nonce, no report
 * destination. Default mode stays `report`. See change: harden-cors-and-csp-reporting (D9, D10).
 *
 * See change: improve-content-editor (baseline CSP §7).
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type CspReportPolicy, cspReportEndpointName, cspReportPath } from "./csp-report-paths.js";

export type CspMode = "off" | "report" | "enforce";

/** Prefixes served by a reverse proxy / sandbox — never stamp our CSP on them. */
const SKIP_PREFIXES = ["/live/"];

/**
 * Baseline directives. `script-src`/`style-src` keep `'unsafe-inline'` (Vite +
 * component inline styles) and `'unsafe-eval'` (Monaco/pdfjs/mermaid dynamic
 * codegen) for now — the high-value wins are `object-src 'none'`,
 * `frame-ancestors 'self'`, `base-uri 'self'`, and `default-src 'self'`.
 * `worker-src 'self' blob:` keeps Monaco/pdfjs workers alive. `connect-src`
 * allows same-origin + WebSocket (dashboard `/ws`, Vite HMR, zrok wss).
 */
function directives(scriptSrc: string): string {
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self' ws: wss:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** The `baseline` policy (legacy `script-src`). */
export function buildCsp(): string {
  return directives("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
}

/** The `strict` policy: `script-src 'self'` plus the response nonce when there is one (HTML only). */
export function buildStrictCsp(nonce?: string): string {
  return directives(nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'");
}

export function resolveCspMode(raw: string | undefined): CspMode {
  if (raw === "enforce" || raw === "off") return raw;
  return "report"; // default — safe, non-breaking
}

const TRUSTED_TYPES_DIRECTIVE = "require-trusted-types-for 'script'";

/** `PI_DASHBOARD_TRUSTED_TYPES`: explicit value wins; unset / unknown → `off` iff the baseline is `off`, else `report`. */
export function resolveTrustedTypesMode(raw: string | undefined, cspMode: CspMode): CspMode {
  if (raw === "off" || raw === "report" || raw === "enforce") return raw;
  return cspMode === "off" ? "off" : "report";
}

const nonces = new WeakMap<FastifyReply, string>();
const viteProxied = new WeakSet<FastifyReply>();

/** Per-response script nonce (16 random bytes, base64), memoized per reply: the header and the import map share it. */
export function cspNonceFor(reply: FastifyReply): string {
  let n = nonces.get(reply);
  if (!n) {
    n = randomBytes(16).toString("base64");
    nonces.set(reply, n);
  }
  return n;
}

/** Mark a reply as proxied to the Vite dev server: it gets the dev header shape (baseline only, no destinations). */
export function markViteProxied(reply: FastifyReply): void {
  viteProxied.add(reply);
}

const RO = "content-security-policy-report-only";
const EN = "content-security-policy";
const headerFor = (mode: CspMode) => (mode === "enforce" ? EN : RO);

type Plan = Map<string, Array<{ value: string; label?: CspReportPolicy }>>;

/** Header kind → policy values for one response. `label` = report destination (absent in dev / for nothing). */
function plan(mode: CspMode, ttMode: CspMode, dev: boolean, nonce: string | undefined): Plan {
  const out: Plan = new Map();
  const add = (kind: string, value: string, label?: CspReportPolicy) => {
    const list = out.get(kind) ?? [];
    list.push({ value, label: dev ? undefined : label });
    out.set(kind, list);
  };
  const tt = (on: boolean) => (on ? `; ${TRUSTED_TYPES_DIRECTIVE}` : "");
  if (mode === "report") {
    add(RO, buildCsp() + tt(ttMode === mode), "baseline");
    if (!dev) add(RO, buildStrictCsp(nonce), "strict");
  } else if (mode === "enforce") {
    // dev: the baseline policy enforcing (legacy dev `script-src`); production: the strict policy.
    if (dev) add(EN, buildCsp() + tt(ttMode === mode), "baseline");
    else add(EN, buildStrictCsp(nonce) + tt(ttMode === mode), "strict");
  }
  if (ttMode !== "off" && ttMode !== mode) add(headerFor(ttMode), TRUSTED_TYPES_DIRECTIVE, "trusted-types");
  return out;
}

/**
 * Register the CSP hook. No-op when both the baseline and Trusted Types are
 * `off`. `ttMode` defaults to `off` (callers opt in; `server.ts` passes the
 * resolved `PI_DASHBOARD_TRUSTED_TYPES` mode).
 */
export function registerCsp(fastify: FastifyInstance, mode: CspMode, ttMode: CspMode = "off"): void {
  if (mode === "off" && ttMode === "off") return;
  fastify.addHook("onSend", async (request, reply, payload) => {
    const url = request.url;
    if (SKIP_PREFIXES.some((p) => url.startsWith(p))) return payload;
    const dev = viteProxied.has(reply);
    const used = new Set<CspReportPolicy>();
    // Each header kind is added only when absent (a route-level policy stands).
    for (const [kind, entries] of plan(mode, ttMode, dev, nonces.get(reply))) {
      if (reply.getHeader(kind)) continue;
      const values = entries.map(({ value, label }) => {
        if (!label) return value;
        used.add(label);
        return `${value}; report-uri ${cspReportPath(label)}; report-to ${cspReportEndpointName(label)}`;
      });
      reply.header(kind, values.length === 1 ? values[0] : values);
    }
    if (used.size > 0 && !reply.getHeader("reporting-endpoints")) {
      reply.header("reporting-endpoints", [...used].map((l) => `${cspReportEndpointName(l)}="${cspReportPath(l)}"`).join(", "));
    }
    return payload;
  });
}
