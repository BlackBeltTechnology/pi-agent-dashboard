/**
 * Dismissible notice shown when a terminal spawn was refused: at a cap
 * (`terminal_limit_reached`) or by cwd admission / unknown session (`terminal_error`,
 * server-authored text shown verbatim). `role="status"` (polite): it reports an outcome,
 * not an emergency. Severity colour plus a "!" glyph, never colour alone.
 * Mockup A in the change's `mockups/index.html`.
 * See change: harden-server-capability-bounds (D3), harden-git-terminal-plugin-boundaries (D14).
 */
import { useSyncExternalStore } from "react";
import { t } from "../../lib/i18n/i18n.js";
import {
  dismissTerminalLimitNotice,
  getTerminalLimitNotice,
  getTerminalLimitNoticeVersion,
  subscribeTerminalLimitNotices,
} from "../../lib/state/terminal-limit-notice-store.js";

interface Props {
  cwd: string;
  /** True in the chat slot (an inline terminal card was refused), false in the tab bar. */
  inline: boolean;
}

export function TerminalLimitNotice({ cwd, inline }: Props) {
  // Re-render on any store change; read the slot's notice directly.
  useSyncExternalStore(subscribeTerminalLimitNotices, getTerminalLimitNoticeVersion);
  const notice = getTerminalLimitNotice(cwd, inline);
  if (!notice) return null;

  const isError = notice.kind === "error";
  const body =
    notice.kind === "error"
      ? notice.message
      : notice.scope === "owner"
      ? t(
          "terminalLimit.owner",
          { limit: notice.limit },
          "You already have {limit} terminals open (the maximum). Close one you no longer need, then try again.",
        )
      : t(
          "terminalLimit.global",
          { limit: notice.limit },
          "{limit} terminals are open across all folders (the maximum). Close one in any folder, then try again.",
        );

  return (
    <div
      className="px-2 pt-2"
      data-testid={`${isError ? "terminal-error-notice" : "terminal-limit-notice"}${inline ? "-inline" : ""}`}
    >
      <div
        role="status"
        className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]"
      >
        <span aria-hidden="true" className="w-4 flex-none text-center font-bold">!</span>
        <div className="min-w-0 flex-1">
          <strong className="block font-semibold">
            {isError
              ? t("terminalError.title", undefined, "Terminal not opened")
              : t("terminalLimit.title", undefined, "Terminal limit reached")}
          </strong>
          {body}
        </div>
        <button
          type="button"
          onClick={() => dismissTerminalLimitNotice(cwd, inline)}
          className="focus-ring -m-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded sm:min-h-[28px] sm:min-w-[28px] hover:bg-[var(--bg-hover)]"
          aria-label={t("common.dismiss", undefined, "Dismiss")}
          title={t("common.dismiss", undefined, "Dismiss")}
        >
          ×
        </button>
      </div>
    </div>
  );
}
