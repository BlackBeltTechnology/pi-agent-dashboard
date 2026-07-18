import { mdiAlert, mdiClose, mdiContentCopy, mdiStop } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import type { BannerState } from "../../lib/chat/event-reducer.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CopyButton } from "../primitives/CopyButton.js";

export type { BannerState } from "../../lib/chat/event-reducer.js";

interface Props {
  state: BannerState;
  /** Aborts the session. Wired to the single "Stop (ends the session)" control. */
  onAbort?: () => void;
  /** Clears the local error/retry banner state. Wired to ✕ — NEVER aborts. */
  onDismiss?: () => void;
  /** Override clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Character cutoff before collapsing the error message. Defaults to 240. */
  collapseThreshold?: number;
}

/**
 * Single-card error-lifecycle surface (change: simplify-error-retry-single-card).
 *
 * ONE bordered card per failure. The raw error string is always the header;
 * the provider auto-retry is a live sub-line ("retrying… (attempt N)") on the
 * SAME surface, with a thin animated top strip while a retry is in flight —
 * never two stacked cards.
 *
 * Controls:
 *   - ✕ (dismiss) is clear-only. It NEVER aborts the session; it only clears
 *     the local banner state via `onDismiss`.
 *   - "Stop (ends the session)" is the SOLE abort. It is present only while a
 *     retry is in flight (pi is still working); on a settled error pi has
 *     already stopped, so only ✕ + copy remain.
 *
 * There is no manual "Try again": pi's own auto-retry covers transient
 * failures, and a settled error offers copy + clear-only dismiss.
 *
 * Mounted sticky above the command input.
 */
export function SessionBanner({
  state,
  onAbort,
  onDismiss,
  now = Date.now,
  collapseThreshold = 240,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  if ("variant" in state && state.variant === "hidden") return null;
  const error = "error" in state ? state.error : undefined;
  const retry = "retry" in state ? state.retry : undefined;
  if (!error && !retry) return null;

  const retrying = !!retry;
  // Header text: the settled error when present, else the string that
  // triggered the in-flight retry (retry.reason carries the errorMessage).
  const headerText = error?.message ?? retry?.reason ?? "";
  const isLong = headerText.length > collapseThreshold;
  const displayText =
    !isLong || expanded ? headerText : `${headerText.slice(0, collapseThreshold).trimEnd()}…`;

  return (
    <div className="mt-4 mb-2 mx-auto max-w-2xl">
      <div
        data-testid="error-banner"
        className="relative overflow-hidden bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 flex items-start gap-2"
      >
        {retrying && (
          // Thin animated top strip — the only "activity" affordance while pi
          // is re-attempting. See change: simplify-error-retry-single-card.
          <div
            data-testid="retry-strip"
            className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400/80 to-transparent animate-pulse"
          />
        )}
        <Icon path={mdiAlert} size={0.7} className="text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div
            data-testid="error-banner-text"
            className="text-sm text-red-300 whitespace-pre-wrap break-words"
          >
            {displayText}
          </div>

          {retrying && (
            <div data-testid="retry-banner" className="mt-1 text-xs text-amber-300/90">
              <span data-testid="retry-banner-attempt">
                {i18nT("status.retryingAttempt", undefined, "retrying…")} (
                {i18nT("common.attempt", undefined, "attempt")} {retry!.attempt})
              </span>
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
            {/* Sole abort: present only while retrying (pi still working). */}
            {retrying && onAbort && (
              <button
                data-testid="error-banner-stop"
                onClick={onAbort}
                title={i18nT("session.stopEndsSession", undefined, "Stop (ends the session)")}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-red-500/40 text-red-200 hover:bg-red-500/15"
              >
                <Icon path={mdiStop} size={0.55} />
                {i18nT("session.stopEndsSession", undefined, "Stop (ends the session)")}
              </button>
            )}
            <CopyButton
              getText={() => headerText}
              icon={<Icon path={mdiContentCopy} size={0.6} />}
              title={i18nT("session.copyErrorMessage", undefined, "Copy error message")}
            />
          </div>
        </div>
        {onDismiss && (
          <button
            data-testid="error-banner-dismiss"
            onClick={onDismiss}
            className="text-red-400 hover:text-red-300 shrink-0"
            title={i18nT("common.dismiss", undefined, "Dismiss")}
          >
            <Icon path={mdiClose} size={0.6} />
          </button>
        )}
      </div>
    </div>
  );
}
