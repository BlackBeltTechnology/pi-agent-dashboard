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
 * See change: improve-content-editor (baseline CSP §7).
 */
import type { FastifyInstance } from "fastify";

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
export function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
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

const headerFor = (mode: CspMode) => (mode === "enforce" ? "content-security-policy" : "content-security-policy-report-only");

/** Register the CSP hook. No-op when both the baseline and Trusted Types are `off`. */
export function registerCsp(fastify: FastifyInstance, mode: CspMode, ttMode: CspMode = resolveTrustedTypesMode(undefined, mode)): void {
  // header kind → value; each kind is added only when absent (a route-level policy stands).
  const headers = new Map<string, string>();
  if (mode !== "off") headers.set(headerFor(mode), ttMode === mode ? `${buildCsp()}; ${TRUSTED_TYPES_DIRECTIVE}` : buildCsp());
  if (ttMode !== "off" && ttMode !== mode) headers.set(headerFor(ttMode), TRUSTED_TYPES_DIRECTIVE);
  if (headers.size === 0) return;
  fastify.addHook("onSend", async (request, reply, payload) => {
    const url = request.url;
    if (SKIP_PREFIXES.some((p) => url.startsWith(p))) return payload;
    for (const [header, value] of headers) if (!reply.getHeader(header)) reply.header(header, value);
    return payload;
  });
}
