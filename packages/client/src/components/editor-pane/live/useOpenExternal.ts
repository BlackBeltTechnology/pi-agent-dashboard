/**
 * "Open ↗" for a capability-served preview (change: improve-canvas-html-and-url-ux, D3).
 * Mints a FRESH capability (the tab's token never lands in browser history) under the
 * tab's current policy and opens it in a new window. The window is opened
 * synchronously so the popup blocker sees the click, then navigated once the mint answers.
 */
import { classifyUrl } from "@blackbelt-technology/pi-dashboard-shared/url-policy.js";
import { useCallback, useState } from "react";
import { getApiBase } from "../../../lib/api/api-context.js";
import { mintLiveCapability, type PreviewPolicy } from "../../../lib/api/live-server-api.js";
import { frameSrc } from "../../../lib/live-preview/preview-policy.js";
import { openExternalUrl } from "../../../lib/nav/safe-navigation.js";

export function useOpenExternal(targetId: string, policy: PreviewPolicy, runScripts: boolean, viewerId: string, deep: string) {
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(async () => {
    setError(null);
    // client-sinks: allow — constant about:blank opened synchronously for the popup blocker
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;
    const res = await mintLiveCapability(targetId, { policy, runScripts: runScripts || undefined, viewerId });
    if (!res.ok) {
      win?.close();
      setError(res.error);
      return;
    }
    const url = frameSrc(getApiBase(), res.path, deep);
    if (classifyUrl(url, window.location.origin) === "blocked") {
      win?.close();
      return;
    }
    // client-sinks: allow — server-minted capability URL, classified above
    if (win) win.location.href = url;
    else openExternalUrl(url);
  }, [targetId, policy, runScripts, viewerId, deep]);
  return { open, error };
}
