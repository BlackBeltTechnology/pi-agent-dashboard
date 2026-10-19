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
