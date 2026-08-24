/**
 * Folder actions menu contribution registry.
 *
 * A slot section (Automations / Goals / KB) renders inside the directory
 * card's pill grid, while the folder actions menu renders in the folder
 * HEADER. They are siblings, so a prop cannot carry a section's callback to
 * the menu — and the callbacks are section-local closures (Automations' refresh
 * is a `useState` setter), so they cannot be hoisted into static config either.
 *
 * The bridge is therefore an external store keyed by folder scope, read with
 * `useSyncExternalStore` (React's tearing guarantee) so an ALREADY-OPEN menu
 * re-renders when a late-mounting section registers.
 *
 * Two registration paths:
 *  - `useFolderMenuItem`     — contributes one declarative item.
 *  - `useFolderMenuRefresher` — contributes a callback with NO item of its own,
 *    so the single `MAINTENANCE` refresh item can fan out to it.
 *
 * The plugin-facing contribution is strictly declarative: no `ReactNode`, no
 * `pressed`. The HOST keeps those on its own `FolderMenuItem` (add-to-workspace's
 * popover, urgency sort's `aria-pressed`); that exception is not a plugin
 * capability. The contributing plugin's identity is stamped by this module from
 * the plugin context — never read from the payload, so a plugin cannot declare
 * itself as another.
 *
 * See change: move-slot-actions-to-menu (folder-actions-menu spec).
 */

import type React from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useCurrentPluginId } from "./plugin-context.js";

/** Host-owned verb taxonomy, in render order. Grouping is by verb, never by plugin. */
export const FOLDER_MENU_GROUPS = ["workspace", "directory", "create", "open", "maintenance"] as const;
export type FolderMenuGroup = (typeof FOLDER_MENU_GROUPS)[number];

export function isFolderMenuGroup(value: unknown): value is FolderMenuGroup {
  return typeof value === "string" && (FOLDER_MENU_GROUPS as readonly string[]).includes(value);
}

/** The plugin-facing contribution — declarative only. */
export interface FolderMenuContribution {
  /** Stable id; drives the item's test id (`folder-menu-item-<id>`). */
  id: string;
  group: FolderMenuGroup;
  label: string;
  /** mdi path string. */
  icon: string;
  onSelect: () => void;
  /** Short state marker rendered on the item and folded into its accessible name. */
  badge?: string;
  /** Renders as a disabled control; its callback is never invoked. */
  disabled?: boolean;
}

/** A contribution plus the identity the registry stamped on it. */
export interface RegisteredFolderMenuItem extends FolderMenuContribution {
  pluginId: string;
}

/**
 * A contribution is well-formed only with all five required fields and a group
 * inside the taxonomy. An unknown group is a version mismatch, so the item is
 * DROPPED rather than rendered ungrouped — inventing a home hides the mismatch.
 */
export function isValidFolderMenuContribution(value: unknown): value is FolderMenuContribution {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" && c.id.length > 0 &&
    isFolderMenuGroup(c.group) &&
    typeof c.label === "string" && c.label.length > 0 &&
    typeof c.icon === "string" && c.icon.length > 0 &&
    typeof c.onSelect === "function"
  );
}

/**
 * Registration-independent ordering: sort by contributing plugin id, then by
 * contribution id. When distinct plugins collide on one id the lower plugin id
 * wins, so the outcome never depends on load order.
 */
