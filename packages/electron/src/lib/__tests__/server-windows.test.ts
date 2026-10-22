/**
 * Server-window lifecycle against fake Electron ports.
 * See change: add-electron-server-windows (test-plan E13, E20, E23–E32, P3, X6, X9).
 */
import nodeCrypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectingState } from "../pairing-client.js";
import type { DiscoveredEntry } from "../server-discovery.js";
import { loadKeyring, type ServerKeyring } from "../server-keyring.js";
import {
  classifyExchange,
  composeTitle,
  createServerWindows,
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
  clearStorageData = async () => void this.cleared++;
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
      loadURL: async (u: string) => void this.loaded.push(u),
      getURL: () => this.loaded.at(-1) ?? "",
      executeJavaScript: async (code: string) => void this.scripts.push(code),
    };
  }
  on = (e: string, fn: (...a: any[]) => void) => this.ev.on(e, fn);
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimized;
  close = vi.fn(() => {
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
  codeSessions: Array<{ submitCode: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; resolve: (r: unknown) => void }>;
}

let dir: string;
let rig: Rig;

function makeRig(opts: { encrypt?: boolean } = {}): Rig {
  const logs: string[] = [];
  const keyring = loadKeyring({ dir, crypto: opts.encrypt === false ? { ...crypto, isEncryptionAvailable: () => false } : crypto, log: (l) => logs.push(l) });
  const sessions = new Map<string, FakeSession>();
  const windows: FakeWindow[] = [];
  const provenBy = new Map<string, string | "unreachable" | "badsig">([[ORIGIN, F]]);
  const prove = vi.fn(async (origin: string) => {
    const v = provenBy.get(origin) ?? "unreachable";
    if (v === "unreachable") return { refused: "challenge failed" };
    if (v === "badsig") return { refused: "signature invalid", identityFailure: true as const };
    return { proven: v };
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
    },
    ports,
    prove,
    log: (l) => logs.push(l),
    startPairing: startPairing as never,
    startCodePairing: startCodePairing as never,
  });
  return { keyring, sw, windows, sessions, prove, provenBy, external, notices, askNeedsPairing, connectingOpened, adverts, discovered, bounds, logs, resume, startPairing, startCodePairing, codeSessions };
}

const pairHome = (r: Rig) =>
  r.keyring.savePaired({ fingerprint: F, label: "home-imac", host: { scheme: "http", host: "192.168.16.204", port: 8000 }, bearer: BEARER, pinnedPubkey: "PUB" });

const flush = () => vi.advanceTimersByTimeAsync(0);
const partitionOf = (r: Rig) => [...r.sessions.keys()].find((k) => k.startsWith("persist:server-"))!;
const win = (r: Rig) => r.windows[0]!;
const ses = (r: Rig) => r.sessions.get(partitionOf(r))!;

beforeEach(() => {
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
    rig.provenBy.set("http://good.lan:8000", F);
    const p = rig.sw.open(F);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: true });
    const probed = rig.prove.mock.calls.map((c) => String(c[0]));
    expect(probed.some((u) => u.includes("#") || u.includes("evil"))).toBe(false);
    expect(win(rig).loaded).toEqual(["http://good.lan:8000/"]);
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

  it("X4: exchange refused (403 network_not_allowed) ⇒ needs pairing, no load, ONE dialog with Pair again/Forget", async () => {
    const part = partitionOfKeyring(rig);
    rig.sessions.set(part, Object.assign(new FakeSession(), { exchange: { status: 403, body: { error: "network_not_allowed" } } }));
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
    ses(rig).exchange = { status: 403, body: { error: "network_not_allowed" } };
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
    expect(ses(rig).cookiesRemoved).toContainEqual([`${ORIGIN}/api/`, "pi_dash_device"]);
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
