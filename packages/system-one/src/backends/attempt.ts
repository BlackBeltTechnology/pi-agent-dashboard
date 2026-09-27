/**
 * Shared attempt plumbing: a per-attempt AbortController fired by the
 * adapter's own timer or by the caller's signal, and an outcome union.
 * See change: add-system-one-registry.
 */
import type { FailReason } from "../types.js";

export type RawOutcome = { ok: true; raw: unknown; model: string } | { ok: false; outcome: Exclude<FailReason, "no-backend"> };

export interface AttemptScope {
  signal: AbortSignal;
  /** Resolves to "timeout" when the adapter timer or caller abort fires. */
  aborted: Promise<"timeout">;
  timedOut(): boolean;
  dispose(): void;
}

export function attemptScope(timeoutMs: number, caller?: AbortSignal): AttemptScope {
  const ac = new AbortController();
  let fired = false;
  let resolveAbort!: (v: "timeout") => void;
  const aborted = new Promise<"timeout">((r) => {
    resolveAbort = r;
  });
  const fire = () => {
    if (fired) return;
    fired = true;
    ac.abort();
    resolveAbort("timeout");
  };
  const timer = setTimeout(fire, timeoutMs);
  const onCaller = () => fire();
  if (caller?.aborted) fire();
  else caller?.addEventListener("abort", onCaller, { once: true });
  return {
    signal: ac.signal,
    aborted,
    timedOut: () => fired,
    dispose() {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCaller);
    },
  };
}
