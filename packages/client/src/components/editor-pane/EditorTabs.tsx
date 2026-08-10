/**
 * Horizontal tab strip for the editor pane. Click to activate, "×" / middle-
 * click / Ctrl+Cmd-W to close, drag to reorder. Labels show the basename;
 * the tooltip shows the rel path.
 *
 * See change: add-internal-monaco-editor-pane.
 * See change: improve-content-editor (per-kind tab icon #2).
 */

import { mdiClose, mdiConsoleLine } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import type { OpenFile } from "../../lib/layout/editor-pane-state.js";
import { fileIcon } from "../../lib/preview/file-icon.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { stripTermId } from "../../lib/layout/use-terminal-pane-tabs.js";

interface EditorTabsProps {
  openFiles: OpenFile[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  /** Resolve a terminal id to its display title (for `term:<id>` tabs). */
  terminalTitle?: (id: string) => string | undefined;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** True while the OS requests reduced motion (WCAG 2.2.2). Reactive. */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const mq = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduce;
}

/**
 * Unread indicator for a background-added tab (change: non-disruptive-file-open).
 * The dot persists while `file.unread`; a one-time pulse plays each time this
 * tab's OpenFile object identity changes (a fresh background add OR a re-signal
 * — the reducer always mints a new object via setUnreadAt), so a repeat agent
 * write re-pulses. Pulse is transient (local state, not persisted) and gated
 * behind reduced-motion: the dot still shows, the animation does not run.
 */
function UnreadDot({ file }: { file: OpenFile }) {
  const reduce = usePrefersReducedMotion();
  const [pulse, setPulse] = useState(true);
  // Re-runs on mount and whenever `file` changes reference. The reducer mints a
  // NEW OpenFile object on every background add / re-signal (setUnreadAt) but
  // preserves identity for untouched tabs — so this re-pulses on a repeat agent
  // write without firing on unrelated re-renders. The `file` dep is the trigger
  // itself, not a value read inside the effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `file` identity is the intended re-pulse trigger
  useEffect(() => {
    setPulse(true);
    const id = setTimeout(() => setPulse(false), 700);
    return () => clearTimeout(id);
  }, [file]);
  const animate = pulse && !reduce;
  return (
    <span
      data-testid="unread-dot"
      data-pulse={animate ? "true" : "false"}
      aria-hidden="true"
      className={[
        "ml-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-blue)]",
        animate ? "animate-ping" : "",
      ].join(" ")}
    />
  );
}

export function EditorTabs({ openFiles, activeIndex, onActivate, onClose, onReorder, terminalTitle }: EditorTabsProps) {
  const { t } = useI18n();
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Roving-tabindex keyboard navigation across the tab strip.
  const onTabKeyDown = (e: React.KeyboardEvent, i: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(i + 1, openFiles.length - 1);
    else if (e.key === "ArrowLeft") next = Math.max(i - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = openFiles.length - 1;
    else if (e.key === "Enter" || e.key === " ") next = i;
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onClose(i);
      return;
    } else return;
    e.preventDefault();
    onActivate(next);
    tabRefs.current[next]?.focus();
  };

  // Close the active tab on Ctrl/Cmd-W (best-effort; the browser may preempt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "w" || e.key === "W")) {
        if (activeIndex >= 0) {
          e.preventDefault();
          onClose(activeIndex);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, onClose]);

  return (
    <div role="tablist" aria-label={t("editor.openFiles", undefined, "Open files")} className="flex shrink-0 overflow-x-auto border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      {openFiles.map((file, i) => (
        <div
          key={file.path}
          ref={(el) => {
            tabRefs.current[i] = el;
          }}
          role="tab"
          aria-selected={i === activeIndex}
          tabIndex={i === activeIndex ? 0 : -1}
          onKeyDown={(e) => onTabKeyDown(e, i)}
          title={file.path}
          draggable
          onDragStart={() => {
            dragFrom.current = i;
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(i);
          }}
          onDrop={() => {
            if (dragFrom.current !== null && dragFrom.current !== i) onReorder(dragFrom.current, i);
            dragFrom.current = null;
            setDragOver(null);
          }}
          onDragEnd={() => {
            dragFrom.current = null;
            setDragOver(null);
          }}
          onClick={() => onActivate(i)}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(i);
            }
          }}
          className={[
            "group flex max-w-[16rem] cursor-pointer items-center gap-1.5 whitespace-nowrap border-r border-[var(--border-primary)] px-3 py-1.5 text-xs",
            i === activeIndex
              ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
            dragOver === i ? "border-l-2 border-l-[var(--accent-blue)]" : "",
          ].join(" ")}
        >
          {file.viewer === "terminal" ? (
            <Icon path={mdiConsoleLine} size={0.5} className="text-cyan-500" />
          ) : (
            <Icon path={fileIcon(file.path).iconPath} size={0.5} className={fileIcon(file.path).colorClass} />
          )}
          <span className="truncate">
            {file.viewer === "terminal"
              ? (terminalTitle?.(stripTermId(file.path) ?? "") ?? t("terminal.terminal", undefined, "terminal"))
              : basename(file.path)}
          </span>
          {file.unread && i !== activeIndex && <UnreadDot file={file} />}
          {file.viewer === "diff" && (
            <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">
              diff
            </span>
          )}
          <button
            type="button"
            aria-label={t("editor.closeFile", { name: basename(file.path) }, "Close {name}")}
            onClick={(e) => {
              e.stopPropagation();
              onClose(i);
            }}
            className="opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
          >
            <Icon path={mdiClose} size={0.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
