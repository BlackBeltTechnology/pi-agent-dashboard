/**
 * Client-side OpenSpec reconciliation (fix-connect-snapshot-frame-loss D7).
 *
 * The server's per-cwd `openspec_update` frames are coalesced state frames —
 * under back-pressure one can be lost with the socket still healthy. For
 * every cwd the sidebar actually renders (non-ended session cards ∪ pinned
 * folder cards ∪ the selected session's cwd, any status) that has no SETTLED
 * entry in `openspecMap` (no entry, or only a `pending: true` placeholder)
 * and no in-flight request, send `openspec_get` with a fresh `requestId`.
 *
 * The in-flight mark releases when `useMessageHandler` applies the reply with
 * `final: true` (it shares `inflightRef`), on a 15 s timeout (a lost final
 * reply must not wedge the cwd), or when the socket (re)opens — so every
 * reconnect re-runs the pull and a cold cache after restart self-heals.
 */

import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useEffect, useRef } from "react";
import type { ConnectionStatus } from "./useWebSocket.js";

/** One in-flight `openspec_get` per cwd; the timeout releases the mark. */
export interface OpenSpecGetInflight {
  requestId: string;
  timer: ReturnType<typeof setTimeout>;
}

export type OpenSpecGetInflightRef = React.MutableRefObject<Map<string, OpenSpecGetInflight>>;

/** 15 s: a request whose final reply never lands must not wedge its cwd. */
export const OPENSPEC_GET_TIMEOUT_MS = 15_000;

/** Monotonic per-bundle request-id source — every attempt gets a fresh id. */
let requestSeq = 0;

export interface UseOpenSpecReconcileArgs {
  /** Rendered cwds (caller-computed memo). Ended cards / stub groups excluded. */
  renderedCwds: ReadonlyArray<string>;
  /** The shared OpenSpec map `useMessageHandler` maintains. */
  openspecMap: ReadonlyMap<string, OpenSpecData>;
  /** `useWebSocket` send — the hook owns no socket of its own. */
  send: (msg: BrowserToServerMessage) => void;
  status: ConnectionStatus;
  /** Bumped by `useMessageHandler` on every applied `sessions_snapshot`. */
  snapshotGeneration: number;
  /** Shared with `useMessageHandler` (`final: true` resolves the entry). */
  inflightRef: OpenSpecGetInflightRef;
}

export function useOpenSpecReconcile({
  renderedCwds,
  openspecMap,
  send,
  status,
  snapshotGeneration,
  inflightRef,
}: UseOpenSpecReconcileArgs): void {
  const connected = status === "connected";
  const prevConnectedRef = useRef(connected);

  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      // Socket (re)opened: every in-flight mark is void — its reply may have
      // been lost across the disconnect. Drop marks + timers before pulling.
      for (const entry of inflightRef.current.values()) clearTimeout(entry.timer);
      inflightRef.current.clear();
    }
    prevConnectedRef.current = connected;
    if (!connected) return;
    for (const cwd of renderedCwds) {
      if (inflightRef.current.has(cwd)) continue;
      const entry = openspecMap.get(cwd);
      // Settled = a real entry. A `pending: true` placeholder (a `final:false`
      // reply) is NOT settled — its final reply may never arrive.
      if (entry && entry.pending !== true) continue;
      const requestId = `osget-${Date.now()}-${++requestSeq}`;
      const timer = setTimeout(() => {
        inflightRef.current.delete(cwd);
      }, OPENSPEC_GET_TIMEOUT_MS);
      inflightRef.current.set(cwd, { requestId, timer });
      send({ type: "openspec_get", requestId, cwd });
    }
  }, [connected, snapshotGeneration, renderedCwds, openspecMap, send, inflightRef]);

  // Unmount: no leaked timers.
  useEffect(
    () => () => {
      for (const entry of inflightRef.current.values()) clearTimeout(entry.timer);
      inflightRef.current.clear();
    },
    [inflightRef],
  );
}
