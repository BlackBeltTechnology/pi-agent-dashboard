/**
 * Server-window lifecycle against fake Electron ports.
 * See change: add-electron-server-windows (test-plan E13, E20, E23–E32, P3, X6, X9).
 */
import nodeCrypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { base64urlToBytes, devbindMessage, rawEd25519PubToSpki } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeviceKey } from "../device-key.js";
import type { ConnectingState } from "../pairing-client.js";
import type { DiscoveredEntry } from "../server-discovery.js";
import { loadKeyring, type ServerKeyring } from "../server-keyring.js";
import {
  classifyExchange,
  composeTitle,
  createServerWindows,
  deviceNote,
  isLoopbackHost,
  isServerWindowPermissionAllowed,
  parseManualUrl,
  type ServerWindowLike,
  type ServerWindowOptions,
  type ServerWindowPorts,
  type SessionLike,
} from "../server-windows.js";

const F = `sha256:${"A".repeat(43)}`;
const G = `sha256:${"B".repeat(43)}`;
/** This machine's own dashboard fingerprint / any other foreign fingerprint (harden-peer-address-identity). */
const L = `sha256:${"L".repeat(43)}`;
const P = `sha256:${"P".repeat(43)}`;

/** Cross-fake event order (reset per test): clear / load / close. */
let order: string[] = [];
const ORIGIN = "http://192.168.16.204:8000";
const BEARER = "B1-secret";

const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s).reverse(),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
};

type Handlers = Record<string, Array<(...a: any[]) => void>>;
const emitter = () => {
  const h: Handlers = {};
  return {
    on: (e: string, fn: (...a: any[]) => void) => void (h[e] ??= []).push(fn),
    emit: (e: string, ...a: unknown[]) => (h[e] ?? []).forEach((fn) => fn(...a)),
    count: (e: string) => (h[e] ?? []).length,
  };
};

class FakeSession implements SessionLike {
  ev = emitter();
  cookiesRemoved: Array<[string, string]> = [];
  cleared = 0;
  fetchCalls: Array<{ url: string; init: any }> = [];
  /** scripted exchange answer */
  exchange: { status: number; body?: unknown } | "throw" = { status: 200 };
  onCompleted?: (d: { statusCode: number; url: string }) => void;
  permissionHandler?: (wc: unknown, p: string, cb: (g: boolean) => void) => void;
  cookies = {
    remove: async (url: string, name: string) => void this.cookiesRemoved.push([url, name]),
  };
  clearCalls: unknown[] = [];
  clearFails = false;
  clearStorageData = async (o?: unknown) => {
    if (this.clearFails) throw new Error("clear failed");
    this.cleared++;
    this.clearCalls.push(o);
    order.push("clear");
  };
  /** When set, the exchange waits for it (lets a test act while the exchange is in flight). */
  gate?: () => Promise<void>;
  fetch = async (url: string, init: any) => {
    this.fetchCalls.push({ url, init });
    await this.gate?.();
    if (this.exchange === "throw") throw new Error("ECONNREFUSED");
    return new Response(JSON.stringify(this.exchange.body ?? {}), { status: this.exchange.status });
  };
  setPermissionRequestHandler = (h: any) => void (this.permissionHandler = h);
  setPermissionCheckHandler = () => {};
  webRequest = { onCompleted: (_f: unknown, l: any) => void (this.onCompleted = l ?? undefined) };
  on = (e: string, fn: (...a: any[]) => void) => this.ev.on(e, fn);
}

class FakeWindow implements ServerWindowLike {
  ev = emitter();
  wcEv = emitter();
  title = "";
  destroyed = false;
  minimized = false;
  restore = vi.fn(() => void (this.minimized = false));
  focus = vi.fn();
  loaded: string[] = [];
  scripts: string[] = [];
  windowOpenHandler?: (d: { url: string }) => { action: "deny" };
  webContents: ServerWindowLike["webContents"];
  options: ServerWindowOptions;
  session: FakeSession;
  constructor(options: ServerWindowOptions, session: FakeSession) {
    this.options = options;
    this.session = session;
    this.webContents = {
      session,
      on: (e: string, fn: (...a: any[]) => void) => this.wcEv.on(e, fn),
      setWindowOpenHandler: (fn: any) => void (this.windowOpenHandler = fn),
      loadURL: async (u: string) => {
        this.loaded.push(u);
        order.push(`load:${u}`);
      },
      getURL: () => this.loaded.at(-1) ?? "",
      executeJavaScript: async (code: string) => void this.scripts.push(code),
    };
  }
  on = (e: string, fn: (...a: any[]) => void) => this.ev.on(e, fn);
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimized;
  close = vi.fn(() => {
    order.push("close");
    this.ev.emit("close");
    this.destroyed = true;
    this.ev.emit("closed");
  });
  setTitle = (t: string) => void (this.title = t);
  getBounds = () => ({ x: 10, y: 20, width: 900, height: 700 });
}

interface Rig {
  keyring: ServerKeyring;
  sw: ReturnType<typeof createServerWindows>;
  windows: FakeWindow[];
  sessions: Map<string, FakeSession>;
  prove: ReturnType<typeof vi.fn>;
  provenBy: Map<string, string | "unreachable" | "badsig">;
  external: string[];
  notices: Array<[string, string]>;
  askNeedsPairing: ReturnType<typeof vi.fn>;
  connectingOpened: ConnectingState[];
  adverts: Array<{ host: string; port: number; fingerprint?: string; addresses?: string[] }>;
  discovered: DiscoveredEntry[];
  bounds: Map<string, any>;
  logs: string[];
  resume: Array<() => void>;
  startPairing: ReturnType<typeof vi.fn>;
  startCodePairing: ReturnType<typeof vi.fn>;
  /** harden-peer-address-identity controls */
  lookup: ReturnType<typeof vi.fn>;
  lookupTable: Map<string, string[] | Error | { delayMs: number; addrs: string[] }>;
  ifaces: { value: Record<string, unknown[]> };
  local: { value: string | "none" | undefined };
  codeSessions: Array<{ submitCode: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; resolve: (r: unknown) => void }>;
  /** device-key-mutual-check: scripted device-status / device-key answers + every request made with them. */
  devFetch: ReturnType<typeof vi.fn>;
  status: { reply: unknown | "throw" | "http500" };
  bind: { status: number | "throw" };
  nonce: { value: string | undefined };
  deviceChanged: ReturnType<typeof vi.fn>;
}
const NONCE = `${"n".repeat(42)}A`;
const PAIRED_FULL = { status: "paired", scope: "full", tier: "operate" };

let dir: string;
let rig: Rig;

function makeRig(opts: { encrypt?: boolean } = {}): Rig {
  const logs: string[] = [];
  const keyring = loadKeyring({ dir, crypto: opts.encrypt === false ? { ...crypto, isEncryptionAvailable: () => false } : crypto, log: (l) => logs.push(l) });
  const sessions = new Map<string, FakeSession>();
  const windows: FakeWindow[] = [];
  const provenBy = new Map<string, string | "unreachable" | "badsig">([[ORIGIN, F]]);
  const nonce: Rig["nonce"] = { value: NONCE };
  const prove = vi.fn(async (origin: string) => {
    const v = provenBy.get(origin) ?? "unreachable";
    if (v === "unreachable") return { refused: "challenge failed" };
    if (v === "badsig") return { refused: "signature invalid", identityFailure: true as const };
    return { proven: v, ...(nonce.value ? { deviceNonce: nonce.value } : {}) };
  });
  const status: Rig["status"] = { reply: PAIRED_FULL };
  // Default: the server refuses a bind, so entries made keyless by a test stay keyless; X5 tests answer 200 explicitly.
  const bind: Rig["bind"] = { status: 500 };
  const deviceChanged = vi.fn();
  const devFetch = vi.fn(async (url: string, _init?: unknown) => {
    if (String(url).endsWith("/api/pair/device-key")) {
      if (bind.status === "throw") throw new Error("ECONNRESET");
      return new Response(JSON.stringify({ success: bind.status === 200 }), { status: bind.status });
    }
    if (status.reply === "throw") throw new Error("ECONNRESET");
    if (status.reply === "http500") return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(status.reply), { status: 200 });
  });
  const external: string[] = [];
  const notices: Array<[string, string]> = [];
  const askNeedsPairing = vi.fn(async () => "close" as const);
  const connectingOpened: ConnectingState[] = [];
  const bounds = new Map<string, any>();
  const resume: Array<() => void> = [];
  const adverts: Rig["adverts"] = [];
  const discovered: DiscoveredEntry[] = [];
  const startPairing = vi.fn((_target: unknown, _deps: unknown) => ({ send: vi.fn(), stop: vi.fn(), done: new Promise<never>(() => {}) }));
  const codeSessions: Rig["codeSessions"] = [];
  const startCodePairing = vi.fn((_target: unknown, _deps: unknown) => {
    let resolve!: (r: unknown) => void;
    const done = new Promise<unknown>((r) => (resolve = r));
    const cs = { submitCode: vi.fn(), stop: vi.fn(), resolve };
    codeSessions.push(cs);
    return { submitCode: cs.submitCode, stop: cs.stop, done };
  });
  const lookupTable: Rig["lookupTable"] = new Map();
  const lookup = vi.fn(async (h: string) => {
    const v = lookupTable.get(h);
    if (v === undefined) throw new Error("ENOTFOUND");
    if (v instanceof Error) throw v;
    if (Array.isArray(v)) return v;
    await new Promise((r) => setTimeout(r, v.delayMs));
    return v.addrs;
  });
  const ifaces: Rig["ifaces"] = { value: {} };
  const local: Rig["local"] = { value: "none" };
  const ports: ServerWindowPorts = {
    createWindow: (options) => {
      const ses = sessions.get(options.webPreferences.partition) ?? new FakeSession();
      sessions.set(options.webPreferences.partition, ses);
      const w = new FakeWindow(options, ses);
      windows.push(w);
      return w;
    },
    sessionFor: (partition) => {
      let s = sessions.get(partition);
      if (!s) sessions.set(partition, (s = new FakeSession()));
      return s;
    },
    openExternal: (u) => void external.push(u),
    askNeedsPairing,
    notify: (t, m) => void notices.push([t, m]),
    openConnectingWindow: (initial) => {
      connectingOpened.push(initial);
      let open = true;
      return { push: (s) => void connectingOpened.push(s), focus: () => {}, close: () => void (open = false), isOpen: () => open };
    },
    bounds: { get: (fp) => bounds.get(fp), set: (fp, b) => void bounds.set(fp, b), remove: (fp) => void bounds.delete(fp) },
    onResume: (cb) => {
      resume.push(cb);
      return () => {};
    },
    deviceName: () => "my-mac",
  };
  const sw = createServerWindows({
    keyring,
    discovery: {
      advertsFor: (fp) => adverts.filter((a) => a.fingerprint === fp).map((a) => ({ ...a, piPort: 0, version: "1", pid: 1, isLocal: false, source: "mdns" as const })),
      raw: () => [],
      list: () => discovered,
      localFp: () => local.value,
    },
    lookup,
    interfaces: () => ifaces.value as never,
    ports,
    prove,
    fetch: devFetch as never,
    onDeviceChange: deviceChanged,
    log: (l) => logs.push(l),
    startPairing: startPairing as never,
    startCodePairing: startCodePairing as never,
  });
  return { keyring, sw, windows, sessions, prove, provenBy, external, notices, askNeedsPairing, connectingOpened, adverts, discovered, bounds, logs, resume, startPairing, startCodePairing, lookup, lookupTable, ifaces, local, codeSessions, devFetch, status, bind, nonce, deviceChanged };
}

