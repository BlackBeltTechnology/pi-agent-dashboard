/**
 * Embed-mode chrome: the "Open full dashboard" exit control and the embed home
 * message that replaces the session list. Exit navigates with REPLACE to the
 * current path and query with `embed` set to `0` (other parameters kept).
 * See change: add-session-ui-deep-links-for-agents (D5).
 */
import { useLocation, useSearch } from "wouter";
import { t as i18nT } from "../../lib/i18n/i18n.js";

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

/** Current path + query with `embed` removed and `embed=0` appended. */
export function buildEmbedExitTarget(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("embed");
  params.set("embed", "0");
  return `${pathname}?${params.toString()}`;
}

export function EmbedExit({ navigate, className }: { navigate: Navigate; className?: string }) {
  const [pathname] = useLocation();
  const search = useSearch();
  return (
    <button
      type="button"
      data-testid="embed-exit"
      onClick={() => navigate(buildEmbedExitTarget(pathname, search), { replace: true })}
      className={
        className ??
        "rounded border border-[var(--border-primary)] px-3 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      }
    >
      {i18nT("embed.exit", undefined, "Open full dashboard")}
    </button>
  );
}

/** What embed mode shows where the session list / landing page would be. */
export function EmbedHome({ navigate }: { navigate: Navigate }) {
  return (
    <div
      data-testid="embed-home"
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[var(--text-tertiary)]"
    >
      <p className="text-sm">{i18nT("embed.noSession", undefined, "No session selected")}</p>
      <EmbedExit navigate={navigate} />
    </div>
  );
}
