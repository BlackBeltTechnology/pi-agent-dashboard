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
import { type CapabilityResult, mintLiveCapability, type PreviewPolicy, touchLiveCapability } from "../../../lib/api/live-server-api.js";
import type { MintShape } from "../../../lib/live-preview/mint-response.js";

/** Re-mint this long before the capability's absolute expiry. */
const REMINT_LEAD_MS = 10 * 60_000;
/** Retry cadence after a failed re-mint (the current token is still valid meanwhile). */
const REMINT_RETRY_MS = 30_000;
/** Keepalive cadence (static idle expiry is 10 min). */
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface LiveCapability {
  /** The tier the server resolved: 1-4 frame `origin`, 5 `/preview/<pid>/`, `legacy` `/live/<id>/~c/<token>/`. */
  tier: MintShape["tier"];
  /** Tiers 1-4: the preview origin. Framed, never displayed. */
  origin?: string;
  /** Tier 1-4: `/` (tier 3 `/?k=…`); tier 5 / legacy: the capability path. Framed, never displayed. */
  path: string;
  /** Tiers 1-4 of a site started under a tier-5 base. */
  base?: string;
  expiresAt: number;
  tokenId?: string;
  /** Tier 5: a previous pid was superseded; the running site must restart under the new base. */
  restartRequired?: boolean;
  /** What the server actually granted (falls back to what was requested). */
  policy: PreviewPolicy;
}

/** The viewer-side shape of a successful mint. */
const toCapability = (res: Extract<CapabilityResult, { ok: true }>, fallback: PreviewPolicy): LiveCapability => ({
  tier: res.tier,
  origin: res.origin,
  path: res.path,
  base: res.base,
  expiresAt: res.expiresAt,
  tokenId: res.tokenId,
  restartRequired: res.restartRequired,
  policy: res.policy ?? fallback,
});

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

  // `runScripts` is part of the key: the operator's "Run scripts" click must re-mint even when the
  // client already asked for `scripts:true` (the server withheld them under a different exposure view).
  const key = targetId ? `${targetId}|${policy.egress}|${policy.scripts}|${runScripts}|${epoch}` : "";
  // Latest request params, read by timers without re-subscribing them.
  const latest = useRef({ policy, runScripts, viewerId });
  latest.current = { policy, runScripts, viewerId };
  const touchFailedRef = useRef(onTouchFailed);
  touchFailedRef.current = onTouchFailed;

  // Mints on the wire (never aborted): a failed touch must not start a second one while one is pending.
  const inFlight = useRef(0);
  const mint = useCallback(
    (id: string) => {
      const { policy: p, runScripts: run, viewerId: v } = latest.current;
      inFlight.current += 1;
      return mintLiveCapability(id, { policy: p, runScripts: run || undefined, viewerId: v }).finally(() => {
        inFlight.current -= 1;
      });
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
      setCap({ key, ...toCapability(res, latest.current.policy) });
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
        setCap({ key: capKey, ...toCapability(next, latest.current.policy) });
      } else if (next.rejected) {
        setError(next.error); // terminal: a rejected response is never auto-retried (manual Retry only)
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
        if (inFlight.current === 0) setForced((n) => n + 1); // a pending mint already replaces the dead token
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
