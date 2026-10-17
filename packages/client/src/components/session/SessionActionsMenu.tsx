/**
 * The session actions flyout: ONE grouped menu holding every action of a
 * desktop session card. Four entry points open the same menu — the header
 * trigger (`mdiDotsVertical`), the right-edge hover strip, right-click on the
 * card, and Shift+F10 / the ContextMenu key (the last three are wired by
 * `SessionCard` / `SessionList` through `onOpenChange`).
 *
 * The menu renders the `deriveSessionMenu` groups in the fixed taxonomy
 * `NEXT · SESSION · OPENSPEC · GIT · PLUGINS · VIEW`, with:
 *  - sticky group headings and one inline `More…` expander per group (≥ 2 rare);
 *  - a `role="menu"` panel, APG roving focus, Escape / Tab returning focus to
 *    the opener (the trigger when the opener is gone);
 *  - live re-derivation: items enable / disable / appear / vanish in place, with
 *    focus preserved by item id;
 *  - propagation containment: click / contextmenu / keydown inside the menu
 *    never reach the card's own handlers (the menu is a React descendant of the
 *    card through its portal);
 *  - the PLUGINS group hosting the per-card plugin container (see `SessionCard`),
 *    whose claims stay mounted for the card's lifetime.
 *
 * Placement is `fixed` beside the card via `useSideFlyoutPosition`, portaled
 * with `LayerPortal` at the `z-popover` layer.
 *
 * See change: add-session-actions-flyout.
 */
import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiDotsVertical } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { attrEscape } from "../../lib/util/attr-escape.js";
import { useSideFlyoutPosition } from "../../hooks/useSideFlyoutPosition.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  partitionRare,
  type SessionMenuGroup,
  type SessionMenuGroupId,
  type SessionMenuItem,
} from "../../lib/session/session-menu-items.js";
import type { SessionMenuSource } from "../../lib/state/SessionMenuScopeContext.js";

export interface SessionMenuOpenRequest {
  source: SessionMenuSource;
  point?: { x: number; y: number };
  opener?: HTMLElement | null;
}

interface Props {
  session: DashboardSession;
  groups: SessionMenuGroup[];
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

const ITEM_BASE =
  "flex w-full min-h-[30px] items-center gap-2 px-3 py-1.5 text-left text-sm focus-ring focus:bg-[var(--bg-hover)]";

/** Interactive nodes in DOM order: host menu items plus focusable plugin output. */
function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      "[role='menuitem'], [data-session-menu-plugins] button:not([disabled]), [data-session-menu-plugins] a[href], [data-session-menu-plugins] [role='menuitem']",
    ),
  ).filter((el) => !el.closest("[hidden]"));
}

function isEnabled(el: HTMLElement): boolean {
  return el.getAttribute("aria-disabled") !== "true" && !(el as HTMLButtonElement).disabled;
}

function focusRegion(): void {
  const region = document.querySelector<HTMLElement>("[data-session-list-region]");
  region?.focus({ preventScroll: true });
}

export function SessionActionsMenu({ session, groups, open, source, point, opener, cardRef, onOpenChange, pluginContainer }: Props) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const openRef = React.useRef(open);
  openRef.current = open;
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
          <SessionActionsPanel
            sessionId={session.id}
            panelRef={panelRef}
            triggerRef={triggerRef}
            cardRef={cardRef}
            groups={groups}
            source={source}
            point={point}
            close={close}
            pluginContainer={pluginContainer}
            label={label}
          />
        </LayerPortal>
      )}
    </span>
  );
}

