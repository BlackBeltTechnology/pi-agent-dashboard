/**
 * Electron-main side of the operator browser host: serves
 * `window.piDashboard.browserHost` (contract: shared `browser-host-ipc.ts`).
 *
 * Trust: every channel goes through `trustedHandler` / `trustedListener`
 * (`lib/ipc-trust.ts`) AND must come from the ONE attached main window — a
 * sender that is not the local loading page / loopback origin on the configured
 * port is refused (`UntrustedSenderError`), and so is another window. The
 * private key and tokens never appear in any return value, push or log line.
 *
 * Connect flow (`connect` → answer pushed on `connectAnswer`):
 *   no desktop Chrome → `no-chrome`; target `/api/health` unverifiable →
 *   `server-unverified` (no dialog); else consent (stored "Always allow" or the
 *   55 s dialog; `denied`); then register the link with the loopback shim,
 *   open Chrome on `connect.html` (token appended locally), answer `ok`.
 * `cancelConnect`, a main-frame navigation/reload, window destruction and a
 * target change close every dialog and link of the window (the same effect as the
 * server's `browser_host_connect_cancel`; S sees the carrier close).
 *
 * Electron is injected (`ipcMain` shape, window shape, dialog + launcher ports),
 * so this module is unit-tested without Electron (`__tests__/ipc.test.ts`).
 *
 * See change: add-operator-browser-relay (D1, D4, D7, D9, D10).
 */
import { BROWSER_HOST_CHANNELS as CH, type BrowserHostConnectAnswer } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import { buildChromeOpenCommand } from "@blackbelt-technology/pi-dashboard-shared/chrome-profiles.js";
import { type SenderEventLike, trustedHandler, trustedListener } from "../ipc-trust.js";
import { createConsentStore, type DialogPort, requestConsent, type ServerKey } from "./consent.js";
import { type ChromePort, createHostIdentity } from "./identity.js";
import { buildOperatorConnectUrl, createShim, type Shim } from "./shim.js";
import type { CryptoPort, FsPort } from "./store.js";
import { createTarget, type FetchLike } from "./target.js";
import { createTee } from "./tee.js";
import { createTokenStore } from "./tokens.js";

/** Pending (unanswered) connects and total live links per window — a hostile server cannot flood dialogs. */
const MAX_PENDING_CONNECTS = 4;
const MAX_LINKS = 8;
const MAX_FRAME = 16 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** `profileDirectory` ≤128, no path separators, never option-like. */
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,127}$/;

type Listener = (event: unknown, ...args: unknown[]) => unknown;
export interface IpcMainPort {
  handle(channel: string, listener: Listener): void;
  removeHandler(channel: string): void;
  on(channel: string, listener: Listener): void;
  removeListener(channel: string, listener: Listener): void;
}

