/**
 * Tab-strip label for a browser pane tab: live title (fallback: URL host, then
 * "Browser tab") plus a state dot. Mounted for EVERY open browser tab, active
 * or not, so a background tab's label stays current. Reads the shared relay
 * store; never subscribes to frames. See change: add-browser-editor-pane-tab.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { BrowserRelayTabState } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type React from "react";
import { findRelayTab, useRelayStatus, useRelayStatusFeed } from "./relay-store.js";
import { parseBrowserTabPath } from "./tab-path.js";

const DOT: Record<BrowserRelayTabState, string> = {
  live: "bg-green-500",
  "no-frames": "bg-amber-500",
  detached: "bg-red-500",
  "client-screencast-active": "bg-blue-500",
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function BrowserTabLabel({ path }: { path: string }): React.ReactElement {
  const t = useT();
  useRelayStatusFeed();
  const status = useRelayStatus();
  const ref = parseBrowserTabPath(path);
  const tab = ref ? findRelayTab(status, ref.instanceId, ref.tabId)?.tab : undefined;
  const title = tab?.title || (tab ? hostOf(tab.url) : "") || t("tabFallback", undefined, "Browser tab");
  const stateLabel: Record<BrowserRelayTabState, string> = {
    live: t("stateLive", undefined, "live"),
    "no-frames": t("stateIdle", undefined, "idle"),
    detached: t("stateDetached", undefined, "detached"),
    "client-screencast-active": t("stateAgent", undefined, "agent is capturing"),
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-testid="browser-tab-label">
      {tab && (
        <span
          data-testid="browser-tab-state"
          data-state={tab.state}
          role="img"
          aria-label={stateLabel[tab.state]}
          title={stateLabel[tab.state]}
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tab.state]}`}
        />
      )}
      <span className="truncate">{title}</span>
    </span>
  );
}
