import { mdiAlert, mdiChevronDown, mdiChevronUp, mdiContentCopy, mdiStop } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { BannerRetry, BannerState } from "../../lib/chat/event-reducer.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CopyButton } from "../primitives/CopyButton.js";
import { InlineMessage } from "../primitives/InlineMessage.js";

export type { BannerState } from "../../lib/chat/event-reducer.js";

interface Props {
  state: BannerState;
  /**
   * "Stop retrying" — cancels pi's retry chain by aborting the session. Wired
   * to the same handler the main Stop button uses. The ONLY abort-capable
   * control in the banner.
   */
  onAbort?: () => void;
  /**
   * Clears the settled-error banner. Fires ONLY when no retry is pending; while
   * a retry runs, the dismiss control collapses instead (never clears).
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

/** The collapsed one-line pill: error + attempt + countdown + Stop + expand. */
function CollapsedRetryPill({
  headerText,
  retry,
  nowMs,
  stopButton,
  onExpand,
}: {
  headerText: string;
  retry: BannerRetry;
  nowMs: number;
  stopButton: ReactNode;
  onExpand: () => void;
}) {
  return (
    <div className="mt-4 mb-2 mx-auto max-w-2xl">
      <InlineMessage
        severity="error"
        icon={mdiAlert}
        variant="compact"
        testId="error-banner"
        title={
          <span className="min-w-0 flex items-baseline gap-1.5">
            <span className="truncate">{headerText}</span>
            <span className="shrink-0 opacity-80">· <RetryStatusLine retry={retry} nowMs={nowMs} /></span>
          </span>
        }
        actions={
          <>
            {stopButton}
            <button
              type="button"
              data-testid="error-banner-expand"
              onClick={onExpand}
              title={i18nT("common.expand", undefined, "Expand")}
              aria-label={i18nT("common.expand", undefined, "Expand")}
              className="opacity-70 hover:opacity-100"
            >
              <Icon path={mdiChevronDown} size={0.7} />
            </button>
          </>
        }
      />
    </div>
  );
}

/** The expanded card's action row: show-more toggle, Stop, Copy, collapse. */
function ExpandedActions({
  isLong,
  expanded,
  onToggleExpand,
  stopButton,
  headerText,
  retrying,
  onCollapse,
}: {
  isLong: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  stopButton: ReactNode;
  headerText: string;
  retrying: boolean;
  onCollapse: () => void;
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
      {stopButton}
      <CopyButton
        getText={() => headerText}
        icon={<Icon path={mdiContentCopy} size={0.6} />}
        title={i18nT("session.copyErrorMessage", undefined, "Copy error message")}
      />
      {retrying && (
        <button
          type="button"
          data-testid="error-banner-collapse"
          onClick={onCollapse}
          title={i18nT("common.collapse", undefined, "Collapse")}
          aria-label={i18nT("common.collapse", undefined, "Collapse")}
          className="opacity-70 hover:opacity-100"
        >
          <Icon path={mdiChevronUp} size={0.7} />
        </button>
      )}
    </>
  );
}

/**
 * Single-card error-lifecycle surface (change: retry-forever-with-stop-control).
 *
 * ONE bordered card (via the shared `InlineMessage` severity=error primitive).
 * The error string is the header; the retry is a live sub-line — bare
 * "attempt N" plus a countdown from `nextAttemptAt` (or a computed
 * `startedAt + delayMs`, degrading to elapsed-only on overrun / zero delay).
 *
 * Controls:
 *   - "Stop retrying" (`error-banner-stop`) — present whenever a retry is
 *     pending, in both waiting and in-flight sub-states; calls `onAbort`
 *     (cancels pi's chain by aborting). The SOLE abort control.
 *   - While a retry is pending the dismiss role degrades to COLLAPSE
 *     (`error-banner-collapse`, chevron-up) — it never clears. The collapsed
 *     pill carries error + attempt + countdown + Stop + an expand control
 *     (`error-banner-expand`, chevron-down). Collapse is sticky per failure
 *     chain: it resets to expanded when a new chain begins.
 *   - On a settled error (no retry) the dismiss control (`error-banner-dismiss`,
 *     mdiClose) clears via `onDismiss`. There is NO Retry control.
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
  const error = "variant" in state ? undefined : state.error;
  const retry = "variant" in state ? undefined : state.retry;
  const retrying = !!retry;

  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [, forceTick] = useState(0);

  // Sticky-collapse per failure chain: reset to expanded when a retry chain
  // begins (retry appears after being absent). Subsequent attempts of the same
  // chain keep the user's collapse choice.
  const prevRetrying = useRef(false);
  useEffect(() => {
    if (retrying && !prevRetrying.current) setCollapsed(false);
    prevRetrying.current = retrying;
  }, [retrying]);

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

  const stopRetrying = i18nT("session.stopRetrying", undefined, "Stop retrying");
  const stopButton = retrying && onAbort && (
    <button
      type="button"
      data-testid="error-banner-stop"
      onClick={onAbort}
      title={stopRetrying}
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-current"
    >
      <Icon path={mdiStop} size={0.55} />
      {stopRetrying}
    </button>
  );

  const retryLine = retry ? (
    <div data-testid="retry-banner" className="text-xs">
      <RetryStatusLine retry={retry} nowMs={now()} />
    </div>
  ) : null;

  // ── Collapsed pill (one line) — only while a retry is pending ──────────────
  if (retrying && collapsed && retry) {
    return (
      <CollapsedRetryPill
        headerText={headerText}
        retry={retry}
        nowMs={now()}
        stopButton={stopButton}
        onExpand={() => setCollapsed(false)}
      />
    );
  }

  // ── Expanded card ──────────────────────────────────────────────────────────
  const actions = (
    <ExpandedActions
      isLong={isLong}
      expanded={expanded}
      onToggleExpand={() => setExpanded((v) => !v)}
      stopButton={stopButton}
      headerText={headerText}
      retrying={retrying}
      onCollapse={() => setCollapsed(true)}
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
        // Dismiss clears ONLY on a settled error. While retrying, the collapse
        // control (in actions) owns the dismiss role — the ✕ is not rendered.
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
