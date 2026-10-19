/**
 * Client helpers for the Gateway "Built-in HTTPS" section.
 *
 *   - `GET  /api/health`      → `tls` (cached state only; never calls out)
 *   - `POST /api/tls/issue`   → operator "issue now" (Renew now / Try again now / Check now)
 *   - `GET/PUT /api/config`   → the `tls` block (via `gateway-api`)
 *
 * See change: add-tailscale-cert-tls.
 */
import type { TlsStatus } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import { getApiBase } from "../api/api-context.js";
import { fetchJsonResponse } from "../api/fetch-json.js";
import { t } from "../i18n/i18n.js";

/** The `tls` object of `/api/health`, or `null` when the server does not report one. */
export async function getTlsStatus(): Promise<TlsStatus | null> {
  const { json } = await fetchJsonResponse<{ tls?: TlsStatus }>(`${getApiBase()}/api/health`);
  const tls = json?.tls;
  return tls && typeof tls === "object" && typeof tls.enabled === "boolean" ? tls : null;
}

/**
 * The stored `tls` config block, read STRICTLY: any non-success read (HTTP error, `success:false`,
 * no `data`) throws, so a failed read can never be mistaken for "no sources configured" (the shared
 * `getConfig()` answers `{}` on those). `{}` only when the read succeeded and there is no block.
 */
export async function getStoredTlsConfig(): Promise<Record<string, unknown>> {
  const { res, json } = await fetchJsonResponse<{ success?: boolean; data?: Record<string, unknown> }>(
    `${getApiBase()}/api/config`,
  );
  if (!res.ok || json?.success !== true || !json.data || typeof json.data !== "object") {
    throw new Error(t("gateway.tls.err.configRead", undefined, "Could not read the current settings"));
  }
  const tls = json.data.tls;
  return tls && typeof tls === "object" && !Array.isArray(tls) ? (tls as Record<string, unknown>) : {};
}

/**
 * Ask the server to (re)issue now. `name` absent = every name of the source that needs it.
 * Throws with the server's reason on a refusal (409 listener disabled, 404 unknown source/name, 401/403).
 */
export async function issueTlsNow(sourceId: string, name?: string): Promise<void> {
  const { res, json } = await fetchJsonResponse<{ success?: boolean; error?: string }>(`${getApiBase()}/api/tls/issue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(name === undefined ? { sourceId } : { sourceId, name }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(t("remoteAccess.err.refused", undefined, "This browser is not allowed to make the change."));
  }
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error ?? t("gateway.tls.err.issueFailed", undefined, "Could not start the certificate request"));
  }
}

// ── ACME (domain certificate) source writes — see change: add-acme-dns01-certs (design D5, D11) ──

type AcmeDirectory = "staging" | "production" | string;
type AcmeSolver =
  | { type: "cloudflare"; zoneId?: string }
  | { type: "acme-dns"; server: string; subdomain: string; fulldomain: string };

/** One `acme` entry as the per-entry route stores it. */
export interface AcmeSourceEntry {
  type: "acme";
  id: string;
  domains: string[];
  email: string;
  agreeTos: true;
  directory: AcmeDirectory;
  advertise?: boolean;
  solver: AcmeSolver;
}

/** An `acme` entry as `GET /api/config` projects it: `solver.configured` says whether the vault holds its secrets. */
export type StoredAcmeEntry = Omit<AcmeSourceEntry, "solver" | "agreeTos"> & {
  agreeTos?: boolean;
  solver: AcmeSolver & { configured?: boolean };
};

/** Write-only secret body of the credentials route (Cloudflare token, or acme-dns user + key). */
export type AcmeCredentials = { token: string } | { user: string; key: string };

async function sendAcme(method: "PUT" | "DELETE", url: string, body: unknown, fallback: string): Promise<void> {
  const { res, json } = await fetchJsonResponse<{ success?: boolean; error?: string }>(`${getApiBase()}${url}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(t("remoteAccess.err.refused", undefined, "This browser is not allowed to make the change."));
  }
  if (!res.ok || json?.success === false) throw new Error(json?.error ?? fallback);
}

const acmeUrl = (id: string): string => `/api/tls/acme/${encodeURIComponent(id)}`;

/** Upsert one acme entry. Throws with the server's field-naming message on 400/409. */
export const putAcmeSource = (entry: AcmeSourceEntry): Promise<void> =>
  sendAcme("PUT", acmeUrl(entry.id), entry, t("gateway.acme.err.saveFailed", undefined, "Could not save this domain certificate source"));

/** Remove one acme entry (and, server-side, its vault secrets). */
export const deleteAcmeSource = (id: string): Promise<void> =>
  sendAcme("DELETE", acmeUrl(id), undefined, t("gateway.acme.err.removeFailed", undefined, "Could not remove this source"));

/** Store the solver secrets in the credential vault. The secret travels only in the body. */
export const putAcmeCredentials = (id: string, credentials: AcmeCredentials): Promise<void> =>
  sendAcme("PUT", `${acmeUrl(id)}/credentials`, credentials, t("gateway.acme.err.credentialsFailed", undefined, "Could not save the credentials"));

/** The stored acme entries (strict read, see `getStoredTlsConfig`). */
export async function getStoredAcmeSources(): Promise<StoredAcmeEntry[]> {
  const sources = (await getStoredTlsConfig()).sources;
  return Array.isArray(sources) ? (sources.filter((s) => s && typeof s === "object" && (s as { type?: unknown }).type === "acme") as StoredAcmeEntry[]) : [];
}
