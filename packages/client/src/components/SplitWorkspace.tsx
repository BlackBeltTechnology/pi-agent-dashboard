/**
 * Content-area split wrapper. Co-mounts the chat column and the editor pane so
 * the conversation stays visible while reading code. When closed it renders the
 * chat slot alone (today's behaviour). When open it renders chat + a draggable
 * `SplitDivider` + editor, laid out horizontally on desktop and stacked
 * vertically below the mobile breakpoint. The divider stores a fraction so the
 * split survives window resizes.
 *
 * Pure layout primitive: split state (open/ratio/orientation) and the file-open
 * plumbing live in the caller; this component only arranges the two slots.
 *
 * See change: split-editor-workspace.
 */

import { useRef } from "react";
import { t as i18nT } from "../lib/i18n";
import type { SplitOrientation } from "../lib/split-state.js";
import { useSplitRatio } from "../lib/useSplitRatio.js";
import { SplitDivider } from "./SplitDivider.js";

interface SplitWorkspaceProps {
  open: boolean;
  /** Chat pane fraction of the split (0..1); editor gets the remainder. */
  ratio: number;
  orientation: SplitOrientation;
  onRatioChange: (ratio: number) => void;
  chat: React.ReactNode;
  editor: React.ReactNode;
  /**
   * Tablet replace-chat mode (auto-canvas Decision 1): when the split is open
   * on the tablet tier, the editor takes the full width and the chat pane is
   * NOT mounted (no side-by-side, no divider). Desktop keeps side-by-side.
   */
  replaceChat?: boolean;
}

export function SplitWorkspace({ open, ratio, orientation, onRatioChange, chat, editor, replaceChat = false }: SplitWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const applyRatio = useSplitRatio(containerRef, orientation, onRatioChange);

  if (!open) {
    // Closed: chat occupies the whole content column (pre-split behaviour).
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{chat}</div>;
  }

  if (replaceChat) {
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
    <div ref={containerRef} className={`flex min-h-0 min-w-0 flex-1 ${dir}`}>
      <div
        data-testid="split-chat-pane"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ flexGrow: ratio, flexShrink: 1, flexBasis: 0 }}
      >
        {chat}
      </div>
      <SplitDivider
        orientation={orientation}
        onResize={applyRatio}
        data-testid="split-divider"
        title={i18nT("common.dragToResize", undefined, "Drag to resize")}
      />
      <div
        data-testid="split-editor-pane"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ flexGrow: 1 - ratio, flexShrink: 1, flexBasis: 0 }}
      >
        {editor}
      </div>
    </div>
  );
}
