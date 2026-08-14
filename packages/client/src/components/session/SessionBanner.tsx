import { mdiAlert, mdiChevronDown, mdiChevronUp, mdiContentCopy, mdiLoading } from "@mdi/js";
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
   * Clears the banner. Always available (retrying or settled) and clear-only —
   * it never aborts. While retrying, the next attempt's signal re-opens the
   * surface; a confirmed-good resume clears it on its own.
   */
  onDismiss?: () => void;
  /** One-shot continue-resume. Rendered only for a settled provider error. */
  onRetry?: () => void;
  /** Lifecycle identity for settled Retry. A new error timestamp re-enables the one-shot control. */
  retryRevision?: number;
  /** Override clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Character cutoff before collapsing the error message. Defaults to 240. */
  collapseThreshold?: number;
}

/**
 * Countdown / elapsed suffix, or `undefined` while an attempt is in flight — the
 * spinner is the in-flight signal, so no words are spent on it.
 * See change: raw-error-render-and-retry-authority.
 */
function countdownSuffix(retry: BannerRetry, nowMs: number): string | undefined {
  if (!retry.waiting) return undefined;
  const target =
    retry.nextAttemptAt ?? (retry.delayMs > 0 ? retry.startedAt + retry.delayMs : undefined);
  if (target !== undefined) {
    const remainMs = target - nowMs;
    if (remainMs > 0) {
      const secs = Math.ceil(remainMs / 1000);
      return i18nT("status.retryInSecs", { secs }, `${secs}s`);
    }
  }
  // No known target (delayMs 0) OR the computed countdown overran: elapsed-only,
  // never a zeroed/negative countdown.
  const elapsed = Math.max(0, Math.floor((nowMs - retry.startedAt) / 1000));
  return i18nT("status.retrySecsElapsed", { secs: elapsed }, `${elapsed}s elapsed`);
}

/**
 * Spinner + short label — `Retry 3 · 12s` waiting, `Retry 3` in flight.
 *
 * The spinner carries the in-flight signal that "retrying now…" used to spell
 * out; the text carries only what motion cannot — which attempt, and how long.
 * The attempt number stays TEXT so the state survives `prefers-reduced-motion`
 * and greyscale. Coloured from `--severity-warning-fg`, not raw
 * `--status-working` (1.68:1 on the light surface).
 */
function RetryStatusLine({ retry, nowMs }: { retry: BannerRetry; nowMs: number }) {
  const suffix = countdownSuffix(retry, nowMs);
  return (
    <span className="inline-flex items-center gap-1 text-[var(--severity-warning-fg)]">
      <Icon path={mdiLoading} size={0.55} className="animate-spin shrink-0" aria-hidden="true" />
      <span data-testid="retry-banner-attempt">
        {i18nT("session.retryAttempt", { attempt: retry.attempt }, "Retry {attempt}")}
      </span>
      {suffix !== undefined && (
        <>
          {" · "}
          <span data-testid="retry-banner-countdown">{suffix}</span>
        </>
      )}
    </span>
  );
}

/**
 * The collapsed one-line row. Entered only by explicit user action while a retry
 * is pending; it keeps the surface — and therefore `retryState` and the session
 * Stop — alive while hiding the error text.
 * See change: raw-error-render-and-retry-authority (D1).
 */
function CollapsedRetryRow({
  retry,
  nowMs,
  onExpand,
}: {
  retry: BannerRetry;
  nowMs: number;
  onExpand: () => void;
}) {
  return (
    <div className="mt-4 mb-2 mx-auto max-w-2xl">
      <InlineMessage
        severity="error"
        icon={mdiAlert}
        variant="compact"
        animate={!retry.waiting}
        title={
          <span data-testid="retry-banner">
            <RetryStatusLine retry={retry} nowMs={nowMs} />
          </span>
        }
        onDismiss={onExpand}
        dismissIcon={mdiChevronDown}
        dismissLabel={i18nT("session.showError", undefined, "Show error")}
        testId="error-banner"
        dismissTestId="error-banner-expand"
      />
    </div>
  );
}

