/**
 * "Still loading history · Ns" + Retry, rendered above the chat skeleton once a
 * load has run `SLOW_LOAD_MS` with no content. Self-contained: it owns the 1 s
 * clock, so only it re-renders per second — never `ChatView`. The live region
 * text is static (announced once); the seconds sibling is `aria-hidden`.
 * See change: show-session-history-load-state (design D8).
 */
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { SLOW_LOAD_MS } from "../../lib/replay/history-load-phase.js";
import { useNow } from "../../lib/time/use-now.js";

export interface SlowLoadNoticeProps {
  startedAt: number;
  onRetry?: () => void;
}

export function SlowLoadNotice({ startedAt, onRetry }: SlowLoadNoticeProps) {
  const now = useNow(true);
  const elapsed = now - startedAt;
  if (elapsed < SLOW_LOAD_MS) return null;
  return (
    <div
      className="flex items-center gap-2 px-4 pt-3 text-xs text-[var(--text-secondary)]"
      data-testid="chat-history-slow-notice"
    >
      <span role="status">{i18nT("status.historyStillLoading", undefined, "Still loading history")}</span>
      <span aria-hidden="true" className="tabular-nums text-[var(--text-tertiary)]">· {Math.floor(elapsed / 1000)}s</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring ml-auto rounded px-2 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
          data-testid="chat-history-slow-retry"
        >
          {i18nT("common.retry", undefined, "Retry")}
        </button>
      ) : null}
    </div>
  );
}
