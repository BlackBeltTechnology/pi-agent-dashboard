/**
 * `window.piDashboard.browserHost` accessor. Kept out of `OperatorHostCarrier`
 * so the always-loaded shell chunk (BrowserRelayFeed) does not pull the carrier's
 * bridging code in for the non-Electron majority.
 * See change: add-operator-browser-relay.
 */
import type { BrowserHostBridge } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";

/** `window.piDashboard.browserHost`, or `undefined` outside the trusted Electron main window. */
export function getBrowserHost(): BrowserHostBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { piDashboard?: { browserHost?: BrowserHostBridge } }).piDashboard?.browserHost;
}
