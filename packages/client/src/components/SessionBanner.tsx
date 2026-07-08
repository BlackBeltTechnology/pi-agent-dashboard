import React, { useEffect, useState } from "react";
import { Icon } from "@mdi/react";
import {
  mdiAlert,
  mdiClockOutline,
  mdiClose,
  mdiContentCopy,
  mdiCreditCardOutline,
  mdiRefresh,
  mdiStop,
} from "@mdi/js";
import { CopyButton } from "./CopyButton";
import { t as i18nT } from "../lib/i18n";
import type { BannerState, BannerRetry } from "../lib/event-reducer.js";

export type { BannerState } from "../lib/event-reducer.js";

interface Props {
  state: BannerState;
  onAbort?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  /** Override clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Character cutoff before collapsing error message. Defaults to 240. */
  collapseThreshold?: number;
}

/**
 * Unified session-status banner: ONE composed error-lifecycle surface per
 * session. The settled error (`state.error`) is the persistent anchor; the
 * provider-retry status (`state.retry`) is a live sub-status composed on top
 * of it. The previous "retrying XOR error" precedence is replaced by
 * composition — when both are present the error header AND the retry sub-line
 * render in the same surface. Mounted sticky above the command input.
 *
 * Surface states (driven by `deriveBannerState`):
 *   - hidden                       — null DOM
 *   - retry only (amber)           — provider auto-retry before any terminal error
 *   - error anchor + retry sub-line — error header (red) + amber retry sub-line
 *   - error only (red)             — message + Retry + Dismiss + copy
 *   - limit-exceeded (red, 💳)      — message + Dismiss + hint, NO Retry
 *
 * Dismiss ✕ is state-dependent: on a retrying/retryable surface it aborts the
 * in-flight retry AND clears; on a terminal limit-exceeded surface it only
 * clears (pi already stopped).
 *
 * See change: unify-error-retry-lifecycle.
 */
export function SessionBanner({
  state,
  onAbort,
  onRetry,
  onDismiss,
  now = Date.now,
  collapseThreshold = 240,
}: Props) {
  if ("variant" in state && state.variant === "hidden") return null;
  const error = "error" in state ? state.error : undefined;
  const retry = "retry" in state ? state.retry : undefined;
  if (!error && !retry) return null;

  return (
    <div className="mt-4 mb-2 mx-auto max-w-2xl space-y-2">
      {error && (
        <ErrorBlock
          message={error.message}
          isLimitExceeded={error.kind === "limit-exceeded"}
          // Retry is a manual action only when no auto-retry is already in
          // flight and the error is generic (terminal billing won't resolve).
          onRetry={!retry && error.kind === "error" ? onRetry : undefined}
          onDismiss={onDismiss}
          onAbort={onAbort}
          // Dismiss aborts when a retry is live OR the error is retryable.
          dismissAborts={!!retry || error.kind === "error"}
          collapseThreshold={collapseThreshold}
        />
      )}
      {retry && <RetryBlock retry={retry} onAbort={onAbort} now={now} />}
    </div>
  );
}

function RetryBlock({
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
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 flex items-start gap-2">
        <Icon
          path={mdiClockOutline}
          size={0.7}
          className="text-amber-400 shrink-0 mt-0.5 animate-pulse"
        />
        <div className="flex-1 min-w-0">
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
                data-testid="retry-banner-stop"
                onClick={onAbort}
                title={i18nT("auto.stop_retrying", undefined, "Stop retrying")}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-amber-500/40 text-amber-200 hover:bg-amber-500/15"
              >
                <Icon path={mdiStop} size={0.55} />
                {i18nT("auto.stop_retrying", undefined, "Stop retrying")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorBlock({
  message,
  isLimitExceeded,
  onRetry,
  onDismiss,
  onAbort,
  dismissAborts,
  collapseThreshold,
}: {
  message: string;
  isLimitExceeded: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  onAbort?: () => void;
  dismissAborts: boolean;
  collapseThreshold: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.length > collapseThreshold;
  const displayText =
    !isLong || expanded ? message : `${message.slice(0, collapseThreshold).trimEnd()}…`;
  const iconPath = isLimitExceeded ? mdiCreditCardOutline : mdiAlert;

  // Dismiss is state-dependent: when the surface carries a live retry or a
  // generic retryable error, dismissing must STOP pi (abort) AND clear; for a
  // terminal limit-exceeded surface (pi already stopped) it only clears.
  // See change: unify-error-retry-lifecycle.
  const handleDismiss = () => {
    if (dismissAborts) onAbort?.();
    onDismiss?.();
  };

  return (
    <div
      data-testid="error-banner"
      className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 flex items-start gap-2"
    >
      {isLimitExceeded && (
        <span data-testid="limit-exceeded-banner" className="sr-only">
          limit-exceeded
        </span>
      )}
      <Icon path={iconPath} size={0.7} className="text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div
          data-testid="error-banner-text"
          className="text-sm text-red-300 whitespace-pre-wrap break-words"
        >
          {displayText}
        </div>
        {isLimitExceeded && (
          <div
            data-testid="limit-exceeded-hint"
            className="mt-0.5 text-xs text-red-300/70"
          >
            {i18nT("auto.session_stopped_automatically", undefined, "Session stopped automatically.")}
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {isLong && (
            <button
              data-testid="error-banner-toggle"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-red-300 hover:text-red-200 underline-offset-2 hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          {/* Retry only on generic `error` with no live retry — terminal
              billing/quota wouldn't resolve on retry. */}
          {onRetry && (
            <button
              data-testid="error-banner-retry"
              onClick={onRetry}
              title={i18nT("auto.retry_continue_session", undefined, "Retry (continue session)")}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-red-500/40 text-red-200 hover:bg-red-500/15"
            >
              <Icon path={mdiRefresh} size={0.55} />
              {i18nT("auto.retry", undefined, "Retry")}
            </button>
          )}
          <CopyButton
            text={message}
            icon={<Icon path={mdiContentCopy} size={0.6} />}
            title={i18nT("auto.copy_error_message", undefined, "Copy error message")}
          />
        </div>
      </div>
      {onDismiss && (
        <button
          data-testid="error-banner-dismiss"
          onClick={handleDismiss}
          className="text-red-400 hover:text-red-300 shrink-0"
          title={i18nT("auto.dismiss", undefined, "Dismiss")}
        >
          <Icon path={mdiClose} size={0.6} />
        </button>
      )}
    </div>
  );
}
