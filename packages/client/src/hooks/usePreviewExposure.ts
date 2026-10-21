/**
 * Exposure + access-prompting policy for live previews (change:
 * improve-canvas-html-and-url-ux, design D5). Reads `GET /api/live-server/policy`
 * and re-reads it whenever the server pushes `preview_exposure_changed`.
 *
 * Fails CLOSED: while the answer is unknown, or when the read fails, the
 * dashboard is treated as exposed (restricted previews keep scripts off).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getLivePolicy } from "../lib/api/live-server-api.js";
import { getPushedExposureEpoch, subscribeExposure } from "../lib/live-preview/exposure-store.js";

export interface PreviewExposure {
  /** `false` until the first read settles. */
  ready: boolean;
  exposed: boolean;
  /** Exposure epoch; `-1` when the read failed (never equals a real epoch). */
  epoch: number;
  promptingEnabled: boolean;
  /** Force a re-read (a revoked token, a touch failure). */
  refresh: () => void;
}

type Snapshot = Pick<PreviewExposure, "ready" | "exposed" | "epoch" | "promptingEnabled">;
const UNKNOWN: Snapshot = { ready: false, exposed: true, epoch: -1, promptingEnabled: false };

export function usePreviewExposure(): PreviewExposure {
  const [snap, setSnap] = useState<Snapshot>(UNKNOWN);
  const [reads, setReads] = useState(0);
  const pushed = useSyncExternalStore(subscribeExposure, getPushedExposureEpoch, getPushedExposureEpoch);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `pushed` and `reads` are deliberate re-read triggers
  useEffect(() => {
    let cancelled = false;
    void getLivePolicy().then((p) => {
      if (cancelled) return;
      setSnap(
        p
          ? { ready: true, exposed: p.exposure === "exposed", epoch: p.epoch, promptingEnabled: p.promptingEnabled }
          : { ready: true, exposed: true, epoch: -1, promptingEnabled: false },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [pushed, reads]);

  const refresh = useCallback(() => setReads((n) => n + 1), []);
  return { ...snap, refresh };
}
