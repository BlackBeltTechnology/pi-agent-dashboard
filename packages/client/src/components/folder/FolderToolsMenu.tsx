import { SidebarFolderSectionSlot, useSlotHasClaimsForFolder } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiCog, mdiDotsHorizontal, mdiSourceCommit } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useInitStatus } from "../../hooks/useInitStatus.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { ProjectInitButton } from "../packages/ProjectInitButton.js";

interface Props {
  cwd: string;
  /** True when the caller supplies the existing OpenSpec section as children. */
  hasOpenSpec: boolean;
  children?: ReactNode;
  /** Renders the Pencil-reference square overflow trigger beside primary actions. */
  compact?: boolean;
  onInitializeProject?: (cwd: string) => void;
  onOpenDirectorySettings?: () => void;
  onCommit?: () => void;
}

/** Secondary folder integrations and project-scoped actions. */
export function FolderToolsMenu({ cwd, hasOpenSpec, children, compact = false, onInitializeProject, onOpenDirectorySettings, onCommit }: Props) {
  const hasPluginSection = useSlotHasClaimsForFolder("sidebar-folder-section", { cwd });
  const hasTools = hasPluginSection || hasOpenSpec || !!onInitializeProject || !!onOpenDirectorySettings || !!onCommit;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState({ top: 8, left: 8, maxHeight: 0 });

  const placePopup = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const gap = 8;
    const width = Math.min(240, window.innerWidth - margin * 2);
    const maxHeight = Math.max(120, window.innerHeight - margin * 2);
    const popupHeight = Math.min(popupRef.current?.offsetHeight ?? maxHeight, maxHeight);
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const openAbove = popupHeight > spaceBelow && rect.top - margin > spaceBelow;
    const desiredTop = openAbove ? rect.top - gap - popupHeight : rect.bottom + gap;
    setPopupPosition({
      top: Math.max(margin, Math.min(desiredTop, window.innerHeight - margin - popupHeight)),
      left: Math.max(margin, Math.min(rect.right - width, window.innerWidth - margin - width)),
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    placePopup();
    if (typeof ResizeObserver === "undefined" || !popupRef.current) return;
    const observer = new ResizeObserver(placePopup);
    observer.observe(popupRef.current);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const onViewportChange = () => placePopup();
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  if (!hasTools) return null;

  return (
    <div ref={menuRef} className={`${compact ? "relative" : "relative mt-2"} ${open ? "z-[80]" : "z-0"}`} data-testid={`folder-tools-${cwd}`}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="folder-tools-trigger"
        aria-expanded={open}
        aria-controls={`folder-tools-menu-${cwd}`}
        onClick={(event) => {
          event.stopPropagation();
          if (!open) placePopup();
          setOpen((value) => !value);
        }}
        aria-label={i18nT("sessionList.folderTools", undefined, "Folder tools")}
        title={i18nT("sessionList.folderTools", undefined, "Folder tools")}
        className={compact
          ? "focus-ring inline-flex h-11 w-11 items-center justify-center rounded-[6px] border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors sm:h-[34px] sm:w-9"
          : "focus-ring w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"}
      >
        <Icon path={mdiDotsHorizontal} size={0.55} />
        {!compact && i18nT("sessionList.folderTools", undefined, "Folder tools")}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popupRef}
          id={`folder-tools-menu-${cwd}`}
          role="menu"
          data-testid="folder-tools-menu"
          style={{ top: popupPosition.top, left: popupPosition.left, maxHeight: popupPosition.maxHeight || undefined }}
          className="fixed z-[100] flex w-[calc(100vw-16px)] max-w-[240px] flex-col gap-[2px] overflow-y-auto rounded-[10px] border border-[var(--border-secondary)] bg-[var(--bg-primary)] p-[6px] shadow-[0_4px_8px_rgba(14,20,32,0.08),0_12px_24px_rgba(14,20,32,0.06)]"
          onClick={(event) => event.stopPropagation()}
        >
          <FolderToolsContents
            cwd={cwd}
            hasPluginSection={hasPluginSection}
            onInitializeProject={onInitializeProject}
            onOpenDirectorySettings={onOpenDirectorySettings}
            onCommit={onCommit}
          >
            {children}
          </FolderToolsContents>
        </div>,
        document.body,
      )}
    </div>
  );
}

function FolderToolsContents({ cwd, hasPluginSection, onInitializeProject, onOpenDirectorySettings, onCommit, children }: {
  cwd: string;
  hasPluginSection: boolean;
  onInitializeProject?: (cwd: string) => void;
  onOpenDirectorySettings?: () => void;
  onCommit?: () => void;
  children?: ReactNode;
}) {
  const { status } = useInitStatus(cwd);
  return (
    <div className="flex flex-col gap-[2px]">
      <div className="px-2 py-[6px] font-mono text-[8px] font-normal uppercase tracking-[0.5px] text-[var(--text-muted)]">
        {i18nT("sessionList.projectTools", undefined, "Project tools")}
      </div>
      {hasPluginSection && <div className="flex w-full flex-col gap-[2px]"><SidebarFolderSectionSlot folder={{ cwd }} placement="menu" /></div>}
      {children && <div className="flex w-full flex-col gap-[2px]">{children}</div>}
      {onCommit && (
        <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); onCommit(); }} className="focus-ring flex w-full items-center gap-[10px] rounded-[6px] p-2 text-left hover:bg-[var(--bg-hover)]">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-amber-500"><Icon path={mdiSourceCommit} size={0.52} /></span>
          <span className="flex min-w-0 flex-1 flex-col gap-px"><span className="text-[12px] font-medium text-[var(--text-primary)]">{i18nT("git.commit", undefined, "Commit / Git")}</span><span className="font-mono text-[9px] font-normal text-[var(--text-muted)]">Review and commit changes</span></span>
        </button>
      )}
      {onOpenDirectorySettings && (
        <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); onOpenDirectorySettings(); }} className="focus-ring flex w-full items-center gap-[10px] rounded-[6px] p-2 text-left hover:bg-[var(--bg-hover)]">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-violet-500"><Icon path={mdiCog} size={0.52} /></span>
          <span className="flex min-w-0 flex-1 flex-col gap-px"><span className="text-[12px] font-medium text-[var(--text-primary)]">{i18nT("folders.directorySettings", undefined, "Directory Settings")}</span><span className="font-mono text-[9px] font-normal text-[var(--text-muted)]">Instructions, resources, and setup</span></span>
        </button>
      )}
      <ProjectInitButton cwd={cwd} status={status} onInitializeProject={onInitializeProject} variant="menu" />
    </div>
  );
}
