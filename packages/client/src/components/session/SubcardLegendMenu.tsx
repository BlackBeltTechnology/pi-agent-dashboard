/**
 * `⋯` options menu inside a session subcard's legend capsule: Hide in this
 * folder / Hide everywhere / Section settings…. Hide actions write through
 * `useCardSectionActions` (Undo toast); settings opens the folder's
 * Session cards page. Collapsed to zero width until the subcard is hovered
 * or focused, but always in the tab order. Clicks never select the card.
 *
 * Desktop-only (mobile cards render no subcards). The panel is portaled
 * (escapes the card's `isolate` stacking context) and positioned `fixed`
 * from the trigger rect, like `FolderActionsMenu`.
 * See change: configurable-session-card-sections (design D8).
 */
import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import { mdiDotsHorizontal } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { useLocation } from "wouter";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { buildFolderSettingsUrl } from "../../lib/nav/route-builders.js";
import { useCardSectionActions } from "../../lib/state/CardSectionsContext.js";

export interface SubcardMenuTarget {
  /** Card section id (`CARD_SECTION_IDS`). */
  sectionId: string;
  /** Folder the session card groups under (worktree → main path). */
  folderPath: string;
}

export function SubcardLegendMenu({ target, label }: { target: SubcardMenuTarget; label: string }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();
  const actions = useCardSectionActions();
  const { flipUp, maxHeight, anchorRight, triggerRect } = usePopoverFlip(triggerRef, {
    open,
    estimatedWidth: 220,
  });

  const close = React.useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const handler = (e: Event) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
    if (nodes.length === 0) return;
    e.preventDefault();
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? 0 : (at + (e.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length;
    nodes[next]?.focus();
  }

  const items: { id: string; text: string; run: () => void }[] = [
    {
      id: "hide-folder",
      text: i18nT("cardSections.hideInFolder", { section: label }, "Hide {section} in this folder"),
      run: () => actions.hideInFolder(target.folderPath, target.sectionId, label),
    },
    {
      id: "hide-everywhere",
      text: i18nT("cardSections.hideEverywhere", { section: label }, "Hide {section} everywhere"),
      run: () => actions.hideEverywhere(target.sectionId, label),
    },
    {
      id: "settings",
      text: i18nT("cardSections.sectionSettings", undefined, "Section settings…"),
      run: () => navigate(buildFolderSettingsUrl(target.folderPath, "cards")),
    },
  ];

  const GAP = 4;
  const style: React.CSSProperties = {
    maxHeight,
    visibility: triggerRect ? "visible" : "hidden",
    ...(triggerRect
      ? flipUp
        ? { bottom: Math.round(window.innerHeight - triggerRect.top + GAP) }
        : { top: Math.round(triggerRect.bottom + GAP) }
      : {}),
    ...(triggerRect
      ? anchorRight
        ? { right: Math.max(0, Math.round(window.innerWidth - triggerRect.right)) }
        : { left: Math.round(triggerRect.left) }
      : {}),
  };
  const menuLabel = i18nT("cardSections.sectionOptions", { section: label }, "{section} section options");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        title={menuLabel}
        data-testid={`subcard-menu-${target.sectionId}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`focus-ring overflow-hidden rounded leading-none text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-[max-width,opacity] ${
          open
            ? "max-w-4 opacity-100"
            : "max-w-0 opacity-0 group-hover/sub:max-w-4 group-hover/sub:opacity-100 group-focus-within/sub:max-w-4 group-focus-within/sub:opacity-100"
        }`}
      >
        {/* SVG, not a text glyph: the capsule's text content must stay exactly
            the title (E2E specs match `getByText(title, {exact:true})`). */}
        <Icon path={mdiDotsHorizontal} size={0.4} className="ml-0.5" aria-hidden="true" />
      </button>
      {open && (
        <LayerPortal>
          <div
            ref={panelRef}
            role="menu"
            aria-label={menuLabel}
            data-testid={`subcard-menu-panel-${target.sectionId}`}
            onKeyDown={onPanelKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={style}
            className="fixed z-popover min-w-[220px] overflow-y-auto rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] py-1 shadow-lg normal-case tracking-normal"
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-testid={`subcard-menu-item-${item.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  close(false);
                  item.run();
                }}
                className="flex w-full items-center px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-ring"
              >
                {item.text}
              </button>
            ))}
          </div>
        </LayerPortal>
      )}
    </>
  );
}
