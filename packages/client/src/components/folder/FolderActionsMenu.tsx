/**
 * The single trailing control on a sidebar folder header.
 *
 * Every directory mutation that used to render as its own button in the header
 * cluster (urgency sort, pin/unpin, add-to-workspace, remove-from-workspace,
 * Directory Settings) is now an item in this grouped popover. The cluster is
 * exactly one control.
 *
 * Groups are a FIXED host-owned verb taxonomy rendered in a stable order
 * (`workspace · directory · create · open · maintenance`); a group renders only
 * when it holds at least one item. Callers never choose the order — that is
 * what keeps the menu learnable as later changes contribute more items.
 * Grouping is by VERB, never one group per plugin: per-plugin groups would be
 * mostly single-item and would leak the extension architecture into the user's
 * mental model.
 *
 * The menu merges two sources: the HOST items its caller passes (which keep the
 * `node` / `pressed` escape hatches) and the declarative items plugin slot
 * sections registered for this folder. Reading the registry HERE — rather than
 * having the caller pass a merged list — is what makes an ALREADY-OPEN menu
 * converge when a late-mounting section registers.
 * See change: move-slot-actions-to-menu.
 *
 * Trigger glyph is `mdiFolderCogOutline`. `mdiDotsHorizontal` is REJECTED:
 * `WorktreeActionsMenu` already renders it on worktree session cards *inside
 * the folder body*, so the two triggers would be identical with different
 * scopes.
 *
 * Open state is owned by the caller and keyed per folder SCOPE (not per cwd),
 * mirroring `addToWsMenuFor`, so a folder row and a same-cwd session card can
 * never co-open.
 *
 * See change: add-folder-actions-menu.
 */

