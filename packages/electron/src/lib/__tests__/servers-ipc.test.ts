/**
 * `servers:*` IPC: sender trust, payload validation, known-host restriction, push targets.
 * See change: add-electron-server-windows (test-plan E19–E21, E35, X13).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyring } from "../server-keyring.js";
import type { ServerWindows } from "../server-windows.js";
import {
  isServerWindowsSender,
  registerServersIpc,
  type ServersEvent,
  type TrustContext,
  type TrustedWindow,
  validHostPort,
} from "../servers-ipc.js";

const F = `sha256:${"A".repeat(43)}`;
const LOCAL = "http://localhost:8000";
const RC_FILE = "/app/renderer/remote-connect.html";
const CONN_FILE = "/app/renderer/connecting.html";

const mkWin = (kind: TrustedWindow["kind"], expectedFile?: string) => {
  const sent: Array<[string, unknown]> = [];
  const mainFrame = { id: `${kind}-frame` };
  const w = {
    kind,
    expectedFile,
    isDestroyed: () => false,
    webContents: { mainFrame, send: (c: string, a: unknown) => void sent.push([c, a]), isDestroyed: () => false },
  } as TrustedWindow & { sent: typeof sent };
  (w as { sent: typeof sent }).sent = sent;
  return w;
};

let main: ReturnType<typeof mkWin>;
let rc: ReturnType<typeof mkWin>;
let conn: ReturnType<typeof mkWin>;
let server: ReturnType<typeof mkWin>;
let localOrigin: string | undefined;
let ctx: TrustContext;

beforeEach(() => {
  main = mkWin("main");
  rc = mkWin("remote-connect", RC_FILE);
  conn = mkWin("connecting", CONN_FILE);
  server = mkWin("main"); // a server window is NOT in the trusted list
  localOrigin = LOCAL;
  ctx = { windows: () => [main, rc, conn], localOrigin: () => localOrigin };
});

/** Event whose senderFrame IS the sender's main frame. */
const topEvent = (w: ReturnType<typeof mkWin>, url: string): ServersEvent => {
  const frame = Object.assign(w.webContents.mainFrame as object, { url });
  return { sender: w.webContents as never, senderFrame: frame as never };
};

describe("isServerWindowsSender (E19)", () => {
  it("true only for: main top frame on local origin, remote-connect file, connecting file", () => {
    const rows: Array<[string, boolean, ServersEvent]> = [
      ["main top frame, local origin", true, topEvent(main, `${LOCAL}/`)],
      ["main subframe, same origin", false, { sender: main.webContents as never, senderFrame: { url: `${LOCAL}/frame` } as never }],
      ["remote-connect file", true, topEvent(rc, pathToFileURL(RC_FILE).href)],
      ["connecting file", true, topEvent(conn, pathToFileURL(CONN_FILE).href)],
      ["server window", false, topEvent(server, "http://192.168.16.204:8000/")],
      ["unknown window", false, { sender: { mainFrame: {} } as never, senderFrame: { url: `${LOCAL}/` } as never }],
    ];
    for (const [name, expected, e] of rows) expect(isServerWindowsSender(e, ctx), name).toBe(expected);
  });

  it("main top frame on a remote-mode origin is refused (and so is every main frame when no local origin)", () => {
    expect(isServerWindowsSender(topEvent(main, "http://192.168.16.204:8000/"), ctx)).toBe(false);
    localOrigin = undefined;
    expect(isServerWindowsSender(topEvent(main, `${LOCAL}/`), ctx)).toBe(false);
  });

  it("a bundled page showing a different file is refused; null frame is refused", () => {
    expect(isServerWindowsSender(topEvent(rc, pathToFileURL("/tmp/evil.html").href), ctx)).toBe(false);
    expect(isServerWindowsSender({ sender: rc.webContents as never, senderFrame: null }, ctx)).toBe(false);
  });

  it("a remote-connect window navigated to http:// is refused", () => {
    expect(isServerWindowsSender(topEvent(rc, "http://evil.test/"), ctx)).toBe(false);
  });
});

describe("validHostPort (E20)", () => {
  it.each([
    ["a".repeat(253), 8000, true],
    ["a".repeat(254), 8000, false],
    ["h", 1, true],
    ["h", 65535, true],
    ["h", 0, false],
    ["h", 65536, false],
    ["h", 80.5, false],
    ["h/evil", 80, false],
    ["", 80, false],
    ["h", "80", false],
  ])("host len %#", (host, port, ok) => {
    expect(validHostPort(host, port) !== null).toBe(ok);
  });
});

// ── handler wiring ────────────────────────────────────────────────────────────