const pairHome = (r: Rig) =>
  r.keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: "192.168.16.204", port: 8000 }, bearer: BEARER, pinnedPubkey: "PUB" });

const flush = () => vi.advanceTimersByTimeAsync(0);
const partitionOf = (r: Rig) => [...r.sessions.keys()].find((k) => k.startsWith("persist:server-"))!;
const win = (r: Rig) => r.windows[0]!;
const ses = (r: Rig) => r.sessions.get(partitionOf(r))!;

beforeEach(() => {
  order = [];
  vi.useFakeTimers();
  vi.setSystemTime(0);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-"));
  rig = makeRig();
  pairHome(rig);
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("pure helpers (E26, E25, E13, E20)", () => {
  it("E26 classifyExchange", () => {
    expect(classifyExchange(200, {})).toBe("ok");
    expect(classifyExchange(401, {})).toBe("refused");
    expect(classifyExchange(403, { error: "network_not_allowed" })).toBe("refused");
    expect(classifyExchange(403, { error: "insufficient_scope" })).toBe("transport");
    expect(classifyExchange(404, {})).toBe("transport");
    expect(classifyExchange(500, {})).toBe("transport");
    expect(classifyExchange(null, undefined)).toBe("transport");
  });
  it("E25 permissions", () => {
    for (const p of ["clipboard-sanitized-write", "notifications", "fullscreen"]) expect(isServerWindowPermissionAllowed(p)).toBe(true);
    for (const p of ["media", "geolocation", "midi", "clipboard-read"]) expect(isServerWindowPermissionAllowed(p)).toBe(false);
  });
  it("E13 title composition strips U+202E", () => {
    expect(composeTitle("home-imac", "\u202EMain")).toBe("home-imac — Main");
    expect(composeTitle("home-imac", undefined)).toBe("home-imac");
    expect(composeTitle("home-imac", "x", "not reachable")).toBe("home-imac — not reachable");
  });
  it("E20 manual URL parsing", () => {
    expect(parseManualUrl("https://dash.lan:8443/p?q")).toEqual({ scheme: "https", host: "dash.lan", port: 8443 });
    expect(parseManualUrl("10.0.0.5:8000")).toEqual({ scheme: "http", host: "10.0.0.5", port: 8000 });
    expect(parseManualUrl("ftp://x")).toBeNull();
    expect(parseManualUrl("http://127.0.0.1:8000")).toBeNull();
    expect(parseManualUrl("http://localhost:8000")).toBeNull();
    expect(parseManualUrl("http://[::1]:8000")).toBeNull();
    // rooted names resolve to loopback too
    expect(parseManualUrl("http://localhost.:8000")).toBeNull();
    expect(parseManualUrl("http://127.0.0.1.:8000")).toBeNull();
    expect(parseManualUrl("http://x:0")).toBeNull();
    expect(parseManualUrl("http://x:65536")).toBeNull();
    expect(parseManualUrl(`http://${"a".repeat(254)}:80`)).toBeNull();
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackHost("192.168.1.1")).toBe(false);
  });
});

describe("opening (E24, E30, X1-ish)", () => {
  it("loads the server's own origin after the cookie exchange, with a hardened window", async () => {
    const p = rig.sw.open(F);
    await flush();
    expect(await p).toEqual({ ok: true });
    const w = win(rig);
    // exchange happened in the server's partition, with the bearer, redirect manual, BEFORE the load
    const s = ses(rig);
    expect(s.fetchCalls).toHaveLength(1);
    expect(s.fetchCalls[0]).toMatchObject({ url: `${ORIGIN}/api/device-session`, init: { method: "POST", redirect: "manual", headers: { Authorization: `Bearer ${BEARER}` } } });
    expect(w.loaded).toEqual([`${ORIGIN}/`]);
    // E24 posture
    expect(w.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false });
    expect(w.options.webPreferences).not.toHaveProperty("preload");
    expect(w.options.webPreferences.partition).toMatch(/^persist:server-[0-9a-f]{32}$/);
    expect(w.windowOpenHandler?.({ url: "https://example.com" })).toEqual({ action: "deny" });
    expect(w.options.title).toBe("home-imac");
  });

  it("marks the page as cookie-paired on dom-ready so its client mints a WS ticket", async () => {
    await rig.sw.open(F);
    const w = win(rig);
    w.wcEv.emit("dom-ready");
    expect(w.scripts).toHaveLength(1);
    expect(w.scripts[0]).toContain("localStorage.setItem(\"pi-dashboard:device-paired\",\"1\")");
    expect(w.scripts[0]).not.toContain(BEARER);
  });

  it("does not mark a page that is not on the server's origin", async () => {
    await rig.sw.open(F);
    const w = win(rig);
    w.loaded.push("about:blank");
    w.wcEv.emit("dom-ready");
    expect(w.scripts).toEqual([]);
  });

  it("E30 second open focuses the existing (minimized) window; no second window", async () => {
    await rig.sw.open(F);
    win(rig).minimized = true;
    await rig.sw.open(F);
    expect(rig.windows).toHaveLength(1);
    expect(win(rig).restore).toHaveBeenCalled();
    expect(win(rig).focus).toHaveBeenCalled();
  });

  it("not-remembered entry (no OS encryption): non-persistent partition, window still opens for this run", async () => {
    fs.rmSync(path.join(dir, "server-keyring.json"), { force: true });
    rig = makeRig({ encrypt: false });
    pairHome(rig);
    expect(rig.keyring.get(F)!.remembered).toBe(false);
    await rig.sw.open(F);
    expect(win(rig).options.webPreferences.partition).toMatch(/^server-[0-9a-f]{32}$/);
    expect(win(rig).loaded).toEqual([`${ORIGIN}/`]);
  });

  it("bounds are remembered on close and restored on reopen", async () => {
    await rig.sw.open(F);
    win(rig).close();
    expect(rig.bounds.get(F)).toMatchObject({ width: 900, height: 700 });
    await rig.sw.open(F);
    expect(rig.windows[1]!.options).toMatchObject({ width: 900, height: 700, x: 10, y: 20 });
    expect(rig.windows).toHaveLength(2);
    expect(rig.sw.isOpen(F)).toBe(true);
  });

  it("E31 open of an unpaired discovered server starts pairing; no server window", async () => {
    rig.discovered.push({ key: "lab-box", name: "lab-box", host: "10.0.0.9", port: 8000, addresses: [], fingerprint: G, state: "not-paired" });
    const r = await rig.sw.connectDiscovered("lab-box");
    expect(r).toEqual({ ok: true, pairing: true });
    expect(rig.connectingOpened).toHaveLength(1);
    expect(rig.windows).toHaveLength(0);
    expect(rig.startPairing.mock.calls[0]![0]).toMatchObject({ label: "lab-box", advertFp: G, ref: { host: "10.0.0.9", port: 8000 } });
  });

  it("an entry that needs pairing re-pairs instead of loading", async () => {
    rig.keyring.markNeedsPairing(F);
    expect(await rig.sw.open(F)).toEqual({ ok: true, pairing: true });
    expect(rig.windows).toHaveLength(0);
    expect(rig.startPairing.mock.calls[0]![0]).toMatchObject({ pinnedFp: F, label: "home-imac" });
  });

  it("re-pairing a server that moved targets its fresh advert, not the stale stored host", async () => {
    rig.keyring.markNeedsPairing(F);
    rig.adverts.push({ host: "192.168.16.77", port: 8000, fingerprint: F });
    await rig.sw.open(F);
    expect(rig.startPairing.mock.calls[0]![0]).toMatchObject({ pinnedFp: F, ref: { host: "192.168.16.77", port: 8000 } });
  });

  it("unknown fingerprint / unknown host:port are refused with no network", async () => {
    expect(await rig.sw.open(G)).toEqual({ ok: false, reason: "unknown_server" });
    expect(await rig.sw.openByHostPort("10.9.9.9", 22)).toEqual({ ok: false, reason: "unknown_server" });
    expect(rig.prove).not.toHaveBeenCalled();
    expect(rig.sessions.size).toBe(0);
  });

  it("openByHostPort resolves a keyring host", async () => {
    expect(await rig.sw.openByHostPort("192.168.16.204", 8000)).toEqual({ ok: true });
    expect(rig.windows).toHaveLength(1);
  });

  it("connectManual: loopback refused; known host opens; unknown starts TOFU pairing", async () => {
    expect(await rig.sw.connectManual("http://127.0.0.1:8000")).toEqual({ ok: false, reason: "invalid" });
    expect(await rig.sw.connectManual("http://192.168.16.204:8000/some/path")).toEqual({ ok: true });
    expect(rig.windows).toHaveLength(1);
    expect(await rig.sw.connectManual("https://dash.example.lan:8443/some/path")).toEqual({ ok: true, pairing: true });
    expect(rig.startPairing.mock.calls.at(-1)![0]).toMatchObject({ ref: { scheme: "https", host: "dash.example.lan", port: 8443 } });
    expect((rig.startPairing.mock.calls.at(-1)![0] as { pinnedFp?: string }).pinnedFp).toBeUndefined();
  });
});

