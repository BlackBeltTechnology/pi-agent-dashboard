import { mdiAlert, mdiContentCopy } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import type { BannerRetry, BannerState } from "../../lib/chat/event-reducer.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CopyButton } from "../primitives/CopyButton.js";
import { InlineMessage } from "../primitives/InlineMessage.js";

export type { BannerState } from "../../lib/chat/event-reducer.js";

interface Props {
  state: BannerState;
  /**
   * Clears the settled-error banner. Fires ONLY when no retry is pending; while
   * a retry runs, no dismiss control is rendered (the surface clears itself on
   * a confirmed-good resume).
   */
  onDismiss?: () => void;
  /** Override clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Character cutoff before collapsing the error message. Defaults to 240. */
  collapseThreshold?: number;
}

/** The waiting/in-flight status line: bare "attempt N" + a countdown/elapsed suffix. */
function countdownSuffix(retry: BannerRetry, nowMs: number): string {
  if (!retry.waiting) {
    return i18nT("status.retryingNow", undefined, "retrying now…");
  }
  const target =
    retry.nextAttemptAt ?? (retry.delayMs > 0 ? retry.startedAt + retry.delayMs : undefined);
  if (target !== undefined) {
    const remainMs = target - nowMs;
    if (remainMs > 0) {
      const secs = Math.ceil(remainMs / 1000);
      return i18nT("status.nextAttemptIn", { secs }, `next attempt in ${secs}s`);
    }
  }
  // No known target (delayMs 0) OR the computed countdown overran: elapsed-only,
  // never a zeroed/negative countdown.
  const elapsed = Math.max(0, Math.floor((nowMs - retry.startedAt) / 1000));
  return i18nT("status.stillWaiting", { secs: elapsed }, `still waiting… (${elapsed}s elapsed)`);
}

/** Bare "attempt N" + countdown/elapsed suffix, shared by the expanded card and the pill. */
function RetryStatusLine({ retry, nowMs }: { retry: BannerRetry; nowMs: number }) {
  return (
    <>
      <span data-testid="retry-banner-attempt">
        {i18nT("common.attempt", undefined, "attempt")} {retry.attempt}
      </span>{" "}
      · <span data-testid="retry-banner-countdown">{countdownSuffix(retry, nowMs)}</span>
    </>
  );
}

/** The card's action row: show-more toggle + Copy. */
function ExpandedActions({
  isLong,
  expanded,
  onToggleExpand,
  headerText,
}: {
  isLong: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  headerText: string;
}) {
  return (
    <>
      {isLong && (
        <button
          type="button"
          data-testid="error-banner-toggle"
          onClick={onToggleExpand}
          className="text-xs underline-offset-2 hover:underline"
        >
          {expanded
            ? i18nT("common.showLess", undefined, "Show less")
            : i18nT("common.showMore", undefined, "Show more")}
        </button>
      )}
      <CopyButton
        getText={() => headerText}
        icon={<Icon path={mdiContentCopy} size={0.6} />}
        title={i18nT("session.copyErrorMessage", undefined, "Copy error message")}
      />
    </>
  );
}

/**
 * Single-card error-lifecycle surface (change: error-banner-observe-only).
 *
 * ONE bordered card (via the shared `InlineMessage` severity=error primitive).
 * The error string is the header; the retry is a live sub-line — bare
 * "attempt N" plus a countdown from `nextAttemptAt` (or a computed
 * `startedAt + delayMs`, degrading to elapsed-only on overrun / zero delay).
 *
 * Observe-only: pi owns the retry loop; the banner only renders it.
 *   - No "Stop retrying" control — the always-present session Stop is the sole
 *     abort entry point.
 *   - While a retry is pending the surface shows the status + Copy only; there
 *     is no dismiss and no collapse. It clears itself on a confirmed-good
 *     resume (retryState + lastError both clear).
 *   - On a settled error (no retry) the dismiss control (`error-banner-dismiss`,
 *     mdiClose) clears via `onDismiss`. There is NO Retry control.
 *
 * Mounted sticky above the command input.
 */
export function SessionBanner({
  state,
  onDismiss,
  now = Date.now,
  collapseThreshold = 240,
}: Props) {
  const error = "variant" in state ? undefined : state.error;
  const retry = "variant" in state ? undefined : state.retry;
  const retrying = !!retry;

  const [expanded, setExpanded] = useState(false);
  const [, forceTick] = useState(0);

  // Re-render once per second while a retry is pending so the countdown ticks.
  useEffect(() => {
    if (!retrying) return;
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [retrying]);

  if ("variant" in state && state.variant === "hidden") return null;
  if (!error && !retry) return null;

  const headerText = error?.message ?? retry?.reason ?? "";
  const isLong = headerText.length > collapseThreshold;
  const displayText =
    !isLong || expanded ? headerText : `${headerText.slice(0, collapseThreshold).trimEnd()}…`;

  const retryLine = retry ? (
    <div data-testid="retry-banner" className="text-xs">
      <RetryStatusLine retry={retry} nowMs={now()} />
    </div>
  ) : null;

  // ── Card ───────────────────────────────────────────────────────────────────
  const actions = (
    <ExpandedActions
      isLong={isLong}
      expanded={expanded}
      onToggleExpand={() => setExpanded((v) => !v)}
      headerText={headerText}
    />
  );

  return (
    <div className="mt-4 mb-2 mx-auto max-w-2xl">
      <InlineMessage
        severity="error"
        icon={mdiAlert}
        animate={retrying && !retry!.waiting}
        title={
          <span data-testid="error-banner-text" className="whitespace-pre-wrap break-words font-normal">
            {displayText}
          </span>
        }
        // Dismiss clears ONLY on a settled error. While retrying, no dismiss
        // control is rendered — the surface clears itself on a good resume.
        onDismiss={retrying ? undefined : onDismiss}
        testId="error-banner"
        dismissTestId="error-banner-dismiss"
        actions={actions}
      >
        {retryLine}
      </InlineMessage>
    </div>
  );
}
