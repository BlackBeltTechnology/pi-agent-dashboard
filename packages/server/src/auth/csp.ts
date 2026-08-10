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

/** Register the CSP hook. No-op when mode is `off`. */
export function registerCsp(fastify: FastifyInstance, mode: CspMode): void {
  if (mode === "off") return;
  const header = mode === "enforce" ? "content-security-policy" : "content-security-policy-report-only";
  const value = buildCsp();
  fastify.addHook("onSend", async (request, reply, payload) => {
    const url = request.url;
    if (SKIP_PREFIXES.some((p) => url.startsWith(p))) return payload;
    if (!reply.getHeader(header)) reply.header(header, value);
    return payload;
  });
}
