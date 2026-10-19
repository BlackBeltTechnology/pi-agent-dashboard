/**
 * `useRemoteAccessSnapshot(open, pollActive)` — ONE snapshot for the dialog.
 *
 * One `GET /api/config`, one `/api/tunnel-status-detail`, one
 * `/api/tunnel/endpoints` and one readiness read on open and on every
 * `refresh()` (the dialog calls it on return to the landing and after every
 * write). Each source is tri-state, so a slow or failed read is never rendered
 * as a default. The `reachability_updated` broadcast outranks the config read.
 *
 * See change: add-remote-access-wizard (design D2).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pairingApprovalStore } from "../pairing/pairing-approval-store.js";
import { readConfig, readEndpoints, readStatusDetail } from "./ra-api.js";
import { useLiveReachability } from "./reachability-store.js";
import { FAILED, LOADING, loaded, type RaConfig, type Snapshot, type Tri } from "./steps.js";
import { type ReadinessPoll, useReadinessPoll } from "./use-readiness-poll.js";

export interface RemoteAccessSnapshot {
  snapshot: Snapshot;
  /** Re-read config + status + endpoints + readiness (a new read, not a reset: values stay while it runs). */
  refresh: () => Promise<void>;
  poll: ReadinessPoll;
  /** Pairing requests waiting for the operator, from the app-wide approval state. */
  pendingCount: number;
}

export function useRemoteAccessSnapshot(open: boolean, pollActive: boolean): RemoteAccessSnapshot {
  const [config, setConfig] = useState<Tri<RaConfig>>(LOADING);
  const [status, setStatus] = useState<Snapshot["status"]>(LOADING);
  const [endpoints, setEndpoints] = useState<Snapshot["endpoints"]>(LOADING);
  const poll = useReadinessPoll(open && pollActive);
  const live = useLiveReachability();
  const pending = useSyncExternalStore(pairingApprovalStore.subscribe, pairingApprovalStore.getState).pending;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const pollTick = poll.tick;
  const refresh = useCallback(async () => {
    const settle = <T,>(p: Promise<T>, set: (t: Tri<T>) => void) =>
      p.then(
        (v) => alive.current && set(loaded(v)),
        () => alive.current && set(FAILED),
      );
    await Promise.all([settle(readConfig(), setConfig), settle(readStatusDetail(), setStatus), settle(readEndpoints(), setEndpoints), pollTick()]);
  }, [pollTick]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // The server pushed new bind facts (after a restart the socket replays them):
  // re-read so the rows converge without a manual refresh.
  const liveKey = live ? `${live.resolvedBindHost}|${live.pendingBindHost}` : "";
  const seenLive = useRef(liveKey);
  useEffect(() => {
    if (!open || seenLive.current === liveKey) return;
    seenLive.current = liveKey;
    void refresh();
  }, [open, liveKey, refresh]);

  const readiness: Snapshot["readiness"] =
    poll.lastCheckedAt !== undefined ? loaded(poll.providers) : poll.failed ? FAILED : LOADING;

  return {
    snapshot: { config, readiness, status, endpoints, live: live ?? undefined },
    refresh,
    poll,
    pendingCount: pending.length,
  };
}
