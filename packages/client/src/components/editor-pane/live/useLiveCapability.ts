/**
 * Capability lifecycle for ONE framed live preview (change:
 * improve-canvas-html-and-url-ux, D4/D5/D8).
 *
 * - Mints before framing, passing the tab's policy on EVERY mint.
 * - Reuses a token only while (target, egress, scripts, exposure epoch) is
 *   unchanged; any change re-mints, and a frame is never shown under a token
 *   minted for a different policy.
 * - Re-mints `REMINT_LEAD_MS` before the absolute expiry (retrying on failure).
 * - Keepalive: `POST /touch` every 5 min while mounted AND the page is visible,
 *   so an idle page does not 404 on lazy assets. A failed touch (revoked/expired
 *   token) forces a policy re-read and a re-mint.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mintLiveCapability, type PreviewPolicy, touchLiveCapability } from "../../../lib/api/live-server-api.js";

/** Re-mint this long before the capability's absolute expiry. */
export const REMINT_LEAD_MS = 10 * 60_000;
/** Retry cadence after a failed re-mint (the current token is still valid meanwhile). */
export const REMINT_RETRY_MS = 30_000;
/** Keepalive cadence (static idle expiry is 10 min). */
export const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface LiveCapability {
  /** `/live/<id>/~c/<token>/` — framed, never displayed. */
  path: string;
  expiresAt: number;
  tokenId?: string;
  /** What the server actually granted (falls back to what was requested). */
  policy: PreviewPolicy;
}

interface Params {
  targetId: string | null;
  policy: PreviewPolicy;
  /** The operator's "Run scripts" click for the current epoch. */
  runScripts: boolean;
  epoch: number;
  viewerId: string;
  /** Hold off minting (e.g. until the exposure policy is known). */
  enabled: boolean;
  /** Called when a keepalive fails: re-read the policy. */
  onTouchFailed?: () => void;
}

export function useLiveCapability({ targetId, policy, runScripts, epoch, viewerId, enabled, onTouchFailed }: Params) {
  const [cap, setCap] = useState<(LiveCapability & { key: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forced, setForced] = useState(0);

  const key = targetId ? `${targetId}|${policy.egress}|${policy.scripts}|${epoch}` : "";
  // Latest request params, read by timers without re-subscribing them.
  const latest = useRef({ policy, runScripts, viewerId });
  latest.current = { policy, runScripts, viewerId };
  const touchFailedRef = useRef(onTouchFailed);
  touchFailedRef.current = onTouchFailed;

  const mint = useCallback(
    (id: string) => {
      const { policy: p, runScripts: run, viewerId: v } = latest.current;
      return mintLiveCapability(id, { policy: p, runScripts: run || undefined, viewerId: v });
    },
    [],
  );

  // Mint on (target, policy, epoch) change — and on a forced re-mint.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `forced` is a deliberate re-mint trigger; params read via `latest`
  useEffect(() => {
    if (!targetId || !enabled) {
      setCap(null);
      return;
    }
    let cancelled = false;
    setError(null);
    void mint(targetId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setCap(null);
        setError(res.error);
        return;
      }
      setCap({
        key,
        path: res.path,
        expiresAt: res.expiresAt,
        tokenId: res.tokenId,
        policy: res.policy ?? latest.current.policy,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key, targetId, enabled, forced, mint]);

  // Re-mint before the absolute expiry and re-point the frame. A failed re-mint retries
  // (the current token still works until `expiresAt`).
  const expiresAt = cap?.expiresAt;
  const capKey = cap?.key;
  useEffect(() => {
    if (!targetId || expiresAt == null || !capKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const next = await mint(targetId);
      if (cancelled) return;
      if (next.ok) {
        setCap({ key: capKey, path: next.path, expiresAt: next.expiresAt, tokenId: next.tokenId, policy: next.policy ?? latest.current.policy });
      } else if (Date.now() < expiresAt) {
        timer = setTimeout(run, REMINT_RETRY_MS);
      }
    };
    timer = setTimeout(run, Math.max(0, expiresAt - REMINT_LEAD_MS - Date.now()));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [targetId, expiresAt, capKey, mint]);

  // Keepalive while mounted + visible.
  const tokenId = cap?.tokenId;
  useEffect(() => {
    if (!targetId || !tokenId) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      void touchLiveCapability(targetId, tokenId).then((ok) => {
        if (ok) return;
        touchFailedRef.current?.();
        setForced((n) => n + 1);
      });
    };
    const sync = () => {
      const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
      if (visible && !interval) interval = setInterval(tick, TOUCH_INTERVAL_MS);
      if (!visible && interval) {
        clearInterval(interval);
        interval = undefined;
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      if (interval) clearInterval(interval);
    };
  }, [targetId, tokenId]);

  /** Only a capability minted for the CURRENT (target, policy, epoch) is ever returned. */
  const capability = useMemo(() => (cap && cap.key === key ? cap : null), [cap, key]);
  const remint = useCallback(() => setForced((n) => n + 1), []);
  return { capability, error, remint };
}
