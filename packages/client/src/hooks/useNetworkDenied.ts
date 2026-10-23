/**
 * Detects that the active server answers this browser with the network guard's
 * policy denial (HTTP 403 `network_not_allowed`) while the transport is down, so
 * the connection banner can show "Network not allowed" (with a Request access
 * action) instead of a generic "Disconnected / Retrying".
 *
 * Probes `GET {apiBase}/api/health` while the socket is `offline` or `auth_required`, then every
 * `intervalMs` until it connects; any other answer clears the denial. A transport
 * failure is NOT a denial. A 200 carrying `localProof: "required"` is the strict-default
 * "this tab needs proof" state. See changes: distinguish-offline-from-network-denied,
 * add-lan-knock-pairing (design D10), close-container-loopback-impersonation (D3).
 */
import { LOCAL_PROOF_REQUIRED } from "@blackbelt-technology/pi-dashboard-shared/local-proof-signal.js";
import { useEffect, useState } from "react";
import type { ConnectionStatus } from "./useWebSocket.js";

/** The command that authorizes a plain browser tab as local (printed by the server too). */
export const LOCAL_PROOF_COMMAND = "pi-dashboard open";

export interface NetworkDenied {
  hint?: string;
  /** `local_proof_required`: the strict default refuses this tab until `pi-dashboard open` authorizes it. */
  reason?: "local_proof_required";
}

export interface UseNetworkDeniedOptions {
  /** Re-probe cadence while offline. Default 10 s. */
  intervalMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

async function probeNetworkDenied(apiBase: string, fetchImpl: typeof fetch): Promise<NetworkDenied | null> {
  try {
    const res = await fetchImpl(`${apiBase}/api/health`, { signal: AbortSignal.timeout(3000) });
    // Strict default: `/api/health` answers 200 to a bare-loopback tab but says it needs proof.
    if (res.status === 200) {
      const ok = (await res.json().catch(() => null)) as { localProof?: unknown } | null;
      return ok?.localProof === LOCAL_PROOF_REQUIRED
        ? { reason: "local_proof_required", hint: `Run \`${LOCAL_PROOF_COMMAND}\` on this machine to authorize this browser.` }
        : null;
    }
    if (res.status !== 403) return null;
    const body = (await res.json().catch(() => null)) as { error?: unknown; hint?: unknown; reason?: unknown } | null;
    if (body?.error !== "network_not_allowed") return null;
    return {
      ...(typeof body.hint === "string" ? { hint: body.hint } : {}),
      ...(body.reason === "local_proof_required" ? { reason: "local_proof_required" as const } : {}),
    };
  } catch {
    return null;
  }
}

export function useNetworkDenied(
  status: ConnectionStatus,
  apiBase: string,
  opts: UseNetworkDeniedOptions = {},
): NetworkDenied | null {
  const [denied, setDenied] = useState<NetworkDenied | null>(null);
  const intervalMs = opts.intervalMs ?? 10_000;
  const fetchImpl = opts.fetchImpl;

  useEffect(() => {
    if (status === "connected") {
      setDenied(null);
      return;
    }
    // `auth_required` too: with OAuth configured a refused socket becomes `auth_required`, and the
    // sign-in prompt is not what a tab that merely lacks proof is missing.
    if (status !== "offline" && status !== "auth_required") return;
    let cancelled = false;
    const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    const run = () => {
      void probeNetworkDenied(apiBase, doFetch).then((d) => {
        if (!cancelled) setDenied(d);
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, apiBase, intervalMs, fetchImpl]);

  return denied;
}
