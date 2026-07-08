import {
  mdiAlert,
  mdiClockOutline,
  mdiClose,
  mdiContentCopy,
  mdiStop,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import type { BannerRetry, BannerState } from "../lib/event-reducer.js";
import { t as i18nT } from "../lib/i18n";
import { CopyButton } from "./CopyButton";

export type { BannerState } from "../lib/event-reducer.js";

interface Props {
  state: BannerState;
  onAbort?: () => void;
  onDismiss?: () => void;
  /** Override clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Character cutoff before collapsing error message. Defaults to 240. */
  collapseThreshold?: number;
}

/**
 * Unified session-status banner: ONE composed card per session. The settled
 * error (`state.error`) is the header; the provider-retry status
 * (`state.retry`) is a live sub-line composed beneath it in the SAME card —
 * never two stacked cards for one failure.
 *
 * Surface states (driven by `deriveBannerState`):
 *   - hidden            — null DOM
 *   - retry only        — one card: retrying sub-line + Stop
 *   - error + retry     — one card: error header + retrying sub-line + Stop
 *   - error only        — one card: message + Dismiss + copy (no manual retry)
 *
 * There is NO `limit-exceeded` variant — billing errors render as ordinary
 * errors (no regex classification).
 *
 * Dismiss ✕ is CLEAR-ONLY in every state — it never aborts the session. The
 * single "Stop (ends the session)" control (present only while retrying) is
 * the sole path that aborts, so the user is aware the action stops the session.
 *
 * See change: unify-error-retry-lifecycle.
 * See change: simplify-error-retry-single-card.
 */
export function SessionBanner({
  state,
  onAbort,
  onDismiss,
  now = Date.now,
  collapseThreshold = 240,
}: Props) {
  if ("variant" in state && state.variant === "hidden") return null;
  const error = "error" in state ? state.error : undefined;
  const retry = "retry" in state ? state.retry : undefined;
  if (!error && !retry) return null;

  // Dismiss is CLEAR-ONLY: it clears the local banner state and NEVER aborts.
  // Stopping the session is a separate, explicitly-labeled action.
  // See change: simplify-error-retry-single-card.
  const handleDismiss = () => onDismiss?.();

  const accent = error
    ? "bg-red-500/10 border-red-500/30"
    : "bg-amber-500/10 border-amber-500/30";

  return (
    <div className="mt-4 mb-2 mx-auto max-w-2xl">
      <div
        // Legacy/e2e test-id: the card carries `error-banner` when an error is
        // present (single red surface).
        data-testid={error ? "error-banner" : "retry-banner-card"}
        className={`rounded-xl border px-4 py-2.5 flex items-start gap-2 ${accent}`}
      >
        <Icon
          path={error ? mdiAlert : mdiClockOutline}
          size={0.7}
          className={
            error
              ? "text-red-400 shrink-0 mt-0.5"
              : "text-amber-400 shrink-0 mt-0.5 animate-pulse"
          }
        />
        <div className="flex-1 min-w-0 space-y-2">
          {error && (
            <ErrorRow message={error.message} collapseThreshold={collapseThreshold} />
          )}
          {retry && <RetryRow retry={retry} onAbort={onAbort} now={now} />}
        </div>
        {onDismiss && (
          <button
            type="button"
            data-testid="error-banner-dismiss"
            onClick={handleDismiss}
            className={error ? "text-red-400 hover:text-red-300 shrink-0" : "text-amber-400 hover:text-amber-300 shrink-0"}
            title={i18nT("auto.dismiss", undefined, "Dismiss")}
          >
            <Icon path={mdiClose} size={0.6} />
          </button>
        )}
      </div>
    </div>
  );
}

function ErrorRow({
  message,
  collapseThreshold,
}: {
  message: string;
  collapseThreshold: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.length > collapseThreshold;
  const displayText =
    !isLong || expanded ? message : `${message.slice(0, collapseThreshold).trimEnd()}…`;

  return (
    <div>
      <div
        data-testid="error-banner-text"
        className="text-sm text-red-300 whitespace-pre-wrap break-words"
      >
        {displayText}
      </div>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {isLong && (
          <button
            type="button"
            data-testid="error-banner-toggle"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-red-300 hover:text-red-200 underline-offset-2 hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        <CopyButton
          text={message}
          icon={<Icon path={mdiContentCopy} size={0.6} />}
          title={i18nT("auto.copy_error_message", undefined, "Copy error message")}
        />
      </div>
    </div>
  );
}

function RetryRow({
  retry,
  onAbort,
  now,
}: {
  retry: BannerRetry;
  onAbort?: () => void;
  now: () => number;
}) {
  // Sentinel `-1` from bridge synthesis means "unknown" — pi doesn't expose
  // its retry settings to extensions. Render an indeterminate state instead
  // of a countdown.
  const hasCountdown = retry.delayMs > 0 && retry.maxAttempts > 0;
  const target = retry.startedAt + retry.delayMs;
  const computeRemaining = () => Math.max(0, Math.ceil((target - now()) / 1000));
  const [remaining, setRemaining] = useState(hasCountdown ? computeRemaining : 0);

  useEffect(() => {
    if (!hasCountdown) return;
    setRemaining(computeRemaining());
    const id = setInterval(() => setRemaining(computeRemaining()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry.startedAt, retry.delayMs, hasCountdown]);

  return (
    <div data-testid="retry-banner">
      <div className="text-sm text-amber-200">
        {hasCountdown ? (
          <>
            <span data-testid="retry-banner-attempt">
              {i18nT("auto.rate_limited_retry", undefined, "Rate-limited — retry")} {retry.attempt} of {retry.maxAttempts}
            </span>
            <span className="text-amber-300/80"> in </span>
            <span data-testid="retry-banner-countdown" className="font-mono">
              {remaining}s
            </span>
          </>
        ) : (
          <span data-testid="retry-banner-indeterminate">
            {i18nT("auto.rate_limited_retrying_attempt", undefined, "Rate-limited — retrying… (attempt")} {retry.attempt})
          </span>
        )}
      </div>
      <div
        data-testid="retry-banner-reason"
        className="mt-0.5 text-xs text-amber-300/70 truncate"
        title={retry.reason}
      >
        {retry.reason}
      </div>
      {onAbort && (
        <div className="mt-1.5">
          <button
            type="button"
            data-testid="retry-banner-stop"
            onClick={onAbort}
            title={i18nT("auto.stop_ends_session", undefined, "Stop (ends the session)")}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-amber-500/40 text-amber-200 hover:bg-amber-500/15"
          >
            <Icon path={mdiStop} size={0.55} />
            {i18nT("auto.stop_ends_session", undefined, "Stop (ends the session)")}
          </button>
        </div>
      )}
    </div>
  );
}
