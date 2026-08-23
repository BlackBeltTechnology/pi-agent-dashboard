/**
 * Interstitial divider disclosing the elided middle of a WINDOWED replay.
 *
 * NOT the Slack/WhatsApp "load older" pattern: those anchor at the TOP because
 * their missing region is unbounded upward. This gap is bounded on BOTH sides
 * — head above, tail below — so the affordance sits between two loaded regions,
 * mid-scroll. It is an interstitial, not a header.
 *
 * Click-to-load, not scroll-triggered auto-fetch: retrieving a specific earlier
 * exchange in your own transcript is a FIND task, and NN/g's guidance is
 * pagination-with-visible-position for find tasks, infinite scroll only for
 * exploratory feeds. It also removes the auto-fetch loop risk entirely.
 *
 * Weight is deliberately secondary — the composer's send button is this view's
 * one focal action, so the pill reuses the shipped floating-pill treatment
 * rather than an accent-filled CTA.
 *
 * See change: lazy-load-session-history (task 7.1, mockups/ui-plan.md § A).
 */
import type { HistoryGapState } from "../../lib/chat/history-gap.js";
import { t } from "../../lib/i18n/i18n.js";

interface Props {
  gap: HistoryGapState;
  onLoadEarlier: () => void;
}

function WarningIcon() {
  return (
    <svg className="w-[13px] h-[13px] shrink-0 block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6" />
      <path d="M12 16.5v.5" />
    </svg>
  );
}

/**
 * Flanking rules are hidden below 480px: at that width they degrade to
 * sub-24px stubs that read as artifacts rather than as a divider. The
 * container's own top border carries the Gestalt continuity cue instead.
 */
const RULE = "flex-1 h-px bg-[var(--border-secondary)] min-w-[24px] hidden sm:block";
/**
 * 32px on desktop keeps the secondary weight (Von Restorff); below 480px the
 * pill is the component's only touch target, so Fitts's Law takes precedence
 * over visual restraint and it gets the full 44px. Both clear the AA 24×24 floor.
 */
const PILL =
  "inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[32px] px-4 sm:px-3 rounded-full " +
  "bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)] " +
  "text-xs cursor-pointer hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-85 " +
  "focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

export function HistoryGapDivider({ gap, onLoadEarlier }: Props) {
  /**
   * `--text-muted` is BANNED on this surface (2.77:1 dark / 2.32:1 light — both
   * fail AA for text) and `--text-tertiary` is unsafe as text in the LIGHT
   * theme (4.477:1, just under the 4.5:1 floor; it is documented as a 3:1
   * non-text overlay boundary). Every text token here is `--text-secondary`
   * (9.07:1 dark / 9.74:1 light) or `--text-primary`.
   */
  const body = (() => {
    /**
     * A5 — the gap exists but the store cannot serve it. Deliberately NOT an
     * error: nothing failed. No retry is offered because there is nothing to
     * retry.
     *
     * The wording must stay true for BOTH causes of an empty slice: retention
     * having trimmed the events, and replay compaction having dropped a whole
     * all-`message_update` band as superseded. The client cannot distinguish
     * them, so it states the OUTCOME ("no longer available to load") and never
     * attributes the loss to retention, which would sometimes be false.
     * See change: fix-lazy-history-backfill-ux (D8).
     */
    if (gap.unservable) {
      return (
        <span role="status" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] whitespace-nowrap" data-testid="history-gap-unavailable">
          <WarningIcon />
          {t(
            "chat.historyGap.unavailable",
            undefined,
            "These earlier messages are no longer available to load.",
          )}
        </span>
      );
    }
    // A4 — every protocol code collapses to ONE plain sentence plus a retry.
    // `in_flight` / `stale_generation` are transient races the user cannot act
    // on differently, so distinguishing them would add choice without agency.
    if (gap.failed) {
      return (
        <>
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] whitespace-nowrap" data-testid="history-gap-error">
            <WarningIcon />
            {t("chat.historyGap.error", undefined, "Could not load earlier messages.")}
          </span>
          <button type="button" className={PILL} onClick={onLoadEarlier} data-testid="history-gap-retry">
            {t("chat.historyGap.retry", undefined, "Try again")}
          </button>
        </>
      );
    }
    // A2 — local pending state. Deliberately NOT the replay-in-flight flag:
    // that one means "the initial replay is still arriving", a different fact.
    if (gap.pending) {
      return (
        <button type="button" className={PILL} disabled aria-busy="true" data-testid="history-gap-loading">
          <span className="w-3 h-3 shrink-0 rounded-full border-2 border-[var(--border-strong)] border-t-transparent animate-spin motion-reduce:animate-none" />
          {t("chat.historyGap.loading", undefined, "Loading earlier messages…")}
        </button>
      );
    }
    // A1 / A3 — idle. The exact count is stated because we KNOW it; an
    // unlabelled "Load more" would make the user guess how much is hidden.
    return (
      <>
        <span role="status" className="text-xs text-[var(--text-secondary)] whitespace-nowrap" data-testid="history-gap-count">
          {gap.gapCount === 1
            ? t("chat.historyGap.countOne", { count: "1" }, "1 earlier message")
            : t("chat.historyGap.countMany", { count: gap.gapCount.toLocaleString() }, `${gap.gapCount.toLocaleString()} earlier messages`)}
        </span>
        <button type="button" className={PILL} onClick={onLoadEarlier} disabled={!gap.armed} data-testid="history-gap-load">
          {t("chat.historyGap.load", undefined, "Load earlier")}
        </button>
      </>
    );
  })();

  return (
    <div
      data-testid="history-gap-divider"
      className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 px-0 sm:px-4 py-3 mx-4 sm:mx-0 border-t sm:border-t-0 border-[var(--border-secondary)]"
    >
      <div className={RULE} />
      <div className="flex items-center gap-2.5 shrink-0 flex-wrap justify-center w-full sm:w-auto">{body}</div>
      <div className={RULE} />
    </div>
  );
}