describe("host selection and identity at open", () => {
  it("a discovered advert with a URL-significant host is never probed (audit/CodeRabbit)", async () => {
    rig.provenBy.clear();
    rig.adverts.push({ host: "attacker.example#", port: 8000, fingerprint: F, addresses: ["10.0.0.1/evil", "good.lan"] });
    rig.lookupTable.set("good.lan", ["10.1.2.3"]);
    rig.provenBy.set("http://10.1.2.3:8000", F);
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: true });
    const probed = rig.prove.mock.calls.map((c) => String(c[0]));
    expect(probed.some((u) => u.includes("#") || u.includes("evil"))).toBe(false);
    expect(win(rig).loaded).toEqual(["http://10.1.2.3:8000/"]);
  });

  it("heals a moved server: discovered host that proves F becomes most recent", async () => {
    rig.provenBy.clear();
    rig.provenBy.set("http://192.168.16.77:8000", F);
    rig.adverts.push({ host: "192.168.16.77", port: 8000, fingerprint: F });
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: true });
    expect(rig.keyring.get(F)!.lastHosts[0]).toEqual({ scheme: "http", host: "192.168.16.77", port: 8000, source: "mdns" }); // source recorded (group-servers-by-identity)
    expect(win(rig).loaded).toEqual(["http://192.168.16.77:8000/"]);
  });

  it("pinned server answers with a different identity ⇒ no credential sent, no window, pin stays, one log line", async () => {
    rig.provenBy.set(ORIGIN, G);
    const p = rig.sw.open(F, { notify: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: false, reason: "identity_mismatch" });
    expect(rig.windows).toHaveLength(0);
    expect(rig.sessions.size).toBe(0); // no partition session, hence no exchange / no bearer sent
    expect(rig.keyring.get(F)!.fingerprint).toBe(F);
    const line = rig.logs.filter((l) => l.includes("identity mismatch at open"));
    expect(line).toHaveLength(1);
    expect(line[0]).toContain("expected=sha256:AAAAAAAAAAAAAAAA");
    expect(line[0]).toContain("proven=sha256:BBBBBBBBBBBBBBBB");
    expect(line[0]).not.toContain(BEARER);
    expect(rig.notices).toHaveLength(1);
  });

  it("no host reachable ⇒ unreachable, nothing sent", async () => {
    rig.provenBy.clear();
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: false, reason: "unreachable" });
    expect(rig.sessions.size).toBe(0);
  });
});

describe("credential exchange outcomes (E26/X4/X9)", () => {
  it.each([[{ status: 500 }], ["throw" as const]])("X9: exchange %j ⇒ no load, entry unchanged, user told unreachable", async (answer) => {
    rig.sessions.set(partitionOfKeyring(rig), Object.assign(new FakeSession(), { exchange: answer }));
    const p = rig.sw.open(F, { notify: true });
    await flush();
    expect(await p).toEqual({ ok: false, reason: "unreachable" });
    expect(rig.windows).toHaveLength(0);
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false });
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
    expect(rig.notices[0]?.[1]).toMatch(/unreachable/);
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
  });

  it("X4: exchange refused (401, keyless entry) ⇒ needs pairing, no load, ONE dialog with Pair again/Forget", async () => {
    const part = partitionOfKeyring(rig);
    rig.sessions.set(part, Object.assign(new FakeSession(), { exchange: { status: 401 } }));
    const r = await (async () => {
      const p = rig.sw.open(F, { notify: true });
      await flush();
      return p;
    })();
    expect(r).toEqual({ ok: false, reason: "needs_pairing" });
    expect(rig.windows).toHaveLength(0);
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: true, pinnedPubkey: "PUB" });
    expect(rig.keyring.bearerFor(F)).toBeNull();
    expect(rig.sessions.get(part)!.cookiesRemoved).toEqual([[`${ORIGIN}/api/`, "pi_dash_device"]]);
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
    expect(rig.logs.some((l) => l.includes("credential refused") && l.includes(BEARER))).toBe(false);
  });

  it("401 at open is refused as well; choosing Forget forgets", async () => {
    const part = partitionOfKeyring(rig);
    rig.sessions.set(part, Object.assign(new FakeSession(), { exchange: { status: 401 } }));
    rig.askNeedsPairing.mockResolvedValueOnce("forget");
    const p = rig.sw.open(F);
    await flush();
    await p;
    await flush();
    expect(rig.keyring.has(F)).toBe(false);
  });
});

function partitionOfKeyring(r: Rig): string {
  // same derivation the module uses (persist: variant — entries are remembered in these tests)
  return `persist:server-${nodeCrypto.createHash("sha256").update(F).digest("hex").slice(0, 32)}`;
}

describe("navigation (E23, E34-ish)", () => {
  async function opened() {
    await rig.sw.open(F);
    return win(rig);
  }
  const navEvent = (url: string, isMainFrame = true) => ({ url, isMainFrame, preventDefault: vi.fn() });

  it("E23 off-origin redirect is cancelled; evil.test goes only through the allowlist; never loaded", async () => {
    const w = await opened();
    const ev = navEvent("http://evil.test/");
    w.wcEv.emit("will-redirect", ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(rig.external).toEqual(["http://evil.test/"]);
    expect(w.loaded.some((u) => u.includes("evil.test"))).toBe(false);
  });

  it("will-navigate: same-origin allowed; https external; mailto external; file/ms-msdt dropped", async () => {
    const w = await opened();
    const cases: Array<[string, boolean, string[]]> = [
      [`${ORIGIN}/settings`, false, []],
      ["https://example.com/", true, ["https://example.com/"]],
      ["mailto:a@b", true, ["mailto:a@b"]],
      ["file:///Applications/Calculator.app", true, []],
      ["ms-msdt:/id", true, []],
    ];
    for (const [url, prevented, external] of cases) {
      vi.setSystemTime(Date.now() + 1500); // past the per-window external-open rate limit
      rig.external.length = 0;
      const ev = navEvent(url);
      w.wcEv.emit("will-navigate", ev);
      expect(ev.preventDefault.mock.calls.length > 0, url).toBe(prevented);
      expect(rig.external, url).toEqual(external);
    }
  });

  it("subframe navigations are not restricted", async () => {
    const w = await opened();
    const ev = navEvent("https://example.com/", false);
    w.wcEv.emit("will-navigate", ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("window.open: always denied; file:// opens nothing; https goes external", async () => {
    const w = await opened();
    expect(w.windowOpenHandler!({ url: "file:///Applications/Calculator.app" })).toEqual({ action: "deny" });
    expect(rig.external).toEqual([]);
    expect(w.windowOpenHandler!({ url: "https://example.com" })).toEqual({ action: "deny" });
    expect(rig.external).toEqual(["https://example.com/"]);
  });

  it("external opens are rate-limited per window: a page cannot flood the system browser", async () => {
    const w = await opened();
    for (const u of ["https://a.test/", "https://b.test/", "https://c.test/"]) w.windowOpenHandler!({ url: u });
    expect(rig.external).toEqual(["https://a.test/"]);
    vi.setSystemTime(Date.now() + 1100);
    w.windowOpenHandler!({ url: "https://d.test/" });
    expect(rig.external).toEqual(["https://a.test/", "https://d.test/"]);
  });

  it("E13 page-title-updated: default prevented, sanitised title", async () => {
    const w = await opened();
    const ev = { preventDefault: vi.fn() };
    w.wcEv.emit("page-title-updated", ev, "\u202EMain");
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(w.title).toBe("home-imac — Main");
  });

  it("E25 permission handler wiring", async () => {
    await opened();
    const results: Record<string, boolean> = {};
    for (const p of ["clipboard-sanitized-write", "notifications", "fullscreen", "media", "geolocation"]) {
      ses(rig).permissionHandler!({}, p, (g) => (results[p] = g));
    }
    expect(results).toEqual({ "clipboard-sanitized-write": true, notifications: true, fullscreen: true, media: false, geolocation: false });
  });
});

describe("runtime credential re-check (E27–E29)", () => {
  const completed = (r: Rig, status: number) => ses(r).onCompleted!({ statusCode: status, url: `${ORIGIN}/api/x` });

  it("E27 tier refusal: re-run exchange succeeds ⇒ nothing changes (no dialog, no reload)", async () => {
    await rig.sw.open(F);
    const before = win(rig).loaded.length;
    completed(rig, 403);
    await flush();
    expect(ses(rig).fetchCalls).toHaveLength(2); // open + recheck
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false });
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
    expect(ses(rig).cookiesRemoved).toEqual([]);
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
    expect(win(rig).loaded.length).toBe(before);
  });

  it("E28 rate limit: ten 401s in a minute ⇒ one exchange; none at 299 s; second at 301 s", async () => {
    await rig.sw.open(F);
    const exchanges = () => ses(rig).fetchCalls.length - 1;
    for (let t = 0; t < 10; t++) {
      vi.setSystemTime(t * 6000);
      completed(rig, 401);
      await flush();
    }
    expect(exchanges()).toBe(1);
    vi.setSystemTime(299_000);
    completed(rig, 401);
    await flush();
    expect(exchanges()).toBe(1);
    vi.setSystemTime(301_000);
    completed(rig, 401);
    await flush();
    expect(exchanges()).toBe(2);
  });

  it("E29 refused re-check unpairs once: needs pairing, bearer gone, cookie removed, dialog exactly once", async () => {
    await rig.sw.open(F);
    ses(rig).exchange = { status: 401 };
    vi.setSystemTime(1000);
    completed(rig, 403);
    await flush();
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: true });
    expect(rig.keyring.bearerFor(F)).toBeNull();
    expect(ses(rig).cookiesRemoved).toEqual([[`${ORIGIN}/api/`, "pi_dash_device"]]);
    for (const t of [400_000, 800_000, 1_200_000]) {
      vi.setSystemTime(t);
      completed(rig, 401);
      await flush();
    }
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
    expect(ses(rig).fetchCalls).toHaveLength(2); // open + the one refused recheck
  });

  it("a refused-credential re-check first re-proves identity: a takeover gets NO bearer (blank + one report)", async () => {
    await rig.sw.open(F);
    const exchangesBefore = ses(rig).fetchCalls.length;
    rig.provenBy.set(ORIGIN, G); // address taken over; it answers 401 to everything
    ses(rig).exchange = { status: 401 };
    completed(rig, 401);
    await flush();
    expect(ses(rig).fetchCalls.length).toBe(exchangesBefore); // the bearer was never sent
    expect(win(rig).loaded.at(-1)).toBe("about:blank");
    expect(rig.notices).toHaveLength(1);
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
  });

  it("a closed window unsubscribes its listener: a later refused exchange on the same session never re-checks or prompts", async () => {
    await rig.sw.open(F);
    const s = ses(rig);
    win(rig).close();
    expect(s.onCompleted).toBeUndefined();
    // the same partition session now sees a refused exchange (e.g. a reopen after revocation)
    s.exchange = { status: 403, body: { error: "network_not_allowed" } };
    const fetches = s.fetchCalls.length;
    s.onCompleted?.({ statusCode: 403, url: `${ORIGIN}/api/device-session` });
    await flush();
    expect(s.fetchCalls.length).toBe(fetches);
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
  });

  it("a transport failure on the recheck does not unpair", async () => {
    await rig.sw.open(F);
    ses(rig).exchange = "throw";
    completed(rig, 401);
    await flush();
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false });
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
  });
});

