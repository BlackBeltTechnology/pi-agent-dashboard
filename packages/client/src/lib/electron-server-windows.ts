/**
 * Electron "open server window" capability, as seen from the dashboard page.
 *
 * The Electron app exposes `window.piDashboard.openServerWindow` ONLY to its main
 * window while that window shows the LOCAL dashboard origin. The client
 * feature-detects it (and re-checks that the page origin is loopback, since a
 * remote-origin page must keep the in-page switch) and then asks the app to open
 * — or start pairing with — a known server by host + port. The app validates
 * everything else.
 *
 * See change: add-electron-server-windows (D9, D13).
 */
type OpenServerWindowResult = { ok: true; pairing?: true } | { ok: false; reason: string };
export type OpenServerWindowFn = (target: { host: string; port: number }) => Promise<OpenServerWindowResult>;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The capability, or undefined in a browser / remote-origin document. */
export function getOpenServerWindow(): OpenServerWindowFn | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = (window as unknown as { piDashboard?: { openServerWindow?: unknown } }).piDashboard;
  const fn = bridge?.openServerWindow;
  if (typeof fn !== "function") return undefined;
  if (!LOOPBACK_HOSTNAMES.has(window.location.hostname)) return undefined;
  return (target) => (fn as OpenServerWindowFn).call(bridge, target);
}
