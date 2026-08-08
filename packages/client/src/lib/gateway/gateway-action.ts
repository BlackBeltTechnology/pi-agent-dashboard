/**
 * The "add a gateway URL" action (D12/D13) — pure config algebra, no I/O.
 *
 * One operator statement ("my gateway is `https://pi.example.com`, used for
 * OAuth") becomes ONE `PUT /api/config` writing every key that gateway needs:
 * `publicBaseUrls`, `cors.allowedOrigins`, `auth.redirectBaseUrl` (iff OAuth)
 * and `trustedNetworks` (iff trusted-network) — plus a `gateways[]` provenance
 * record, so removal reverses exactly what add wrote and nothing the operator
 * authored themselves.
 *
 * Everything here is a pure function over a config object precisely so the
 * atomicity is structural: one patch, one write. A partially-applied gateway
 * is not representable.
 *
 * See change: config-override-oauth-redirect-base.
 */

import type {
  GatewayAuthMode,
  GatewayRecord,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { appendPublicBaseUrl, resolvePublicBaseUrls } from "./gateway-config-ops.js";

/** The config slice the action reads and writes. */
export interface GatewayConfigShape {
  publicBaseUrls?: string[];
  pairing?: { publicBaseUrls?: string[]; [k: string]: unknown };
  cors?: { allowedOrigins?: string[] };
  auth?: { redirectBaseUrl?: string; [k: string]: unknown };
  trustedNetworks?: string[];
  gateways?: GatewayRecord[];
}

/** What the operator states in the dialog. */
export interface GatewayDraft {
  url: string;
  authModes: GatewayAuthMode[];
  /** CIDR / host entries; required when `trusted-network` is selected. */
  trustedNetworks?: string[];
}

export type GatewayValidationCode =
  | "url-invalid"
  | "no-auth-mode"
  | "insecure-pairing"
  | "insecure-oauth"
  | "insecure-needs-trusted-network"
  | "trusted-network-empty";

export interface GatewayValidation {
  ok: boolean;
  /** Stable codes; the dialog renders the human copy for each. */
  errors: GatewayValidationCode[];
  /** Parsed origin (`new URL(url).origin`), when the URL parses. */
  origin?: string;
  secure: boolean;
}

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Scheme drives eligibility (D12):
 *
 * | scheme    | trustedNetworks | QR pairing | OAuth |
 * |-----------|-----------------|------------|-------|
 * | `http://` | **required**    | ineligible | ineligible |
 * | `https://`| optional        | eligible   | eligible   |
 *
 * At least one auth mode is mandatory for `https://` too: a gateway with none
 * of {trusted network, pairing, OAuth} is either unreachable or unprotected,
 * and both are worse than a refused save.
 */
export function validateGatewayDraft(draft: GatewayDraft): GatewayValidation {
  const errors: GatewayValidationCode[] = [];
  const parsed = parseUrl(draft.url);
  if (!parsed) return { ok: false, errors: ["url-invalid"], secure: false };

  const secure = parsed.protocol === "https:";
  const modes = new Set(draft.authModes);
  const cidrs = (draft.trustedNetworks ?? []).filter((e) => e.trim().length > 0);

  if (modes.size === 0) errors.push("no-auth-mode");
  if (!secure) {
    // The pairing payload's TLS gate and the OAuth providers' own rules are
    // owned elsewhere; the dialog states them rather than silently dropping.
    if (modes.has("pairing")) errors.push("insecure-pairing");
    if (modes.has("oauth")) errors.push("insecure-oauth");
    if (!modes.has("trusted-network")) errors.push("insecure-needs-trusted-network");
  }
  if (modes.has("trusted-network") && cidrs.length === 0) errors.push("trusted-network-empty");

  return { ok: errors.length === 0, errors, origin: parsed.origin, secure };
}

function addUnique(list: string[] | undefined, entries: string[]): string[] {
  const out = [...(list ?? [])];
  for (const e of entries) if (!out.includes(e)) out.push(e);
  return out;
}

/**
 * The ONE patch that adds a gateway. Every key the gateway needs plus the
 * provenance record ride the same object, so there is no window in which the
 * gateway is half-configured.
 *
 * Seeds the top-level `publicBaseUrls` from the legacy `pairing.publicBaseUrls`
 * on the first write (D12) — otherwise the operator's existing entries stop
 * being read the moment the top-level key appears.
 */
export function buildGatewayAddPatch(
  config: GatewayConfigShape,
  draft: GatewayDraft,
): Record<string, unknown> {
  const validation = validateGatewayDraft(draft);
  if (!validation.ok) throw new Error(`invalid gateway draft: ${validation.errors.join(", ")}`);

  const url = draft.url.trim().replace(/\/+$/, "");
  const origin = validation.origin as string;
  const modes = new Set(draft.authModes);
  const cidrs = (draft.trustedNetworks ?? []).map((e) => e.trim()).filter(Boolean);

  const wrote: GatewayRecord["wrote"] = {
    publicBaseUrls: [url],
    corsAllowedOrigins: [origin],
    ...(modes.has("oauth") ? { authRedirectBaseUrl: url } : {}),
    ...(modes.has("trusted-network") ? { trustedNetworks: cidrs } : {}),
  };

  const record: GatewayRecord = { url, authModes: [...draft.authModes], wrote };

  return {
    // `allowInsecure`: an http:// gateway is a legitimate endpoint-inventory
    // member; the pairing TLS gate stays downstream at read time (D8).
    ...appendPublicBaseUrl(config, url, { allowInsecure: true }),
    cors: { ...(config.cors ?? {}), allowedOrigins: addUnique(config.cors?.allowedOrigins, [origin]) },
    ...(modes.has("oauth") ? { auth: { redirectBaseUrl: url } } : {}),
    ...(modes.has("trusted-network")
      ? { trustedNetworks: addUnique(config.trustedNetworks, cidrs) }
      : {}),
    gateways: [...(config.gateways ?? []).filter((g) => g.url !== url), record],
  };
}

/**
 * Reverse exactly what add wrote: a recorded value is removed only when it is
 * STILL EQUAL in live config. Anything the operator changed since is left
 * alone.
 *
 * Known limit (D12): provenance cannot distinguish authorship of identical
 * values. If the operator had hand-set `auth.redirectBaseUrl` to this URL
 * before adding the gateway, removal clears it — which is why both the add and
 * the remove dialog say so out loud.
 */
export function buildGatewayRemovePatch(
  config: GatewayConfigShape,
  url: string,
): Record<string, unknown> {
  const record = (config.gateways ?? []).find((g) => g.url === url);
  const patch: Record<string, unknown> = {
    gateways: (config.gateways ?? []).filter((g) => g.url !== url),
  };
  if (!record) return patch;

  const wrote = record.wrote ?? {};
  if (wrote.publicBaseUrls?.length) {
    const current = resolvePublicBaseUrls(config);
    patch.publicBaseUrls = current.filter((e) => !wrote.publicBaseUrls?.includes(e));
  }
  if (wrote.corsAllowedOrigins?.length) {
    patch.cors = {
      ...(config.cors ?? {}),
      allowedOrigins: (config.cors?.allowedOrigins ?? []).filter(
        (e) => !wrote.corsAllowedOrigins?.includes(e),
      ),
    };
  }
  if (wrote.authRedirectBaseUrl && config.auth?.redirectBaseUrl === wrote.authRedirectBaseUrl) {
    patch.auth = { redirectBaseUrl: "" };
  }
  if (wrote.trustedNetworks?.length) {
    patch.trustedNetworks = (config.trustedNetworks ?? []).filter(
      (e) => !wrote.trustedNetworks?.includes(e),
    );
  }
  return patch;
}

export type GatewayStatus = "ok" | "incomplete" | "conflicting" | "ineligible";

export interface GatewayStatusResult {
  status: GatewayStatus;
  /** Recorded values absent from live config (drives the Fix delta). */
  missing: GatewayWroteDelta;
  /** For `conflicting`: who holds `auth.redirectBaseUrl` right now. */
  conflictHolder?: string;
}

export interface GatewayWroteDelta {
  publicBaseUrls?: string[];
  corsAllowedOrigins?: string[];
  authRedirectBaseUrl?: string;
  trustedNetworks?: string[];
}

/**
 * Status is computed on read, never persisted — a stored status would itself
 * drift. Trusted networks are checked against the EFFECTIVE merge the runtime
 * uses (top-level `trustedNetworks` ∪ `auth.bypassHosts`), because the Settings
 * editor writes the second key while this action writes the first (D13/D15).
 */
export function computeGatewayStatus(
  config: GatewayConfigShape,
  record: GatewayRecord,
): GatewayStatusResult {
  const missing: GatewayWroteDelta = {};
  const wrote = record.wrote ?? {};

  const livePublic = resolvePublicBaseUrls(config);
  const missingPublic = (wrote.publicBaseUrls ?? []).filter((e) => !livePublic.includes(e));
  if (missingPublic.length) missing.publicBaseUrls = missingPublic;

  const liveCors = config.cors?.allowedOrigins ?? [];
  const missingCors = (wrote.corsAllowedOrigins ?? []).filter((e) => !liveCors.includes(e));
  if (missingCors.length) missing.corsAllowedOrigins = missingCors;

  const effectiveTrusted = [
    ...(config.trustedNetworks ?? []),
    ...(((config.auth as { bypassHosts?: string[] } | undefined)?.bypassHosts) ?? []),
  ];
  const missingTrusted = (wrote.trustedNetworks ?? []).filter((e) => !effectiveTrusted.includes(e));
  if (missingTrusted.length) missing.trustedNetworks = missingTrusted;

  // Eligibility can only regress through a hand-edited or restored config —
  // the UI offers add and remove, not edit. It stays because silent breakage
  // is the worse failure.
  const eligibility = validateGatewayDraft({
    url: record.url,
    authModes: record.authModes,
    trustedNetworks: wrote.trustedNetworks ?? ["placeholder"],
  });
  if (!eligibility.ok) return { status: "ineligible", missing };

  const holder = config.auth?.redirectBaseUrl;
  if (wrote.authRedirectBaseUrl) {
    if (holder && holder !== wrote.authRedirectBaseUrl) {
      return { status: "conflicting", missing, conflictHolder: holder };
    }
    if (!holder) missing.authRedirectBaseUrl = wrote.authRedirectBaseUrl;
  }

  return { status: Object.keys(missing).length ? "incomplete" : "ok", missing };
}

/**
 * Fix is reconcile-to-record, NEVER re-run-add: it writes the delta and nothing
 * else, so it cannot duplicate list entries and cannot silently resurrect a
 * value the operator deliberately removed — the confirmation lists exactly what
 * it will restore.
 */
export function buildGatewayFixPatch(
  config: GatewayConfigShape,
  record: GatewayRecord,
): Record<string, unknown> {
  const { missing } = computeGatewayStatus(config, record);
  const patch: Record<string, unknown> = {};
  if (missing.publicBaseUrls) {
    patch.publicBaseUrls = addUnique(resolvePublicBaseUrls(config), missing.publicBaseUrls);
  }
  if (missing.corsAllowedOrigins) {
    patch.cors = {
      ...(config.cors ?? {}),
      allowedOrigins: addUnique(config.cors?.allowedOrigins, missing.corsAllowedOrigins),
    };
  }
  if (missing.trustedNetworks) {
    patch.trustedNetworks = addUnique(config.trustedNetworks, missing.trustedNetworks);
  }
  if (missing.authRedirectBaseUrl) {
    patch.auth = { redirectBaseUrl: missing.authRedirectBaseUrl };
  }
  return patch;
}
