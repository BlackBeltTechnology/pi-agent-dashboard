/**
 * Content-area layout surface. Co-mounts the chat column and the editor pane and
 * arranges them per `mode`:
 *   - `closed` — chat fills the column; a right-edge EDITOR restore tab reopens `split`.
 *   - `split`  — chat | draggable resize-only `SplitDivider` | editor,
 *                horizontal on desktop / stacked on mobile.
 *   - `full`   — editor fills the column; the chat pane is **kept mounted but
 *                hidden** (so composer draft + scroll survive a `split→full→split`
 *                round-trip) and a leading-edge CHAT restore tab restores `split`.
 *
 * Collapse is driven solely by the header `Chat│Split│Editor` switch; the
 * divider only resizes. On desktop (`orientation "h"`) the chat pane wears an
 * always-visible CHAT caption and the collapsed panes restore via in-flow
 * rotated tabs (push, never overlay — kills the narrow-pane overlap bug). The
 * stacked mobile split (`orientation "v"`) keeps its existing edge-grabber peek.
 *
 * The chat + editor wrappers carry stable `key`s so a mode change never remounts
 * `ChatView` (the `full` invariant) — only the divider/tabs mount and unmount.
 *
 * See change: redesign-split-layout-controls (was: editor-layout-modes).
 */

import { mdiChevronRight, mdiViewSplitVertical } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useRef } from "react";
import { t as i18nT } from "../lib/i18n";
import type { SplitMode, SplitOrientation } from "../lib/split-state.js";
import { useSplitRatio } from "../lib/useSplitRatio.js";
import { SplitDivider } from "./SplitDivider.js";
import { RestoreTab } from "./split/RestoreTab.js";

interface SplitWorkspaceProps {
  mode: SplitMode;
  /** Chat pane fraction of the split (0..1); editor gets the remainder. */
  ratio: number;
  orientation: SplitOrientation;
  onRatioChange: (ratio: number) => void;
  /** Set the layout mode (restore tabs only re-open; collapse is header-driven). */
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
  const isDesktop = orientation === "h";

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

  const dir = isDesktop ? "flex-row" : "flex-col";

  return (
    <div ref={containerRef} className={`relative flex min-h-0 min-w-0 flex-1 ${dir}`}>
      {/* Desktop: leading-edge CHAT restore tab (in-flow, pushes content). */}
      {isDesktop && isFull && (
        <RestoreTab
          key="chat-peek"
          side="left"
          label={i18nT("layout.chat", undefined, "Chat")}
          chevron="›"
          onClick={() => onModeChange("split")}
          title={i18nT("layout.openChatPeek", undefined, "Show chat")}
          data-testid="chat-peek"
        />
      )}

      {/* Chat pane — always mounted; hidden (not unmounted) in `full` so the
          composer draft + scroll position survive a split→full→split trip. */}
      <div
        key="chat"
        data-testid="split-chat-pane"
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${isFull ? "hidden" : ""}`}
        style={isSplit ? { flexGrow: ratio, flexShrink: 1, flexBasis: 0 } : isClosed ? { flex: "1 1 0" } : undefined}
      >
        {/* Always-visible pane caption (desktop). Folded as the chat pane's
            header row — chat has no chrome of its own, so this is its single
            header, not a second bar. */}
        {isDesktop && (
          <div
            data-testid="pane-caption-chat"
            className="flex h-8 shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]"
          >
            <span className="h-1.5 w-1.5 rounded-sm bg-[var(--accent-primary)] opacity-70" />
            {i18nT("layout.chat", undefined, "Chat")}
          </div>
        )}
        {chat}
      </div>

      {/* Resize-only divider — `split` only, no collapse control. */}
      {isSplit && (
        <SplitDivider
          key="divider"
          orientation={orientation}
          onResize={applyRatio}
          data-testid="split-divider"
          title={i18nT("common.dragToResize", undefined, "Drag to resize")}
        />
      )}

      {/* Editor pane — mounted in `split` and `full`, unmounted in `closed`.
          Its EDITOR caption lives inside EditorPane's own header row. */}
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

      {/* Desktop: trailing-edge EDITOR restore tab (in-flow, pushes content). */}
      {isDesktop && isClosed && (
        <RestoreTab
          key="editor-peek"
          side="right"
          label={i18nT("layout.editor", undefined, "Editor")}
          chevron="‹"
          onClick={() => onModeChange("split")}
          title={i18nT("layout.openEditorPeek", undefined, "Open editor")}
          data-testid="editor-peek"
        />
      )}

      {/* Mobile (stacked `v`): keep the existing absolute edge-grabber peeks. */}
      {!isDesktop && isClosed && (
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
      {!isDesktop && isFull && (
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
