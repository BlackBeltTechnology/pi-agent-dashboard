/**
 * The session actions flyout's always-mounted half: the header trigger
 * (`mdiDotsVertical`, `session-actions-trigger-<id>`) plus the open state wiring.
 * The `role="menu"` PANEL — groups, `More…`, roving focus, plugin hosting, and the
 * `deriveSessionMenu` call itself — lives in `SessionActionsPanel` and is
 * code-split (`lazy-session-menu.ts`), so none of it loads on the cold landing; the
 * trigger prefetches the chunk on pointer-enter / focus.
 *
 * Four entry points open the same menu: the trigger, the right-edge hover strip,
 * right-click on the card, and Shift+F10 / the ContextMenu key (the last three are
 * wired by `SessionCard` / `SessionList` through `onOpenChange`). Placement is
 * `fixed` beside the card (`useSideFlyoutPosition`), portaled with `LayerPortal`
 * at the `z-popover` layer. See `docs/session-actions-menu.md`.
 *
 * See change: add-session-actions-flyout.
 */
import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiDotsVertical } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { Suspense } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { SessionMenuCtx, SessionMenuGroup } from "../../lib/session/session-menu-items.js";
import type { SessionMenuSource } from "../../lib/state/SessionMenuScopeContext.js";
import { LazySessionActionsPanel, prefetchSessionActionsPanel } from "./lazy-session-menu.js";

export interface SessionMenuOpenRequest {
  source: SessionMenuSource;
  point?: { x: number; y: number };
  opener?: HTMLElement | null;
}

interface Props {
  session: DashboardSession;
  /** Pre-derived groups (tests). The card passes `ctx` instead. */
  groups?: SessionMenuGroup[];
  /** The card's menu context; the lazily loaded panel derives the groups from it while open. */
  ctx?: SessionMenuCtx;
  open: boolean;
  /** How the open menu was opened (`hover` never moves focus). */
  source?: SessionMenuSource;
  /** Pointer position for a right-click open. */
  point?: { x: number; y: number };
  /** Element that had focus when the menu opened; Escape returns to it. */
  opener?: HTMLElement | null;
  /** The card element the flyout is anchored to. */
  cardRef: React.RefObject<HTMLElement | null>;
  /** Open (with how) or close. */
  onOpenChange: (open: boolean, request?: SessionMenuOpenRequest) => void;
  /** Detached per-card container holding the action-bar slot output (D7). */
  pluginContainer?: HTMLElement | null;
}

function focusRegion(): void {
  const region = document.querySelector<HTMLElement>("[data-session-list-region]");
  region?.focus({ preventScroll: true });
}

export function SessionActionsMenu({ session, groups, ctx, open, source, point, opener, cardRef, onOpenChange, pluginContainer }: Props) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const label = i18nT("sessionMenu.sessionActions", undefined, "Session actions");

  /** Return focus to the opener, falling back to the trigger. */
  const restoreFocus = React.useCallback(() => {
    const target = opener && document.contains(opener) ? opener : triggerRef.current;
    target?.focus();
  }, [opener]);

  const close = React.useCallback(
    (restore: boolean) => {
      onOpenChange(false);
      if (restore) restoreFocus();
    },
    [onOpenChange, restoreFocus],
  );

  // The card unmounting under an open menu (archived elsewhere, filtered out,
  // folder collapsed) must not strand focus on <body>. Layout-effect cleanup runs
  // BEFORE React removes the host nodes, so `activeElement` is still readable.
  React.useLayoutEffect(
    () => () => {
      const a = document.activeElement;
      const inside = a != null && (panelRef.current?.contains(a) || cardRef.current?.contains(a));
      if (inside) focusRegion();
    },
    [cardRef],
  );

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid={`session-actions-trigger-${session.id}`}
        onPointerEnter={prefetchSessionActionsPanel}
        onFocus={prefetchSessionActionsPanel}
        onClick={(e) => {
          e.stopPropagation();
          if (open) onOpenChange(false);
          else onOpenChange(true, { source: "trigger", opener: triggerRef.current });
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            close(true);
          }
        }}
        className="focus-ring inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] rounded flex-shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        <Icon path={mdiDotsVertical} size={0.5} />
      </button>
      {open && (
        <LayerPortal>
          <Suspense fallback={null}>
            <LazySessionActionsPanel
              session={session}
              panelRef={panelRef}
              triggerRef={triggerRef}
              cardRef={cardRef}
              groups={groups}
              ctx={ctx}
              source={source}
              point={point}
              close={close}
              pluginContainer={pluginContainer}
              label={label}
            />
          </Suspense>
        </LayerPortal>
      )}
    </span>
  );
}
