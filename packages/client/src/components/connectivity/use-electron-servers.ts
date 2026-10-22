/**
 * The Electron main window's renderer-safe servers state (keyring + discovery, no bearer) via
 * `piDashboard.listServers()`; `null` in a browser, the neutral shell and a remote-origin page.
 *
 * See change: group-servers-by-identity (D9).
 */
import { type MutableRefObject, useEffect, useState } from "react";
import { getListServers } from "../../lib/electron-server-windows.js";
import type { ElectronServersState } from "../../lib/server-list-model.js";

export function useElectronServers(alive: MutableRefObject<boolean>): ElectronServersState | null {
  const [state, setState] = useState<ElectronServersState | null>(null);
  useEffect(() => {
    const list = getListServers();
    if (!list) return;
    list()
      .then((s) => alive.current && setState(s))
      .catch(() => alive.current && setState(null));
  }, [alive]);
  return state;
}
