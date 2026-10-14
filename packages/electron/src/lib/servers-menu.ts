/**
 * "Servers" submenu shared by the app menu and the tray menu.
 *
 * One item per keyring entry (sanitised label, state in words when not
 * "Paired"), then "Connect to another dashboard…". Pure template builder — the
 * hooks (entries / open / connect) are installed once by `main.ts`, and the
 * menus are rebuilt when the keyring changes.
 *
 * Imports only TYPES from electron — unit-tested in `__tests__/servers-menu.test.ts`.
 *
 * See change: add-electron-server-windows ("Servers menu").
 */
import type { MenuItemConstructorOptions } from "electron";
import { sanitizeDisplayName } from "./server-discovery.js";

export interface ServersMenuEntry {
  fingerprint: string;
  label: string;
  needsPairing: boolean;
}

export interface ServersMenuHooks {
  entries(): ServersMenuEntry[];
  open(fingerprint: string): void;
  connectAnother(): void;
}

/** Items of the Servers submenu. */
export function buildServersSubmenu(
  entries: ServersMenuEntry[],
  open: (fingerprint: string) => void,
  connectAnother: () => void,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = entries.map((e) => {
    const label = sanitizeDisplayName(e.label, "dashboard");
    return { label: e.needsPairing ? `${label} — needs pairing` : label, click: () => open(e.fingerprint) };
  });
  if (items.length > 0) items.push({ type: "separator" });
  items.push({ label: "Connect to another dashboard…", click: connectAnother });
  return items;
}

let hooks: ServersMenuHooks | null = null;
const rebuilders = new Set<() => void>();

/** Install the hooks (main.ts, at app ready). */
export function setServersMenuHooks(h: ServersMenuHooks | null): void {
  hooks = h;
}

/** Register a menu rebuild callback (app menu, tray); returns an unregister function. */
export function onServersMenuChanged(cb: () => void): () => void {
  rebuilders.add(cb);
  return () => rebuilders.delete(cb);
}

/** Call when the keyring changed so every menu rebuilds. */
export function notifyServersMenuChanged(): void {
  for (const cb of rebuilders) {
    try {
      cb();
    } catch {
      /* a menu rebuild must never break the keyring write path */
    }
  }
}

/** The top-level "Servers" menu item for the current hooks (a lone "Connect…" row before hooks exist). */
export function serversMenuItem(): MenuItemConstructorOptions {
  return {
    label: "Servers",
    submenu: buildServersSubmenu(
      hooks?.entries() ?? [],
      (fp) => hooks?.open(fp),
      () => hooks?.connectAnother(),
    ),
  };
}
