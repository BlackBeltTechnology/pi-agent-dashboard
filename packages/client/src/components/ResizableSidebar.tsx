import { mdiChevronLeft, mdiChevronRight } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode, useCallback, useEffect, useRef } from "react";
import type { SidebarState } from "../hooks/useSidebarState.js";
import { t as i18nT } from "../lib/i18n";

interface Props {
  sidebar: SidebarState;
  children: ReactNode;
}

const COLLAPSED_WIDTH = 28;

export function ResizableSidebar({ sidebar, children }: Props) {
  const { width, collapsed, setWidth, toggleCollapse } = sidebar;
  const dragging = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Drag-to-resize handler (collapse button handles toggle separately)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) return;
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [collapsed],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = e.clientX;
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${Math.max(180, Math.min(500, newWidth))}px`;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth(e.clientX);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [setWidth]);

  // Collapsed strip
  if (collapsed) {
    return (
      <div
        className="relative border-r border-[var(--border-primary)] bg-[var(--bg-primary)] flex-shrink-0"
        style={{ width: COLLAPSED_WIDTH }}
      >
        <button
          onClick={toggleCollapse}
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-30 w-5 h-8 flex items-center justify-center rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] shadow-md transition-colors cursor-pointer"
          title={i18nT("common.expandSidebar", undefined, "Expand sidebar")}
          data-testid="sidebar-expand"
        >
          <Icon path={mdiChevronRight} size={0.55} />
        </button>
      </div>
    );
  }

  // Expanded sidebar with drag handle
  return (
    <div
      ref={sidebarRef}
      className="flex flex-shrink-0 relative"
      style={{ width }}
    >
      <div className="flex-1 overflow-hidden flex flex-col border-r border-[var(--border-primary)]">
        {children}
      </div>
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 flex-shrink-0"
        data-testid="drag-handle"
      />
      {/* Collapse button — floats on the sidebar edge */}
      <button
        onClick={toggleCollapse}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-30 w-5 h-8 flex items-center justify-center rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] shadow-md transition-colors cursor-pointer"
        title={i18nT("common.collapseSidebar", undefined, "Collapse sidebar")}
        data-testid="sidebar-collapse"
      >
        <Icon path={mdiChevronLeft} size={0.55} />
      </button>
    </div>
  );
}