describe("identity re-verification (P3, X6, takeover)", () => {
  it("P3: 10 interval + 1 focus(90 s) + 1 resume; focus at 30 s adds none", async () => {
    await rig.sw.open(F);
    rig.prove.mockClear();
    vi.setSystemTime(0);
    const events: Array<[number, "focus" | "resume"]> = [[30_000, "focus"], [90_000, "focus"], [200_000, "resume"]];
    let t = 0;
    for (const [at, kind] of events) {
      await vi.advanceTimersByTimeAsync(at - t);
      t = at;
      if (kind === "focus") win(rig).ev.emit("focus");
      else rig.resume.forEach((cb) => cb());
      await flush();
    }
    await vi.advanceTimersByTimeAsync(600_000 - t);
    expect(rig.prove).toHaveBeenCalledTimes(10 + 1 + 1);
  });

  it("X6: briefly unreachable ⇒ window not navigated, title says not reachable, then reverts", async () => {
    await rig.sw.open(F);
    const w = win(rig);
    const loadedBefore = w.loaded.length;
    w.wcEv.emit("page-title-updated", { preventDefault() {} }, "Main");
    expect(w.title).toBe("home-imac — Main");
    rig.provenBy.set(ORIGIN, "unreachable");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.title).toContain("not reachable");
    expect(w.loaded.length).toBe(loadedBefore);
    rig.provenBy.set(ORIGIN, F);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.title).toBe("home-imac — Main");
  });

  it("takeover: proven G ≠ F ⇒ about:blank, cookie removed, mismatch reported with short fps only", async () => {
    await rig.sw.open(F);
    rig.provenBy.set(ORIGIN, G);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(win(rig).loaded.at(-1)).toBe("about:blank");
    // every cookie of the partition goes (not just the one for this origin), awaited
    expect(ses(rig).clearCalls).toEqual([{ storages: ["cookies"] }]);
    const line = rig.logs.find((l) => l.includes("identity mismatch while open"))!;
    expect(line).toContain("sha256:AAAAAAAAAAAAAAAA");
    expect(line).toContain("sha256:BBBBBBBBBBBBBBBB");
    expect(rig.logs.join("\n")).not.toContain(BEARER);
    expect(rig.notices).toHaveLength(1);
  });

  it("a persistent impostor is reported once: timers stop, no repeated blank/dialog", async () => {
    await rig.sw.open(F);
    rig.provenBy.set(ORIGIN, G);
    await vi.advanceTimersByTimeAsync(60_000);
    const loads = win(rig).loaded.length;
    rig.prove.mockClear();
    await vi.advanceTimersByTimeAsync(600_000);
    win(rig).ev.emit("focus");
    rig.resume.forEach((cb) => cb());
    await flush();
    expect(rig.prove).not.toHaveBeenCalled();
    expect(win(rig).loaded.length).toBe(loads);
    expect(rig.notices).toHaveLength(1);
  });

  it("reopening a blanked window replaces it and re-verifies from scratch", async () => {
    await rig.sw.open(F);
    rig.provenBy.set(ORIGIN, G);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(win(rig).loaded.at(-1)).toBe("about:blank");
    rig.provenBy.set(ORIGIN, F); // the genuine server is back
    expect(await rig.sw.open(F)).toEqual({ ok: true });
    expect(win(rig).close).toHaveBeenCalled();
    expect(rig.windows).toHaveLength(2);
    expect(rig.windows[1]!.loaded).toEqual([`${ORIGIN}/`]);
  });

  it("an invalid signature at the host is a mismatch too (impostor signal)", async () => {
    await rig.sw.open(F);
    rig.provenBy.set(ORIGIN, "badsig");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(win(rig).loaded.at(-1)).toBe("about:blank");
  });

  it("closing the window stops its timers", async () => {
    await rig.sw.open(F);
    rig.prove.mockClear();
    win(rig).close();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(rig.prove).not.toHaveBeenCalled();
  });
});

describe("Forget (E32)", () => {
  it("closes the window; removes keyring + bounds; clears the partition; says the operator can revoke", async () => {
    await rig.sw.open(F);
    const r = await rig.sw.forget(F);
    expect(win(rig).close).toHaveBeenCalled();
    expect(rig.keyring.has(F)).toBe(false);
    expect(rig.bounds.has(F)).toBe(false);
    expect(ses(rig).cleared).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/operator.*revoke/);
    expect(r.message).toContain("home-imac");
  });

  it("the closing window of a forgotten server does not write its bounds back", async () => {
    await rig.sw.open(F);
    await rig.sw.forget(F);
    expect(rig.bounds.has(F)).toBe(false);
  });

  it("Forget while an open is in flight: the planted cookie is removed and nothing loads", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((r) => (release = r));
    const s = Object.assign(new FakeSession(), { gate: () => waiting });
    const part = partitionOfKeyring(rig);
    rig.sessions.set(part, s);
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(0); // host picked; the exchange is awaiting the gate
    expect(s.fetchCalls).toHaveLength(1);
    await rig.sw.forget(F);
    release();
    expect(await p).toEqual({ ok: false, reason: "unknown_server" });
    expect(rig.windows).toHaveLength(0);
    expect(s.cookiesRemoved).toContainEqual([`${ORIGIN}/api/`, "pi_dash_device"]);
  });

  it("forgetting an unknown fingerprint is a no-op", async () => {
    expect((await rig.sw.forget(G)).ok).toBe(false);
  });
});

describe("observability without secrets (X12)", () => {
  it("heal, mismatch at open, refused recheck, takeover, undecryptable + corrupt keyring: short fingerprints only, never a bearer/cookie", async () => {
    const SECRET_COOKIE = "COOKIE-VALUE-xyz";
    // heal: a moved server proves F at a new host
    rig.provenBy.clear();
    rig.provenBy.set("http://192.168.16.77:8000", F);
    rig.adverts.push({ host: "192.168.16.77", port: 8000, fingerprint: F });
    let p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    // takeover while open (X5)
    rig.provenBy.set("http://192.168.16.77:8000", G);
    await vi.advanceTimersByTimeAsync(60_000);
    rig.sw.closeAll();
    // mismatch at open (pin F, host answers G)
    p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    // refused recheck (E29) on a fresh window
    rig.provenBy.set("http://192.168.16.77:8000", F);
    p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    const s = rig.sessions.get(partitionOfKeyring(rig))!;
    s.exchange = { status: 401 };
    s.onCompleted!({ statusCode: 401, url: "x" });
    await flush();
    // undecryptable bearer + corrupt keyring files on a fresh start
    const k2dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-k2-"));
    const lines: string[] = [];
    const k = loadKeyring({ dir: k2dir, crypto, log: (l) => lines.push(l) });
    k.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: "h", port: 8000 }, bearer: SECRET_COOKIE });
    loadKeyring({ dir: k2dir, crypto: { ...crypto, decryptString: () => { throw new Error("reset"); } }, log: (l) => lines.push(l) });
    fs.writeFileSync(path.join(k2dir, "server-keyring.json"), "{");
    loadKeyring({ dir: k2dir, crypto, log: (l) => lines.push(l) });
    fs.rmSync(k2dir, { recursive: true, force: true });

    const all = [...rig.logs, ...lines].join("\n");
    for (const secret of [BEARER, SECRET_COOKIE]) expect(all).not.toContain(secret);
    // never the full fingerprint, only the short form
    expect(all).not.toContain(F);
    expect(all).not.toContain(G);
    // every [server-windows] outcome line carries a short fp (or is the set-aside line, which names a file)
    const outcome = all.split("\n").filter((l) => l.startsWith("[server-windows]") && !l.includes("set aside"));
    expect(outcome.length).toBeGreaterThanOrEqual(5);
    expect(outcome.some((l) => l.includes("identity mismatch at open"))).toBe(true);
    for (const l of outcome) expect(l, l).toMatch(/sha256:[A-Za-z0-9_-]{16}\b/);
    expect(lines.filter((l) => l.includes("set aside"))).toHaveLength(1);
  });
});

// ── group-servers-by-identity: in-app code pairing hand-off + host source (D8; task 8.3, 8.4) ──

describe("pairWithCode / submitCode (#X11, #F14 logic half)", () => {
  it("#X11: opens the Connecting window in code mode for the pinned fingerprint; the label comes from the keyring", async () => {
    expect(await rig.sw.pairWithCode(F)).toEqual({ ok: true, pairing: true });
    expect(rig.connectingOpened[0]).toMatchObject({ mode: "code", phase: "code", label: "home-imac" });
    expect(rig.startCodePairing.mock.calls[0]![0]).toMatchObject({ fingerprint: F, label: "home-imac", deviceName: "my-mac" });
    expect(rig.windows).toHaveLength(0);
  });

  it("#X11: an unpaired fingerprint is labelled from discovery, else by its short fingerprint; nothing else is accepted from the page", async () => {
    rig.discovered.push({ key: "k", name: "build-box", host: "10.0.0.9", port: 8000, addresses: [], fingerprint: G, state: "not-paired" });
    await rig.sw.pairWithCode(G);
    expect(rig.startCodePairing.mock.calls.at(-1)![0]).toMatchObject({ fingerprint: G, label: "build-box" });
    const H = `sha256:${"C".repeat(43)}`;
    await rig.sw.pairWithCode(H);
    expect(rig.startCodePairing.mock.calls.at(-1)![0]).toMatchObject({ fingerprint: H, label: expect.stringContaining("sha256:CCCCCCCCCCCCCCCC") });
  });

  it("#X11: submitCode reaches the active code session only", async () => {
    rig.sw.submitCode("pi:pair:v1.ZZ9"); // no session: ignored
    await rig.sw.pairWithCode(F);
    rig.sw.submitCode("pi:pair:v1.ZZ9");
    expect(rig.codeSessions[0]!.submitCode).toHaveBeenCalledWith("pi:pair:v1.ZZ9");
  });

  it("#X11: approval closes the Connecting window and opens the server window; no browser window is opened", async () => {
    await rig.sw.pairWithCode(F);
    rig.codeSessions[0]!.resolve({ status: "approved", fingerprint: F });
    await vi.advanceTimersByTimeAsync(10);
    expect(rig.external).toEqual([]);
    expect(rig.windows).toHaveLength(1);
  });

  it("Pair again in code mode asks for a fresh paste; a new pairing supersedes the old session", async () => {
    await rig.sw.pairWithCode(F);
    rig.sw.retryPairing();
    expect(rig.startCodePairing).toHaveBeenCalledTimes(2);
    expect(rig.codeSessions[0]!.stop).toHaveBeenCalled();
    await rig.sw.connectDiscovered("nope"); // unknown: no effect
    rig.sw.stopWaiting();
    expect(rig.codeSessions[1]!.stop).toHaveBeenCalled();
  });

  it("a knock started while a code session is active stops it, and sendRequest does not reach the code session", async () => {
    await rig.sw.pairWithCode(F);
    rig.discovered.push({ key: "lab-box", name: "lab-box", host: "10.0.0.9", port: 8000, addresses: [], fingerprint: G, state: "not-paired" });
    await rig.sw.connectDiscovered("lab-box");
    expect(rig.codeSessions[0]!.stop).toHaveBeenCalled();
    rig.sw.sendRequest("x");
    expect(rig.codeSessions[0]!.submitCode).not.toHaveBeenCalled();
  });
});

