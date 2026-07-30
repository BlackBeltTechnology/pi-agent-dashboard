/**
 * `composer-panel` slot component. Rendered below the chat composer input by
 * the dashboard shell, it receives the live draft + a bounded `onApplyText`
 * apply callback, drives {@link useGrammarCheck}, and renders the trigger
 * (button + ⌘G) plus the {@link GrammarPanel} results — the whole composer
 * grammar surface, owned entirely by the plugin (no core grammar code).
 * See change: make-grammar-fully-plugin-contained.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiSpellcheck } from "@mdi/js";
import Icon from "@mdi/react";
import { useEffect } from "react";
import { GrammarPanel } from "./GrammarPanel.js";
import { GrammarRedlinePanel } from "./GrammarRedlinePanel.js";
import { useGrammarCheck } from "./useGrammarCheck.js";

export interface GrammarComposerPanelProps {
  draft: string;
  language?: string;
  sessionId?: string;
  sessionStatus?: string;
  onApplyText: (text: string) => void;
}

export function GrammarComposerPanel({
  draft,
  sessionId,
  sessionStatus,
  onApplyText,
}: GrammarComposerPanelProps) {
  const t = useT();
  const grammar = useGrammarCheck({
    draft,
    sessionId,
    sessionStatus: sessionStatus as "idle" | "streaming" | "ended" | undefined,
    onDraftChange: onApplyText,
  });

  // ⌘/Ctrl+G manual check when the feature is enabled (replaces the old
  // composer-toolbar shortcut; scoped listener, removed on unmount/disable).
  useEffect(() => {
    if (!grammar.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        grammar.checkNow();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [grammar.enabled, grammar.checkNow]);

  if (!grammar.enabled) return null;

  return (
    <div data-testid="grammar-composer-panel">
      {/* Manual trigger — shown when there's a draft and no result yet. */}
      {grammar.status === "idle" && draft.trim().length > 0 && (
        <div className="flex justify-end px-1 pt-1">
          <button
            type="button"
            data-testid="grammar-check-button"
            onClick={grammar.checkNow}
            className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            title={t("checkGrammar", undefined, "Check grammar (⌘G)")}
            aria-label={t("checkGrammar", undefined, "Check grammar")}
          >
            <Icon path={mdiSpellcheck} size={0.7} />
            {t("checkGrammar", undefined, "Check grammar")}
          </button>
        </div>
      )}
      {grammar.correctionView === "redline" ? (
        <GrammarRedlinePanel
          draft={draft}
          status={grammar.status}
          error={grammar.error}
          suggestions={grammar.suggestions}
          summary={grammar.summary}
          truncated={grammar.truncated}
          onApplyAll={grammar.applyAll}
          onAccept={grammar.accept}
          onDismiss={grammar.dismiss}
          onDismissPanel={grammar.dismissPanel}
        />
      ) : (
        <GrammarPanel
          status={grammar.status}
          error={grammar.error}
          suggestions={grammar.suggestions}
          summary={grammar.summary}
          truncated={grammar.truncated}
          onApplyAll={grammar.applyAll}
          onAccept={grammar.accept}
          onDismiss={grammar.dismiss}
          onDismissPanel={grammar.dismissPanel}
        />
      )}
    </div>
  );
}
