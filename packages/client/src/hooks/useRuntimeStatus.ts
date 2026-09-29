/**
 * useRuntimeStatus — GET /api/runtime/status (Electron runtime overlay), kept
 * fresh by the `runtime-update-event` DOM event (useMessageHandler).
 *
 * Loads are sequenced: a response is applied only if no later load started
 * (out-of-order snapshots cannot resurrect a finished staging job). Failures
 * surface as `error` instead of being swallowed.
 *
 * See change: electron-runtime-overlay-updates.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { logRejection } from "../lib/report-error.js";

type RuntimeSourceName = "bundled" | "npm" | "github" | "local";

export interface RuntimeInfo {
  origin: string;
  id: string;
  version: string;
  updatable: boolean;
  gitSha?: string | null;
  dirty?: boolean;
  lastFailure?: { id: string; reason: string };
}

type RuntimeCheck =
  | { state: "not_applicable" }
  | { state: "up_to_date" | "available"; target: string; active: string }
  | { state: "check_failed"; reason: string };

export interface RuntimeStatus {
  runtime: RuntimeInfo;
  piVersion?: string | null;
  source: RuntimeSourceName;
  channel: "stable" | "beta";
  pin: string | null;
  pending: string | null;
  previous: string | null;
  check: RuntimeCheck;
  staging: { version: string; last?: { phase: string; message?: string } } | null;
  lastStageError: { version: string; message: string } | null;
}

export interface UseRuntimeStatus {
  status: RuntimeStatus | null;
  /** Live staging phase from WS progress; null when idle. */
  progress: string | null;
  error: string | null;
  setError: (e: string | null) => void;
  load: (refresh?: boolean) => Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function useRuntimeStatus(): UseRuntimeStatus {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async (refresh = false) => {
    const mine = ++seq.current;
    try {
      const res = await fetch(`${getApiBase()}/api/runtime/status${refresh ? "?refresh=true" : ""}`);
      const body = (await res.json()) as { success?: boolean; data?: RuntimeStatus; message?: string };
      if (!mounted.current || mine !== seq.current) return;
      if (body.success && body.data) {
        setStatus(body.data);
        setError(null);
      } else setError(body.message ?? `status ${res.status}`);
    } catch (err) {
      if (mounted.current && mine === seq.current) setError(message(err));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load().catch(logRejection("useRuntimeStatus.load"));
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail as { type?: string; phase?: string; message?: string };
      if (msg?.type === "runtime_update_progress") setProgress(msg.phase ?? null);
      if (msg?.type === "runtime_update_staged" || msg?.type === "runtime_update_failed") {
        setProgress(null);
        if (msg.type === "runtime_update_failed") setError(msg.message ?? null);
        load().catch(logRejection("useRuntimeStatus.event"));
      }
    };
    window.addEventListener("runtime-update-event", handler);
    return () => {
      mounted.current = false;
      window.removeEventListener("runtime-update-event", handler);
    };
  }, [load]);

  return { status, progress, error, setError, load };
}