export function selectFolderMenuItems(
  entries: readonly RegisteredFolderMenuItem[],
): RegisteredFolderMenuItem[] {
  const sorted = [...entries].sort(
    (a, b) => a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
  );
  const seen = new Set<string>();
  const out: RegisteredFolderMenuItem[] = [];
  for (const entry of sorted) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

// ── Store ────────────────────────────────────────────────────────────────────

const EMPTY_ITEMS: readonly RegisteredFolderMenuItem[] = Object.freeze([]);

interface ScopeState {
  items: Map<string, RegisteredFolderMenuItem>;
  refreshers: Map<object, () => void>;
  listeners: Set<() => void>;
  snapshot: readonly RegisteredFolderMenuItem[] | null;
}

export interface FolderMenuStore {
  /** Registers one item; returns a dispose that only evicts its OWN registration. */
  registerItem(scope: string, pluginId: string, contribution: FolderMenuContribution): () => void;
  /** Registers a refresher with no item of its own. */
  registerRefresher(scope: string, refresh: () => void): () => void;
  /** Ordered, collision-resolved snapshot. Referentially stable until the scope mutates. */
  getItems(scope: string): readonly RegisteredFolderMenuItem[];
  /** Invokes every refresher registered for the scope; one throwing does not stop the rest. */
  runRefreshers(scope: string): void;
  subscribe(scope: string, onChange: () => void): () => void;
}

export function createFolderMenuStore(): FolderMenuStore {
  const scopes = new Map<string, ScopeState>();

  function state(scope: string): ScopeState {
    let s = scopes.get(scope);
    if (!s) {
      s = { items: new Map(), refreshers: new Map(), listeners: new Set(), snapshot: null };
      scopes.set(scope, s);
    }
    return s;
  }

  function invalidate(s: ScopeState) {
    s.snapshot = null;
    for (const listener of s.listeners) listener();
  }

  return {
    registerItem(scope, pluginId, contribution) {
      if (!isValidFolderMenuContribution(contribution)) return () => {};
      const s = state(scope);
      // Key by (pluginId, id): a section that unmounts and remounts — including
      // a development double-mount — re-registers the same key, so the LATEST
      // registration wins and the live callback is never dropped.
      const key = `${pluginId}\u0000${contribution.id}`;
      const entry: RegisteredFolderMenuItem = { ...contribution, pluginId };
      s.items.set(key, entry);
      invalidate(s);
      return () => {
        // Identity guard: a superseded registration's dispose (React runs the
        // remount's effect before the unmount's cleanup in some orders) must
        // not evict the live entry.
        if (s.items.get(key) !== entry) return;
        s.items.delete(key);
        invalidate(s);
      };
    },

    registerRefresher(scope, refresh) {
      const s = state(scope);
      const token = {};
      s.refreshers.set(token, refresh);
      return () => {
        s.refreshers.delete(token);
      };
    },

    getItems(scope) {
      const s = scopes.get(scope);
      if (!s) return EMPTY_ITEMS;
      if (s.snapshot === null) s.snapshot = Object.freeze(selectFolderMenuItems([...s.items.values()]));
      return s.snapshot;
    },

    runRefreshers(scope) {
      const s = scopes.get(scope);
      if (!s) return;
      for (const refresh of [...s.refreshers.values()]) {
        try {
          refresh();
        } catch (err) {
          console.error("[folder-menu] refresher threw:", err);
        }
      }
    },

    subscribe(scope, onChange) {
      const s = state(scope);
      s.listeners.add(onChange);
      return () => {
        s.listeners.delete(onChange);
      };
    },
  };
}

// ── Provider ─────────────────────────────────────────────────────────────────

const FolderMenuContext = createContext<FolderMenuStore | null>(null);

/**
 * Default store used when no provider is mounted, so a slot section rendered
 * in isolation (a unit test, a standalone harness) still behaves rather than
 * silently no-opping in a way nobody notices.
 */
const defaultStore = createFolderMenuStore();

export function FolderMenuProvider({
  store,
  children,
}: {
  store?: FolderMenuStore;
  children: React.ReactNode;
}) {
  const own = useRef<FolderMenuStore | null>(null);
  if (!store && !own.current) own.current = createFolderMenuStore();
  const value = store ?? own.current!;
  return <FolderMenuContext.Provider value={value}>{children}</FolderMenuContext.Provider>;
}

export function useFolderMenuStore(): FolderMenuStore {
  return useContext(FolderMenuContext) ?? defaultStore;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Registers one menu item for `scope` for as long as the caller is mounted.
 * A `null` scope registers nothing — the KB section also renders in the
 * worktree-card placement, whose scope has no folder actions menu.
 *
 * Re-registration is keyed on the RENDERED fields, so a state-driven label /
 * badge / disabled change reaches an open menu while an unchanged re-render
 * does not churn the snapshot. `onSelect` is read through a ref, so the item
 * always invokes the current closure without re-registering.
 */
export function useFolderMenuItem(
  scope: string | null | undefined,
  contribution: FolderMenuContribution | null | undefined,
): void {
  const store = useFolderMenuStore();
  const pluginId = useCurrentPluginId();
  const latest = useRef(contribution);
  latest.current = contribution;

  const id = contribution?.id;
  const group = contribution?.group;
  const label = contribution?.label;
  const icon = contribution?.icon;
  const badge = contribution?.badge;
  const disabled = contribution?.disabled;

  useEffect(() => {
    if (!scope || !pluginId || id === undefined) return;
    return store.registerItem(scope, pluginId, {
      id,
      group: group as FolderMenuGroup,
      label: label as string,
      icon: icon as string,
      badge,
      disabled,
      onSelect: () => latest.current?.onSelect(),
    });
  }, [store, scope, pluginId, id, group, label, icon, badge, disabled]);
}

/**
 * Registers a refresher for `scope` — no menu item of its own. The single
 * `MAINTENANCE` refresh item fans out to every refresher registered for the
 * folder.
 */
export function useFolderMenuRefresher(
  scope: string | null | undefined,
  refresh: (() => void) | null | undefined,
): void {
  const store = useFolderMenuStore();
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (!scope) return;
    return store.registerRefresher(scope, () => latest.current?.());
  }, [store, scope]);
}

/** Host read hook: the folder's contributed items, ordered and collision-resolved. */
export function useFolderMenuItems(scope: string): readonly RegisteredFolderMenuItem[] {
  const store = useFolderMenuStore();
  const subscribe = useMemo(() => (cb: () => void) => store.subscribe(scope, cb), [store, scope]);
  return useSyncExternalStore(
    subscribe,
    () => store.getItems(scope),
    () => EMPTY_ITEMS,
  );
}

/** Host hook returning a stable `(scope) => void` fan-out over registered refreshers. */
export function useFolderMenuRefreshRunner(): (scope: string) => void {
  const store = useFolderMenuStore();
  return useMemo(() => (scope: string) => store.runRefreshers(scope), [store]);
}
