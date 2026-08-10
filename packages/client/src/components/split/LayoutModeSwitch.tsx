/**
 * Header layout-mode switch: a `Chat │ Split │ Editor` segmented control that
 * sets the content-area layout (`split.mode`). Self-contained: reads the split
 * state from `SplitWorkspaceContext` and renders nothing when mounted outside a
 * provider (no selected session), so it can be dropped into the shared header
 * (desktop + mobile) without prop threading.
 *
 * A mutually-exclusive 3-option control → WAI-ARIA APG radio-group pattern:
 * `role="radiogroup"` with three `role="radio"` `aria-checked` segments, roving
 * `tabindex`, Arrow/Home/End navigation, and Enter/Space selection. The active
 * mode is the checked radio.
 *
 * See change: editor-layout-modes.
 */

import { mdiFileDocumentOutline, mdiMessageOutline, mdiViewSplitVertical } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useRef } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { SplitMode } from "../../lib/layout/split-state.js";
import { useOptionalSplitWorkspace } from "./SplitWorkspaceContext.js";

interface Segment {
  mode: SplitMode;
  icon: string;
  label: string;
}

export function LayoutModeSwitch() {
  const ctx = useOptionalSplitWorkspace();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  if (!ctx) return null;

  const segments: Segment[] = [
    { mode: "closed", icon: mdiMessageOutline, label: i18nT("layout.chat", undefined, "Chat") },
    { mode: "split", icon: mdiViewSplitVertical, label: i18nT("layout.split", undefined, "Split") },
    { mode: "full", icon: mdiFileDocumentOutline, label: i18nT("layout.editor", undefined, "Editor") },
  ];
  const active = ctx.split.mode;
  const activeIndex = segments.findIndex((s) => s.mode === active);

  const focusSegment = (index: number) => {
    const clamped = (index + segments.length) % segments.length;
    ctx.setMode(segments[clamped].mode);
    refs.current[clamped]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusSegment(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusSegment(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusSegment(0);
        break;
      case "End":
        e.preventDefault();
        focusSegment(segments.length - 1);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        ctx.setMode(segments[index].mode);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={i18nT("layout.switchLabel", undefined, "Editor layout")}
      data-testid="layout-mode-switch"
      className="inline-flex items-center rounded border border-[var(--border-secondary)] overflow-hidden mr-1"
    >
      {segments.map((seg, i) => {
        const checked = seg.mode === active;
        return (
          <button
            key={seg.mode}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={seg.label}
            tabIndex={i === (activeIndex < 0 ? 0 : activeIndex) ? 0 : -1}
            data-testid={`layout-mode-${seg.mode}`}
            onClick={() => ctx.setMode(seg.mode)}
            onKeyDown={(e) => onKeyDown(e, i)}
            title={seg.label}
            className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 transition-colors ${
              checked
                ? "text-blue-400 bg-blue-500/10"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <Icon path={seg.icon} size={0.4} className="inline" />
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
