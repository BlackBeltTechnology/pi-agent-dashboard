import type { TunnelStatus, TunnelStatusDetail } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { getTunnelStatusDetail } from "../lib/gateway/gateway-api.js";
import { type RemoteAccessTone, remoteAccessIndicator } from "../lib/gateway/gateway-connection.js";
import { pairingApprovalStore } from "../lib/pairing/pairing-approval-store.js";
import { useLiveReachability } from "../lib/remote-access/reachability-store.js";
import { hasStoredRun, takeFreshRun } from "../lib/remote-access/run-store.js";
import type { RunState } from "../lib/remote-access/steps.js";
import { logRejection } from "../lib/report-error.js";

const POLL_INTERVAL = 30_000;

interface RemoteAccessIndicatorState {
  tone: RemoteAccessTone;
  /** Full accessible name: `Remote access: <state>[, N device(s) waiting]`. */
  label: string;
  /** Bare state phrase, e.g. `listening on the network`. */
  state: string;
  /** Raw waiting-device count. */
  pending: number;
  /** A run saved before a Listen-on-network restart, handed to the dialog. */
  resumeRun: RunState | null;
  dialogOpen: boolean;
  /** Refetch status, clear any resumed run, open the dialog on its landing view. */
  openDialog: (trigger?: HTMLElement | null) => Promise<void>;
  /** Close the dialog and return focus to the opener (or a visible chip). */
  closeDialog: () => void;
}

/** True when `el` is attached and laid out (not display:none / detached). */
function isVisible(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && el.isConnected && el.offsetParent !== null;
}

/**
 * Single owner of the Remote access state: the 30 s `/api/tunnel-status` poll
 * (+ gated detail), the `reachability_updated` broadcast, the waiting-pairing
 * count and the `resolvedBindHost`-keyed saved-run resume. Call once, in `App`.
 *
 * See change: declutter-sidebar-header.
 */
export function useRemoteAccessIndicator(): RemoteAccessIndicatorState {
  const [status, setStatus] = useState<TunnelStatus | TunnelStatusDetail | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resumeRun, setResumeRun] = useState<RunState | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const live = useLiveReachability();
  const pending = useSyncExternalStore(pairingApprovalStore.subscribe, pairingApprovalStore.getState).pending.length;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/tunnel-status`);
      if (res.ok) {
        const data = (await res.json()) as TunnelStatus;
        // The ungated counts cannot tell a failed provider from an idle one; the
        // gated twin can (null for a browser without access — harmless).
        const detail = data.gateway && data.gateway.expected > 0 ? await getTunnelStatusDetail().catch(() => null) : null;
        setStatus(detail?.providers ? { ...data, providers: detail.providers } : data);
        return data;
      }
    } catch {
      // a failed fetch keeps the last known state
    }
    return null;
  }, []);

  useEffect(() => {
    void fetchStatus().catch(logRejection("useRemoteAccessIndicator.fetchStatus"));
    const id = setInterval(() => {
      void fetchStatus().catch(logRejection("useRemoteAccessIndicator.poll"));
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Resume a run saved by Listen on network: on mount (page reload) and when the
  // server's RESOLVED bind host changes (only across a restart). The key is
  // always removed when read.
  const resolved = live?.resolvedBindHost ?? null;
  const lastResolved = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const first = lastResolved.current === undefined;
    const changed = !first && lastResolved.current !== resolved;
    lastResolved.current = resolved;
    if (!(first || changed) || !hasStoredRun()) return;
    const run = takeFreshRun();
    if (run) {
      setResumeRun(run);
      setDialogOpen(true);
    }
  }, [resolved]);

  const openDialog = useCallback(
    async (trigger?: HTMLElement | null) => {
      triggerRef.current = trigger ?? null;
      await fetchStatus();
      setResumeRun(null);
      setDialogOpen(true);
    },
    [fetchStatus],
  );

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setResumeRun(null);
    const stored = triggerRef.current;
    triggerRef.current = null;
    // Deferred so the dialog's own focus-restore on unmount cannot win.
    setTimeout(() => {
      const target = isVisible(stored)
        ? stored
        : Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connection-chip"]')).find(isVisible);
      target?.focus();
    }, 0);
  }, []);

  const { tone, title, state } = remoteAccessIndicator(status, resolved, pending);
  return { tone, label: title, state, pending, resumeRun, dialogOpen, openDialog, closeDialog };
}
