/**
 * Corrections panel — the default `redline` presentation (selected by
 * `plugins.grammar.correctionView === "redline"`). Renders the whole draft on
 * one line via {@link buildRedlineSegments}, with a remembered mode toggle:
 *
 *  - **redline** (default): each change shows `original` (dotted, kind colour)
 *    plus a green ghost `→ replacement`; click / Enter applies only that change.
 *  - **compact**: `original` with a wavy kind-coloured squiggle; hover/focus
 *    reveals an Apply / Ignore popover (keyboard: Enter applies, Delete ignores).
 *  - **original** / **corrected**: read-only before / after previews.
 *
 * The chosen mode persists per-browser in `localStorage` (a view lens, not a
 * grammar setting). Applying reuses the hook's offset-safe `accept`/`applyAll`.
 * See change: add-grammar-compact-view.
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { GrammarErrorCode } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { mdiCheck, mdiClose, mdiSpellcheck } from "@mdi/js";
import Icon from "@mdi/react";
import type React from "react";
import { useCallback, useState } from "react";
import {
  ACCENT_BUTTON_BG,
  errorMessage,
  KIND_COLOR_VAR,
  PANEL_SHELL,
  PanelCloseButton,
} from "./grammar-panel-chrome.js";
import { buildRedlineSegments } from "./grammar-redline.js";
import type { ActiveSuggestion, GrammarStatus } from "./useGrammarCheck.js";

export type RedlineMode = "redline" | "compact" | "original" | "corrected";
const MODES: readonly RedlineMode[] = ["redline", "compact", "original", "corrected"];
const MODE_KEY = "grammar.correctionMode";

/** Read the remembered mode; any unrecognised / unavailable value → `redline`. */
function readMode(): RedlineMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return MODES.includes(v as RedlineMode) ? (v as RedlineMode) : "redline";
  } catch {
    return "redline";
  }
}

interface Props {
  draft: string;
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

export function GrammarRedlinePanel({
  draft,
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
  const [mode, setMode] = useState<RedlineMode>(readMode);
  const chooseMode = useCallback((m: RedlineMode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* storage unavailable — mode stays in-memory only */
    }
  }, []);

  if (status === "idle") return null;

  if (status === "checking") {
    return (
      <div data-testid="grammar-redline-panel" className={PANEL_SHELL}>
        <span className="text-[var(--text-muted)]">
          {t("grammar.checking", undefined, "Checking grammar…")}
        </span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div data-testid="grammar-redline-panel" className={PANEL_SHELL}>
        <div className="flex items-center gap-2">
          <span className="text-[var(--severity-error-fg)] flex-1">
            {errorMessage(t, error ?? "backend_unreachable")}
          </span>
          <PanelCloseButton label={t("grammar.dismiss", undefined, "Dismiss")} onClick={onDismissPanel} />
        </div>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div data-testid="grammar-redline-panel" className={PANEL_SHELL}>
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

  const segments = buildRedlineSegments(draft, suggestions);

  const onChangeKey = (s: ActiveSuggestion) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAccept(s.id);
    } else if (mode === "compact" && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      onDismiss(s.id);
    }
  };

  function renderChange(s: ActiveSuggestion, key: number) {
    const color = KIND_COLOR_VAR[s.kind];
    const label = `${s.kind}: ${s.original} → ${s.replacement}${s.message ? `. ${s.message}` : ""}`;

    if (mode === "original") {
      return (
        <span key={key} data-testid="grammar-change" style={{ color: "var(--accent-red)" }}>
          {s.original}
        </span>
      );
    }
    if (mode === "corrected") {
      return (
        <span key={key} data-testid="grammar-change" style={{ color: "var(--accent-green)" }}>
          {s.replacement}
        </span>
      );
    }
    if (mode === "compact") {
      return (
        <span
          key={key}
          data-testid="grammar-change"
          tabIndex={0}
          aria-label={`${label}. Enter to apply, Delete to ignore.`}
          onKeyDown={onChangeKey(s)}
          className="group relative focus-ring rounded-md cursor-pointer"
          style={{ textDecoration: "underline wavy", textDecorationColor: color, textUnderlineOffset: "3px" }}
        >
          {s.original}
          <span className="hidden group-hover:inline-flex group-focus-within:inline-flex absolute left-1/2 -translate-x-1/2 -top-7 z-10 items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-surface)] px-1 py-0.5 shadow-lg whitespace-nowrap">
            <button
              type="button"
              data-testid="grammar-apply"
              onClick={() => onAccept(s.id)}
              className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--accent-green)] hover:bg-[var(--bg-hover)]"
            >
              <Icon path={mdiCheck} size={0.5} />
              {t("apply", undefined, "Apply")}
            </button>
            <button
              type="button"
              data-testid="grammar-ignore"
              onClick={() => onDismiss(s.id)}
              className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <Icon path={mdiClose} size={0.5} />
              {t("ignore", undefined, "Ignore")}
            </button>
          </span>
        </span>
      );
    }

    // redline (default)
    return (
      <span
        key={key}
        data-testid="grammar-change"
        tabIndex={0}
        aria-label={`${label}. Enter to apply.`}
        onClick={() => onAccept(s.id)}
        onKeyDown={onChangeKey(s)}
        className="focus-ring rounded-md cursor-pointer"
      >
        <span
          style={{ color, textDecoration: "underline dotted", textDecorationColor: color, textUnderlineOffset: "3px" }}
        >
          {s.original}
        </span>
        <span data-testid="grammar-ghost" className="ml-1" style={{ color: "var(--accent-green)" }}>
          → {s.replacement}
        </span>
      </span>
    );
  }

  const modeLabel: Record<RedlineMode, string> = {
    redline: t("modeRedline", undefined, "Redline"),
    compact: t("modeCompact", undefined, "Compact"),
    original: t("modeOriginal", undefined, "Original"),
    corrected: t("modeCorrected", undefined, "Corrected"),
  };

  return (
    <div data-testid="grammar-redline-panel" className={PANEL_SHELL}>
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
          style={{ background: ACCENT_BUTTON_BG }}
          className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white hover:opacity-90"
        >
          <Icon path={mdiCheck} size={0.6} />
          {t("grammar.applyAll", undefined, "Apply all")}
        </button>
        <PanelCloseButton label={t("grammar.dismiss", undefined, "Dismiss")} onClick={onDismissPanel} />
      </div>

      {/* Mode toggle: Redline · Compact · Original · Corrected (remembered). */}
      <div
        data-testid="grammar-mode-toggle"
        role="tablist"
        aria-label={t("correctionView", undefined, "Correction view")}
        className="inline-flex self-start rounded-md border border-[var(--border-secondary)] overflow-hidden text-[11px]"
      >
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            data-testid={`grammar-mode-${m}`}
            onClick={() => chooseMode(m)}
            style={mode === m ? { background: ACCENT_BUTTON_BG } : undefined}
            className={
              mode === m
                ? "px-2.5 py-1 text-white"
                : "px-2.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border-l border-[var(--border-secondary)] first:border-l-0"
            }
          >
            {modeLabel[m]}
          </button>
        ))}
      </div>

      {truncated && (
        <span className="text-[11px] text-[var(--text-muted)]">
          {t("grammar.truncated", undefined, "Only the first part of your draft was checked.")}
        </span>
      )}

      <div data-testid="grammar-redline" className="break-words leading-loose">
        {segments.map((seg, i) =>
          seg.type === "unchanged" ? (
            <span key={i} className="text-[var(--text-secondary)]">
              {seg.text}
            </span>
          ) : (
            renderChange(seg.suggestion, i)
          ),
        )}
      </div>
    </div>
  );
}
