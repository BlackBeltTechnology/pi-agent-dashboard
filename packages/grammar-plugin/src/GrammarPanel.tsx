/**
 * Corrections panel — the `list` presentation (selected by
 * `plugins.grammar.correctionView === "list"`). Renders each suggestion as an
 * aligned **before → after** row carrying the `kind` (a coloured pill) and the
 * `message`, with per-row Accept / Dismiss and a panel-level Apply-all. The
 * default presentation is the inline {@link GrammarRedlinePanel}; this stacked
 * view is the alternative. A `<textarea>` cannot style substrings, so all
 * highlighting lives here. See changes: add-composer-grammar-check,
 * add-grammar-compact-view.
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { GrammarErrorCode } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { mdiCheck, mdiClose, mdiSpellcheck } from "@mdi/js";
import Icon from "@mdi/react";
import { errorMessage, KIND_COLOR_VAR, PANEL_SHELL, PanelCloseButton } from "./grammar-panel-chrome.js";
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

  if (status === "idle") return null;

  if (status === "checking") {
    return (
      <div data-testid="grammar-panel" className={PANEL_SHELL}>
        <span className="text-[var(--text-muted)]">
          {t("grammar.checking", undefined, "Checking grammar…")}
        </span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div data-testid="grammar-panel" className={PANEL_SHELL}>
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
      <div data-testid="grammar-panel" className={PANEL_SHELL}>
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
    <div data-testid="grammar-panel" className={PANEL_SHELL}>
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

      {/* Aligned before → after grid: the L2 layout. */}
      <div
        className="grid items-center gap-x-3 gap-y-0.5"
        style={{ gridTemplateColumns: "1fr auto 1fr auto auto auto" }}
      >
        {suggestions.map((s) => (
          <div key={s.id} data-testid="grammar-suggestion" style={{ display: "contents" }}>
            <span className="text-right break-words line-through text-[var(--accent-red)]">{s.original}</span>
            <span className="text-[var(--text-muted)]">→</span>
            <span className="break-words text-[var(--accent-green)]">{s.replacement}</span>
            <span
              className="justify-self-start text-[9.5px] uppercase tracking-wide rounded px-1.5 py-px text-[var(--text-secondary)]"
              style={{
                background: `color-mix(in srgb, ${KIND_COLOR_VAR[s.kind]} 20%, transparent)`,
                border: `1px solid color-mix(in srgb, ${KIND_COLOR_VAR[s.kind]} 45%, transparent)`,
              }}
            >
              {s.kind}
            </span>
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
            {s.message && (
              <span className="text-[11px] text-[var(--text-muted)]" style={{ gridColumn: "1 / -1" }}>
                {s.message}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
