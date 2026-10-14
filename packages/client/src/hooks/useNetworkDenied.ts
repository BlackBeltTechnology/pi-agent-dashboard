/**
 * Detects that the active server answers this browser with the network guard's
 * policy denial (HTTP 403 `network_not_allowed`) while the transport is down, so
 * the connection banner can show "Network not allowed" (with a Request access
 * action) instead of a generic "Disconnected / Retrying".
 *
 * Probes `GET {apiBase}/api/health` while the socket is `offline`, then every
 * `intervalMs` until it connects; any other answer clears the denial. A transport
 * failure is NOT a denial. See changes: distinguish-offline-from-network-denied,
 * add-lan-knock-pairing (design D10).
 */
import { useEffect, useState } from "react";
import type { ConnectionStatus } from "./useWebSocket.js";

export interface NetworkDenied {
  hint?: string;
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
    if (res.status !== 403) return null;
    const body = (await res.json().catch(() => null)) as { error?: unknown; hint?: unknown } | null;
    if (body?.error !== "network_not_allowed") return null;
    return typeof body.hint === "string" ? { hint: body.hint } : {};
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
    if (status !== "offline") return;
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
