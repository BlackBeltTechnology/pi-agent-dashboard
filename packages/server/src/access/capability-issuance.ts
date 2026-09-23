/**
 * Who is issued a prompt capability (design D1a; tasks 2b.1, 3.2, 3.5).
 *
 * An admitted origin is not by itself evidence of a browser: `isOriginAdmitted`
 * returns `true` when `Origin` is ABSENT (`cors-origin.ts:244`), deliberately,
 * so non-browser local clients keep working. Issuing a capability to every
 * admitted socket would therefore hand one to any local process that opens the
 * WebSocket without an `Origin` — the defeat D1a records.
 *
 * Issuance additionally requires browser-shaped provenance, all of:
 *   1. a NON-ABSENT, non-empty `Origin` that the admission rule admits
 *      (`isOriginAdmitted` — same-origin-by-Host, or an explicitly configured
 *      origin with the zrok wildcard DISABLED);
 *   2. `Sec-Fetch-Site` of `same-origin` or `cross-site`. `cross-site` exists for
 *      the neutral `pi-dashboard.dev` shell, which is cross-site by construction;
 *      it qualifies only because condition 1 already demanded the admission
 *      rule admit its Origin. `same-site`, `none`, and absent do not qualify;
 *   3. the credential tier the UI itself requires of the connection. That tier
 *      is enforced by the upgrade gate BEFORE the socket exists
 *      (`server.ts:2938-2950`): a socket reaching this predicate has already
 *      passed it, so it is not re-derived here.
 *
 * These are PROVENANCE SIGNALS, NOT AN AUTHENTICATION BOUNDARY. A process on the
 * same machine can forge every header above; D1b records that residual (R-A,
 * R-C) rather than claiming it closed.
 *
 * See change: add-access-grant-dialog.
 */
import { type CorsOriginOptions, isOriginAdmitted } from "../auth/cors-origin.js";

/** Upgrade-request headers, as `http.IncomingMessage` exposes them. */
export type UpgradeHeaders = Record<string, string | string[] | undefined>;

/** `Sec-Fetch-Site` values that qualify for issuance. */
const QUALIFYING_FETCH_SITES: ReadonlySet<string> = new Set(["same-origin", "cross-site"]);

/** A header that may arrive repeated; a repeated provenance header is refused. */
function single(headers: UpgradeHeaders, name: string): string | undefined {
  const raw = headers[name];
  return typeof raw === "string" ? raw : undefined;
}

/**
 * Whether a newly connected browser socket is issued a prompt capability.
 *
 * Fail-closed: anything missing, repeated, or unrecognised answers `false`. A
 * socket refused here still works for every other purpose; it simply never
 * receives a capability, so every denial attributable to it is ineligible.
 */
export function shouldIssuePromptCapability(
  headers: UpgradeHeaders | undefined,
  opts: CorsOriginOptions,
): boolean {
  if (!headers) return false;
  const origin = single(headers, "origin");
  // Condition 1 — absent is exactly the non-browser case D1a closes.
  if (origin === undefined || origin === "") return false;
  if (!isOriginAdmitted(origin, single(headers, "host"), opts)) return false;
  // Condition 2.
  const site = single(headers, "sec-fetch-site");
  if (site === undefined || !QUALIFYING_FETCH_SITES.has(site)) return false;
  // Condition 3 is enforced upstream by the upgrade gate (see header).
  return true;
}
