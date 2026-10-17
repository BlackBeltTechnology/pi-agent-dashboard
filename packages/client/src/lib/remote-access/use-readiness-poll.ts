/**
 * `useReadinessPoll(active, read)` — the ONE owner of the readiness loop.
 *
 * A readiness tick shells out per provider (~4 subprocesses), so it never runs
 * as a background service: one tick per `tick()` call (dialog open / return to
 * the landing / Refresh) and, only while `active` (a provider-dependent step is
 * current, or the Gateway page is mounted), an immediate tick plus one every
 * {@link READINESS_POLL_INTERVAL_MS}. A tick is skipped while one is in flight,
 * so a slow provider CLI cannot queue overlapping batches. Cleanup is the whole
 * guarantee that nothing polls once `active` drops or the host unmounts.
 *
 * See change: add-remote-access-wizard (design D2); add-zrok-custom-reserved-name (D7).
 */
import type { ProviderReadiness } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { READINESS_POLL_INTERVAL_MS } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getProviderReadiness } from "../gateway/gateway-api.js";
import {
  INITIAL_POLL_STATE,
  onOpen,
  onTickError,
  onTickResult,
  onTickStart,
  shouldTick,
} from "../gateway/readiness-poll.js";

export interface ReadinessPoll {
  providers: ProviderReadiness[];
  /** Epoch ms of the last completed tick. */
  lastCheckedAt?: number;
  inFlight: boolean;
  /** The most recent tick failed (the last good board is kept). */
  failed: boolean;
  /** Run one evaluation now, unless one is already in flight. */
  tick: () => Promise<void>;
}

export function useReadinessPoll(
  active: boolean,
  read: (signal?: AbortSignal) => Promise<ProviderReadiness[]> = getProviderReadiness,
): ReadinessPoll {
  const [state, setState] = useState({ ...INITIAL_POLL_STATE, open: true });
  const [failed, setFailed] = useState(false);
  // Read inside timers so the scheduler never closes over a stale `inFlight`.
  // Marked synchronously on the REF: `setState` only refreshes it next render,
  // so two same-frame calls would both observe `inFlight: false`.
  const stateRef = useRef(onOpen(INITIAL_POLL_STATE));
  const readRef = useRef(read);
  readRef.current = read;
  const mounted = useRef(true);

  const tick = useCallback(async () => {
    if (!shouldTick(stateRef.current)) return;
    stateRef.current = onTickStart(stateRef.current);
    setState((s) => onTickStart(s));
    try {
      const providers = await readRef.current();
      if (!mounted.current) return;
      stateRef.current = onTickResult(stateRef.current, providers, Date.now());
      setFailed(false);
      setState((s) => onTickResult(s, providers, Date.now()));
    } catch {
      if (!mounted.current) return;
      stateRef.current = onTickError(stateRef.current);
      setFailed(true);
      setState((s) => onTickError(s));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    void tick();
    const id = setInterval(() => void tick(), READINESS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, tick]);

  return { providers: state.providers, lastCheckedAt: state.lastCheckedAt, inFlight: state.inFlight, failed, tick };
}
