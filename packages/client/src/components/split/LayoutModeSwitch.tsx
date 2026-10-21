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

import { mdiCheck, mdiFileDocumentOutline, mdiMenuDown, mdiMessageOutline, mdiViewSplitHorizontal, mdiViewSplitVertical } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { SplitMode } from "../../lib/layout/split-state.js";
import { useOptionalSplitWorkspace } from "./SplitWorkspaceContext.js";

interface Segment {
  mode: SplitMode;
  icon: string;
  label: string;
  /** Extra line under the label (menu variant only). */
  description?: string;
}

interface Props {
  /**
   * `segmented` (default): the 3-segment radiogroup. `menu`: the mobile form —
   * a 44 px trigger showing the current mode icon + caret that opens an APG
   * menu of three `menuitemradio` items.
   */
  variant?: "segmented" | "menu";
}

export function LayoutModeSwitch({ variant = "segmented" }: Props = {}) {
  const ctx = useOptionalSplitWorkspace();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  if (!ctx) return null;
  if (variant === "menu") return <LayoutModeMenu ctx={ctx} />;

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
      className="inline-flex items-stretch shrink-0 rounded-md border border-[var(--border-secondary)] overflow-hidden bg-[var(--bg-primary)]"
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
            className={`inline-flex items-center justify-center gap-1.5 min-h-8 px-3 text-xs font-semibold transition-colors @max-[760px]:px-0 @max-[760px]:min-w-9 ${
              i > 0 ? "border-l border-[var(--border-secondary)]" : ""
            } ${
              checked
                ? "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <Icon path={seg.icon} size={0.67} className="inline shrink-0" />
            <span className="@max-[760px]:sr-only">{seg.label}</span>
          </button>
        );
      })}
    </div>
  );
}

type Ctx = NonNullable<ReturnType<typeof useOptionalSplitWorkspace>>;

/** Mobile layout-mode menu (APG menu button + `menuitemradio` items). */
function LayoutModeMenu({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // On a phone the split stacks (chat above, editor below), so Split gets the
  // horizontal-divider glyph.
  const segments: Segment[] = [
    { mode: "closed", icon: mdiMessageOutline, label: i18nT("layout.chat", undefined, "Chat") },
    {
      mode: "split",
      icon: mdiViewSplitHorizontal,
      label: i18nT("layout.split", undefined, "Split"),
      description: i18nT("layout.splitStacked", undefined, "Chat above, editor below"),
    },
    { mode: "full", icon: mdiFileDocumentOutline, label: i18nT("layout.editor", undefined, "Editor") },
  ];
  const active = ctx.split.mode;
  const activeIndex = Math.max(0, segments.findIndex((s) => s.mode === active));
  const current = segments[activeIndex];

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
    const onOutside = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
    // Focus only on open; later mode changes close the menu anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const focusItem = (index: number) => itemRefs.current[(index + segments.length) % segments.length]?.focus();
  const choose = (mode: SplitMode) => {
    ctx.setMode(mode);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onItemKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusItem(0);
        break;
      case "End":
        e.preventDefault();
        focusItem(segments.length - 1);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        choose(segments[index].mode);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const triggerLabel = i18nT("layout.currentMode", { mode: current.label }, `Editor layout: ${current.label}`);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        data-testid="layout-mode-switch"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md text-[var(--tint-blue-fg)] hover:bg-[var(--bg-hover)]"
      >
        <Icon path={current.icon} size={0.83} />
        <Icon path={mdiMenuDown} size={0.6} className="-ml-0.5 text-[var(--text-secondary)]" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={i18nT("layout.switchLabel", undefined, "Editor layout")}
          className="absolute right-0 top-full mt-1 z-popover min-w-[220px] rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] py-1 shadow-lg"
        >
          {segments.map((seg, i) => {
            const checked = seg.mode === active;
            return (
              <button
                key={seg.mode}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                data-testid={`layout-mode-${seg.mode}`}
                onClick={() => choose(seg.mode)}
                onKeyDown={(e) => onItemKeyDown(e, i)}
                className={`flex w-full items-center gap-2 min-h-[44px] px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] ${
                  checked ? "font-semibold" : ""
                }`}
              >
                <Icon path={seg.icon} size={0.75} className="shrink-0 text-[var(--text-secondary)]" />
                <span className="min-w-0">
                  {seg.label}
                  {seg.description && <span className="block text-xs font-normal text-[var(--text-secondary)]">{seg.description}</span>}
                </span>
                {checked && <Icon path={mdiCheck} size={0.75} className="ml-auto shrink-0 text-[var(--tint-blue-fg)]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
