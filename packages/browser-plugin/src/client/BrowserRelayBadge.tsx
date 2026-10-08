/**
 * Session-card badge for the browser relay (change: add-browser-relay, task
 * 4.3; reworked by add-browser-editor-pane-tab).
 *
 * Hidden until ≥1 live instance has ≥1 listed tab. It is a menu button: the
 * menu lists every live relay tab with "Open in pane" (and "Open all in pane"),
 * opening the tab(s) in THIS card's session pane via one navigation
 * (`openPluginTabRoute`, which also selects the session). Activating the badge
 * never replaces the chat with a browser surface.
 *
 * It is also an always-mounted `browser_relay_status` feeder (the sidebar
 * renders the session-card-badge slot for every session).
 *
 * Manifest claim: `{ "slot": "session-card-badge", "component": "BrowserRelayBadge" }`.
 */
import { openPluginTabRoute, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useRelayStatus, useRelayStatusFeed } from "./relay-store.js";
import { browserTabPath } from "./tab-path.js";

const DOT: Record<string, string> = {
  live: "bg-green-500",
  "no-frames": "bg-amber-500",
  detached: "bg-red-500",
  "client-screencast-active": "bg-blue-500",
};

export function BrowserRelayBadge({ session }: { session: DashboardSession }): React.ReactElement | null {
  const t = useT();
  const [, navigate] = useLocation();
  useRelayStatusFeed();
  const status = useRelayStatus();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const tabs = useMemo(
    () =>
      (status?.instances ?? []).flatMap((instance) =>
        instance.tabs.map((tab) => ({ instanceId: instance.instanceId, tab, path: browserTabPath(instance.instanceId, tab.tabId) })),
      ),
    [status],
  );

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Focus the first item on open; close on outside press.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (tabs.length === 0) return null;
  const countLabel = t("relayBadge", { n: tabs.length }, `${tabs.length} browser tabs`);

  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation(); // do not also select the enclosing session card
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect();
      setPos(r ? { top: r.bottom + 4, left: Math.max(4, Math.min(r.left, window.innerWidth - 248)) } : null);
    }
    setOpen((v) => !v);
  };

  const openPaths = (paths: string[]) => {
    openPluginTabRoute(navigate, session.id, paths);
    close(false);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Home") items[0]?.focus();
    else if (e.key === "End") items[items.length - 1]?.focus();
    else if (e.key === "Escape" || e.key === "Tab") {
      close(e.key === "Escape");
      return;
    } else return;
    e.preventDefault();
  };

  const item = "block w-full text-left text-xs px-2 py-1.5 hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] focus:outline-none";

  return (
    <span className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        data-testid="browser-relay-badge"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // Accessible name keeps the visible label (WCAG 2.5.3) plus the action.
        aria-label={`${countLabel} — ${t("badgeMenu", undefined, "Open browser tabs in the pane")}`}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) toggle(e);
          else if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--accent-soft)] text-[var(--accent-text)]"
      >
        {countLabel}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          data-testid="browser-relay-menu"
          aria-label={t("badgeMenu", undefined, "Open browser tabs in the pane")}
          style={pos ? { position: "fixed", top: pos.top, left: pos.left, width: 240 } : undefined}
          className="z-50 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onMenuKeyDown}
        >
          {tabs.map(({ instanceId, tab, path }) => (
            <button
              key={path}
              type="button"
              role="menuitem"
              data-testid={`browser-relay-open-${instanceId}-${tab.tabId}`}
              className={`${item} flex items-center gap-1.5`}
              onClick={() => openPaths([path])}
            >
              <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tab.state] ?? ""}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{tab.title || tab.url || t("untitledTab", undefined, "Untitled tab")}</span>
              <span className="shrink-0 text-[var(--text-tertiary)]">{t("openInPane", undefined, "Open in pane")}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            data-testid="browser-relay-open-all"
            className={`${item} border-t border-[var(--border-secondary)]`}
            onClick={() => openPaths(tabs.map((x) => x.path))}
          >
            {t("openAllInPane", undefined, "Open all in pane")}
          </button>
        </div>
      )}
    </span>
  );
}
