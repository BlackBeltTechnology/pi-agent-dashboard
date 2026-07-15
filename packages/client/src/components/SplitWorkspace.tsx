/**
 * Content-area layout surface. Co-mounts the chat column and the editor pane and
 * arranges them per `mode`:
 *   - `closed` — chat fills the column; a right-edge "Editor" peek reopens `split`.
 *   - `split`  — chat | draggable `SplitDivider` (w/ collapse chevrons) | editor,
 *                horizontal on desktop / stacked on mobile.
 *   - `full`   — editor fills the column; the chat pane is **kept mounted but
 *                hidden** (so composer draft + scroll survive a `split→full→split`
 *                round-trip) and a leading-edge "Chat" peek restores `split`.
 *
 * The chat + editor wrappers carry stable `key`s so a mode change never remounts
 * `ChatView` (the `full` invariant) — only the divider/peeks mount and unmount.
 *
 * Pure layout primitive: split state (mode/ratio/orientation) and the file-open
 * plumbing live in the caller; this component only arranges the two slots.
 *
 * See change: editor-layout-modes (was split-editor-workspace).
 */

import { mdiChevronRight, mdiViewSplitVertical } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useRef } from "react";
import { t as i18nT } from "../lib/i18n";
import type { SplitMode, SplitOrientation } from "../lib/split-state.js";
import { useSplitRatio } from "../lib/useSplitRatio.js";
import { SplitDivider } from "./SplitDivider.js";

interface SplitWorkspaceProps {
  mode: SplitMode;
  /** Chat pane fraction of the split (0..1); editor gets the remainder. */
  ratio: number;
  orientation: SplitOrientation;
  onRatioChange: (ratio: number) => void;
  /** Set the layout mode (edge peeks + divider chevrons). */
  onModeChange: (mode: SplitMode) => void;
  chat: React.ReactNode;
  editor: React.ReactNode;
  /**
   * Tablet replace-chat mode (auto-canvas Decision 1): on the tablet tier the
   * editor takes the full width and the chat pane is NOT mounted (no
   * side-by-side, no divider). Desktop keeps side-by-side.
   */
  replaceChat?: boolean;
}

export function SplitWorkspace({
  mode,
  ratio,
  orientation,
  onRatioChange,
  onModeChange,
  chat,
  editor,
  replaceChat = false,
}: SplitWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const applyRatio = useSplitRatio(containerRef, orientation, onRatioChange);

  const isClosed = mode === "closed";
  const isSplit = mode === "split";
  const isFull = mode === "full";

  if (replaceChat && !isClosed) {
    // Tablet: the canvas replaces chat — full-width editor, chat pane omitted.
    return (
      <div
        data-testid="split-editor-pane"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {editor}
      </div>
    );
  }

  const dir = orientation === "h" ? "flex-row" : "flex-col";

  return (
    <div ref={containerRef} className={`relative flex min-h-0 min-w-0 flex-1 ${dir}`}>
      {/* Chat pane — always mounted; hidden (not unmounted) in `full` so the
          composer draft + scroll position survive a split→full→split trip. */}
      <div
        key="chat"
        data-testid="split-chat-pane"
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${isFull ? "hidden" : ""}`}
        style={isSplit ? { flexGrow: ratio, flexShrink: 1, flexBasis: 0 } : isClosed ? { flex: "1 1 0" } : undefined}
      >
        {chat}
      </div>

      {/* Draggable divider + collapse chevrons — `split` only. */}
      {isSplit && (
        <SplitDivider
          key="divider"
          orientation={orientation}
          onResize={applyRatio}
          data-testid="split-divider"
          title={i18nT("common.dragToResize", undefined, "Drag to resize")}
          onCollapseChat={() => onModeChange("full")}
          onCollapseEditor={() => onModeChange("closed")}
        />
      )}

      {/* Editor pane — mounted in `split` and `full`, unmounted in `closed`. */}
      {!isClosed && (
        <div
          key="editor"
          data-testid="split-editor-pane"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden"
          style={isSplit ? { flexGrow: 1 - ratio, flexShrink: 1, flexBasis: 0 } : { flex: "1 1 0" }}
        >
          {editor}
        </div>
      )}

      {/* Right-edge Editor peek — reopens `split` from `closed`. */}
      {isClosed && (
        <button
          key="editor-peek"
          type="button"
          onClick={() => onModeChange("split")}
          data-testid="editor-peek"
          title={i18nT("layout.openEditorPeek", undefined, "Open editor")}
          aria-label={i18nT("layout.openEditorPeek", undefined, "Open editor")}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex items-center rounded-l border border-r-0 border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-0.5 py-2 text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10"
        >
          <Icon path={mdiViewSplitVertical} size={0.55} />
        </button>
      )}

      {/* Leading-edge Chat peek — restores `split` from `full`. */}
      {isFull && (
        <button
          key="chat-peek"
          type="button"
          onClick={() => onModeChange("split")}
          data-testid="chat-peek"
          title={i18nT("layout.openChatPeek", undefined, "Show chat")}
          aria-label={i18nT("layout.openChatPeek", undefined, "Show chat")}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex items-center rounded-r border border-l-0 border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-0.5 py-2 text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10"
        >
          <Icon path={mdiChevronRight} size={0.7} />
        </button>
      )}
    </div>
  );
}
