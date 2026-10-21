/**
 * Content-Security-Policy builder for every capability response under
 * `/live/<id>/~c/<token>/` (port AND static targets).
 *
 * Pure: the policy comes from the token (never from a request path, query or
 * header), the prefix origin from the already host-admitted `Host`. The frame
 * is sandboxed (opaque origin); this header makes the same isolation hold when
 * the capability URL is opened directly. Restricted mode confines every fetch
 * directive to the capability prefix plus the granted egress origins `<G>`;
 * it never contains `'self'` (that would be the dashboard origin).
 *
 * See change: improve-canvas-html-and-url-ux (design D3, D4).
 */
import type { LivePolicy } from "./live-capability.js";

export interface LiveCspInput {
  policy: LivePolicy;
  /** Validated `Host` header value (host[:port]). */
  host: string;
  /** `http` or `https` — the scheme the dashboard is reached on. */
  scheme: "http" | "https";
  /** `/live/<id>/~c/<token>` (no trailing slash). */
  prefix: string;
  /** Granted egress origins `<G>`: project grants ∪ the viewer's allow-once set. */
  granted?: readonly string[];
}

export interface LiveCspResult {
  /** `Content-Security-Policy` header value. */
  csp: string;
  /** `Reporting-Endpoints` header value, restricted mode only. */
  reportingEndpoints?: string;
}

/** A canonical https origin: no path/space/`;`/`,` can ride into the header. */
const SAFE_ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
/** A `Host` header value we are willing to embed in a header. */
const SAFE_HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/** The report endpoint, relative to the capability prefix. */
export const CSP_REPORT_SUBPATH = "/__pi/csp-report";

function sandboxDirective(policy: LivePolicy): string {
  if (!policy.scripts) return "sandbox";
  return policy.egress === "open"
    ? "sandbox allow-scripts allow-forms allow-popups allow-downloads"
    : "sandbox allow-scripts allow-forms";
}

/**
 * Build the CSP for one capability response. Returns `null` when `host` is not a
 * plain host[:port] (fail closed — the caller answers 404 rather than emit a
 * header it cannot trust).
 */
export function buildLiveCsp(input: LiveCspInput): LiveCspResult | null {
  const { policy, host, scheme, prefix } = input;
  if (!SAFE_HOST.test(host)) return null;
  const sandbox = sandboxDirective(policy);

  if (policy.egress === "open") {
    return { csp: `${sandbox}; object-src 'none'; frame-ancestors 'self'` };
  }

  const wsScheme = scheme === "https" ? "wss" : "ws";
  const p = `${scheme}://${host}${prefix}/`;
  const pws = `${wsScheme}://${host}${prefix}/`;
  const g = [...new Set(input.granted ?? [])].filter((o) => SAFE_ORIGIN.test(o));
  const gStr = g.length > 0 ? ` ${g.join(" ")}` : "";
  const scriptKw = policy.scripts ? "'unsafe-inline' 'unsafe-eval'" : "'unsafe-inline'";
  const s = `${p} ${scriptKw}${gStr}`;
  const styleS = `${p} 'unsafe-inline'${gStr}`;
  const reportPath = `${prefix}${CSP_REPORT_SUBPATH}`;
  const directives = [
    sandbox,
    "default-src 'none'",
    `script-src ${s}`,
    `style-src ${styleS}`,
    `img-src ${p} data: blob:${gStr}`,
    `font-src ${p} data:${gStr}`,
    `media-src ${p} blob:${gStr}`,
    `connect-src ${p} ${pws}${gStr}`,
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    `worker-src ${p} blob:`,
    "manifest-src 'none'",
    `report-uri ${reportPath}`,
    "report-to csp",
  ];
  return { csp: directives.join("; "), reportingEndpoints: `csp="${reportPath}"` };
}
