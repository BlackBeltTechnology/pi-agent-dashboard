/**
 * Client fetch helpers for the Gateway surfaces (settings page + dialog).
 *
 * Wraps the auth-gated server routes added by add-tunnel-providers:
 *   - `GET  /api/tunnel/endpoints`   — tagged "Accessible at" list.
 *   - `GET  /api/tunnel/block-events`— recent guard denials (Trust banner).
 *   - `POST /api/tunnel/enroll`      — whitelisted auth-token/activate recipe.
 *   - `GET  /api/config` / `PUT /api/config` — publicBaseUrls + trustedNetworks.
 *   - `GET/POST /api/tunnel-status|connect|disconnect` — lifecycle.
 *
 * See change: add-tunnel-providers.
 */
import type { TunnelStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "../api/api-context.js";
import { fetchJsonResponse } from "../api/fetch-json.js";
import { t } from "../i18n/i18n.js";

/** A coalesced network-guard denial (mirror of the server `BlockEvent`). */
export interface BlockEvent {
  ip: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
  /** False for loopback/proxy-terminated peers — UI suppresses "Trust". */
  trustable: boolean;
}

export async function getBlockEvents(): Promise<BlockEvent[]> {
  const { json } = await fetchJsonResponse<{
    success: boolean;
    data?: { events: BlockEvent[] };
  }>(`${getApiBase()}/api/tunnel/block-events`);
  return json.success && json.data ? json.data.events : [];
}

export type EnrollResult = { ok: true } | { ok: false; error: string };

/** Run a whitelisted enroll step server-side. `param` is validated server-side. */
export async function runEnrollStep(
  provider: string,
  step: string,
  param: string,
): Promise<EnrollResult> {
  try {
    const { json } = await fetchJsonResponse<{ success: boolean; error?: string }>(
      `${getApiBase()}/api/tunnel/enroll`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, step, param }),
      },
    );
    if (json.success) return { ok: true };
    return { ok: false, error: json.error ?? "enroll failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "enroll failed" };
  }
}

/** Raw (redacted) config read — used to re-read `pairing` before a full PUT. */
export async function getConfig(): Promise<Record<string, unknown>> {
  const { json } = await fetchJsonResponse<{ success: boolean; data?: Record<string, unknown> }>(
    `${getApiBase()}/api/config`,
  );
  return json.success && json.data ? json.data : {};
}

/** Write a config partial through the existing auth-gated route. */
export async function putConfig(partial: Record<string, unknown>): Promise<void> {
  const { json } = await fetchJsonResponse<{ success: boolean; error?: string }>(
    `${getApiBase()}/api/config`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(partial),
    },
  );
  if (!json.success) throw new Error(json.error ?? "config write failed");
}

export async function getTunnelStatus(): Promise<TunnelStatus | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/tunnel-status`);
    if (res.ok) return (await res.json()) as TunnelStatus;
  } catch {
    /* ignore */
  }
  return null;
}

export async function connectTunnel(): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/tunnel-connect`, { method: "POST" });
  const data = res.ok ? await res.json() : null;
  if (!data?.ok) throw new Error(data?.error || t("err.connectTunnelFailed", undefined, "Failed to connect tunnel"));
}

/**
 * Disconnect the tunnel. `forget: true` also releases a v2 reserved name
 * (`delete name`) and clears it from config — the stable URL is gone. Plain
 * disconnect PRESERVES a reserved name. See change: support-zrok-v2.
 */
export async function disconnectTunnel(opts?: { forget?: boolean }): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/tunnel-disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ forget: opts?.forget === true }),
  });
  if (!res.ok) throw new Error(t("err.disconnectTunnelFailed", undefined, "Failed to disconnect tunnel"));
}
