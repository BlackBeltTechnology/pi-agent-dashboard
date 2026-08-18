/**
 * Bridge-probe read for the Anthropic OAuth row's peer hint.
 *
 * Reads `/api/health.plugins[]`, finds the `flows-anthropic-bridge` row and
 * derives `peerMissing` STRICTLY from
 * `lastProbe.peers["@pi/anthropic-messages"].ok === false` (D1/D2). Every other
 * shape — no response, no plugin row, no `lastProbe`, no peer key, malformed
 * payload, still loading — is fail-open (`false`, render nothing): a missing
 * signal is not evidence of a missing peer.
 *
 * Re-read on mount, on a 60 s poll while mounted (cadence adopted from
 * `usePiCompatibility.ts`), on window focus, and on a successful
 * `pi-package-event` `package_operation_complete`.
 *
 * See change: warn-missing-anthropic-messages-peer.
 */
import { PEER_AM_LEGACY } from "@blackbelt-technology/pi-dashboard-flows-anthropic-bridge-plugin/peer-probe";
import { RECOMMENDED_EXTENSIONS } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { logRejection } from "../lib/report-error.js";

const POLL_INTERVAL_MS = 60 * 1000;

const BRIDGE_PLUGIN_ID = "flows-anthropic-bridge";

/** Install source for the peer — the shipped recommended-extensions entry (D8). */
export const ANTHROPIC_PEER_SOURCE: string =
  RECOMMENDED_EXTENSIONS.find((e) => e.id === "pi-anthropic-messages")?.source ?? "";

/** The bridge emits `import failed: …` when resolve succeeded but import threw (D6c). */
export const IMPORT_FAILURE_PREFIX = "import failed:";

export interface AnthropicPeerProbeState {
  /** True only on a strict `ok === false` from the bridge probe. */
  peerMissing: boolean;
  /** Probe `reason` verbatim (server-originated, not translatable). */
  peerReason?: string;
}

/** Narrowing read of an unknown-shaped object property. */
function prop(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function derive(body: unknown): AnthropicPeerProbeState {
  const plugins = prop(body, "plugins");
  if (!Array.isArray(plugins)) return { peerMissing: false };
  const row = plugins.find((p) => prop(p, "id") === BRIDGE_PLUGIN_ID);
  const peers = prop(prop(row, "lastProbe"), "peers");
  const peer = prop(peers, PEER_AM_LEGACY);
  if (prop(peer, "ok") !== false) return { peerMissing: false };
  const reason = prop(peer, "reason");
  return {
    peerMissing: true,
    peerReason: typeof reason === "string" ? reason : undefined,
  };
}

export function useAnthropicPeerProbe(): AnthropicPeerProbeState {
  const [state, setState] = useState<AnthropicPeerProbeState>({ peerMissing: false });
  const mountedRef = useRef(true);

  const read = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/health`);
      if (!res.ok) {
        if (mountedRef.current) setState({ peerMissing: false });
        return;
      }
      const body = await res.json();
      if (!mountedRef.current) return;
      setState(derive(body));
    } catch {
      // Fail-open: a failed read is never evidence of a missing peer.
      if (mountedRef.current) setState({ peerMissing: false });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void read().catch(logRejection("useAnthropicPeerProbe.mount"));
    const timer = setInterval(
      () => void read().catch(logRejection("useAnthropicPeerProbe.poll")),
      POLL_INTERVAL_MS,
    );
    const onFocus = () => void read().catch(logRejection("useAnthropicPeerProbe.focus"));
    const onPackageEvent = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === "package_operation_complete" && msg.success) {
        void read().catch(logRejection("useAnthropicPeerProbe.packageEvent"));
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("pi-package-event", onPackageEvent);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pi-package-event", onPackageEvent);
    };
  }, [read]);

  return state;
}