describe("pairing targets record how the host was learned (#X15)", () => {
  it("a discovered server is source mdns; a manual address is source saved; a re-pair at a fresh advert is mdns", async () => {
    rig.discovered.push({ key: "lab-box", name: "lab-box", host: "10.0.0.9", port: 8000, addresses: [], fingerprint: G, state: "not-paired" });
    await rig.sw.connectDiscovered("lab-box");
    expect(rig.startPairing.mock.calls.at(-1)![0]).toMatchObject({ source: "mdns" });
    await rig.sw.connectManual("https://dash.example.lan:8443/x");
    expect(rig.startPairing.mock.calls.at(-1)![0]).toMatchObject({ source: "saved" });
    rig.keyring.markNeedsPairing(F);
    rig.adverts.push({ host: "192.168.16.77", port: 8000, fingerprint: F });
    await rig.sw.open(F);
    expect(rig.startPairing.mock.calls.at(-1)![0]).toMatchObject({ source: "mdns" });
  });

  it("a healed discovered host is recorded as mdns", async () => {
    rig.provenBy.clear();
    rig.adverts.push({ host: "192.168.16.77", port: 8000, fingerprint: F });
    rig.provenBy.set("http://192.168.16.77:8000", F);
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(rig.keyring.get(F)!.lastHosts[0]).toMatchObject({ host: "192.168.16.77", source: "mdns" });
  });
});

// ═══ harden-peer-address-identity ═════════════════════════════════════════════
// Proof is bound to an address literal; a foreign proof is self | foreign; one re-selection transition.

const A = ORIGIN; // http://192.168.16.204:8000 — where the window is first loaded
const B_HOST = "192.168.16.203";
const B = `http://${B_HOST}:8000`;
const OWN_BRIDGE = "192.168.64.1";
const OWN = `http://${OWN_BRIDGE}:8000`;
const NAME = "pi-dashboard-31f4-8000.local";

/** A keyring whose only stored host is `host` (a hostname the advert/stored ref uses). */
function freshRig(host: { scheme: "http" | "https"; host: string; port: number }): Rig {
  fs.rmSync(path.join(dir, "server-keyring.json"), { force: true });
  const r = makeRig();
  r.keyring.savePaired({ fingerprint: F, label: "home-imac", host, bearer: BEARER, pinnedPubkey: "PUB" });
  r.provenBy.clear();
  return r;
}
const advertAt = (r: Rig, addresses: string[], host = NAME) => r.adverts.push({ host, port: 8000, fingerprint: F, addresses });

describe("proof and use are bound to one literal (#E2 #E3 #E4 #X2 #X3)", () => {
  it("#E2: a name resolving to this machine and to the server uses only the literal that proved F", async () => {
    rig = freshRig({ scheme: "http", host: NAME, port: 8000 });
    rig.local.value = L;
    rig.lookupTable.set(NAME, [OWN_BRIDGE, B_HOST]);
    rig.provenBy.set(OWN, L);
    rig.provenBy.set(B, F);
    const p = rig.sw.open(F);
    await flush();
    expect(await p).toEqual({ ok: true });
    const s = ses(rig);
    expect(s.fetchCalls.map((c) => c.url)).toEqual([`${B}/api/device-session`]);
    expect(win(rig).loaded).toEqual([`${B}/`]);
    expect(rig.keyring.get(F)!.lastHosts[0]).toMatchObject({ host: B_HOST, port: 8000 });
    // nothing was ever challenged or fetched at the name itself
    expect(rig.prove.mock.calls.map((c) => String(c[0])).some((u) => u.includes(NAME))).toBe(false);
    expect(rig.logs.some((l) => l.includes("candidate skipped") && l.includes("reason=self"))).toBe(true);
    expect(rig.notices).toEqual([]);
  });

  it.each([7, 8, 9])("#E3: a name with %i literals is probed at %i literals at most 8", async (n) => {
    rig = freshRig({ scheme: "http", host: NAME, port: 8000 });
    rig.lookupTable.set(NAME, Array.from({ length: n }, (_, i) => `10.7.0.${i + 1}`));
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: false, reason: "unreachable" });
    const probed = rig.prove.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("10.7.0."));
    expect(probed).toHaveLength(Math.min(n, 8));
    expect(probed.some((u) => u.includes("10.7.0.9"))).toBe(false);
  });

  it("#E4: an https host keeps its name — no lookup, challenge and window use the name", async () => {
    rig = freshRig({ scheme: "https", host: "studio.example", port: 443 });
    rig.provenBy.set("https://studio.example:443", F);
    const p = rig.sw.open(F);
    await flush();
    expect(await p).toEqual({ ok: true });
    expect(rig.lookup).not.toHaveBeenCalled();
    expect(ses(rig).fetchCalls[0]!.url).toBe("https://studio.example:443/api/device-session");
    expect(win(rig).loaded).toEqual(["https://studio.example:443/"]);
  });

  it("#X2: a lookup stalling past the deadline counts as unreachable; the stored literal still opens within 5 s", async () => {
    rig = freshRig({ scheme: "http", host: B_HOST, port: 8000 });
    rig.keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: NAME, port: 8000 }, bearer: BEARER, pinnedPubkey: "PUB" });
    rig.lookupTable.set(NAME, { delayMs: 6000, addrs: [OWN_BRIDGE] });
    rig.provenBy.set(B, F);
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await p).toEqual({ ok: true });
    expect(win(rig).loaded).toEqual([`${B}/`]);
  });

  it("#X3: a lookup that throws ⇒ unreachable, no mismatch, no exchange", async () => {
    rig = freshRig({ scheme: "http", host: NAME, port: 8000 });
    rig.lookupTable.set(NAME, new Error("ENOTFOUND"));
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: false, reason: "unreachable" });
    expect(rig.sessions.size === 0 || [...rig.sessions.values()].every((s) => s.fetchCalls.length === 0)).toBe(true);
    expect(rig.logs.some((l) => l.includes("identity mismatch"))).toBe(false);
  });
});

describe("candidates are ordered by locality, in batches (#E7 #E8)", () => {
  it("#E7: the working address listed after 13 off-link ones opens via the second batch", async () => {
    rig = freshRig({ scheme: "http", host: "10.255.255.1", port: 8000 });
    const offLink = Array.from({ length: 13 }, (_, i) => `10.9.0.${i + 1}`);
    advertAt(rig, [...offLink, B_HOST], "adv.invalid");
    rig.provenBy.set(B, F);
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: true });
    expect(win(rig).loaded).toEqual([`${B}/`]);
  });

  it("#E7: with an interface covering it, the working address is in the first batch (probed before the off-link tail)", async () => {
    rig = freshRig({ scheme: "http", host: "10.255.255.1", port: 8000 });
    rig.ifaces.value = { en0: [{ address: "192.168.16.220", netmask: "255.255.255.0", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:01", cidr: "192.168.16.220/24" }] };
    advertAt(rig, [...Array.from({ length: 13 }, (_, i) => `10.9.0.${i + 1}`), B_HOST], "adv.invalid");
    rig.provenBy.set(B, F);
    const p = rig.sw.open(F);
    await flush();
    expect(await p).toEqual({ ok: true });
    const probed = rig.prove.mock.calls.map((c) => String(c[0]));
    expect(probed).toContain(B);
    expect(probed.some((u) => u.includes("10.9.0.13"))).toBe(false); // second batch never started
  });

  it("#E8-window: an advert flagged local still contributes its addresses (selection ignores locality)", async () => {
    rig = freshRig({ scheme: "http", host: "10.255.255.1", port: 8000 });
    rig.adverts.push({ host: "adv.invalid", port: 8000, fingerprint: F, addresses: [B_HOST] });
    rig.provenBy.set(B, F);
    const p = rig.sw.open(F);
    await flush();
    expect(await p).toEqual({ ok: true });
  });
});

describe("foreign proofs: self vs foreign (#F8 #E1-window)", () => {
  it("#F8: own fingerprint unresolved ⇒ no notice, no mismatch, retry; once resolved the next trigger classifies self", async () => {
    await rig.sw.open(F);
    rig.local.value = undefined;
    rig.provenBy.set(A, L);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rig.notices).toEqual([]);
    expect(rig.logs.some((l) => l.includes("identity mismatch"))).toBe(false);
    expect(win(rig).loaded.at(-1)).toBe(`${A}/`); // the page stays: treated like a transport failure
    rig.local.value = L;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(win(rig).loaded.at(-1)).toBe("about:blank");
    expect(rig.notices).toEqual([]);
    expect(rig.logs.some((l) => l.includes("reason=self"))).toBe(true);
  });

  it("an advertised impostor is still foreign: P answers, nothing proves F ⇒ mismatch at open", async () => {
    rig = freshRig({ scheme: "http", host: B_HOST, port: 8000 });
    rig.local.value = L;
    rig.adverts.push({ host: "adv.invalid", port: 8000, fingerprint: P, addresses: [] }); // advert says P, pin says F
    rig.provenBy.set(B, P);
    const p = rig.sw.open(F, { notify: true });
    await flush();
    expect(await p).toEqual({ ok: false, reason: "identity_mismatch" });
    expect(rig.logs.some((l) => l.includes("foreign proof"))).toBe(true);
  });
});

/** A live window at A; address A now proves `now`; B proves F (advertised). */
async function liveAtA(aNow: string | "unreachable", opts: { bProves?: string | "unreachable" } = {}): Promise<void> {
  await rig.sw.open(F);
  rig.local.value = L;
  rig.adverts.push({ host: B_HOST, port: 8000, fingerprint: F, addresses: [] });
  if (aNow === "unreachable") rig.provenBy.delete(A);
  else rig.provenBy.set(A, aNow);
  if ((opts.bProves ?? F) !== "unreachable") rig.provenBy.set(B, opts.bProves ?? F);
}