import {
  FOLDER_MENU_GROUPS,
  type FolderMenuGroup,
  useFolderMenuItems,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiFolderCogOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { useMobile } from "../../hooks/useMobile.js";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { DialogPortal } from "../primitives/DialogPortal.js";

// The taxonomy lives in the plugin runtime so the plugin-facing contribution
// type and the host renderer cannot drift apart; re-exported here because every
// existing host call site imports it from this module.
export { FOLDER_MENU_GROUPS, type FolderMenuGroup };

const GROUP_LABELS: Record<FolderMenuGroup, string> = {
  workspace: i18nT("folders.menuGroupWorkspace", undefined, "Workspace"),
  directory: i18nT("folders.menuGroupDirectory", undefined, "Directory"),
  create: i18nT("folders.menuGroupCreate", undefined, "Create"),
  open: i18nT("folders.menuGroupOpen", undefined, "Open"),
  maintenance: i18nT("folders.menuGroupMaintenance", undefined, "Maintenance"),
};

export interface FolderMenuItem {
  /** Stable id — drives the item's test id (`folder-menu-item-<id>`). */
  id: string;
  group: FolderMenuGroup;
  label: string;
  icon: string;
  onSelect: () => void;
  /** Short state marker, rendered on the item and part of its accessible name. */
  badge?: string;
  /** Renders as a disabled control; its callback is never invoked. */
  disabled?: boolean;
  /** Toggle state, surfaced as `aria-pressed` (urgency sort). */
  pressed?: boolean;
  /**
   * Escape hatch for an item that carries its own popover and test id — today
   * only add-to-workspace, whose `add-to-workspace-btn-<cwd>` contract and
   * `AddToWorkspaceMenu` behaviour must survive the relocation verbatim. The
   * node is responsible for its own `role="menuitem"`.
   */
  node?: React.ReactNode;
}

interface Props {
  cwd: string;
  items: FolderMenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FolderActionsMenu({ cwd, items, open, onOpenChange }: Props) {
  // Plugin contributions for THIS folder, already ordered by (pluginId, id) and
  // collision-resolved by the registry. Host items keep their declared order
  // and lead within each group.
  const contributed = useFolderMenuItems(cwd);
  const allItems = React.useMemo<FolderMenuItem[]>(
    () => [...items, ...contributed],
    [items, contributed],
  );
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const isMobile = useMobile();
  const { flipUp, maxHeight, minHeight, anchorRight, maxWidth, triggerRect } = usePopoverFlip(
    triggerRef,
    {
      open: open && !isMobile,
      estimatedWidth: 240,
    },
  );

  // Desktop panel is PORTALED to the layer root (escapes the `isolate` stacking
  // context every SessionCard creates, which used to trap this inline-absolute
  // panel and make it UNDERLAP the cards). Being portaled, it is no longer
  // anchored by a `relative` wrapper, so it positions itself `fixed` from the
  // trigger's viewport rect + the flip/anchor decision. See change:
  // add-overlay-layering-system.
  const GAP = 4; // matches the previous mt-1 / mb-1
  const desktopStyle: React.CSSProperties = {
    maxHeight,
    minHeight,
    maxWidth,
    // Hidden until the first measure lands, so we never flash at (0,0).
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

  const close = React.useCallback(
    (restoreFocus: boolean) => {
      onOpenChange(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [onOpenChange],
  );

  // Outside click / touch dismissal. The sheet form is portalled, so the
  // trigger's wrapper does not contain it — both nodes are checked.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open, onOpenChange]);

  /** Roving focus across the rendered `role="menuitem"` nodes. */
  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const nodes = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
    );
    if (nodes.length === 0) return;
    e.preventDefault();
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    const delta = e.key === "ArrowDown" ? 1 : -1;
    const next = at < 0 ? 0 : (at + delta + nodes.length) % nodes.length;
    nodes[next]?.focus();
  }

  const label = i18nT("folders.folderActions", undefined, "Folder actions");

  const panel = (
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      data-testid={`folder-actions-menu-panel-${cwd}`}
      data-menu-form={isMobile ? "sheet" : "popover"}
      onKeyDown={onPanelKeyDown}
      style={isMobile ? undefined : desktopStyle}
      className={
        isMobile
          ? "fixed inset-x-0 bottom-0 z-popover max-h-[70vh] w-full overflow-y-auto overflow-x-hidden rounded-t-xl border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)] py-1 shadow-lg"
          : "fixed z-popover min-w-[220px] overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] py-1 shadow-lg"
      }
    >
      {FOLDER_MENU_GROUPS.map((group) => {
        const groupItems = allItems.filter((i) => i.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group} data-testid={`folder-menu-group-${group}`}>
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {GROUP_LABELS[group]}
            </div>
            {groupItems.map((item) =>
              item.node !== undefined ? (
                <div key={item.id} className="px-2 py-1">
                  {item.node}
                </div>
              ) : (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  data-testid={`folder-menu-item-${item.id}`}
                  aria-pressed={item.pressed}
                  // `aria-disabled`, not the `disabled` attribute: a disabled
                  // menuitem stays focusable so roving focus does not skip it
                  // (ARIA APG), while still being exposed as a disabled control.
                  aria-disabled={item.disabled || undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.disabled) return;
                    onOpenChange(false);
                    // A plugin's callback runs inside the host's menu; letting it
                    // throw here would take the whole sidebar down with it.
                    try {
                      item.onSelect();
                    } catch (err) {
                      console.error(`[folder-menu] item "${item.id}" onSelect threw:`, err);
                    }
                  }}
                  className={`flex w-full min-h-[44px] items-center gap-3 px-3 py-2 text-left text-sm ${
                    item.disabled
                      ? "text-[var(--text-muted)] cursor-not-allowed"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon path={item.icon} size={0.6} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      data-testid={`folder-menu-badge-${item.id}`}
                      className="ml-auto shrink-0 text-[10px] font-extrabold text-amber-400"
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              ),
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        // stopPropagation: the trigger sits inside the header row, which
        // navigates to the directory home page on click.
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            close(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid={`folder-actions-menu-${cwd}`}
        className="focus-ring rounded px-1 py-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      >
        <Icon path={mdiFolderCogOutline} size={0.6} />
      </button>
      {open && (isMobile ? <DialogPortal>{panel}</DialogPortal> : <LayerPortal>{panel}</LayerPortal>)}
    </span>
  );
}
