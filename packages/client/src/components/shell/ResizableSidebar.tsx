/**
 * Resizable session-list rail. The resize handle is an always-visible
 * dotted-grip seam matching the split divider (one shared seam language), with
 * a vertically-centered collapse knob floating on it. When collapsed the rail
 * restores via a vertical `SESSIONS` tab using the same rotated-tab idiom as the
 * chat/editor pane peeks. Desktop-only surface: the caller mounts it under
 * `hidden md:flex`, so below the mobile breakpoint the hamburger overlay governs
 * and neither the seam nor the tab renders.
 *
 * See change: redesign-split-layout-controls.
 */

import { mdiChevronLeft } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useRef } from "react";
import { useResizeDrag } from "../../hooks/useResizeDrag.js";
import type { SidebarState } from "../../hooks/useSidebarState.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { RestoreTab } from "../split/RestoreTab.js";
import { SeamGrip } from "../split/SeamGrip.js";

interface Props {
  sidebar: SidebarState;
  children: ReactNode;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;
const clampWidth = (px: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, px));

export function ResizableSidebar({ sidebar, children }: Props) {
  const { width, collapsed, setWidth, toggleCollapse } = sidebar;
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Drag-to-resize: direct `style.width` preview per frame, `setWidth` once on
  // release (collapse knob stops propagation so a knob press never starts a
  // drag). See change: fix-split-divider-drag (D6).
  const drag = useResizeDrag({
    axis: "x",
    cursor: "col-resize",
    onPreview: (clientX) => {
      if (sidebarRef.current) sidebarRef.current.style.width = `${clampWidth(clientX)}px`;
    },
    onEnd: (clientX) => {
      if (clientX !== null) setWidth(clampWidth(clientX));
    },
  });

  // Collapsed → vertical SESSIONS restore tab (same idiom as the pane peeks).
  if (collapsed) {
    return (
      <RestoreTab
        side="left"
        label={i18nT("common.sessions", undefined, "Sessions")}
        chevron="›"
        onClick={toggleCollapse}
        title={i18nT("common.expandSidebar", undefined, "Expand sidebar")}
        data-testid="sidebar-expand"
      />
    );
  }

  // Expanded sidebar with an always-visible dotted-grip resize seam.
  return (
    <div ref={sidebarRef} className="flex flex-shrink-0 relative" style={{ width }}>
      <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
      {/* Resize seam — visible dotted grip + centered collapse knob. */}
      <div
        onPointerDown={drag.onPointerDown}
        onMouseDown={drag.onMouseDown}
        style={{ touchAction: "none" }}
        data-testid="drag-handle"
        className="relative flex w-2.5 shrink-0 cursor-col-resize items-center justify-center bg-[var(--border-primary)] transition-colors hover:bg-blue-500/30 active:bg-blue-500/50"
      >
        <SeamGrip dots={3} data-testid="rail-seam-grip" />
        <button
          onClick={toggleCollapse}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute left-1/2 top-1/2 z-30 flex h-[22px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] shadow-md transition-colors cursor-pointer hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
          title={i18nT("common.collapseSidebar", undefined, "Collapse sidebar")}
          data-testid="sidebar-collapse"
        >
          <Icon path={mdiChevronLeft} size={0.55} />
        </button>
      </div>
    </div>
  );
}