/** The card's action row: settled Retry + show-more toggle + Copy. */
function ExpandedActions({
  isLong,
  expanded,
  onToggleExpand,
  headerText,
  onRetry,
  retryDisabled,
}: {
  isLong: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  headerText: string;
  onRetry?: () => void;
  retryDisabled: boolean;
}) {
  return (
    <>
      {onRetry && (
        <button
          type="button"
          data-testid="error-banner-retry"
          onClick={onRetry}
          disabled={retryDisabled}
          title={i18nT("session.retryContinueSession", undefined, "Retry by continuing session")}
          className="rounded border border-[var(--severity-error-border)] px-2 py-1 text-xs font-medium text-[var(--severity-error-fg)] hover:bg-[var(--bg-hover)] disabled:cursor-wait disabled:opacity-50"
        >
          {i18nT("common.retry", undefined, "Retry")}
        </button>
      )}
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
 *   - No "Stop retrying" control — the session Stop is the sole abort entry
 *     point, and it already ends the chain (abortLatch + persistent abort).
 *   - The trailing control's icon states what it does. While retrying it is a
 *     chevron that COLLAPSES (component-local; `onDismiss` is not called and
 *     `retryState` is never written, so the session Stop stays mounted). Once
 *     retrying stops it is a real ✕ that clears the surface.
 *   - The surface clears itself on confirmed-good resume. A settled provider
 *     error offers one-shot Retry by continuing the session, plus Copy and X.
 *
 * Mounted sticky above the command input.
 */
export function SessionBanner({
  state,
  onDismiss,
  onRetry,
  retryRevision,
  now = Date.now,
  collapseThreshold = 240,
}: Props) {
  const error = "variant" in state ? undefined : state.error;
  const retry = "variant" in state ? undefined : state.retry;
  const retrying = !!retry;

  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [retryRequested, setRetryRequested] = useState(false);
  const [, forceTick] = useState(0);

  // Collapsing exists to keep the session Stop mounted during a live loop. Once
  // retrying stops there is no handle to protect and the error is actionable,
  // so a stale collapsed row would hide a terminal failure behind a dead
  // spinner. Reset it. See change: raw-error-render-and-retry-authority (D3).
  useEffect(() => {
    if (!retrying && collapsed) setCollapsed(false);
  }, [retrying, collapsed]);

  // A new error/retry phase can offer Retry again. Within one settled phase the
  // control is one-shot so rapid clicks cannot enqueue duplicate runs.
  useEffect(() => {
    setRetryRequested(false);
  }, [retryRevision, error?.message, retrying]);

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

  // ── Collapsed row: retry status only, one line, re-expandable ─────────────
  if (retry && collapsed) {
    return <CollapsedRetryRow retry={retry} nowMs={now()} onExpand={() => setCollapsed(false)} />;
  }

  // The trailing control's identity in ONE place: while retrying it collapses
  // (component-local, never touching `retryState`); once settled it dismisses.
  // See change: raw-error-render-and-retry-authority (D1/D2).
  const trailing = retrying
    ? {
        onDismiss: () => setCollapsed(true),
        dismissIcon: mdiChevronUp,
        dismissLabel: i18nT("common.collapse", undefined, "Collapse"),
        dismissTestId: "error-banner-collapse",
      }
    : { onDismiss, dismissIcon: undefined, dismissLabel: undefined, dismissTestId: "error-banner-dismiss" };

  // ── Card ───────────────────────────────────────────────────────────────────
  const actions = (
    <ExpandedActions
      isLong={isLong}
      expanded={expanded}
      onToggleExpand={() => setExpanded((v) => !v)}
      headerText={headerText}
      onRetry={retrying || !onRetry ? undefined : () => {
        if (retryRequested) return;
        setRetryRequested(true);
        onRetry();
      }}
      retryDisabled={retryRequested}
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
        {...trailing}
        testId="error-banner"
        actions={actions}
      >
        {retryLine}
      </InlineMessage>
    </div>
  );
}