function SessionActionsPanel({
  sessionId,
  panelRef,
  triggerRef,
  cardRef,
  groups,
  source,
  point,
  close,
  pluginContainer,
  label,
}: {
  sessionId: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  cardRef: React.RefObject<HTMLElement | null>;
  groups: SessionMenuGroup[];
  source?: SessionMenuSource;
  point?: { x: number; y: number };
  close: (restore: boolean) => void;
  pluginContainer?: HTMLElement | null;
  label: string;
}) {
  const [expanded, setExpanded] = React.useState<Partial<Record<SessionMenuGroupId, boolean>>>({});
  const [hasPlugins, setHasPlugins] = React.useState(false);
  const pluginHostRef = React.useRef<HTMLDivElement>(null);
  const focusedIdRef = React.useRef<string | null>(null);
  const pendingFocusRef = React.useRef<string | null>(null);
  const hadFocusRef = React.useRef(false);

  useSideFlyoutPosition({ open: true, cardRef, panelRef, point: source === "contextmenu" ? point : null });

  // Outside click / touch / Escape. Escape is a document listener so it also
  // closes a hover-opened menu while focus sits on an unrelated element — and
  // in that case leaves focus exactly where it was.
  React.useEffect(() => {
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const insideMenu = panelRef.current?.contains(document.activeElement);
      close(source !== "hover" || !!insideMenu);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [close, panelRef, triggerRef, source]);

  // Host the detached per-card plugin container; detect whether it renders any
  // element so the PLUGINS heading appears only for real content.
  React.useLayoutEffect(() => {
    const host = pluginHostRef.current;
    if (!host || !pluginContainer) return;
    host.appendChild(pluginContainer);
    const measure = () => setHasPlugins(hasRenderedContent(pluginContainer));
    measure();
    const mo = new MutationObserver(measure);
    mo.observe(pluginContainer, { childList: true, subtree: true, characterData: true });
    // Activating an enabled control inside plugin output closes the menu; the
    // claim (and any dialog it opened) stays mounted through the card's portal.
    const onClick = (e: Event) => {
      const el = (e.target as Element | null)?.closest("button, a[href], [role='menuitem']") as HTMLElement | null;
      if (!el || !isEnabled(el)) return;
      // Same path as a host item: focus returns to the opener, never to <body>.
      close(true);
    };
    pluginContainer.addEventListener("click", onClick);
    return () => {
      mo.disconnect();
      pluginContainer.removeEventListener("click", onClick);
      if (pluginContainer.parentNode === host) host.removeChild(pluginContainer);
    };
  }, [pluginContainer, close]);

  // Initial focus (click / keyboard / right-click open; never for hover).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per open.
  React.useEffect(() => {
    if (source === "hover") return;
    const first = focusables(panelRef.current as HTMLElement).find(isEnabled);
    first?.focus();
  }, []);

  // Live re-derive: keep focus on the same item by id; when it vanished, fall
  // to the first enabled item instead of <body>.
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (pendingFocusRef.current) {
      const el = panel.querySelector<HTMLElement>(`[data-item-id="${attrEscape(pendingFocusRef.current)}"]`);
      pendingFocusRef.current = null;
      el?.focus();
      return;
    }
    const active = document.activeElement;
    if (!hadFocusRef.current || (active && active !== document.body && panel.contains(active))) return;
    if (active && active !== document.body) return;
    const same = focusedIdRef.current
      ? panel.querySelector<HTMLElement>(`[data-item-id="${attrEscape(focusedIdRef.current)}"]`)
      : null;
    const next = same ?? focusables(panel).find(isEnabled);
    next?.focus();
  });

  function onKeyDown(e: React.KeyboardEvent) {
    // Nothing inside the menu may reach the card's keydown (Shift+F10 / Enter).
    e.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const nodes = focusables(panel);
    if (nodes.length === 0) return;
    e.preventDefault();
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = nodes.length - 1;
    else if (e.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % nodes.length;
    else next = at < 0 ? nodes.length - 1 : (at - 1 + nodes.length) % nodes.length;
    nodes[next]?.focus();
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const renderGroup = (g: SessionMenuGroup) => (
    <MenuGroup
      key={g.id}
      group={g}
      expanded={!!expanded[g.id]}
      onExpand={(firstHiddenId) => {
        pendingFocusRef.current = firstHiddenId;
        setExpanded((s) => ({ ...s, [g.id]: true }));
      }}
      onActivate={(item) => {
        if (item.disabled || !item.onSelect) return;
        close(true);
        item.onSelect();
      }}
    />
  );
  const beforeView = groups.filter((g) => g.id !== "view");
  const view = groups.find((g) => g.id === "view");

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      data-testid={`session-actions-menu-${sessionId}`}
      style={{ visibility: "hidden" }}
      onClick={stop}
      onContextMenu={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onDoubleClick={stop}
      onPointerDown={stop}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        hadFocusRef.current = true;
        const id = (e.target as HTMLElement).closest("[data-item-id]")?.getAttribute("data-item-id");
        if (id) focusedIdRef.current = id;
      }}
      className="fixed z-popover min-w-[220px] max-w-[320px] overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] pb-1 shadow-lg"
    >
      {beforeView.map(renderGroup)}
      <div
        hidden={!hasPlugins}
        data-testid="session-menu-group-plugins"
        role="group"
        aria-label={i18nT("sessionMenu.groupPlugins", undefined, "Plugins")}
      >
        {hasPlugins && <GroupHeading title={i18nT("sessionMenu.groupPlugins", undefined, "Plugins")} />}
        <div ref={pluginHostRef} data-session-menu-plugins="" className="px-2 py-1 text-sm" />
      </div>
      {view && renderGroup(view)}
    </div>
  );
}

/**
 * True when the plugin container holds rendered output. The card wraps every
 * plugin in a `[data-plugin-group]` element that is empty when its claim renders
 * nothing, so wrappers alone are not content.
 */
