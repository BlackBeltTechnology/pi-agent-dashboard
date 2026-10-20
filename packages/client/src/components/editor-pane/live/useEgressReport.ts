/**
 * Blocked-origin report for a framed preview (change: improve-canvas-html-and-url-ux,
 * D6/D8). Polls `GET /:id/egress` every 2 s while the viewer is visible and the
 * preview is restricted, and STOPS after 30 s without the answer changing; a
 * reload, an allow, a new token or the tab becoming visible again restarts it.
 * `once` mode (open-egress static targets) reads it a single time for the
 * root-absolute hint.
 */
import { useCallback, useEffect, useState } from "react";
import { type EgressReport, getLiveEgress } from "../../../lib/api/live-server-api.js";

const EGRESS_POLL_MS = 2000;
const EGRESS_IDLE_STOP_MS = 30_000;

export type EgressMode = "poll" | "once" | "off";

const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/**
 * Start polling; returns the stop function. `poll` mode re-arms every 2 s, goes quiet
 * while the page is hidden (resumed by `visibilitychange`) and stops after 30 s without
 * a change; `once` reads a single time.
 */
function startPolling(targetId: string, tokenId: string, mode: "poll" | "once", publish: (r: EgressReport) => void): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSig = "";
  let lastChange = Date.now();

  const poll = async () => {
    timer = undefined;
    if (cancelled || (mode === "poll" && !pageVisible())) return;
    const next = await getLiveEgress(targetId, tokenId);
    if (cancelled) return;
    const sig = next ? JSON.stringify(next) : lastSig;
    if (next && sig !== lastSig) {
      lastSig = sig;
      lastChange = Date.now();
      publish(next);
    }
    if (mode === "once" || Date.now() - lastChange >= EGRESS_IDLE_STOP_MS) return;
    timer = setTimeout(poll, EGRESS_POLL_MS);
  };
  const onVisibility = () => {
    if (mode === "poll" && pageVisible() && !timer && !cancelled) {
      lastChange = Date.now();
      void poll();
    }
  };
  void poll();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function useEgressReport(targetId: string | null, tokenId: string | undefined, mode: EgressMode) {
  const [report, setReport] = useState<EgressReport | null>(null);
  const [restartNonce, setRestartNonce] = useState(0);

  // Reset on a new token: the previous token's report describes a different blocked set.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tokenId / targetId are the reset triggers
  useEffect(() => {
    setReport(null);
  }, [tokenId, targetId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restartNonce is a deliberate restart trigger
  useEffect(() => {
    if (!targetId || !tokenId || mode === "off") return;
    return startPolling(targetId, tokenId, mode, setReport);
  }, [targetId, tokenId, mode, restartNonce]);

  const restart = useCallback(() => setRestartNonce((n) => n + 1), []);
  return { report, restart };
}
