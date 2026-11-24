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
  /**
   * Origin-bound capability (tiers 1-4, D6): the exact capability origin (`http://<label>.localhost:8000`) and
   * the exact dashboard origin(s) it was minted from. Sources come from the ENTRY, never from the request.
   * Absent ⇒ legacy / tier 5 (path-scoped lists, `frame-ancestors 'self'`, opaque sandbox).
   */
  origin?: string;
  ancestors?: readonly string[];
}

export interface LiveCspResult {
  /** `Content-Security-Policy` header value. */
  csp: string;
}

/** A canonical https origin: no path/space/`;`/`,` can ride into the header. */
const SAFE_ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
/** A `Host` header value we are willing to embed in a header. */
const SAFE_HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
/** A dashboard / capability origin we are willing to embed in `frame-ancestors` (http or https, never IPv6, no path). */
const SAFE_ANCESTOR = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

/** The report endpoint, relative to the capability prefix. */
export const CSP_REPORT_SUBPATH = "/__pi/csp-report";

function sandboxDirective(policy: LivePolicy, sameOrigin: boolean): string {
  if (!policy.scripts) return "sandbox";
  // Without `allow-same-origin` the header would force an opaque origin whatever the frame attribute says (P3).
  const so = sameOrigin ? " allow-same-origin" : "";
  return policy.egress === "open"
    ? `sandbox allow-scripts${so} allow-forms allow-popups allow-downloads`
    : `sandbox allow-scripts${so} allow-forms`;
}

/** `frame-ancestors` of an origin-bound capability: the minting dashboard origin(s) plus the capability origin itself. */
function boundAncestors(origin: string, ancestors: readonly string[] | undefined): string | null {
  if (!ancestors || ancestors.length === 0) return null;
  const list = [...new Set([...ancestors, origin])];
  if (!list.every((a) => SAFE_ANCESTOR.test(a))) return null;
  return `frame-ancestors ${list.join(" ")}`;
}

/** Source bases of the restricted lists. Origin-bound: origin-root from the entry (never the request Host / scheme). Legacy / tier 5: path-scoped. */
function sourceBases(input: LiveCspInput): { p: string; pws: string; frameSrc: string; reportPath: string } {
  const { host, scheme, prefix } = input;
  if (input.origin !== undefined) {
    const originUrl = new URL(input.origin); // validated by `boundAncestors` (SAFE_ANCESTOR) before this runs
    return {
      p: `${input.origin}/`,
      pws: `${originUrl.protocol === "https:" ? "wss" : "ws"}://${originUrl.host}/`,
      frameSrc: "frame-src 'self'",
      reportPath: CSP_REPORT_SUBPATH,
    };
  }
  const p = `${scheme}://${host}${prefix}/`;
  return {
    p,
    pws: `${scheme === "https" ? "wss" : "ws"}://${host}${prefix}/`,
    // Tier 5 (a `/preview/<pid>` prefix) frames its own base; legacy keeps `'none'`.
    frameSrc: prefix.startsWith("/preview/") ? `frame-src ${p}` : "frame-src 'none'",
    reportPath: `${prefix}${CSP_REPORT_SUBPATH}`,
  };
}

/**
 * Build the CSP for one capability response. Returns `null` when `host` is not a
 * plain host[:port] (fail closed — the caller answers 404 rather than emit a
 * header it cannot trust).
 */
export function buildLiveCsp(input: LiveCspInput): LiveCspResult | null {
  const { policy, host } = input;
  if (!SAFE_HOST.test(host)) return null;
  const bound = input.origin !== undefined;
  const sandbox = sandboxDirective(policy, bound);
  let frameAncestors = "frame-ancestors 'self'";
  if (input.origin !== undefined) {
    // Fail closed on a malformed origin / missing ancestors: a bad entry never yields a header (D6, X38).
    if (!SAFE_ANCESTOR.test(input.origin)) return null;
    const fa = boundAncestors(input.origin, input.ancestors);
    if (!fa) return null;
    frameAncestors = fa;
  }

  if (policy.egress === "open") {
    return { csp: `${sandbox}; object-src 'none'; ${frameAncestors}` };
  }

  const { p, pws, frameSrc, reportPath } = sourceBases(input);
  const g = [...new Set(input.granted ?? [])].filter((o) => SAFE_ORIGIN.test(o));
  const gStr = g.length > 0 ? ` ${g.join(" ")}` : "";
  const scriptKw = policy.scripts ? "'unsafe-inline' 'unsafe-eval'" : "'unsafe-inline'";
  const s = `${p} ${scriptKw}${gStr}`;
  const styleS = `${p} 'unsafe-inline'${gStr}`;
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
    frameSrc,
    "object-src 'none'",
    frameAncestors,
    `worker-src ${p} blob:`,
    "manifest-src 'none'",
    `report-uri ${reportPath}`,
  ];
  return { csp: directives.join("; ") };
}
