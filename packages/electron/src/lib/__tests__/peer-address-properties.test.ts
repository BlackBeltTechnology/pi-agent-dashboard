/**
 * Properties of host selection over generated interface tables and adverts
 * (seeded generator, no new dependency). For ANY layout:
 *   G1  F proven somewhere before the deadline ⇒ the window is live at a literal that proved F, no mismatch
 *   G2  every `/api/device-session` request targets a literal that proved F
 *   G3  no mismatch when no candidate proved P/invalid; a mismatch whenever P answered and none proved F
 *
 * See change: harden-peer-address-identity (test-plan #E17). Rig modelled on `server-windows.test.ts`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyring } from "../server-keyring.js";
import { createServerWindows, type ServerWindowLike, type ServerWindowPorts, type SessionLike } from "../server-windows.js";

const F = `sha256:${"A".repeat(43)}`;
const L = `sha256:${"L".repeat(43)}`;
const P = `sha256:${"P".repeat(43)}`;
const BEARER = "B1-secret";
const SEEDS = 500;

const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s).reverse(),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
};

/** mulberry32: small, deterministic, no dependency. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const originOf = (lit: string) => `http://${lit.includes(":") ? `[${lit}]` : lit}:8000`;

interface Layout {
  ifaces: Record<string, unknown[]>;
  literals: string[];
  answers: Map<string, string | "unreachable">;
  fIndexes: number[];
}

function generate(seed: number): Layout {
  const rnd = prng(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const v4 = (net: string, host: number) => `${net}.${host}`;
  const lanPool = [v4("192.168.16", 203), v4("192.168.16", 204), v4("192.168.17", 9), v4("172.16.184", 1), v4("10.9.9", 9), v4("100.83.251", 119)];
  const v6Pool = ["2001:db8:0:1::5", "2001:db8:0:ff::1", "2001:db8:1::1", "fd00::7"];
  const ifaceChoices = [
    { address: "192.168.16.220", netmask: "255.255.255.0", family: "IPv4", cidr: "192.168.16.220/24" },
    { address: "192.168.64.1", netmask: "255.255.255.0", family: "IPv4", cidr: "192.168.64.1/24" }, // shared bridge IP
    { address: "10.0.0.5", netmask: "255.0.0.0", family: "IPv4", cidr: "10.0.0.5/8" }, // VPN /8 overlapping the LAN space
    { address: "100.83.251.119", netmask: "255.255.255.255", family: "IPv4", cidr: "100.83.251.119/32" },
    { address: "2001:db8:0:1::5", netmask: "ffff:ffff:ffff:ff00::", family: "IPv6", cidr: "2001:db8:0:1::5/56" },
    { address: "fd00::1", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", cidr: "fd00::1/64" },
  ];
  const ifaceCount = 2 + Math.floor(rnd() * 5);
  const ifaces: Record<string, unknown[]> = {};
  const own: string[] = [];
  for (let i = 0; i < ifaceCount; i++) {
    const c = pick(ifaceChoices);
    ifaces[`if${i}`] = [{ ...c, internal: false, mac: "aa:bb:cc:dd:ee:01" }];
    own.push(c.address);
  }
  const ipv6Only = rnd() < 0.2;
  const pool = [...(ipv6Only ? [] : [...lanPool, ...own.filter((a) => !a.includes(":")), "192.168.64.1"]), ...v6Pool, ...own.filter((a) => a.includes(":"))];
  const n = 1 + Math.floor(rnd() * 20);
  const literals = Array.from(new Set(Array.from({ length: n }, () => pick(pool))));
  const answers = new Map<string, string | "unreachable">();
  const hasF = rnd() < 0.7;
  const fIdx = hasF ? Math.floor(rnd() * literals.length) : -1;
  literals.forEach((lit, i) => {
    if (i === fIdx) return answers.set(lit, F);
    const r = rnd();
    answers.set(lit, r < 0.35 ? L : r < 0.55 ? P : "unreachable");
  });
  return { ifaces, literals, answers, fIndexes: literals.map((l, i) => (answers.get(l) === F ? i : -1)).filter((i) => i >= 0) };
}

class Win implements ServerWindowLike {
  loaded: string[] = [];
  destroyed = false;
  handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  webContents: ServerWindowLike["webContents"];
  session: SessionLike;
  constructor(session: SessionLike) {
    this.session = session;
    this.webContents = {
      session,
      on: () => {},
      setWindowOpenHandler: () => {},
      loadURL: async (u: string) => void this.loaded.push(u),
      getURL: () => this.loaded.at(-1) ?? "",
      executeJavaScript: async () => undefined,
    };
  }
  on = (e: string, fn: (...a: unknown[]) => void) => void (this.handlers[e] ??= []).push(fn);
  isDestroyed = () => this.destroyed;
  isMinimized = () => false;
  restore = () => {};
  focus = () => {};
  close = () => {
    this.destroyed = true;
    for (const fn of this.handlers.close ?? []) fn();
    for (const fn of this.handlers.closed ?? []) fn();
  };
  setTitle = () => {};
  getBounds = () => ({ width: 1, height: 1 });
}

let dir: string;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "peer-props-"));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

interface FakeSessionState {
  fetchUrls: string[];
  cookies: { remove: () => Promise<void> };
  clearStorageData: () => Promise<void>;
  setPermissionRequestHandler: () => void;
  setPermissionCheckHandler: () => void;
  webRequest: { onCompleted: () => void };
  on: () => void;
  fetch: (url: string) => Promise<Response>;
}

function makeSession(): FakeSessionState {
  const state: FakeSessionState = {
    fetchUrls: [],
    cookies: { remove: async () => {} },
    clearStorageData: async () => {},
    setPermissionRequestHandler: () => {},
    setPermissionCheckHandler: () => {},
    webRequest: { onCompleted: () => {} },
    on: () => {},
    fetch: async (url: string) => {
      state.fetchUrls.push(url);
      return new Response("{}", { status: 200 });
    },
  };
  return state;
}

interface Harness {
  sw: ReturnType<typeof createServerWindows>;
  windows: Win[];
  notices: string[];
  sessions: Map<string, FakeSessionState>;
}

function buildHarness(lay: Layout): Harness {
  fs.rmSync(path.join(dir, "server-keyring.json"), { force: true });
  const keyring = loadKeyring({ dir, crypto, log: () => {} });
  keyring.savePaired({ fingerprint: F, label: "srv", host: { scheme: "http", host: "10.255.255.1", port: 8000 }, bearer: BEARER, pinnedPubkey: "PUB" });
  const session = makeSession();
  const sessions = new Map<string, FakeSessionState>();
  const windows: Win[] = [];
  const notices: string[] = [];
  const sessionFor = (partition: string): FakeSessionState => {
    const s = sessions.get(partition) ?? session;
    sessions.set(partition, s);
    return s;
  };
  const ports: ServerWindowPorts = {
    createWindow: (o) => {
      const w = new Win(sessionFor(o.webPreferences.partition) as never);
      windows.push(w);
      return w;
    },
    sessionFor: (p) => sessionFor(p) as never,
    openExternal: () => {},
    askNeedsPairing: async () => "close",
    notify: (_t, m) => void notices.push(m),
    openConnectingWindow: () => ({ push: () => {}, focus: () => {}, close: () => {}, isOpen: () => false }),
    bounds: { get: () => undefined, set: () => {}, remove: () => {} },
    onResume: () => () => {},
    deviceName: () => "mac",
  };
  const sw = createServerWindows({
    keyring,
    discovery: {
      advertsFor: () => [{ host: lay.literals[0]!, port: 8000, fingerprint: F, addresses: lay.literals, piPort: 0, version: "1", pid: 1, isLocal: false, source: "mdns" as const }],
      raw: () => [],
      list: () => [],
      localFp: () => L,
    },
    interfaces: () => lay.ifaces as never,
    ports,
    prove: async (origin: string) => {
      const lit = lay.literals.find((l) => originOf(l) === origin);
      const a = lit ? lay.answers.get(lit) : "unreachable";
      return !a || a === "unreachable" ? { refused: "challenge failed" } : { proven: a };
    },
    log: () => {},
  });
  return { sw, windows, notices, sessions };
}

/** G1 + G2: F proved somewhere ⇒ opened at a literal that proved F, stays there over 3 re-verifications, bearer only goes there. */
async function checkOpened(h: Harness, fLits: string[], res: { ok: boolean }): Promise<string | null> {
  if (!res.ok) return `G1 not opened (${JSON.stringify(res)})`;
  for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(60_000);
  const live = h.windows.filter((x) => !x.destroyed);
  if (live.length !== 1) return `G1 ${live.length} live windows`;
  const at = live[0]!.loaded.at(-1) ?? "";
  if (!fLits.some((l) => at === `${originOf(l)}/`)) return `G1 window at ${at}, F proves at ${fLits.join(",")}`;
  if (h.notices.length > 0) return `G1 unexpected notice ${h.notices[0]}`;
  const provesF = (url: string) => fLits.some((l) => url.startsWith(originOf(l)));
  const badFetch = [...h.sessions.values()].flatMap((s) => s.fetchUrls).find((u) => !provesF(u));
  if (badFetch) return `G2 bearer exchange at ${badFetch}`;
  const badLoad = h.windows.flatMap((w) => w.loaded).find((u) => u !== "about:blank" && !provesF(u));
  return badLoad ? `G2 loaded ${badLoad}` : null;
}