describe("one re-selection transition (#F1–#F7, #X1, #X4)", () => {
  it("#F1: scheduled re-verification — blank, cookies cleared (awaited), old window closed, then B loaded; no notice", async () => {
    await liveAtA(L);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(order.slice(order.indexOf(`load:about:blank`))).toEqual(["load:about:blank", "clear", "close", `load:${B}/`]);
    expect(rig.windows).toHaveLength(2);
    expect(rig.windows[0]!.loaded.at(-1)).toBe("about:blank");
    expect(ses(rig).clearCalls).toEqual([{ storages: ["cookies"] }]);
    expect(rig.notices).toEqual([]);
    expect(rig.logs.some((l) => l.includes("host moved") && l.includes(A) && l.includes(B))).toBe(true);
    expect(ses(rig).fetchCalls.at(-1)!.url).toBe(`${B}/api/device-session`);
  });

  it.each(["focus", "resume"])("#F2: the %s trigger runs the same transition", async (kind) => {
    await liveAtA(L);
    vi.setSystemTime(90_000); // past the focus minimum, no interval tick fires
    if (kind === "focus") win(rig).ev.emit("focus");
    else for (const cb of rig.resume) cb();
    await flush();
    await flush();
    expect(rig.windows).toHaveLength(2);
    expect(rig.windows[1]!.loaded).toEqual([`${B}/`]);
    expect(rig.notices).toEqual([]);
  });

  it("#F3: credential path — a 401 re-proves identity first; foreign + no proving host ⇒ blanked, one notice, timers stopped, no bearer sent", async () => {
    await rig.sw.open(F);
    rig.local.value = L;
    rig.provenBy.set(A, P);
    const before = ses(rig).fetchCalls.length;
    ses(rig).onCompleted?.({ statusCode: 401, url: `${A}/api/x` });
    await flush();
    await flush();
    expect(ses(rig).fetchCalls.length).toBe(before); // no /api/device-session to A
    expect(win(rig).loaded.at(-1)).toBe("about:blank");
    expect(rig.notices).toHaveLength(1);
    expect(rig.notices[0]![1]).toMatch(/different identity/);
    const calls = rig.prove.mock.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(rig.prove.mock.calls.length).toBe(calls); // timers stopped
  });

  it("#F4: transport failure keeps the page, then moves to the host that proves F", async () => {
    await liveAtA("unreachable");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rig.windows[0]!.loaded).not.toContain("about:blank");
    expect(rig.windows).toHaveLength(2);
    expect(rig.windows[1]!.loaded).toEqual([`${B}/`]);
  });

  it("#F4: transport failure and no other host ⇒ page stays, title says not reachable, retries at the next trigger", async () => {
    await liveAtA("unreachable", { bProves: "unreachable" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rig.windows).toHaveLength(1);
    expect(win(rig).loaded).toEqual([`${A}/`]);
    expect(win(rig).title).toContain("not reachable");
    rig.provenBy.set(B, F);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rig.windows).toHaveLength(2);
  });

  it("#F5: only this machine answers ⇒ parked (blank, not reachable, no notice, timers alive); later B proves F ⇒ moved", async () => {
    await liveAtA(L, { bProves: "unreachable" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(win(rig).loaded.at(-1)).toBe("about:blank");
    expect(win(rig).title).toContain("not reachable");
    expect(rig.notices).toEqual([]);
    rig.provenBy.set(B, F);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rig.windows).toHaveLength(2);
    expect(rig.windows[1]!.loaded).toEqual([`${B}/`]);
    expect(rig.notices).toEqual([]);
  });

  it("#F6: a parked window is not focused by an open — it is replaced and re-verified from scratch", async () => {
    await liveAtA(L, { bProves: "unreachable" });
    await vi.advanceTimersByTimeAsync(60_000);
    const parked = win(rig);
    rig.provenBy.set(B, F);
    const p = rig.sw.open(F);
    await flush();
    expect(await p).toEqual({ ok: true });
    expect(parked.focus).not.toHaveBeenCalled();
    expect(parked.close).toHaveBeenCalled();
    expect(rig.windows).toHaveLength(2);
  });

  it("#F7: picking the window's own origin again is a no-op — no replacement, no cookie clear, title cleared", async () => {
    await rig.sw.open(F);
    rig.prove.mockImplementationOnce(async () => ({ refused: "challenge failed" }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rig.windows).toHaveLength(1);
    expect(ses(rig).cleared).toBe(0);
    expect(win(rig).loaded).toEqual([`${A}/`]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(win(rig).title).not.toContain("not reachable");
  });

  it("#X1: cookie removal fails ⇒ nothing loads this cycle, error logged, parked; the next trigger retries and moves", async () => {
    await liveAtA(L);
    ses(rig).clearFails = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rig.windows).toHaveLength(1);
    expect(win(rig).loaded.at(-1)).toBe("about:blank");
    expect(rig.logs.some((l) => l.includes("cookie removal failed"))).toBe(true);
    ses(rig).clearFails = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ses(rig).cleared).toBe(1);
    expect(rig.windows).toHaveLength(2);
    expect(rig.windows[1]!.loaded).toEqual([`${B}/`]);
  });

  it("#X4: the exchange at the new host is refused ⇒ needs pairing, re-pair offered, no window loads B", async () => {
    await liveAtA(L);
    ses(rig).exchange = { status: 401 };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rig.keyring.get(F)!.needsPairing).toBe(true);
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
    expect(rig.windows.flatMap((w) => w.loaded)).not.toContain(`${B}/`);
  });
});

describe("observability without secrets (#X5)", () => {
  it("skipped, foreign and moved lines are present and carry no bearer, cookie or code", async () => {
    await liveAtA(L);
    await vi.advanceTimersByTimeAsync(60_000); // F1: skipped self + moved
    rig.provenBy.set(B, P);
    rig.provenBy.set(`http://${B_HOST}:8000`, P);
    await vi.advanceTimersByTimeAsync(60_000); // B now foreign
    const all = rig.logs.join("\n");
    expect(all).toMatch(/candidate skipped host=\S+ fp=sha256:\S+ reason=self/);
    expect(all).toMatch(/foreign proof host=\S+ fp=sha256:\S+/);
    expect(all).toMatch(/host moved fp=sha256:\S+ from=\S+ to=\S+/);
    expect(all).not.toContain(BEARER);
    expect(all).not.toContain("pi_dash_device");
    expect(all).not.toMatch(/\b\d{8}\b/); // no 8-digit pairing code
  });
});

// ── device-key-mutual-check: refused exchange × device check, key-pending bind (X5–X9, X20, X21) ──

const keyHome = (r: Rig, key = generateDeviceKey()) => {
  r.keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: "192.168.16.204", port: 8000 }, bearer: BEARER, pinnedPubkey: "PUB", deviceKey: key });
  return key;
};
const partitionFor = (fp: string) => `persist:server-${nodeCrypto.createHash("sha256").update(fp).digest("hex").slice(0, 32)}`;
const scriptExchange = (r: Rig, exchange: FakeSession["exchange"], fp = F): FakeSession => {
  const s = Object.assign(new FakeSession(), { exchange });
  r.sessions.set(partitionFor(fp), s);
  return s;
};
const keyringText = () => fs.readFileSync(path.join(dir, "server-keyring.json"), "utf8");
const NNA = { status: 403, body: { error: "network_not_allowed" } } as const;
const statusUrls = (r: Rig) => r.devFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith("/api/pair/device-status"));
const openF = async (r: Rig, fp = F) => {
  const p = r.sw.open(fp, { notify: true });
  await flush();
  return p;
};

describe("X6/X20: refused exchange × device check (key held)", () => {
  beforeEach(() => {
    rig = makeRig();
    keyHome(rig);
  });

  it.each([
    ["401", { status: 401 }],
    ["403 network_not_allowed", NNA],
  ])("revoked + %s ⇒ Access removed: bearer and key kept, nothing loaded, Pair again / Forget offered", async (_n, ex) => {
    const key = rig.keyring.deviceKeyFor(F)!;
    const s = scriptExchange(rig, ex);
    rig.status.reply = { status: "revoked" };
    const before = keyringText();
    expect(await openF(rig)).toEqual({ ok: false, reason: "needs_pairing" });
    expect(rig.windows).toHaveLength(0);
    expect(keyringText()).toBe(before);
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
    expect(rig.keyring.deviceKeyFor(F)?.pub).toBe(key.pub);
    expect(s.cookiesRemoved).toEqual([]);
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
    expect(rig.askNeedsPairing).toHaveBeenCalledWith("home-imac", "access-removed");
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "access-removed" });
    expect(statusUrls(rig)).toEqual([`${ORIGIN}/api/pair/device-status`]);
  });

  it("the device-status body carries a devcheck signature over the fresh challenge's nonce", async () => {
    scriptExchange(rig, { status: 401 });
    rig.status.reply = { status: "revoked" };
    await openF(rig);
    const call = rig.devFetch.mock.calls.find((c) => String(c[0]).endsWith("/device-status"))!;
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body).toMatchObject({ deviceNonce: NONCE, pub: rig.keyring.deviceKeyFor(F)!.pub });
    expect(body.sig).toBe(rig.keyring.deviceKeyFor(F)!.signDevcheck(F, NONCE));
  });

  it("paired + 403 network_not_allowed ⇒ display-only 'network not allowed': nothing written, nothing discarded, nothing loaded", async () => {
    const s = scriptExchange(rig, NNA);
    rig.status.reply = PAIRED_FULL;
    const before = keyringText();
    const r = await openF(rig);
    expect(r).toEqual({ ok: false, reason: "unreachable" });
    expect(rig.notices[0]?.[1]).toMatch(/network not allowed/i);
    expect(rig.windows).toHaveLength(0);
    expect(keyringText()).toBe(before);
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false, keyHeld: true });
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
    expect(s.cookiesRemoved).toEqual([]);
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
    expect(rig.sw.deviceView(F)).toMatchObject({ networkNotAllowed: true });
    // the next open runs the exchange and the check again
    await openF(rig);
    expect(s.fetchCalls).toHaveLength(2);
    expect(statusUrls(rig)).toHaveLength(2);
  });

  it("paired + 401 ⇒ the open fails 'could not confirm, nothing changed'; keyring and state unchanged", async () => {
    const s = scriptExchange(rig, { status: 401 });
    rig.status.reply = PAIRED_FULL;
    const before = keyringText();
    expect(await openF(rig)).toEqual({ ok: false, reason: "unreachable" });
    expect(rig.notices[0]?.[1]).toMatch(/could not confirm/i);
    expect(rig.notices[0]?.[1]).toMatch(/nothing was changed/i);
    expect(keyringText()).toBe(before);
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
    expect(s.cookiesRemoved).toEqual([]);
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
    expect(rig.sw.deviceView(F)?.networkNotAllowed).toBeUndefined();
  });

  it.each([
    ["401", { status: 401 }],
    ["403 network_not_allowed", NNA],
  ])("unknown + %s ⇒ needs pairing: bearer, key and device cookie discarded, offered once", async (_n, ex) => {
    const s = scriptExchange(rig, ex);
    rig.status.reply = { status: "unknown" };
    expect(await openF(rig)).toEqual({ ok: false, reason: "needs_pairing" });
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: true, keyHeld: false, pinnedPubkey: "PUB" });
    expect(rig.keyring.bearerFor(F)).toBeNull();
    expect(rig.keyring.deviceKeyFor(F)).toBeNull();
    expect(s.cookiesRemoved).toEqual([[`${ORIGIN}/api/`, "pi_dash_device"]]);
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
    expect(rig.windows).toHaveLength(0);
  });

  it.each([
    ["401 bearer_expired", { status: 401, body: { error: "bearer_expired" } }],
    ["403 network_not_allowed", NNA],
  ])("expired + %s ⇒ needs pairing with the reason 'Access expired'; bearer, key and cookie discarded; offered once", async (_n, ex) => {
    const s = scriptExchange(rig, ex);
    rig.status.reply = { status: "expired" };
    expect(await openF(rig)).toEqual({ ok: false, reason: "needs_pairing" });
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: true, keyHeld: false });
    expect(rig.keyring.bearerFor(F)).toBeNull();
    expect(s.cookiesRemoved).toEqual([[`${ORIGIN}/api/`, "pi_dash_device"]]);
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
    expect(rig.askNeedsPairing).toHaveBeenCalledWith("home-imac", "access-expired");
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "access-expired" });
  });

  it("exchange ok + expired ⇒ nothing discarded, the window loads", async () => {
    scriptExchange(rig, { status: 200 });
    rig.status.reply = { status: "expired" };
    const before = keyringText();
    expect(await openF(rig)).toEqual({ ok: true });
    await flush();
    expect(win(rig).loaded).toEqual([`${ORIGIN}/`]);
    expect(keyringText()).toBe(before);
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
  });

  it.each([
    ["unverified", "unverified"],
    ["http 500", "http500"],
    ["no answer", "throw"],
  ] as const)("inconclusive check (%s) ⇒ 'could not confirm', nothing discarded or stored; the next open re-runs exchange and check", async (_n, reply) => {
    const s = scriptExchange(rig, { status: 401 });
    rig.status.reply = reply === "unverified" ? { status: "unverified" } : reply;
    const before = keyringText();
    expect(await openF(rig)).toEqual({ ok: false, reason: "unreachable" });
    expect(rig.notices[0]?.[1]).toMatch(/could not confirm/i);
    expect(keyringText()).toBe(before);
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false, keyHeld: true });
    expect(s.cookiesRemoved).toEqual([]);
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
    rig.status.reply = { status: "revoked" };
    await openF(rig);
    expect(s.fetchCalls).toHaveLength(2);
    expect(statusUrls(rig)).toHaveLength(2);
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "access-removed" });
  });

  it("an older server (no deviceNonce in the challenge) ⇒ no device-status request, the open fails 'could not confirm'", async () => {
    scriptExchange(rig, { status: 401 });
    rig.nonce.value = undefined;
    expect(await openF(rig)).toEqual({ ok: false, reason: "unreachable" });
    expect(statusUrls(rig)).toEqual([]);
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
  });

  it("an open window: 401 ⇒ re-run exchange refused ⇒ revoked ⇒ Access removed, credential kept, offered once", async () => {
    await openF(rig);
    await flush();
    const s = ses(rig);
    s.exchange = { status: 401 };
    rig.status.reply = { status: "revoked" };
    vi.setSystemTime(1000);
    s.onCompleted!({ statusCode: 401, url: `${ORIGIN}/api/x` });
    await flush();
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false, keyHeld: true });
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
    expect(rig.askNeedsPairing).toHaveBeenCalledWith("home-imac", "access-removed");
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "access-removed" });
  });

  it("an open window: refused + unknown ⇒ needs pairing, credential discarded", async () => {
    await openF(rig);
    await flush();
    const s = ses(rig);
    s.exchange = NNA;
    rig.status.reply = { status: "unknown" };
    vi.setSystemTime(1000);
    s.onCompleted!({ statusCode: 403, url: `${ORIGIN}/api/x` });
    await flush();
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: true, keyHeld: false });
    expect(rig.keyring.bearerFor(F)).toBeNull();
    expect(s.cookiesRemoved).toEqual([[`${ORIGIN}/api/`, "pi_dash_device"]]);
  });
});

