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
import type { ReservedNameResult, TunnelStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ProviderReadiness } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";

/**
 * Client-side bound on a readiness request.
 *
 * Longer than the server's 4s per-predicate bound (a tick legitimately runs
 * several predicates) but well under the 5s poll interval times a small factor,
 * so a wedged request cannot outlive a couple of ticks.
 */
const READINESS_REQUEST_TIMEOUT_MS = 8_000;

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

/**
 * Set, replace or clear the zrok reserved name — independently of connecting.
 *
 * `name: null` clears (release + forget); a string sets or replaces. The
 * response is a TYPED outcome rather than a bare ok/fail, because `taken`,
 * `invalid` and `write-failed` are three different things a user acts on
 * differently. Rejections arrive as a 200 with a non-`ok` status: they are
 * answers, not transport errors. See change: add-zrok-custom-reserved-name.
 */
export async function setReservedName(name: string | null): Promise<ReservedNameResult> {
  const res = await fetch(`${getApiBase()}/api/tunnel-reserved-name`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: ReservedNameResult; error?: string }
    | null;
  if (!res.ok || !body?.success || !body.data) {
    throw new Error(body?.error ?? t("err.reservedNameFailed", undefined, "Failed to set the reserved name"));
  }
  return body.data;
}

/**
 * Per-provider readiness for the Gateway board.
 *
 * Costs a subprocess per provider server-side, so only the dialog-bound poll
 * calls it — never a background timer. See change: add-zrok-custom-reserved-name.
 */
/**
 * The GATED tunnel status.
 *
 * `/api/tunnel-status` is ungated (the indicator renders before auth exists) and
 * therefore redacts `degraded.configuredName` — a reserved name the operator
 * owns but is not serving is not already-public information. The dialog needs
 * the name to say WHICH one was not used, so it reads this twin instead.
 */
export async function getTunnelStatusDetail(): Promise<TunnelStatus | null> {
  const res = await fetch(`${getApiBase()}/api/tunnel-status-detail`);
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as TunnelStatus | null;
}

export async function getProviderReadiness(signal?: AbortSignal): Promise<ProviderReadiness[]> {
  // The request MUST be bounded. The caller clears its `inFlight` flag only when
  // this settles, and overlap suppression refuses every later tick while that
  // flag is set — so one hung request would stop the board polling for as long
  // as the dialog stays open, with no recovery short of closing it. The server's
  // 4s per-predicate bound does not reach the client's socket.
  const timeout = AbortSignal.timeout(READINESS_REQUEST_TIMEOUT_MS);
  const res = await fetch(`${getApiBase()}/api/tunnel-readiness`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(t("err.readinessFailed", undefined, "Failed to read provider readiness"));
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: { providers?: ProviderReadiness[] };
  } | null;
  // A `success: false` body is a FAILURE, not an empty board: mapping it to []
  // renders zero rows with no error, which is indistinguishable from "no
  // providers exist" — the same silent degrade this change exists to remove.
  if (!body?.success || !Array.isArray(body.data?.providers)) {
    throw new Error(t("err.readinessFailed", undefined, "Failed to read provider readiness"));
  }
  return body.data.providers;
}
