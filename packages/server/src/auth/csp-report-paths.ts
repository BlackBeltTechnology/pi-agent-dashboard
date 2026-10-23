/**
 * Shared path contract for the baseline CSP report sink. Emission (`csp.ts`)
 * and the sink route (`csp-report-sink.ts`) both import from here so the
 * `report-uri` a header advertises can never drift from the route that serves it.
 *
 * `/__pi/csp-report/:policy` sits at the root, OUTSIDE guard jurisdiction
 * (`/api`, `/v1`, `/editor`, `/live`), and is distinct from the per-preview
 * `/live/<id>/__pi/csp-report` sink.
 *
 * See change: harden-cors-and-csp-reporting (D8).
 */

export const CSP_REPORT_PREFIX = "/__pi/csp-report/";

/** Policy labels a report can be filed under; anything else → 404. */
export const CSP_REPORT_POLICIES = ["baseline", "strict", "trusted-types"] as const;
export type CspReportPolicy = (typeof CSP_REPORT_POLICIES)[number];

export function isCspReportPolicy(v: string): v is CspReportPolicy {
  return (CSP_REPORT_POLICIES as readonly string[]).includes(v);
}

/** `/__pi/csp-report/<policy>` */
export function cspReportPath(policy: CspReportPolicy): string {
  return `${CSP_REPORT_PREFIX}${policy}`;
}

/** Reporting API endpoint name declared in `Reporting-Endpoints` (`csp-<policy>`). */
export function cspReportEndpointName(policy: CspReportPolicy): string {
  return `csp-${policy}`;
}
