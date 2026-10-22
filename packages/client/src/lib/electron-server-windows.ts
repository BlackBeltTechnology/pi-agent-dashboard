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
 * `listServers` and `pairWithCode` ride the same main-window gate (D9): the first
 * returns the renderer-safe keyring/discovery state (no bearer, no cookie), the
 * second starts the app-owned "pair with code" window for a pinned fingerprint
 * (the pasted text and the credential never reach this page).
 *
 * See change: add-electron-server-windows (D9, D13), group-servers-by-identity (D8, D9).
 */
import type { ElectronServersState } from "./server-list-model.js";


type OpenServerWindowResult = { ok: true; pairing?: true } | { ok: false; reason: string };
export type OpenServerWindowFn = (target: { host: string; port: number }) => Promise<OpenServerWindowResult>;
export type ListServersFn = () => Promise<ElectronServersState | null>;
export type PairWithCodeFn = (target: { fingerprint: string }) => Promise<OpenServerWindowResult>;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type Bridge = Record<string, unknown>;

/** A main-window bridge method by name, or undefined (browser, remote-origin document, absent method). */
function bridgeMethod(name: string): { bridge: Bridge; fn: (...args: unknown[]) => unknown } | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = (window as unknown as { piDashboard?: Bridge }).piDashboard;
  const fn = bridge?.[name];
  if (!bridge || typeof fn !== "function") return undefined;
  if (!LOOPBACK_HOSTNAMES.has(window.location.hostname)) return undefined;
  return { bridge, fn: fn as (...args: unknown[]) => unknown };
}

/** The capability, or undefined in a browser / remote-origin document. */
export function getOpenServerWindow(): OpenServerWindowFn | undefined {
  const m = bridgeMethod("openServerWindow");
  return m && ((target) => m.fn.call(m.bridge, target) as ReturnType<OpenServerWindowFn>);
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

type PairedState = ElectronServersState["paired"][number];
type DiscoveredState = ElectronServersState["discovered"][number];

const objects = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

function sanitizePaired(p: Record<string, unknown>): PairedState | null {
  const fingerprint = str(p.fingerprint);
  if (!fingerprint) return null;
  const host = str(p.host);
  return {
    fingerprint,
    label: str(p.label) ?? "",
    state: p.state === "needs-pairing" ? "needs-pairing" : "paired",
    ...(host ? { host } : {}),
  };
}

function sanitizeDiscovered(d: Record<string, unknown>): DiscoveredState | null {
  const host = str(d.host);
  if (!host || typeof d.port !== "number") return null;
  const fingerprint = str(d.fingerprint);
  return {
    name: str(d.name) ?? host,
    host,
    port: d.port,
    ...(fingerprint ? { fingerprint } : {}),
    state: d.state === "paired" || d.state === "identity-not-advertised" ? d.state : "not-paired",
  };
}

/** Copy only the renderer-safe fields: whatever else a bridge returns (a bearer, a cookie) never leaves this function. */
function sanitizeServersState(raw: unknown): ElectronServersState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { paired?: unknown; discovered?: unknown };
  return {
    paired: objects(r.paired).flatMap((p) => sanitizePaired(p) ?? []),
    discovered: objects(r.discovered).flatMap((d) => sanitizeDiscovered(d) ?? []),
  };
}

/** `piDashboard.listServers()` reduced to the renderer-safe state; undefined without the capability. */
export function getListServers(): ListServersFn | undefined {
  const m = bridgeMethod("listServers");
  return m && (async () => sanitizeServersState(await m.fn.call(m.bridge)));
}

/** `piDashboard.pairWithCode({fingerprint})`; undefined without the capability. */
export function getPairWithCode(): PairWithCodeFn | undefined {
  const m = bridgeMethod("pairWithCode");
  return m && ((target) => m.fn.call(m.bridge, target) as ReturnType<PairWithCodeFn>);
}
