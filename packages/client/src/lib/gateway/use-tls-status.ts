/**
 * `useTlsStatus` — the Built-in HTTPS section's status reader.
 *
 * Re-reads `/api/health.tls` every {@link TLS_STATUS_POLL_MS} while mounted, one
 * read in flight at a time (a tick that finds one running just skips), and
 * `refresh(true)` — called after the section's own writes / issue requests —
 * queues exactly one immediate re-read when one is already in flight.
 * `status` stays `null` until the first successful read ("Checking…", never a
 * default rendered as fact).
 *
 * See change: add-tailscale-cert-tls (design D11).
 */
import type { TlsStatus } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTlsStatus } from "./tls-api.js";

/** Same cadence as `GatewayConnectToggle`'s status-detail poll. */
const TLS_STATUS_POLL_MS = 5_000;

export function useTlsStatus(): {
  status: TlsStatus | null;
  readFailed: boolean;
  refresh: (afterWrite?: boolean) => Promise<void>;
} {
  const [status, setStatus] = useState<TlsStatus | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(async (afterWrite = false) => {
    if (inFlight.current) {
      queued.current ||= afterWrite;
      return;
    }
    inFlight.current = true;
    let next: TlsStatus | null = null;
    let failed = false;
    try {
      next = await getTlsStatus();
      failed = next === null;
    } catch {
      failed = true;
    }
    inFlight.current = false;
    if (!alive.current) return;
    if (next) setStatus(next);
    setReadFailed(failed);
    if (queued.current) {
      queued.current = false;
      void refresh(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), TLS_STATUS_POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  return { status, readFailed, refresh };
}