/** G3: F proved nowhere ⇒ not opened; a mismatch exactly when a foreign identity answered; no exchange. */
function checkNotOpened(h: Harness, pAnswered: boolean, res: { ok: boolean; reason?: string }): string | null {
  if (res.ok) return "opened although nothing proved F";
  if (pAnswered && res.reason !== "identity_mismatch") return `G3 P answered but reason=${res.reason}`;
  if (!pAnswered && res.reason === "identity_mismatch") return "G3 mismatch without a foreign proof";
  return [...h.sessions.values()].some((s) => s.fetchUrls.length > 0) ? "G2 exchange without a proving literal" : null;
}

async function runSeed(seed: number): Promise<string | null> {
  const lay = generate(seed);
  const h = buildHarness(lay);
  const p = h.sw.open(F);
  await vi.advanceTimersByTimeAsync(5000);
  const res = await p;
  const fLits = lay.literals.filter((l) => lay.answers.get(l) === F);
  const pAnswered = lay.literals.some((l) => lay.answers.get(l) === P);
  const failure = fLits.length > 0 ? await checkOpened(h, fLits, res) : checkNotOpened(h, pAnswered, res);
  return failure ? `seed ${seed}: ${failure}` : null;
}

describe("host selection properties over generated layouts (#E17)", () => {
  it(`G1–G3 hold for ${SEEDS} seeds`, async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const f = await runSeed(seed);
      if (f) failures.push(f);
      if (failures.length >= 5) break;
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
