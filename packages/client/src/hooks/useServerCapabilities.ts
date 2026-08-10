/**
 * Reads server-advertised host capabilities from `/api/health` once on mount.
 * `systemOpen` gates the editor-pane *Open in system app* / *Reveal in file
 * manager* tab actions — true only on a desktop-capable server host, false
 * headless / container / remote. See change: open-view-command-in-editor-pane
 * (D9).
 */
import { useEffect, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";

export interface ServerCapabilities {
  systemOpen: boolean;
}

export function useServerCapabilities(): ServerCapabilities {
  const [caps, setCaps] = useState<ServerCapabilities>({ systemOpen: false });
  useEffect(() => {
    let active = true;
    fetch(`${getApiBase()}/api/health`)
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        setCaps({ systemOpen: body?.capabilities?.systemOpen === true });
      })
      .catch(() => {
        /* default systemOpen:false — actions stay hidden */
      });
    return () => {
      active = false;
    };
  }, []);
  return caps;
}
