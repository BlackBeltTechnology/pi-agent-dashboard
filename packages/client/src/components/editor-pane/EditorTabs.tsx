/**
 * Horizontal tab strip for the editor pane. Click to activate, "×" / middle-
 * click / Ctrl+Cmd-W to close, drag to reorder. Labels show the basename;
 * the tooltip shows the rel path.
 *
 * See change: add-internal-monaco-editor-pane.
 */

import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import type { OpenFile } from "../../lib/editor-pane-state.js";

interface EditorTabsProps {
  openFiles: OpenFile[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function EditorTabs({ openFiles, activeIndex, onActivate, onClose, onReorder }: EditorTabsProps) {
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
    <div role="tablist" aria-label="Open files" className="flex shrink-0 overflow-x-auto border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
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
          <span className="truncate">{basename(file.path)}</span>
          <button
            type="button"
            aria-label={`Close ${basename(file.path)}`}
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
