/**
 * Horizontal tab strip for the editor pane. Click to activate, "×" / middle-
 * click / Ctrl+Cmd-W to close, drag to reorder. Labels show the basename;
 * the tooltip shows the rel path.
 *
 * See change: add-internal-monaco-editor-pane.
 * See change: improve-content-editor (per-kind tab icon #2).
 * The strip is the flexible item of the pane bar (`min-w-0`, scrolls on
 * overflow); its × is a 24 px target visible on keyboard focus; a secondary
 * click, ContextMenu key or Shift+F10 opens the tab context menu.
 * See change: scope-anchor-editor-pane-controls (D1, D9).
 */

import { mdiClose, mdiConsoleLine, mdiPuzzleOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import type { OpenFile } from "../../lib/layout/editor-pane-state.js";
import { stripTermId } from "../../lib/layout/use-terminal-pane-tabs.js";
import { fileIcon } from "../../lib/preview/file-icon.js";
import { basename, prefixOf } from "./tab-labels.js";

interface EditorTabsProps {
  openFiles: OpenFile[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  /** Resolve a terminal id to its display title (for `term:<id>` tabs). */
  terminalTitle?: (id: string) => string | undefined;
  /**
   * Render the label of a plugin (`viewer: "plugin"`) tab — the claim's label
   * component, mounted for every such tab (active or not) so a background
   * tab's label stays live. Defaults to the path prefix.
   * See change: add-browser-editor-pane-tab (D1).
   */
  pluginLabel?: (path: string) => ReactNode;
  /** Open the tab context menu for tab `index`, anchored at `anchorEl`. */
  onContextMenuTab?: (index: number, anchorEl: HTMLElement) => void;
  /** A pane overlay (confirmation, popover, menu) is open: Cmd/Ctrl-W is inert. */
  closeShortcutSuspended?: boolean;
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

/** Tab index a navigation key moves to; `null` for any other key. */
function tabNavTarget(key: string, i: number, last: number): number | null {
  switch (key) {
    case "ArrowRight":
      return Math.min(i + 1, last);
    case "ArrowLeft":
      return Math.max(i - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    case "Enter":
    case " ":
      return i;
    default:
      return null;
  }
}

export function EditorTabs({
  openFiles,
  activeIndex,
  onActivate,
  onClose,
  onReorder,
  terminalTitle,
  pluginLabel,
  onContextMenuTab,
  closeShortcutSuspended = false,
}: EditorTabsProps) {
  const { t } = useI18n();
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Roving-tabindex keyboard navigation across the tab strip.
  const onTabKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      onContextMenuTab?.(i, e.currentTarget as HTMLElement);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onClose(i);
      return;
    }
    const next = tabNavTarget(e.key, i, openFiles.length - 1);
    if (next === null) return;
    e.preventDefault();
    onActivate(next);
    tabRefs.current[next]?.focus();
  };

  // Close the active tab on Ctrl/Cmd-W (best-effort; the browser may preempt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "w" || e.key === "W")) {
        if (closeShortcutSuspended) return;
        if (activeIndex >= 0) {
          e.preventDefault();
          onClose(activeIndex);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, onClose, closeShortcutSuspended]);

  return (
    <div role="tablist" aria-label={t("editor.openFiles", undefined, "Open files")} className="flex min-w-0 overflow-x-auto">
      {openFiles.map((file, i) => (
        <div
          key={file.path}
          ref={(el) => {
            tabRefs.current[i] = el;
          }}
          role="tab"
          aria-selected={i === activeIndex}
          data-testid="editor-tab"
          data-tab-path={file.path}
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
          onContextMenu={(e) => {
            if (!onContextMenuTab) return;
            e.preventDefault();
            onContextMenuTab(i, e.currentTarget as HTMLElement);
          }}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(i);
            }
          }}
          className={[
            "group flex min-h-7 max-w-[16rem] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-r border-[var(--border-primary)] py-0.5 pl-3 pr-1 text-xs",
            i === activeIndex
              ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
            dragOver === i ? "border-l-2 border-l-[var(--accent-blue)]" : "",
          ].join(" ")}
        >
          {file.viewer === "terminal" ? (
            <Icon path={mdiConsoleLine} size={0.5} className="text-cyan-500" />
          ) : file.viewer === "plugin" ? (
            <Icon path={mdiPuzzleOutline} size={0.5} className="text-[var(--text-tertiary)]" />
          ) : (
            <Icon path={fileIcon(file.path).iconPath} size={0.5} className={fileIcon(file.path).colorClass} />
          )}
          <span className="truncate">
            {file.viewer === "terminal"
              ? (terminalTitle?.(stripTermId(file.path) ?? "") ?? t("terminal.terminal", undefined, "terminal"))
              : file.viewer === "plugin"
                ? (pluginLabel?.(file.path) ?? prefixOf(file.path))
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
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <Icon path={mdiClose} size={0.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