function hasRenderedContent(container: HTMLElement): boolean {
  return container.querySelector("*:not([data-plugin-group])") !== null;
}

function GroupHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-baseline gap-2 bg-[var(--bg-secondary)] px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
      <span>{title}</span>
      {subtitle ? <span className="min-w-0 truncate normal-case tracking-normal text-[var(--text-tertiary)]">{subtitle}</span> : null}
    </div>
  );
}

function MenuGroup({
  group,
  expanded,
  onExpand,
  onActivate,
}: {
  group: SessionMenuGroup;
  expanded: boolean;
  onExpand: (firstHiddenId: string) => void;
  onActivate: (item: SessionMenuItem) => void;
}) {
  const { inline, hidden } = partitionRare(group.items);
  return (
    <div role="group" aria-label={group.title} data-testid={`session-menu-group-${group.id}`}>
      <GroupHeading title={group.title} subtitle={group.subtitle} />
      {inline.map((item) => (
        <MenuEntry key={item.id} item={item} onActivate={onActivate} />
      ))}
      {hidden.length > 0 && (
        <button
          type="button"
          role="menuitem"
          aria-expanded={expanded}
          data-item-id={`more-${group.id}`}
          data-testid={`session-menu-more-${group.id}`}
          onClick={(e) => {
            e.stopPropagation();
            if (expanded) return;
            onExpand(hidden[0].id);
          }}
          className={`${ITEM_BASE} text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]`}
        >
          <span>{i18nT("sessionMenu.more", undefined, "More…")}</span>
          <span className="ml-auto text-[10px] font-semibold text-[var(--text-tertiary)]">{hidden.length}</span>
        </button>
      )}
      {expanded && hidden.map((item) => <MenuEntry key={item.id} item={item} onActivate={onActivate} />)}
    </div>
  );
}

function MenuEntry({ item, onActivate }: { item: SessionMenuItem; onActivate: (item: SessionMenuItem) => void }) {
  if (item.kind === "segments") return <LifecycleRow item={item} onActivate={onActivate} />;
  const inert = item.disabled || !item.onSelect;
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-item-id={item.id}
      data-testid={item.testId ?? `session-menu-item-${item.id}`}
      data-emphasis={item.emphasis ? "primary" : undefined}
      // `aria-disabled`, not `disabled`: a disabled menuitem stays focusable (APG).
      aria-disabled={inert || undefined}
      title={item.reason}
      onClick={(e) => {
        e.stopPropagation();
        if (item.disabled) return;
        onActivate(item);
      }}
      className={`${ITEM_BASE} ${
        item.emphasis
          ? "font-semibold text-[var(--text-primary)] bg-[var(--accent-soft)] hover:bg-[var(--bg-hover)]"
          : inert
            ? "text-[var(--text-muted)] cursor-not-allowed"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      {item.icon ? <Icon path={item.icon} size={0.55} className="shrink-0" /> : null}
      <span className="truncate">{item.label}</span>
      {item.reason && item.disabled ? (
        <span data-testid={`session-menu-reason-${item.id}`} className="ml-auto shrink-0 pl-2 text-[10px] text-[var(--text-tertiary)]">
          {item.reason}
        </span>
      ) : null}
    </button>
  );
}

/** The five lifecycle segments, mirroring the card's lifecycle bar. Inert ones are plain status. */
function LifecycleRow({ item, onActivate }: { item: SessionMenuItem; onActivate: (item: SessionMenuItem) => void }) {
  return (
    <div role="group" aria-label={item.label} data-testid="session-menu-lifecycle" className="flex items-center gap-1 px-3 py-1.5">
      {(item.segments ?? []).map((seg) => {
        const text = `${seg.letter}`;
        const common = {
          "data-testid": `session-menu-segment-${seg.id}`,
          "data-state": seg.state,
          title: `${seg.label} — ${seg.state}`,
          className: `inline-flex min-w-[28px] items-center justify-center rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
            seg.state === "done"
              ? "border-[var(--border-secondary)] text-[var(--tint-green-fg)]"
              : seg.state === "current"
                ? "border-[var(--accent-blue)] text-[var(--text-primary)]"
                : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"
          }`,
        };
        if (!seg.onSelect) {
          return (
            <span key={seg.id} {...common} data-inert="true" aria-label={`${seg.label}, ${seg.state}`}>
              {text}
            </span>
          );
        }
        const run = seg.onSelect;
        return (
          <button
            key={seg.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-item-id={`segment-${seg.id}`}
            aria-label={`${seg.label}, ${seg.state}`}
            {...common}
            onClick={(e) => {
              e.stopPropagation();
              onActivate({ id: `segment-${seg.id}`, label: seg.label, onSelect: run });
            }}
            className={`${common.className} focus-ring hover:bg-[var(--bg-hover)]`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