describe("X7: keyless entries, non-refusals, tier refusal", () => {
  it("keyless + 401 ⇒ needs pairing, bearer discarded; no device-status request", async () => {
    const s = scriptExchange(rig, { status: 401 });
    expect(await openF(rig)).toEqual({ ok: false, reason: "needs_pairing" });
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: true });
    expect(rig.keyring.bearerFor(F)).toBeNull();
    expect(s.cookiesRemoved).toHaveLength(1);
    expect(statusUrls(rig)).toEqual([]);
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
  });

  it("keyless + 403 network_not_allowed ⇒ bearer kept, 'network not allowed', Pair again offered, nothing loaded", async () => {
    const s = scriptExchange(rig, NNA);
    const before = keyringText();
    expect(await openF(rig)).toEqual({ ok: false, reason: "unreachable" });
    expect(rig.windows).toHaveLength(0);
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false });
    expect(keyringText()).toBe(before);
    expect(s.cookiesRemoved).toEqual([]);
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
    expect(rig.askNeedsPairing).toHaveBeenCalledWith("home-imac", "network-not-allowed");
    expect(rig.sw.deviceView(F)).toMatchObject({ networkNotAllowed: true });
    expect(statusUrls(rig)).toEqual([]);
  });

  it("keyless 403 network_not_allowed ⇒ choosing Pair again starts pairing", async () => {
    scriptExchange(rig, NNA);
    rig.askNeedsPairing.mockResolvedValueOnce("pair-again");
    await openF(rig);
    await flush();
    expect(rig.startPairing).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["403 insufficient_scope", { status: 403, body: { error: "insufficient_scope" } }],
    ["403 host_not_allowed", { status: 403, body: { error: "host_not_allowed" } }],
    ["timeout / transport failure", "throw" as const],
    ["500", { status: 500 }],
  ])("keyed + %s ⇒ nothing discarded, reported unreachable, no device check", async (_n, ex) => {
    keyHome(rig);
    const s = scriptExchange(rig, ex);
    const before = keyringText();
    expect(await openF(rig)).toEqual({ ok: false, reason: "unreachable" });
    expect(rig.notices[0]?.[1]).toMatch(/unreachable/);
    expect(keyringText()).toBe(before);
    expect(s.cookiesRemoved).toEqual([]);
    expect(statusUrls(rig)).toEqual([]);
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
  });

  it("tier refusal in an open window with a succeeding re-exchange ⇒ stays Paired, no reload, no device check", async () => {
    keyHome(rig);
    await openF(rig);
    await flush();
    const loaded = win(rig).loaded.length;
    const checks = statusUrls(rig).length;
    vi.setSystemTime(1000);
    ses(rig).onCompleted!({ statusCode: 403, url: `${ORIGIN}/api/x` });
    await flush();
    expect(ses(rig).fetchCalls).toHaveLength(2);
    expect(win(rig).loaded.length).toBe(loaded);
    expect(statusUrls(rig)).toHaveLength(checks);
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false });
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "paired", tier: "operate" });
  });
});

describe("X8: re-check exchange rate limit (key held, two windows)", () => {
  it("ten 401s in a minute ⇒ one exchange; none at 4:59; one at 5:01; the second window has its own budget; no reload", async () => {
    keyHome(rig);
    rig.keyring.savePaired({ fingerprint: G, label: "work", host: { scheme: "http", host: "192.168.16.77", port: 8000 }, bearer: "B2", deviceKey: generateDeviceKey() });
    const GORIGIN = "http://192.168.16.77:8000";
    rig.provenBy.set(GORIGIN, G);
    await openF(rig, F);
    await openF(rig, G);
    await flush();
    const sf = rig.sessions.get(partitionFor(F))!;
    const sg = rig.sessions.get(partitionFor(G))!;
    const wf = rig.windows.find((w) => w.options.webPreferences.partition === partitionFor(F))!;
    const loaded = wf.loaded.length;
    const exchanges = (s: FakeSession) => s.fetchCalls.length - 1;
    for (let t = 0; t < 10; t++) {
      vi.setSystemTime(t * 6000);
      sf.onCompleted!({ statusCode: 401, url: `${ORIGIN}/api/x` });
      await flush();
    }
    expect(exchanges(sf)).toBe(1);
    expect(exchanges(sg)).toBe(0);
    vi.setSystemTime(299_000);
    sf.onCompleted!({ statusCode: 401, url: `${ORIGIN}/api/x` });
    await flush();
    expect(exchanges(sf)).toBe(1);
    vi.setSystemTime(301_000);
    sf.onCompleted!({ statusCode: 401, url: `${ORIGIN}/api/x` });
    await flush();
    expect(exchanges(sf)).toBe(2);
    sg.onCompleted!({ statusCode: 401, url: `${GORIGIN}/api/x` });
    await flush();
    expect(exchanges(sg)).toBe(1);
    expect(wf.loaded.length).toBe(loaded);
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false });
    expect(rig.askNeedsPairing).not.toHaveBeenCalled();
  });
});

describe("X9: Access removed — transitions and re-pairing", () => {
  beforeEach(() => {
    rig = makeRig();
    keyHome(rig);
  });
  const removeAccess = async () => {
    scriptExchange(rig, { status: 401 });
    rig.status.reply = { status: "revoked" };
    await openF(rig);
    rig.askNeedsPairing.mockClear();
  };

  it("operator undo: check paired + exchange ok ⇒ Paired, no pairing needed, window loads", async () => {
    await removeAccess();
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "access-removed" });
    scriptExchange(rig, { status: 200 });
    rig.status.reply = { status: "paired", scope: "full", tier: "control" };
    expect(await openF(rig)).toEqual({ ok: true });
    await flush();
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "paired", tier: "control" });
    expect(rig.startPairing).not.toHaveBeenCalled();
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
  });

  it("`unknown` alone (exchange ok) discards nothing", async () => {
    await removeAccess();
    scriptExchange(rig, { status: 200 });
    rig.status.reply = { status: "unknown" };
    await openF(rig);
    await flush();
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
    expect(rig.keyring.deviceKeyFor(F)).not.toBeNull();
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: false });
  });

  it("an Access-removed entry whose check now answers `expired` alone is unchanged", async () => {
    await removeAccess();
    const before = keyringText();
    scriptExchange(rig, { status: 200 });
    rig.status.reply = { status: "expired" };
    await openF(rig);
    await flush();
    expect(keyringText()).toBe(before);
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "access-removed" });
  });

  it("refused exchange + unknown ⇒ needs pairing, bearer and key discarded", async () => {
    await removeAccess();
    rig.status.reply = { status: "unknown" };
    await openF(rig);
    expect(rig.keyring.get(F)).toMatchObject({ needsPairing: true, keyHeld: false });
    expect(rig.keyring.bearerFor(F)).toBeNull();
    expect(rig.askNeedsPairing).toHaveBeenCalledTimes(1);
  });

  it("Pair again from Access removed starts pairing; the approval replaces the key with a new one and clears the state", async () => {
    const old = rig.keyring.deviceKeyFor(F)!;
    scriptExchange(rig, { status: 401 });
    rig.status.reply = { status: "revoked" };
    rig.askNeedsPairing.mockResolvedValueOnce("pair-again");
    let approve!: (r: unknown) => void;
    rig.startPairing.mockImplementationOnce(((_t: unknown, d: { keyring: ServerKeyring }) => {
      // The pairing client persists the new entry on approval, before it resolves `done`.
      const done = new Promise((resolve) => {
        approve = (r) => {
          d.keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: "192.168.16.204", port: 8000 }, bearer: "B2", deviceKey: generateDeviceKey() });
          resolve(r);
        };
      });
      return { send: vi.fn(), stop: vi.fn(), done };
    }) as never);
    await openF(rig);
    await flush();
    expect(rig.startPairing).toHaveBeenCalledTimes(1);
    expect((rig.startPairing.mock.calls[0]![0] as { pinnedFp?: string }).pinnedFp).toBe(F);
    // the old key is still the one held until the approval
    expect(rig.keyring.deviceKeyFor(F)?.pub).toBe(old.pub);
    scriptExchange(rig, { status: 200 });
    rig.status.reply = { status: "paired", scope: "full", tier: "operate" };
    approve({ status: "approved", fingerprint: F });
    await flush();
    expect(rig.keyring.deviceKeyFor(F)!.pub).not.toBe(old.pub);
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "paired", tier: "operate" });
  });
});

