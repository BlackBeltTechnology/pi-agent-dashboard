/**
 * `servers:*` IPC — discovery, pairing and server-window requests.
 *
 * Own channel family (NOT the loading page's `dashboard:` server-control family).
 * Every request is handled in the main process and accepted only from the
 * TOP-LEVEL frame of a trusted window (`isServerWindowsSender`):
 *   - the bundled remote-connect window (`file://` page),
 *   - the bundled connecting window (`file://` page),
 *   - the main window while its top-level frame shows the LOCAL dashboard origin
 *     (never the remote-mode origin; subframes — even same-origin iframes — refused).
 * The check is standalone (no composition with another predicate), so it never
 * fails open. Payloads are shape-validated; no credential, partition name or URL
 * path is ever accepted from a renderer.
 *
 * Electron is injected (`ipcMain` shape + trusted-window source), so this module
 * is unit-tested without Electron (`__tests__/servers-ipc.test.ts`).
 *
 * See change: add-electron-server-windows (D9).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRemoteUrl } from "./remote-probe.js";
import { type DiscoveredEntry, isFingerprint, shortFingerprint } from "./server-discovery.js";
import type { KeyringEntryView, ServerKeyring } from "./server-keyring.js";
import type { OpenResult, ServerWindows } from "./server-windows.js";

type SenderKind = "remote-connect" | "connecting" | "main";

/** What the sender check needs to know about a trusted window. */
export interface TrustedWindow {
  kind: SenderKind;
  webContents: { send(channel: string, ...args: unknown[]): void; isDestroyed?(): boolean; mainFrame?: unknown };
  /** For bundled pages: the absolute file the top-level frame must be showing. */
  expectedFile?: string;
  /** Current top-level URL — pushes go only to a window still showing its expected page. */
  topUrl?(): string;
  isDestroyed(): boolean;
}

export interface TrustContext {
  windows(): TrustedWindow[];
  /** Origin of the dashboard this app launched/adopted (undefined in remote mode). */
  localOrigin(): string | undefined;
}

/** Minimal shape of `IpcMainEvent | IpcMainInvokeEvent`. */
export interface ServersEvent {
  sender: { mainFrame?: unknown };
  senderFrame?: { url?: string } | null;
}

function frameShowsFile(url: string | undefined, expected: string | undefined): boolean {
  if (!url || !expected) return false;
  try {
    const u = new URL(url);
    return u.protocol === "file:" && path.resolve(fileURLToPath(u)) === path.resolve(expected);
  } catch {
    return false;
  }
}

/**
 * Top-level frame only: a subframe (even same-origin) is refused. Electron hands back the
 * same WebFrameMain object for `sender.mainFrame` and `senderFrame` of the top frame; a
 * frame with `parent === null` is the top frame too.
 */
function isTopFrame(event: ServersEvent, frame: { url?: string }): boolean {
  return (event.sender.mainFrame !== undefined && event.sender.mainFrame === frame) || (frame as { parent?: unknown }).parent === null;
}

/** Does this trusted window's top frame show the page it is allowed to show? */
function frameIsExpected(w: TrustedWindow, frameUrl: string, ctx: TrustContext): boolean {
  if (w.kind !== "main") return frameShowsFile(frameUrl, w.expectedFile);
  const local = ctx.localOrigin();
  if (!local) return false;
  try {
    return new URL(frameUrl).origin === new URL(local).origin;
  } catch {
    return false;
  }
}

/** Which trusted window kind sent this event, or null. Standalone — no other predicate is composed. */
function senderKind(event: ServersEvent, ctx: TrustContext): SenderKind | null {
  const frame = event.senderFrame;
  if (!frame || typeof frame.url !== "string" || !isTopFrame(event, frame)) return null;
  const w = ctx.windows().find((x) => !x.isDestroyed() && x.webContents === event.sender);
  return w && frameIsExpected(w, frame.url, ctx) ? w.kind : null;
}

export function isServerWindowsSender(event: ServersEvent, ctx: TrustContext): boolean {
  return senderKind(event, ctx) !== null;
}

// ── Payload validation ───────────────────────────────────────────────────────

const HOST_RE = /^[A-Za-z0-9.:_-]+$/;