interface Emitter {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** The main `BrowserWindow`, as far as this module needs it. */
interface HostWindow extends Emitter {
  webContents: Emitter & { send(channel: string, ...args: unknown[]): void; isDestroyed?(): boolean };
}

export interface BrowserHostDeps {
  ipcMain: IpcMainPort;
  /** Sender-frame trust (`isTrustedSenderUrl` bound to the loading page + local port). */
  isTrustedSender: (event: SenderEventLike) => boolean;
  /** userData-like directory for the key, token and consent files. */
  dir: string;
  crypto: CryptoPort;
  fs?: FsPort;
  platform: NodeJS.Platform;
  hostLabel: () => string;
  chrome: ChromePort;
  dialog: DialogPort;
  /** Spawn Chrome (argv, no shell); throws when it cannot start. */
  launch: (cmd: string, args: string[]) => void;
  /** Health fetch (default: global `fetch`). */
  fetchImpl?: FetchLike;
  log: (line: string) => void;
  now?: () => number;
  shim?: Shim;
}

export interface BrowserHost {
  /** (Re)bind to the main window: navigation / destruction cancel everything. */
  attachWindow(win: HostWindow): void;
  /** Remove every stored consent (app menu); live links stay open. Returns the count. */
  revokeAll(): number;
  dispose(): void;
}

interface ConnectRequest {
  requestId: string;
  linkId: string;
  profileDirectory: string;
  serverLabel: string;
}

interface Request {
  linkId: string;
  ctl: AbortController;
  settled: boolean;
}

/** After a Deny, the same (server, profile) is auto-denied this long without a dialog. */
const DENY_COOLDOWN_MS = 60_000;

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function parseConnect(payload: unknown): ConnectRequest | null {
  const p = obj(payload);
  if (!p || !str(p.requestId, 128) || !str(p.linkId, 128) || !ID_RE.test(p.linkId)) return null;
  if (typeof p.profileDirectory !== "string" || !PROFILE_RE.test(p.profileDirectory) || p.profileDirectory.includes("..")) return null;
  if (typeof p.serverLabel !== "string" || p.serverLabel.length > 256) return null;
  return { requestId: p.requestId, linkId: p.linkId, profileDirectory: p.profileDirectory, serverLabel: p.serverLabel };
}

export function createBrowserHost(deps: BrowserHostDeps): BrowserHost {
  const { ipcMain, log } = deps;
  const target = createTarget({ fetchImpl: deps.fetchImpl });
  const identity = createHostIdentity({ dir: deps.dir, crypto: deps.crypto, fs: deps.fs, label: deps.hostLabel, platform: deps.platform, chrome: deps.chrome, target, log, now: deps.now });
  const consents = createConsentStore({ dir: deps.dir, fs: deps.fs, log, now: deps.now });
  const tokens = createTokenStore({ dir: deps.dir, crypto: deps.crypto, fs: deps.fs, log, now: deps.now });
  const shim = deps.shim ?? createShim({ log });

  let win: HostWindow | null = null;
  let detachWindow: (() => void) | null = null;
  const requests = new Map<string, Request>();
  const now = deps.now ?? Date.now;
  const deniedUntil = new Map<string, number>();

  const push = (channel: string, payload: unknown): void => {
    if (!win || win.webContents.isDestroyed?.()) return;
    try {
      win.webContents.send(channel, payload);
    } catch {
      /* window going away */
    }
  };
  const tee = createTee((frame) => push(CH.frame, frame));

  // ── trust ────────────────────────────────────────────────────────────────
  const isTrusted = (event: SenderEventLike & { sender?: { mainFrame?: unknown } }): boolean => {
    if (!win || event?.sender !== (win.webContents as unknown)) return false;
    // Top-level frame only (a same-origin iframe is not the carrier).
    const main = event.sender?.mainFrame;
    if (main !== undefined && event.senderFrame !== main && (event.senderFrame as { parent?: unknown } | null)?.parent !== null) return false;
    return deps.isTrustedSender(event);
  };
  const reject = (channel: string): void => log(`[browser-host] ${channel} rejected: untrusted sender`);
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, trustedHandler(channel, isTrusted, (_e: SenderEventLike, ...args: unknown[]) => fn(...args), reject) as Listener);
  };
  const listenerRefs = new Map<string, Listener>();
  const listen = (channel: string, fn: (...args: unknown[]) => void): void => {
    const wrapped = trustedListener(channel, isTrusted, (_e: SenderEventLike, ...args: unknown[]) => fn(...args), reject) as Listener;
    listenerRefs.set(channel, wrapped);
    ipcMain.on(channel, wrapped);
  };

  // ── links ────────────────────────────────────────────────────────────────
  const forgetLink = (linkId: string): void => {
    tee.drop(linkId);
    for (const [id, r] of requests) if (r.linkId === linkId) requests.delete(id);
  };
  const endLink = (linkId: string, code?: number): void => {
    if (code === undefined) shim.unregister(linkId);
    else shim.close(linkId, code);
    forgetLink(linkId);
  };
  const cancelRequest = (requestId: string): void => {
    const r = requests.get(requestId);
    if (!r) return;
    r.ctl.abort();
    endLink(r.linkId);
    requests.delete(requestId);
  };
  const cancelAll = (): void => {
    for (const id of [...requests.keys()]) cancelRequest(id);
    shim.closeAll();
  };

  shim.onEvent((ev) => {
    if (ev.kind === "data") tee.observe(ev.linkId, ev.data);
    push(CH.extEvent, ev);
    if (ev.kind === "close") forgetLink(ev.linkId);
  });

  // ── connect ──────────────────────────────────────────────────────────────
  const answer = (requestId: string, ctl: AbortController | null, ok: boolean, reason?: string): void => {
    if (ctl?.signal.aborted) return;
    const a: BrowserHostConnectAnswer = { requestId, ok, ...(reason ? { reason } : {}) };
    log(`[browser-host] connect outcome=${ok ? "ok" : reason}`);
    push(CH.connectAnswer, a);
  };

  const runConnect = async (req: ConnectRequest, r: Request): Promise<void> => {
    const { ctl } = r;
    const fail = (reason: string): void => {
      answer(req.requestId, ctl, false, reason);
      endLink(req.linkId);
      requests.delete(req.requestId);
    };
    try {
      if (!deps.chrome.canOpen()) return fail("no-chrome");

      let serverKey: ServerKey;
      try {
        const origin = target.origin();
        if (!origin) throw new Error("no target");
        const instanceId = await target.instanceId();
        if (target.origin() !== origin) throw new Error("target changed");
        serverKey = { origin, instanceId };
      } catch {
        return fail("server-unverified");
      }
      if (ctl.signal.aborted) return;

      const rows = await deps.chrome.listProfiles().catch(() => []);
      const row = rows.find((p) => p.profileDirectory === req.profileDirectory);
      // Chrome silently creates a profile for an unknown directory: only launch ones this machine has.
      if (!row) return fail("not-installed");
      const profileLabel = row.label;
      // A recent Deny holds for 60 s: a hostile or looping server cannot re-raise modal dialogs.
      const denyKey = `${serverKey.origin}|${req.profileDirectory}`;
      if ((deniedUntil.get(denyKey) ?? 0) > now()) return fail("denied");
      const decision = await requestConsent({ store: consents, dialog: deps.dialog, serverKey, serverLabel: req.serverLabel, profileDirectory: req.profileDirectory, profileLabel, signal: ctl.signal });
      if (decision === "cancelled" || ctl.signal.aborted) return;
      if (decision === "denied") {
        deniedUntil.set(denyKey, now() + DENY_COOLDOWN_MS);
        if (deniedUntil.size > 64) for (const [k, t] of deniedUntil) if (t <= now()) deniedUntil.delete(k);
        return fail("denied");
      }

      let port: number;
      try {
        port = await shim.register(req.linkId);
      } catch {
        return fail("launch-failed");
      }
      if (ctl.signal.aborted) {
        endLink(req.linkId);
        return;
      }
      const url = buildOperatorConnectUrl({ port, linkId: req.linkId, token: tokens.get(req.profileDirectory) });
      const { cmd, args } = buildChromeOpenCommand(deps.platform, req.profileDirectory, url);
      try {
        deps.launch(cmd, args);
      } catch (e) {
        log(`[browser-host] chrome launch failed: ${(e as Error).message}`);
        return fail("launch-failed");
      }
      r.settled = true;
      answer(req.requestId, ctl, true);
    } catch (e) {
      log(`[browser-host] connect failed: ${(e as Error).message}`);
      fail("launch-failed");
    }
  };

  const startConnect = (payload: unknown): void => {
    const req = parseConnect(payload);
    const rawId = obj(payload)?.requestId;
    if (!req) {
      if (str(rawId, 128)) answer(rawId, null, false, "invalid");
      return;
    }
    const pending = [...requests.values()].filter((x) => !x.settled).length;
    if (requests.has(req.requestId) || [...requests.values()].some((x) => x.linkId === req.linkId)) return void answer(req.requestId, null, false, "invalid");
    if (pending >= MAX_PENDING_CONNECTS || requests.size >= MAX_LINKS) return void answer(req.requestId, null, false, "host-busy");
    const r: Request = { linkId: req.linkId, ctl: new AbortController(), settled: false };
    requests.set(req.requestId, r);
    void runConnect(req, r);
  };

  // ── window lifecycle ─────────────────────────────────────────────────────
  const resetCarrier = (): void => {
    cancelAll();
    target.clear();
  };

  const attachWindow = (next: HostWindow): void => {
    detachWindow?.();
    win = next;
    const onNavigate = (...args: unknown[]): void => {
      const d = obj(args[0]);
      const isMain = typeof d?.isMainFrame === "boolean" ? d.isMainFrame : args[3] === true;
      const sameDoc = typeof d?.isSameDocument === "boolean" ? d.isSameDocument : args[2] === true;
      if (isMain && !sameDoc) resetCarrier();
    };
    const onGone = (): void => resetCarrier();
    next.webContents.on("did-start-navigation", onNavigate);
    next.webContents.on("did-navigate", onGone); // backstop: commit of a top-level (non in-page) navigation
    next.webContents.on("render-process-gone", onGone);
    next.webContents.on("destroyed", onGone);
    next.on("closed", onGone);
    detachWindow = () => {
      next.webContents.removeListener("did-start-navigation", onNavigate);
      next.webContents.removeListener("did-navigate", onGone);
      next.webContents.removeListener("render-process-gone", onGone);
      next.webContents.removeListener("destroyed", onGone);
      next.removeListener("closed", onGone);
      if (win === next) win = null;
    };
    resetCarrier(); // a freshly attached window owns no links
  };

  // ── channels ─────────────────────────────────────────────────────────────
  handle(CH.identity, () => identity.identity());
  handle(CH.sign, (nonce, serverId) => identity.sign(nonce as string, serverId as string));
  handle(CH.setTarget, (origin) => {
    const before = target.origin();
    target.set(origin);
    if (target.origin() !== before) cancelAll(); // links belong to the previous server
  });
  handle(CH.connect, (payload) => startConnect(payload));
  handle(CH.cancelConnect, (requestId) => {
    if (typeof requestId === "string") cancelRequest(requestId);
  });
  handle(CH.setToken, (profileDirectory, token) => {
    if (typeof profileDirectory !== "string" || (token !== null && typeof token !== "string")) throw new Error("invalid arguments");
    tokens.set(profileDirectory, token as string | null);
  });
  handle(CH.listConsents, () => consents.list());
  handle(CH.revokeConsent, (key) => {
    if (typeof key === "string") consents.revoke(key);
  });

  listen(CH.extSend, (linkId, data) => {
    if (typeof linkId === "string" && typeof data === "string" && data.length <= MAX_FRAME) shim.send(linkId, data);
  });
  listen(CH.extClose, (linkId, code) => {
    if (typeof linkId === "string" && typeof code === "number") endLink(linkId, code);
  });
  listen(CH.tee, (linkId, instanceId, tabId, on) => {
    if (typeof linkId !== "string" || !str(instanceId, 128) || typeof tabId !== "number" || !Number.isInteger(tabId) || typeof on !== "boolean") return;
    if (on && !shim.has(linkId)) return;
    tee.set(linkId, instanceId, tabId, on);
  });

  return {
    attachWindow,
    revokeAll() {
      const n = consents.revokeAll();
      log(`[browser-host] revoked ${n} consent(s)`);
      return n;
    },
    dispose() {
      resetCarrier();
      detachWindow?.();
      detachWindow = null;
      win = null;
      for (const c of [CH.identity, CH.sign, CH.setTarget, CH.connect, CH.cancelConnect, CH.setToken, CH.listConsents, CH.revokeConsent]) ipcMain.removeHandler(c);
      for (const [c, l] of listenerRefs) ipcMain.removeListener(c, l);
      listenerRefs.clear();
    },
  };
}