function build() {
  const handlers = new Map<string, (e: ServersEvent, ...a: any[]) => unknown>();
  const listeners = new Map<string, (e: ServersEvent, ...a: any[]) => void>();
  const sw: Record<string, ReturnType<typeof vi.fn>> = {
    open: vi.fn(async () => ({ ok: true })),
    openByHostPort: vi.fn(async () => ({ ok: false, reason: "unknown_server" })),
    connectDiscovered: vi.fn(async () => ({ ok: true, pairing: true })),
    connectManual: vi.fn(async () => ({ ok: true, pairing: true })),
    pairAgain: vi.fn(async () => ({ ok: true, pairing: true })),
    forget: vi.fn(async () => ({ ok: true, message: "gone" })),
    sendRequest: vi.fn(),
    stopWaiting: vi.fn(),
    retryPairing: vi.fn(),
    connectingState: vi.fn(() => ({ phase: "proving" })),
    isOpen: vi.fn(() => false),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sipc-"));
  const keyring = loadKeyring({ dir, crypto: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() }, log: () => {} });
  keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: "192.168.16.204", port: 8000 }, bearer: "B1" });
  const closeConnecting = vi.fn();
  const logs: string[] = [];
  const ipc = registerServersIpc({
    ipcMain: { handle: (c, l) => void handlers.set(c, l), on: (c, l) => void listeners.set(c, l) },
    trust: ctx,
    serverWindows: sw as unknown as ServerWindows,
    keyring,
    discovery: { list: () => [{ key: "x", name: "x", host: "10.0.0.2", port: 8000, addresses: [], state: "not-paired" as const }] },
    recent: () => [{ url: "http://a:8000", lastUsed: "2026-10-01T00:00:00Z" }],
    closeConnecting,
    log: (l) => logs.push(l),
  });
  return { handlers, listeners, sw, ipc, closeConnecting, logs, keyring };
}

const rcEvent = () => topEvent(rc, pathToFileURL(RC_FILE).href);
const mainEvent = () => topEvent(main, `${LOCAL}/`);
const connEvent = () => topEvent(conn, pathToFileURL(CONN_FILE).href);

describe("servers:list and push targets (X13)", () => {
  it("returns paired + discovered + recent (no bearer) to trusted windows; remote-origin frames get nothing", async () => {
    const b = build();
    const r = (await b.handlers.get("servers:list")!(rcEvent())) as any;
    expect(r.paired).toEqual([expect.objectContaining({ fingerprint: F, label: "home-imac", state: "paired", shortFp: `sha256:${"A".repeat(16)}` })]);
    expect(r.discovered).toHaveLength(1);
    expect(r.recent).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("B1");
    expect(await b.handlers.get("servers:list")!(topEvent(server, "http://192.168.16.204:8000/"))).toEqual({ ok: false, reason: "untrusted" });
    expect(await b.handlers.get("servers:list")!(topEvent(main, "http://192.168.16.204:8000/"))).toEqual({ ok: false, reason: "untrusted" });
  });

  it("servers:changed goes only to trusted windows (never to a server window)", () => {
    const b = build();
    server.sent.length = 0;
    b.ipc.broadcast();
    expect(rc.sent.map((s) => s[0])).toEqual(["servers:changed"]);
    expect(conn.sent.map((s) => s[0])).toEqual(["servers:changed"]);
    expect(main.sent.map((s) => s[0])).toEqual(["servers:changed"]);
    expect(server.sent).toEqual([]);
  });

  it("servers:changed skips a main window that is no longer on the local origin (remote mode / OAuth page)", () => {
    const b = build();
    main.topUrl = () => "https://accounts.example.com/login";
    b.ipc.broadcast();
    expect(main.sent).toEqual([]);
    main.topUrl = () => `${LOCAL}/`;
    b.ipc.broadcast();
    expect(main.sent.map((s) => s[0])).toEqual(["servers:changed"]);
  });

  it("discovered rows exclude paired state; a paired row is flagged open when its window is", async () => {
    const b = build();
    b.sw.isOpen!.mockReturnValue(true);
    expect(((await b.handlers.get("servers:list")!(rcEvent())) as any).paired[0].open).toBe(true);
  });
});