export function validHostPort(host: unknown, port: unknown): { host: string; port: number } | null {
  if (typeof host !== "string" || host.length < 1 || host.length > 253 || !HOST_RE.test(host)) return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// ── State projection ─────────────────────────────────────────────────────────

interface PairedRow {
  fingerprint: string;
  label: string;
  shortFp: string;
  state: "paired" | "needs-pairing";
  open: boolean;
  remembered: boolean;
  host?: string;
}

interface ServersState {
  paired: PairedRow[];
  discovered: DiscoveredEntry[];
  recent: Array<{ url: string; lastUsed: string }>;
}

function pairedRow(e: KeyringEntryView, open: boolean): PairedRow {
  const h = e.lastHosts[0];
  return {
    fingerprint: e.fingerprint,
    label: e.label,
    shortFp: shortFingerprint(e.fingerprint),
    state: e.needsPairing ? "needs-pairing" : "paired",
    open,
    remembered: e.remembered,
    ...(h ? { host: `${h.host}:${h.port}` } : {}),
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

interface IpcMainLike {
  handle(channel: string, listener: (event: ServersEvent, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: ServersEvent, ...args: unknown[]) => void): void;
}

export interface ServersIpcDeps {
  ipcMain: IpcMainLike;
  trust: TrustContext;
  serverWindows: ServerWindows;
  keyring: ServerKeyring;
  discovery: { list(): DiscoveredEntry[] };
  recent: () => Array<{ url: string; lastUsed: string }>;
  /** Close the connecting window (and stop any pairing). */
  closeConnecting: () => void;
  log: (line: string) => void;
}

const REFUSED = { ok: false as const, reason: "untrusted" as const };

export interface ServersIpc {
  state(): ServersState;
  /** Push `servers:changed` to trusted windows only. */
  broadcast(): void;
}

export function registerServersIpc(deps: ServersIpcDeps): ServersIpc {
  const { ipcMain, trust, serverWindows, keyring } = deps;

  const state = (): ServersState => ({
    paired: keyring.list().map((e) => pairedRow(e, serverWindows.isOpen(e.fingerprint))),
    discovered: deps.discovery.list().filter((d) => d.state !== "paired"),
    recent: deps.recent(),
  });

  const broadcast = (): void => {
    const s = state();
    for (const w of trust.windows()) {
      if (w.isDestroyed() || w.webContents.isDestroyed?.()) continue;
      // The main window may be on a remote origin (remote mode, OAuth page): never push there.
      if (w.topUrl && !frameIsExpected(w, w.topUrl(), trust)) continue;
      try {
        w.webContents.send("servers:changed", s);
      } catch {
        /* window going away */
      }
    }
  };

  /** Wrap a handler: only `allowed` kinds pass; anything else is refused with no data. */
  const guarded =
    <A extends unknown[], R>(channel: string, allowed: SenderKind[], fn: (kind: SenderKind, ...args: A) => R) =>
    (event: ServersEvent, ...args: A): R | typeof REFUSED => {
      const kind = senderKind(event, trust);
      if (!kind || !allowed.includes(kind)) {
        deps.log(`[server-windows] ${channel} refused: untrusted sender`);
        return REFUSED;
      }
      return fn(kind, ...args);
    };

  const RC: SenderKind[] = ["remote-connect"];
  const LISTERS: SenderKind[] = ["remote-connect", "connecting", "main"];

  ipcMain.handle("servers:list", guarded("servers:list", LISTERS, () => state()));

  ipcMain.handle(
    "servers:connect",
    guarded("servers:connect", RC, async (_k, payload: unknown): Promise<OpenResult> => {
      const key = obj(payload)?.key;
      if (typeof key !== "string" || key.length === 0 || key.length > 512) return { ok: false, reason: "invalid" };
      return serverWindows.connectDiscovered(key);
    }),
  );

  ipcMain.handle(
    "servers:connect-manual",
    guarded("servers:connect-manual", RC, async (_k, payload: unknown): Promise<OpenResult> => {
      // Normalised exactly as for probing/connecting before any other use.
      const url = normalizeRemoteUrl(obj(payload)?.url);
      if (!url) return { ok: false, reason: "invalid" };
      return serverWindows.connectManual(url);
    }),
  );

  ipcMain.handle(
    "servers:open",
    guarded("servers:open", RC, async (_k, payload: unknown): Promise<OpenResult> => {
      const fp = obj(payload)?.fingerprint;
      if (!isFingerprint(fp)) return { ok: false, reason: "invalid" };
      return serverWindows.open(fp, { notify: true });
    }),
  );

  // From the (local) main window: host + port must match something known.
  ipcMain.handle(
    "servers:open-from-dashboard",
    guarded("servers:open-from-dashboard", ["main"], async (_k, payload: unknown): Promise<OpenResult> => {
      const p = obj(payload);
      const hp = validHostPort(p?.host, p?.port);
      if (!hp) return { ok: false, reason: "invalid" };
      return serverWindows.openByHostPort(hp.host, hp.port);
    }),
  );

  ipcMain.handle(
    "servers:forget",
    guarded("servers:forget", RC, async (_k, payload: unknown) => {
      const fp = obj(payload)?.fingerprint;
      if (!isFingerprint(fp)) return { ok: false, message: "invalid" };
      const r = await serverWindows.forget(fp);
      broadcast();
      return r;
    }),
  );

  // Remote-connect: re-pair a listed entry by fingerprint. Connecting window: retry the current target.
  ipcMain.handle(
    "servers:pair-again",
    guarded("servers:pair-again", ["remote-connect", "connecting"], async (kind, payload: unknown): Promise<OpenResult> => {
      if (kind === "connecting") {
        serverWindows.retryPairing();
        return { ok: true, pairing: true };
      }
      const fp = obj(payload)?.fingerprint;
      if (!isFingerprint(fp)) return { ok: false, reason: "invalid" };
      return serverWindows.pairAgain(fp);
    }),
  );

  ipcMain.handle(
    "servers:send-request",
    guarded("servers:send-request", ["connecting"], (_k, payload: unknown) => {
      const name = obj(payload)?.deviceName;
      if (typeof name !== "string" || name.length > 1024) return { ok: false };
      serverWindows.sendRequest(name);
      return { ok: true };
    }),
  );

  ipcMain.handle(
    "servers:stop-waiting",
    guarded("servers:stop-waiting", ["connecting"], () => {
      serverWindows.stopWaiting();
      return { ok: true };
    }),
  );

  ipcMain.handle(
    "servers:connecting-ready",
    guarded("servers:connecting-ready", ["connecting"], () => serverWindows.connectingState()),
  );

  ipcMain.on("servers:connecting-close", (event: ServersEvent) => {
    if (senderKind(event, trust) !== "connecting") return;
    deps.closeConnecting();
  });

  return { state, broadcast };
}
