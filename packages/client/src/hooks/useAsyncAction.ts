import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastVariant } from "../components/Toast.js";
import { t } from "../lib/i18n";

// Single canonical definition lives in Toast.tsx; re-exported here so existing
// `import { ToastVariant } from "../hooks/useAsyncAction"` consumers keep working
// without a second, drift-prone declaration. See change:
// unify-message-severity-colors (D7).
export type { ToastVariant };

/**
 * Options for {@link useAsyncAction}.
 *
 * `confirm: "http"` (default) — `pending` ends when `fn()` settles.
 * `confirm: "ws"` — `pending` holds after `fn()` resolves until a correlated
 * `ServerToBrowserMessage` matches `confirmEvent(msg, result)`, or
 * `confirmTimeoutMs` elapses (info "still working" toast, never a stuck spinner).
 */
export interface UseAsyncActionOptions<T> {
  confirm?: "http" | "ws";
  /** Toast sink. Injected by the call site (no global context). */
  showToast?: (text: string, variant?: ToastVariant) => void;
  onSuccess?: () => void;
  /** When set, a success-variant toast is shown on completion. */
  successToast?: string;
  /** Custom error → toast text. Defaults to the error message. */
  formatError?: (err: unknown) => string;
  // ── ws mode ──────────────────────────────────────────────────────────────
  /** Subscribe to the WS bus; returns an unsubscribe fn. Required for ws mode. */
  onMessage?: (handler: (msg: ServerToBrowserMessage) => void) => () => void;
  /**
   * Match an incoming message against this action. The handler is registered
   * synchronously when `run()` is invoked (before `fn()` resolves) so a fast
   * echo can never be missed; close over a client-generated correlation id.
   * `result` is `fn()`'s resolved value, or `undefined` until it settles.
   */
  confirmEvent?: (msg: ServerToBrowserMessage, result: T | undefined) => boolean;
  /** ws timeout fallback (ms). Default 15000. */
  confirmTimeoutMs?: number;
  /** Info toast text shown when the ws timeout fires. */
  stillWorkingToast?: string;
}

export interface AsyncActionBinding {
  onClick: () => void;
  disabled: boolean;
}

export interface UseAsyncActionResult {
  pending: boolean;
  error: unknown | null;
  run: () => void;
  bind: AsyncActionBinding;
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Wrap an async action with a `idle → pending → success | error` lifecycle.
 * Auto-disables the bound control, guards against concurrent runs, and routes
 * outcomes to an injected toast sink. Generalizes the WorktreeInitButton FSM.
 */
export function useAsyncAction<T = unknown>(
  fn: () => Promise<T>,
  opts: UseAsyncActionOptions<T> = {},
): UseAsyncActionResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const pendingRef = useRef(false);
  const resultRef = useRef<T | undefined>(undefined);
  const unsubRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const cleanup = useCallback(() => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const finish = useCallback(() => {
    pendingRef.current = false;
    setPending(false);
    cleanup();
  }, [cleanup]);

  const fail = useCallback((err: unknown) => {
    const o = optsRef.current;
    setError(err);
    const text = o.formatError
      ? o.formatError(err)
      : err instanceof Error ? err.message : String(err);
    o.showToast?.(text, "error");
    finish();
  }, [finish]);

  const run = useCallback(() => {
    if (pendingRef.current) return; // synchronous double-click guard
    const o = optsRef.current;
    pendingRef.current = true;
    resultRef.current = undefined;
    setPending(true);
    setError(null);

    if (o.confirm === "ws") {
      // Register the correlation handler + timeout BEFORE firing fn() so a
      // fast server echo can never arrive before we are listening.
      if (o.onMessage && o.confirmEvent) {
        unsubRef.current = o.onMessage((msg) => {
          if (o.confirmEvent!(msg, resultRef.current)) {
            o.onSuccess?.();
            if (o.successToast) o.showToast?.(o.successToast, "success");
            finish();
          }
        });
      }
      timerRef.current = setTimeout(() => {
        // Passive background hint — neutral, not mild-attention info. See
        // change: unify-message-severity-colors (D5).
        o.showToast?.(
          o.stillWorkingToast ?? t("common.stillWorking", undefined, "Still working in the background…"),
          "neutral",
        );
        finish();
      }, o.confirmTimeoutMs ?? DEFAULT_TIMEOUT_MS);
      fnRef.current().then((result) => { resultRef.current = result; }).catch(fail);
    } else {
      fnRef.current().then(() => {
        o.onSuccess?.();
        if (o.successToast) o.showToast?.(o.successToast, "success");
        finish();
      }).catch(fail);
    }
  }, [finish, fail]);

  useEffect(() => cleanup, [cleanup]);

  return { pending, error, run, bind: { onClick: run, disabled: pending } };
}