describe("handlers: trust, validation, known hosts (E20, E21)", () => {
  it("manual URL is accepted from remote-connect only", async () => {
    const b = build();
    expect(await b.handlers.get("servers:connect-manual")!(rcEvent(), { url: "https://dash.lan:8443/p?q" })).toEqual({ ok: true, pairing: true });
    expect(b.sw.connectManual).toHaveBeenCalledWith("https://dash.lan:8443/p?q");
    b.sw.connectManual!.mockClear();
    expect(await b.handlers.get("servers:connect-manual")!(mainEvent(), { url: "https://dash.lan:8443" })).toEqual({ ok: false, reason: "untrusted" });
    expect(b.sw.connectManual).not.toHaveBeenCalled();
    expect(await b.handlers.get("servers:connect-manual")!(rcEvent(), { url: 5 })).toEqual({ ok: false, reason: "invalid" });
    expect(await b.handlers.get("servers:connect-manual")!(rcEvent(), { url: "   " })).toEqual({ ok: false, reason: "invalid" });
    b.sw.connectManual!.mockClear();
    await b.handlers.get("servers:connect-manual")!(rcEvent(), { url: "10.0.0.5:8000/" });
    expect(b.sw.connectManual).toHaveBeenCalledWith("http://10.0.0.5:8000");
  });

  it("fingerprint payloads are regex-validated", async () => {
    const b = build();
    for (const ch of ["servers:open", "servers:pair-again"]) {
      expect(await b.handlers.get(ch)!(rcEvent(), { fingerprint: "sha256:short" })).toMatchObject({ ok: false });
      expect(await b.handlers.get(ch)!(rcEvent(), { fingerprint: `sha256:${"A".repeat(42)}` })).toMatchObject({ ok: false });
    }
    expect(b.sw.open).not.toHaveBeenCalled();
    await b.handlers.get("servers:open")!(rcEvent(), { fingerprint: F });
    expect(b.sw.open).toHaveBeenCalledWith(F, { notify: true });
  });

  it("E21 unknown host from the main window: refused, no further effect", async () => {
    const b = build();
    expect(await b.handlers.get("servers:open-from-dashboard")!(mainEvent(), { host: "10.9.9.9", port: 22 })).toEqual({ ok: false, reason: "unknown_server" });
    expect(b.sw.openByHostPort).toHaveBeenCalledWith("10.9.9.9", 22); // resolution (known-host check) is the registry's job
    expect(await b.handlers.get("servers:open-from-dashboard")!(mainEvent(), { host: "h", port: 0 })).toEqual({ ok: false, reason: "invalid" });
  });

  it("open-from-dashboard from a same-origin iframe / remote-connect window is refused", async () => {
    const b = build();
    const iframe: ServersEvent = { sender: main.webContents as never, senderFrame: { url: `${LOCAL}/frame` } as never };
    expect(await b.handlers.get("servers:open-from-dashboard")!(iframe, { host: "h", port: 80 })).toEqual({ ok: false, reason: "untrusted" });
    expect(await b.handlers.get("servers:open-from-dashboard")!(rcEvent(), { host: "h", port: 80 })).toEqual({ ok: false, reason: "untrusted" });
    expect(b.sw.openByHostPort).not.toHaveBeenCalled();
  });

  it("same-origin iframe forgetting a server is refused; the keyring is unchanged", async () => {
    const b = build();
    const iframe: ServersEvent = { sender: main.webContents as never, senderFrame: { url: `${LOCAL}/frame` } as never };
    expect(await b.handlers.get("servers:forget")!(iframe, { fingerprint: F })).toEqual({ ok: false, reason: "untrusted" });
    expect(b.sw.forget).not.toHaveBeenCalled();
    expect(b.keyring.has(F)).toBe(true);
    expect(b.logs.some((l) => l.includes("servers:forget refused"))).toBe(true);
  });

  it("connecting-window channels reject the remote-connect window and vice versa", async () => {
    const b = build();
    expect(await b.handlers.get("servers:send-request")!(rcEvent(), { deviceName: "x" })).toEqual({ ok: false, reason: "untrusted" });
    expect(await b.handlers.get("servers:send-request")!(connEvent(), { deviceName: "Laptop" })).toEqual({ ok: true });
    expect(b.sw.sendRequest).toHaveBeenCalledWith("Laptop");
    expect(await b.handlers.get("servers:stop-waiting")!(connEvent())).toEqual({ ok: true });
    expect(b.sw.stopWaiting).toHaveBeenCalled();
    expect(await b.handlers.get("servers:connect")!(connEvent(), { key: "k" })).toEqual({ ok: false, reason: "untrusted" });
    expect(await b.handlers.get("servers:connecting-ready")!(connEvent())).toEqual({ phase: "proving" });
    expect(await b.handlers.get("servers:connecting-ready")!(rcEvent())).toEqual({ ok: false, reason: "untrusted" });
  });

  it("pair-again from the connecting window retries; from remote-connect it needs a fingerprint", async () => {
    const b = build();
    await b.handlers.get("servers:pair-again")!(connEvent());
    expect(b.sw.retryPairing).toHaveBeenCalled();
    await b.handlers.get("servers:pair-again")!(rcEvent(), { fingerprint: F });
    expect(b.sw.pairAgain).toHaveBeenCalledWith(F);
  });

  it("connecting-close only from the connecting window", () => {
    const b = build();
    b.listeners.get("servers:connecting-close")!(rcEvent());
    expect(b.closeConnecting).not.toHaveBeenCalled();
    b.listeners.get("servers:connecting-close")!(connEvent());
    expect(b.closeConnecting).toHaveBeenCalled();
  });

  it("device-name payload must be a string within bounds", async () => {
    const b = build();
    expect(await b.handlers.get("servers:send-request")!(connEvent(), { deviceName: 5 })).toEqual({ ok: false });
    expect(await b.handlers.get("servers:send-request")!(connEvent(), { deviceName: "x".repeat(2000) })).toEqual({ ok: false });
  });
});

describe("no mode / MRU change (E35)", () => {
  it("servers:connect and manual open never touch wizard-state or relaunch", async () => {
    vi.resetModules();
    const wizard = await import("../wizard-state.js");
    const write = vi.spyOn(wizard, "writeModeFile");
    const add = vi.spyOn(wizard, "addRecentRemote");
    const b = build();
    await b.handlers.get("servers:connect")!(rcEvent(), { key: "x" });
    await b.handlers.get("servers:connect-manual")!(rcEvent(), { url: "http://10.0.0.5:8000" });
    expect(write).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});

