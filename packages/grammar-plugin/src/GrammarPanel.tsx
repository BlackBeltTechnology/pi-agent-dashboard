/**
 * Corrections panel rendered directly above the composer (sibling to
 * QueuePanel in App). Shows diff-highlighted corrections + a grammar summary,
 * with per-suggestion Accept/Dismiss and an Apply-all action. A `<textarea>`
 * cannot style substrings, so all highlighting lives here — the composer
 * itself stays a plain textarea. See change: add-composer-grammar-check.
 */

import type { GrammarErrorCode } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiCheck, mdiClose, mdiSpellcheck } from "@mdi/js";
import Icon from "@mdi/react";
import type { ActiveSuggestion, GrammarStatus } from "./useGrammarCheck.js";

interface Props {
  status: GrammarStatus;
  error: GrammarErrorCode | null;
  suggestions: ActiveSuggestion[];
  summary: string | null;
  truncated: boolean;
  onApplyAll: () => void;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissPanel: () => void;
}

function errorMessage(t: ReturnType<typeof useT>, code: GrammarErrorCode): string {
  switch (code) {
    case "backend_unreachable":
      return t("grammar.err.unreachable", undefined, "Grammar backend unreachable. Check the LanguageTool server or provider.");
    case "backend_timeout":
      return t("grammar.err.timeout", undefined, "Grammar check timed out.");
    case "backend_unconfigured":
      return t("grammar.err.unconfigured", undefined, "Grammar backend is not configured.");
    case "backend_bad_response":
      return t("grammar.err.badResponse", undefined, "Grammar backend returned an unexpected response.");
    default:
      return t("grammar.err.generic", undefined, "Grammar check failed.");
  }
}

export function GrammarPanel({
  status,
  error,
  suggestions,
  summary,
  truncated,
  onApplyAll,
  onAccept,
  onDismiss,
  onDismissPanel,
}: Props) {
  const t = useT();

  // Idle with nothing to show → render nothing (the trigger lives in the
  // plugin's composer-panel wrapper below the input).
  if (status === "idle") return null;

  const shell =
    "border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 px-3 py-2 flex flex-col gap-2 text-sm";

  if (status === "checking") {
    return (
      <div data-testid="grammar-panel" className={shell}>
        <span className="text-[var(--text-muted)]">
          {t("grammar.checking", undefined, "Checking grammar…")}
        </span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div data-testid="grammar-panel" className={shell}>
        <div className="flex items-center gap-2">
          <span className="text-[var(--severity-error-fg)] flex-1">
            {errorMessage(t, error ?? "backend_unreachable")}
          </span>
          <PanelCloseButton label={t("grammar.dismiss", undefined, "Dismiss")} onClick={onDismissPanel} />
        </div>
      </div>
    );
  }

  // status === "done"
  if (suggestions.length === 0) {
    return (
      <div data-testid="grammar-panel" className={shell}>
        <div className="flex items-center gap-2">
          <Icon path={mdiSpellcheck} size={0.7} className="text-[var(--accent-green)]" />
          <span className="text-[var(--text-secondary)] flex-1">
            {t("grammar.noIssues", undefined, "No issues found")}
          </span>
          <PanelCloseButton label={t("grammar.dismiss", undefined, "Dismiss")} onClick={onDismissPanel} />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="grammar-panel" className={shell}>
      {/* Header: summary + apply-all + close. */}
      <div className="flex items-center gap-2">
        <Icon path={mdiSpellcheck} size={0.7} className="text-[var(--accent-primary)]" />
        <span data-testid="grammar-summary" className="text-[var(--text-secondary)] flex-1 truncate">
          {summary ?? t("grammar.corrections", undefined, "Corrections")}
        </span>
        <button
          type="button"
          data-testid="grammar-apply-all"
          onClick={onApplyAll}
          className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium bg-[var(--accent-primary)] text-white hover:opacity-90"
        >
          <Icon path={mdiCheck} size={0.6} />
          {t("grammar.applyAll", undefined, "Apply all")}
        </button>
        <PanelCloseButton label={t("grammar.dismiss", undefined, "Dismiss")} onClick={onDismissPanel} />
      </div>

      {truncated && (
        <span className="text-[11px] text-[var(--text-muted)]">
          {t("grammar.truncated", undefined, "Only the first part of your draft was checked.")}
        </span>
      )}

      {/* Suggestion list. */}
      <ul className="flex flex-col gap-1.5">
        {suggestions.map((s) => (
          <li
            key={s.id}
            data-testid="grammar-suggestion"
            className="flex items-start gap-2 rounded-md bg-[var(--bg-primary)]/40 px-2 py-1.5"
          >
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="line-through text-[var(--accent-red)] break-words">{s.original}</span>
                <span className="text-[var(--accent-green)] break-words">{s.replacement}</span>
                <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{s.kind}</span>
              </div>
              {s.message && (
                <div className="text-[11px] text-[var(--text-muted)] truncate">{s.message}</div>
              )}
            </div>
            <button
              type="button"
              data-testid="grammar-accept"
              disabled={s.stale}
              onClick={() => onAccept(s.id)}
              title={
                s.stale
                  ? t("grammar.staleHint", undefined, "This suggestion no longer matches your draft")
                  : t("grammar.accept", undefined, "Accept")
              }
              aria-label={t("grammar.accept", undefined, "Accept")}
              className="focus-ring inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--accent-green)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Icon path={mdiCheck} size={0.7} />
            </button>
            <button
              type="button"
              data-testid="grammar-dismiss"
              onClick={() => onDismiss(s.id)}
              title={t("grammar.dismiss", undefined, "Dismiss")}
              aria-label={t("grammar.dismiss", undefined, "Dismiss")}
              className="focus-ring inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <Icon path={mdiClose} size={0.7} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PanelCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="grammar-panel-close"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="focus-ring inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    >
      <Icon path={mdiClose} size={0.7} />
    </button>
  );
}
