/**
 * The session actions menu PANEL — the heavy half of the flyout (deriver call,
 * groups, `More…`, roving focus, plugin hosting). Code-split from the always
 * mounted trigger (`SessionActionsMenu`) so the cold-landing entry chunk does not
 * carry it; see `lazy-session-menu.ts`. It derives the groups itself from the
 * card's `ctx` on EVERY render while open (live state), or takes pre-built
 * `groups` (tests).
 *
 * See change: add-session-actions-flyout.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { Icon } from "@mdi/react";
import React from "react";
import { useSideFlyoutPosition } from "../../hooks/useSideFlyoutPosition.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  deriveSessionMenu,
  partitionRare,
  type SessionMenuCtx,
  type SessionMenuGroup,
  type SessionMenuGroupId,
  type SessionMenuItem,
} from "../../lib/session/session-menu-items.js";
import type { SessionMenuSource } from "../../lib/state/SessionMenuScopeContext.js";
import { attrEscape } from "../../lib/util/attr-escape.js";

const ITEM_BASE =
  "flex w-full min-h-[36px] max-sm:min-h-[44px] items-center gap-2 px-3 py-1.5 text-left text-sm focus-ring focus:bg-[var(--bg-hover)]";

/** Interactive nodes in DOM order: host menu items plus focusable plugin output. */
function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      "[role='menuitem'], [data-session-menu-plugins] button:not([disabled]), [data-session-menu-plugins] a[href], [data-session-menu-plugins] [role='menuitem']",
    ),
  ).filter((el) => !el.closest("[hidden]"));
}

/** Roving index for an arrow / Home / End key (wrapping), or `null` when the key is not navigation. */
function nextFocusIndex(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowDown":
      return at < 0 ? 0 : (at + 1) % count;
    case "ArrowUp":
      return at < 0 ? count - 1 : (at - 1 + count) % count;
    default:
      return null;
  }
}

function isEnabled(el: HTMLElement): boolean {
  return el.getAttribute("aria-disabled") !== "true" && !(el as HTMLButtonElement).disabled;
}


export function SessionActionsPanel({
  session,
  panelRef,
  triggerRef,
  cardRef,
  groups: groupsProp,
  ctx,
  source,
  point,
  close,
  pluginContainer,
  label,
}: {
  session: DashboardSession;
  panelRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  cardRef: React.RefObject<HTMLElement | null>;
  /** Pre-derived groups (tests). Wins over `ctx`. */
  groups?: SessionMenuGroup[];
  /** The card's menu context: the panel derives the groups from it on every render. */
  ctx?: SessionMenuCtx;
  source?: SessionMenuSource;
  point?: { x: number; y: number };
  close: (restore: boolean) => void;
  pluginContainer?: HTMLElement | null;
  label: string;
}) {
  const sessionId = session.id;
  const groups = groupsProp ?? (ctx ? deriveSessionMenu(session, ctx) : []);
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
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close(true);
      return;
    }
    const nodes = focusables(panel);
    const next = nextFocusIndex(e.key, nodes.indexOf(document.activeElement as HTMLElement), nodes.length);
    if (next === null) return;
    e.preventDefault();
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
        <div ref={pluginHostRef} data-session-menu-plugins="" className="px-2 py-1 text-sm text-[var(--text-primary)]" />
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
    <div className="sticky top-0 z-10 flex items-baseline gap-2 bg-[var(--bg-secondary)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
      <span>{title}</span>
      {subtitle ? <span className="min-w-0 truncate normal-case tracking-normal text-[var(--text-secondary)]">{subtitle}</span> : null}
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
          className={`${ITEM_BASE} text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`}
        >
          <span>{i18nT("sessionMenu.more", undefined, "More…")}</span>
          <span className="ml-auto text-xs font-semibold text-[var(--text-secondary)]">{hidden.length}</span>
        </button>
      )}
      {expanded && hidden.map((item) => <MenuEntry key={item.id} item={item} onActivate={onActivate} />)}
    </div>
  );
}

function MenuEntry({ item, onActivate }: { item: SessionMenuItem; onActivate: (item: SessionMenuItem) => void }) {
  const reasonId = React.useId();
  if (item.kind === "segments") return <LifecycleRow item={item} onActivate={onActivate} />;
  const inert = item.disabled || !item.onSelect;
  const showReason = Boolean(item.reason && item.disabled);
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
      aria-describedby={showReason ? reasonId : undefined}
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
            ? "text-[var(--text-secondary)] cursor-not-allowed"
            : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      {item.icon ? <Icon path={item.icon} size={0.55} className="shrink-0" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {showReason ? (
          <span id={reasonId} data-testid={`session-menu-reason-${item.id}`} className="block whitespace-normal text-xs text-[var(--text-secondary)]">
            {item.reason}
          </span>
        ) : null}
      </span>
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
                : "border-[var(--border-subtle)] text-[var(--text-secondary)]"
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
            className={`${common.className} min-h-[36px] max-sm:min-h-[44px] focus-ring hover:bg-[var(--bg-hover)]`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
