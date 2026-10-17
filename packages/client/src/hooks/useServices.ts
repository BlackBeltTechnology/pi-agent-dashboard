/**
 * Live view of `GET /api/services` for the Settings → Services pages.
 *
 * - Refetches ONLY the list (never the probing `GET /api/services/:id`) on every
 *   `services_changed` message and on WebSocket reconnect, after a random
 *   100–400 ms delay that collapses a burst into one request and spreads the
 *   requests of many browsers.
 * - No timer polls: the list changes only when the server says so.
 * - Single-flight: a ping that lands while a fetch is running schedules exactly
 *   one more fetch afterwards.
 * See change: add-services-settings-ui (D3).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { ServiceList } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { listServices, type ServicesResult } from "../lib/services/services-api.js";

export const REFETCH_DELAY_MIN_MS = 100;
export const REFETCH_DELAY_MAX_MS = 400;

export interface UseServicesOptions {
  onMessage?: (handler: (msg: ServerToBrowserMessage) => void) => () => void;
  /** The live socket; `null` while disconnected. A non-null change after mount refetches. */
  ws?: WebSocket | null;
  /** Test seam: the random delay. */
  delayMs?: () => number;
  /** Test seam: the list fetch. */
  fetchList?: () => Promise<ServicesResult<ServiceList>>;
}

export interface UseServices {
  list: ServiceList | null;
  /** True until the first answer. */
  loading: boolean;
  /** The last failed fetch (kept while the previous list stays on screen). */
  error: ServicesResult<ServiceList> | null;
  /** Fetch now (after an action of this tab). */
  refetch: () => Promise<void>;
  /** The caller may use operate-gated routes. Unknown (not loaded yet) counts as false. */
  canOperate: boolean;
}

const randomDelay = () => REFETCH_DELAY_MIN_MS + Math.random() * (REFETCH_DELAY_MAX_MS - REFETCH_DELAY_MIN_MS);

export function useServices({ onMessage, ws, delayMs = randomDelay, fetchList = listServices }: UseServicesOptions = {}): UseServices {
  const [list, setList] = useState<ServiceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ServicesResult<ServiceList> | null>(null);
  const inflight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const fetchRef = useRef(fetchList);
  fetchRef.current = fetchList;
  const delayRef = useRef(delayMs);
  delayRef.current = delayMs;

  const runRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback(() => {
    if (timer.current) return; // a burst collapses into the pending fetch
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void runRef.current();
    }, delayRef.current());
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    try {
      const res = await fetchRef.current();
      if (!alive.current) return;
      if (res.ok && res.data) {
        setList(res.data);
        setError(null);
      } else {
        setError(res);
      }
      setLoading(false);
    } finally {
      inflight.current = false;
      if (again.current && alive.current) {
        again.current = false;
        schedule();
      }
    }
  }, [schedule]);
  runRef.current = run;

  useEffect(() => {
    alive.current = true;
    void run();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [run]);

  useEffect(
    () =>
      onMessage?.((msg) => {
        if (msg.type === "services_changed") schedule();
      }),
    [onMessage, schedule],
  );

  // Reconnect (a socket after none, or a different socket): catch up on what changed while it was down.
  const prevWs = useRef<WebSocket | null | undefined>(undefined);
  useEffect(() => {
    if (ws === undefined) return;
    const prev = prevWs.current;
    prevWs.current = ws;
    if (ws !== null && prev !== undefined && prev !== ws) schedule();
  }, [ws, schedule]);

  const refetch = useCallback(async () => {
    await run();
  }, [run]);

  return { list, loading, error, refetch, canOperate: list?.canOperate === true };
}
