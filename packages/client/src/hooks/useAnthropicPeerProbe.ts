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
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import {
  ANTHROPIC_PEER_SOURCE,
  derivePeerState,
  IMPORT_FAILURE_PREFIX,
} from "../lib/package/anthropic-peer.js";
import { logRejection } from "../lib/report-error.js";

export { ANTHROPIC_PEER_SOURCE, IMPORT_FAILURE_PREFIX };

const POLL_INTERVAL_MS = 60 * 1000;

export interface AnthropicPeerProbeState {
  /** True only on a strict `ok === false` from the bridge probe. */
  peerMissing: boolean;
  /** Probe `reason` verbatim (server-originated, not translatable). */
  peerReason?: string;
  /** True only on a strict `ok === true`. Additive (streamline-first-run). */
  peerResolving: boolean;
  /** Missing with an `import failed:` reason. Additive (streamline-first-run). */
  importFailed: boolean;
}

const NO_PROBE: AnthropicPeerProbeState = { peerMissing: false, peerResolving: false, importFailed: false };

function derive(body: unknown): AnthropicPeerProbeState {
  const s = derivePeerState(body);
  return { peerMissing: s.missing, peerReason: s.reason, peerResolving: s.resolving, importFailed: s.importFailed };
}

export function useAnthropicPeerProbe(): AnthropicPeerProbeState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<AnthropicPeerProbeState>(NO_PROBE);
  const mountedRef = useRef(true);
  // Generation guard: focus + poll + package-event can fire overlapping reads,
  // and a slower earlier response must never overwrite a newer one.
  const readIdRef = useRef(0);

  const read = useCallback(async () => {
    const readId = ++readIdRef.current;
    const fresh = () => mountedRef.current && readId === readIdRef.current;
    try {
      const res = await fetch(`${getApiBase()}/api/health`);
      if (!res.ok) {
        if (fresh()) setState(NO_PROBE);
        return;
      }
      const body = await res.json();
      if (fresh()) setState(derive(body));
    } catch {
      // Fail-open: a failed read is never evidence of a missing peer.
      if (fresh()) setState(NO_PROBE);
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

  return { ...state, refresh: read };
}
