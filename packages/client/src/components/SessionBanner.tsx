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

/**
 * Banner state shape derived by `deriveBannerState(state)` in event-reducer.
 * Single source of truth for which banner (if any) is visible per session.
 *
 * See change: unify-status-banner-and-terminal-limit-stop.
 */
export type BannerState =
  | { variant: "hidden" }
  | {
      variant: "retrying";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      startedAt: number;
      reason: string;
    }
  | { variant: "error"; message: string }
  | { variant: "limit-exceeded"; message: string };

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
 * Unified session-status banner. Renders exactly one variant per session
 * based on the derived state, mounted sticky above the command input.
 *
 * Replaces `RetryBanner` and `ErrorBanner` as separate mount points; race
 * overlap between yellow + red is impossible by construction (the selector
 * picks one).
 *
 * Variants:
 *   - `hidden`         — null DOM
 *   - `retrying`       — amber/yellow, countdown or indeterminate, Stop
 *   - `error`          — red, message + Retry + Dismiss
 *   - `limit-exceeded` — red with credit-card icon, message + Dismiss,
 *                        "Session stopped automatically." hint, no Retry
 *
 * See change: unify-status-banner-and-terminal-limit-stop.
 */
export function SessionBanner({
  state,
  onAbort,
  onRetry,
  onDismiss,
  now = Date.now,
  collapseThreshold = 240,
}: Props) {
  if (state.variant === "hidden") return null;
  if (state.variant === "retrying") {
    return <RetryingVariant state={state} onAbort={onAbort} now={now} />;
  }
  return (
    <ErrorVariant
      message={state.message}
      isLimitExceeded={state.variant === "limit-exceeded"}
      onRetry={onRetry}
      onDismiss={onDismiss}
      collapseThreshold={collapseThreshold}
    />
  );
}

function RetryingVariant({
  state,
  onAbort,
  now,
}: {
  state: Extract<BannerState, { variant: "retrying" }>;
  onAbort?: () => void;
  now: () => number;
}) {
  // Sentinel `-1` from bridge synthesis means "unknown" — pi doesn't expose
  // its retry settings to extensions. Render an indeterminate state instead
  // of a countdown.
  const hasCountdown = state.delayMs > 0 && state.maxAttempts > 0;
  const target = state.startedAt + state.delayMs;
  const computeRemaining = () => Math.max(0, Math.ceil((target - now()) / 1000));
  const [remaining, setRemaining] = useState(hasCountdown ? computeRemaining : 0);

  useEffect(() => {
    if (!hasCountdown) return;
    setRemaining(computeRemaining());
    const id = setInterval(() => setRemaining(computeRemaining()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.startedAt, state.delayMs, hasCountdown]);

  return (
    <div data-testid="retry-banner" className="mt-4 mb-2 mx-auto max-w-2xl">
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
                  {i18nT("auto.rate_limited_retry", undefined, "Rate-limited — retry")} {state.attempt} of {state.maxAttempts}
                </span>
                <span className="text-amber-300/80"> in </span>
                <span data-testid="retry-banner-countdown" className="font-mono">
                  {remaining}s
                </span>
              </>
            ) : (
              <span data-testid="retry-banner-indeterminate">
                {i18nT("auto.rate_limited_retrying_attempt", undefined, "Rate-limited — retrying… (attempt")} {state.attempt})
              </span>
            )}
          </div>
          <div
            data-testid="retry-banner-reason"
            className="mt-0.5 text-xs text-amber-300/70 truncate"
            title={state.reason}
          >
            {state.reason}
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

function ErrorVariant({
  message,
  isLimitExceeded,
  onRetry,
  onDismiss,
  collapseThreshold,
}: {
  message: string;
  isLimitExceeded: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  collapseThreshold: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.length > collapseThreshold;
  const displayText =
    !isLong || expanded ? message : `${message.slice(0, collapseThreshold).trimEnd()}…`;
  const iconPath = isLimitExceeded ? mdiCreditCardOutline : mdiAlert;

  return (
    <div className="mt-4 mb-2 mx-auto max-w-2xl">
      {/* data-testid="error-banner" retained on both variants for legacy
          integration tests. The limit-exceeded variant also carries
          data-testid="limit-exceeded-banner" as an inner marker so tests
          can distinguish the two. See change:
          unify-status-banner-and-terminal-limit-stop. */}
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
            {/* Retry only on `error` variant — terminal billing/quota
                wouldn't resolve on retry. See change spec. */}
            {!isLimitExceeded && onRetry && (
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
            onClick={onDismiss}
            className="text-red-400 hover:text-red-300 shrink-0"
            title={i18nT("auto.dismiss", undefined, "Dismiss")}
          >
            <Icon path={mdiClose} size={0.6} />
          </button>
        )}
      </div>
    </div>
  );
}
