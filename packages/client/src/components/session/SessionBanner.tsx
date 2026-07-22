import { mdiAlert, mdiContentCopy, mdiStop } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import type { BannerState } from "../../lib/chat/event-reducer.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CopyButton } from "../primitives/CopyButton.js";
import { InlineMessage } from "../primitives/InlineMessage.js";

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
 * Single-card error-lifecycle surface (change: simplify-error-retry-single-card;
 * redesign-directory-card — now rendered via the shared `InlineMessage`
 * primitive with `severity="error"` and the `animate` retry sweep).
 *
 * ONE bordered card per failure. The raw error string is always the header;
 * the provider auto-retry is a live sub-line ("retrying… (attempt N)") on the
 * SAME surface, with the primitive's animated top strip while a retry is in
 * flight — never two stacked cards.
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

  const actions = (
    <>
      {isLong && (
        <button
          type="button"
          data-testid="error-banner-toggle"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs underline-offset-2 hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {/* Sole abort: present only while retrying (pi still working). */}
      {retrying && onAbort && (
        <button
          type="button"
          data-testid="error-banner-stop"
          onClick={onAbort}
          title={i18nT("session.stopEndsSession", undefined, "Stop (ends the session)")}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-current"
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
    </>
  );

  return (
    <div className="mt-4 mb-2 mx-auto max-w-2xl">
      <InlineMessage
        severity="error"
        icon={mdiAlert}
        animate={retrying}
        title={
          <span data-testid="error-banner-text" className="whitespace-pre-wrap break-words font-normal">
            {displayText}
          </span>
        }
        onDismiss={onDismiss}
        testId="error-banner"
        dismissTestId="error-banner-dismiss"
        actions={actions}
      >
        {retrying && (
          <div data-testid="retry-banner" className="text-xs">
            <span data-testid="retry-banner-attempt">
              {i18nT("status.retryingAttempt", undefined, "retrying…")} (
              {i18nT("common.attempt", undefined, "attempt")} {retry!.attempt})
            </span>
          </div>
        )}
      </InlineMessage>
    </div>
  );
}