describe("X21: the check goes only to the address that proved the pin", () => {
  it("http name resolving to this machine and to the server: the check (challenge nonce + device-status) goes to the proving literal only", async () => {
    rig = freshRig({ scheme: "http", host: NAME, port: 8000 });
    keyHome(rig);
    rig.keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: NAME, port: 8000 }, bearer: BEARER, pinnedPubkey: "PUB", deviceKey: rig.keyring.deviceKeyFor(F) ?? generateDeviceKey() });
    rig.local.value = L;
    rig.lookupTable.set(NAME, [OWN_BRIDGE, B_HOST]);
    rig.provenBy.set(OWN, L);
    rig.provenBy.set(B, F);
    const s = scriptExchange(rig, { status: 401 });
    rig.status.reply = { status: "revoked" };
    await openF(rig);
    expect(s.fetchCalls.map((c) => c.url)).toEqual([`${B}/api/device-session`]);
    expect(statusUrls(rig)).toEqual([`${B}/api/pair/device-status`]);
    expect(rig.devFetch.mock.calls.every((c) => String(c[0]).startsWith(`${B}/`))).toBe(true);
    expect(rig.prove.mock.calls.at(-1)![0]).toBe(B);
    expect(rig.prove.mock.calls.some((c) => String(c[0]).includes(NAME))).toBe(false);
  });

  it("an https host keeps its name for the check", async () => {
    rig = freshRig({ scheme: "https", host: "studio.example", port: 443 });
    rig.keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "https", host: "studio.example", port: 443 }, bearer: BEARER, pinnedPubkey: "PUB", deviceKey: generateDeviceKey() });
    rig.provenBy.set("https://studio.example:443", F);
    scriptExchange(rig, { status: 401 });
    rig.status.reply = { status: "revoked" };
    await openF(rig);
    expect(statusUrls(rig)).toEqual(["https://studio.example:443/api/pair/device-status"]);
  });

  it("no literal proves the pin ⇒ no exchange, no device request of any kind", async () => {
    rig = freshRig({ scheme: "http", host: NAME, port: 8000 });
    rig.keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: NAME, port: 8000 }, bearer: BEARER, pinnedPubkey: "PUB", deviceKey: generateDeviceKey() });
    rig.lookupTable.set(NAME, [B_HOST, OWN_BRIDGE]);
    rig.provenBy.set(B, G);
    rig.provenBy.set(OWN, G);
    const s = scriptExchange(rig, { status: 401 });
    const r = await openF(rig);
    expect(r.ok).toBe(false);
    expect(rig.devFetch).not.toHaveBeenCalled();
    expect(s.fetchCalls).toEqual([]);
  });

  it("the check re-proves the identity at that literal: an impostor answering the second challenge gets nothing", async () => {
    keyHome(rig);
    scriptExchange(rig, { status: 401 });
    let n = 0;
    rig.prove.mockImplementation(async () => (++n === 1 ? { proven: F, deviceNonce: NONCE } : { proven: G, deviceNonce: NONCE }));
    expect(await openF(rig)).toEqual({ ok: false, reason: "unreachable" });
    expect(rig.devFetch).not.toHaveBeenCalled();
    expect(rig.keyring.bearerFor(F)).toBe(BEARER);
  });
});

describe("X5: key-pending bind (Electron main)", () => {
  const bindCalls = (r: Rig) => r.devFetch.mock.calls.filter((c) => String(c[0]).endsWith("/api/pair/device-key"));

  it("credential and no key: one bind per app start at the proven literal; the key is stored only on 200", async () => {
    rig.bind.status = 200;
    scriptExchange(rig, { status: 200 });
    await openF(rig);
    await flush();
    expect(bindCalls(rig)).toHaveLength(1);
    const [url, init] = bindCalls(rig)[0]! as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe(`${ORIGIN}/api/pair/device-key`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${BEARER}`);
    const body = JSON.parse(init.body);
    expect(body.deviceNonce).toBe(NONCE);
    const stored = rig.keyring.deviceKeyFor(F)!;
    expect(stored.pub).toBe(body.pub);
    expect(
      nodeCrypto.verify(
        null,
        Buffer.from(devbindMessage(F, NONCE)),
        nodeCrypto.createPublicKey({ key: Buffer.from(rawEd25519PubToSpki(base64urlToBytes(body.pub))), format: "der", type: "spki" }),
        Buffer.from(base64urlToBytes(body.sig)),
      ),
    ).toBe(true);
    expect(rig.keyring.get(F)).toMatchObject({ keyHeld: true, needsPairing: false });
    // reopening in the same app run never binds again
    win(rig).close();
    await openF(rig);
    await flush();
    expect(bindCalls(rig)).toHaveLength(1);
  });

  it.each([
    ["500", 500],
    ["409 key_held", 409],
    ["400", 400],
    ["401", 401],
    ["network error", "throw" as const],
  ])("a failed bind (%s) stores nothing and is not retried in this run; the next start tries once more", async (_n, st) => {
    scriptExchange(rig, { status: 200 });
    rig.bind.status = st;
    await openF(rig);
    await flush();
    expect(bindCalls(rig)).toHaveLength(1);
    expect(rig.keyring.get(F)).toMatchObject({ keyHeld: false });
    win(rig).close();
    await openF(rig);
    await flush();
    vi.advanceTimersByTime(10 * 60_000);
    await flush();
    expect(bindCalls(rig)).toHaveLength(1);
    // next app start: a fresh instance over the same keyring file
    const next = makeRig();
    next.sessions.set(partitionFor(F), Object.assign(new FakeSession(), { exchange: { status: 200 } }));
    await openF(next);
    await flush();
    expect(bindCalls(next)).toHaveLength(1);
  });

  it("an entry that already holds a key never binds", async () => {
    rig = makeRig();
    keyHome(rig);
    scriptExchange(rig, { status: 200 });
    await openF(rig);
    await flush();
    expect(bindCalls(rig)).toEqual([]);
  });

  it("a refused exchange never binds", async () => {
    scriptExchange(rig, { status: 401 });
    await openF(rig);
    await flush();
    expect(bindCalls(rig)).toEqual([]);
  });

  it("the bind (challenge + request) goes only to the literal that proved the pin", async () => {
    rig = freshRig({ scheme: "http", host: NAME, port: 8000 });
    rig.local.value = L;
    rig.lookupTable.set(NAME, [OWN_BRIDGE, B_HOST]);
    rig.provenBy.set(OWN, L);
    rig.provenBy.set(B, F);
    rig.bind.status = 200;
    scriptExchange(rig, { status: 200 });
    await openF(rig);
    await flush();
    expect(bindCalls(rig).map((c) => String(c[0]))).toEqual([`${B}/api/pair/device-key`]);
    expect(rig.prove.mock.calls.at(-1)![0]).toBe(B);
  });

  it("an https host keeps its name for the bind", async () => {
    rig = freshRig({ scheme: "https", host: "studio.example", port: 443 });
    rig.provenBy.set("https://studio.example:443", F);
    rig.bind.status = 200;
    scriptExchange(rig, { status: 200 });
    await openF(rig);
    await flush();
    expect(bindCalls(rig).map((c) => String(c[0]))).toEqual(["https://studio.example:443/api/pair/device-key"]);
  });

  it("a bind whose fresh challenge proves another identity sends nothing", async () => {
    scriptExchange(rig, { status: 200 });
    let n = 0;
    rig.prove.mockImplementation(async () => (++n === 1 ? { proven: F, deviceNonce: NONCE } : { proven: G, deviceNonce: NONCE }));
    await openF(rig);
    await flush();
    expect(bindCalls(rig)).toEqual([]);
    expect(rig.keyring.get(F)).toMatchObject({ keyHeld: false });
  });
});

describe("deviceNote (Servers menu words)", () => {
  it("names only the states that need words", () => {
    expect(deviceNote(undefined)).toBeUndefined();
    expect(deviceNote({ state: "paired", tier: "operate" })).toBeUndefined();
    expect(deviceNote({ state: "access-removed" })).toBe("access removed");
    expect(deviceNote({ state: "access-expired" })).toBe("access expired");
    expect(deviceNote({ state: "paired", networkNotAllowed: true })).toBe("network not allowed");
  });
});

describe("device row state for the servers list (deviceView)", () => {
  beforeEach(() => {
    rig = makeRig();
    keyHome(rig);
  });
  const after = async (exchange: FakeSession["exchange"], reply: unknown) => {
    scriptExchange(rig, exchange);
    rig.status.reply = reply;
    await openF(rig);
    await flush();
    return rig.sw.deviceView(F);
  };

  it("nothing before any check", () => expect(rig.sw.deviceView(F)).toBeUndefined());
  it("paired full ⇒ paired + tier", async () => expect(await after({ status: 200 }, { status: "paired", scope: "full", tier: "control" })).toEqual({ state: "paired", tier: "control" }));
  it("paired status-only", async () => expect(await after({ status: 200 }, { status: "paired", scope: "status-only" })).toEqual({ state: "paired-status-only" }));
  it("revoked ⇒ access-removed", async () => expect(await after({ status: 401 }, { status: "revoked" })).toMatchObject({ state: "access-removed" }));
  it("refused + expired ⇒ access-expired", async () => expect(await after({ status: 401 }, { status: "expired" })).toMatchObject({ state: "access-expired" }));
  it("inconclusive ⇒ status-unknown", async () => expect(await after({ status: 200 }, "throw")).toMatchObject({ state: "status-unknown" }));
  it("credential and no key ⇒ key-pending once a check has run", async () => {
    rig = makeRig();
    rig.keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: "192.168.16.204", port: 8000 }, bearer: BEARER, pinnedPubkey: "PUB" });
    scriptExchange(rig, NNA);
    await openF(rig);
    expect(rig.sw.deviceView(F)).toMatchObject({ state: "key-pending", networkNotAllowed: true });
  });
  it("a changed view tells the Servers list / menu", async () => {
    await after({ status: 401 }, { status: "revoked" });
    expect(rig.deviceChanged).toHaveBeenCalled();
  });
  it("no private key or bearer in the view", async () => {
    const v = await after({ status: 200 }, PAIRED_FULL);
    expect(JSON.stringify(v)).not.toMatch(/priv|BEARER|B1-secret/i);
  });
});
