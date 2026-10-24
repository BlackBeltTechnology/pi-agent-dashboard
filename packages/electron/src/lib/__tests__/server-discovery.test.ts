/**
 * Pure helpers + discovery wrapper for Electron server windows.
 * See change: add-electron-server-windows (test-plan E1, E12, E14–E18, P1, P2).
 */
import { EventEmitter } from "node:events";
import type { DashboardBrowser, DiscoveredServer } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { type RankableRoute, rankRoutes } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCandidates,
  createServerDiscovery,
  describeDiscovered,
  expandRef,
  identityVerdict,
  isFingerprint,
  orderByLocality,
  partitionFor,
  pickVerifiedHost,
  resolveExpectedFingerprint,
  sanitizeDisplayName,
  serverOrigin,
  shortFingerprint,
} from "../server-discovery.js";

const b64 = (c: string) => c.repeat(43);
const F = `sha256:${b64("A")}`;
const G = `sha256:${b64("B")}`;

describe("resolveExpectedFingerprint / identityVerdict (E1)", () => {
  const cases: Array<[string | undefined, string | undefined, string, string]> = [
    [F, G, F, "mismatch"], // pin ≠ advert ⇒ never knock
    [F, G, "unreachable", "mismatch"],
    [undefined, undefined, F, "tofu-confirm"],
    [undefined, undefined, "unreachable", "unverifiable"],
    [F, undefined, G, "mismatch"], // proven ≠ expected
    [undefined, F, G, "mismatch"],
    [F, F, "unreachable", "unverifiable"],
    [F, F, F, "proceed"],
    [F, undefined, F, "proceed"],
    [undefined, F, F, "proceed"],
  ];
  it.each(cases)("pin=%s advert=%s proven=%s ⇒ %s", (pin, advert, proven, verdict) => {
    expect(identityVerdict({ pin, advert, proven })).toBe(verdict);
  });
  it("resolveExpected: mismatch carries both", () => {
    expect(resolveExpectedFingerprint(F, G)).toEqual({ kind: "mismatch", pin: F, advert: G });
    expect(resolveExpectedFingerprint(undefined, undefined)).toEqual({ kind: "tofu" });
  });
});

describe("sanitizeDisplayName (E12)", () => {
  it("63/64/65 byte ASCII", () => {
    expect(sanitizeDisplayName("a".repeat(63), "h")).toHaveLength(63);
    expect(sanitizeDisplayName("a".repeat(64), "h")).toHaveLength(64);
    expect(sanitizeDisplayName("a".repeat(65), "h")).toHaveLength(64);
  });
  it("64-byte boundary never splits a 3-byte char", () => {
    const s = sanitizeDisplayName(`${"a".repeat(63)}€`, "h"); // 63 + 3 bytes
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(64);
    expect(s).toBe("a".repeat(63));
  });
  it("strips U+202E and zero-width; zero-width-only falls back to host", () => {
    expect(sanitizeDisplayName("\u202Ecod.exe", "h")).not.toContain("\u202E");
    expect(sanitizeDisplayName("\u200B", "host-a")).toBe("host-a");
    expect(sanitizeDisplayName(undefined, "host-a")).toBe("host-a");
  });
});

const advert = (o: Partial<DiscoveredServer>): DiscoveredServer => ({
  host: "192.168.16.204", port: 8000, piPort: 9999, version: "1", pid: 1, isLocal: false, source: "mdns", ...o,
});

describe("describeDiscovered (E14)", () => {
  it("drops local, labels clones, marks states", () => {
    const entries = describeDiscovered(
      [
        advert({ isLocal: true, fingerprint: F, instance: "a" }),
        advert({ host: "192.168.16.9", fingerprint: F, instance: "b", name: "clone" }),
        advert({ fingerprint: G, instance: "c", name: "\u202Ehome-imac" }),
        advert({ host: "10.0.0.2", instance: "d" }),
      ],
      { isPaired: () => false, localFp: F },
    );
    expect(entries.map((e) => e.key)).toEqual(["b", "c", "d"]);
    expect(entries[0]).toMatchObject({ state: "not-paired", note: "same identity as this dashboard" });
    expect(entries[1]).toMatchObject({ name: "home-imac", state: "not-paired" });
    expect(entries[1]?.note).toBeUndefined();
    expect(entries[2]).toMatchObject({ state: "identity-not-advertised", name: "10.0.0.2" });
  });
  it("paired fingerprint is flagged", () => {
    const [e] = describeDiscovered([advert({ fingerprint: G })], { isPaired: (fp) => fp === G });
    expect(e?.state).toBe("paired");
  });
});

describe("createServerDiscovery (E15)", () => {
  function fakeBrowser(servers: DiscoveredServer[]): DashboardBrowser {
    const b = new EventEmitter() as DashboardBrowser;
    b.servers = new Map(servers.map((s, i) => [String(i), s]));
    b.sweep = async () => {};
    b.stop = vi.fn();
    return b;
  }
  it("remote mode (no proveLocal) never learns a localFp", async () => {
    const d = createServerDiscovery({ createBrowser: () => fakeBrowser([advert({ fingerprint: F })]), isPaired: () => false });
    await d.resolveLocalFp();
    expect(d.list()[0]?.note).toBeUndefined();
  });
  it("local mode labels a clone after resolveLocalFp; stop() stops the browser", async () => {
    const browser = fakeBrowser([advert({ fingerprint: F })]);
    const proveLocal = vi.fn(async () => F);
    const onChange = vi.fn();
    const d = createServerDiscovery({ createBrowser: () => browser, proveLocal, isPaired: () => false, onChange });
    await d.resolveLocalFp();
    expect(proveLocal).toHaveBeenCalledOnce();
    expect(d.list()[0]?.note).toBe("same identity as this dashboard");
    expect(onChange).toHaveBeenCalled();
    d.stop();
    expect(browser.stop).toHaveBeenCalled();
  });
});

describe("shortFingerprint / isFingerprint (E16)", () => {
  it("sha256: + first 16 chars", () => {
    expect(shortFingerprint(F)).toBe(`sha256:${"A".repeat(16)}`);
  });
  it("42-char body is not a fingerprint; 43 is", () => {
    expect(isFingerprint(`sha256:${"A".repeat(42)}`)).toBe(false);
    expect(isFingerprint(F)).toBe(true);
    expect(isFingerprint(`sha256:${"A".repeat(42)}!`)).toBe(false);
  });
});

describe("partitionFor (E17)", () => {
  it("persist: only when remembered; stable per fp; 32 hex", () => {
    expect(partitionFor(F, true)).toMatch(/^persist:server-[0-9a-f]{32}$/);
    expect(partitionFor(F, false)).toMatch(/^server-[0-9a-f]{32}$/);
    expect(partitionFor(F, true)).toBe(partitionFor(F, true));
    expect(partitionFor(F, true)).not.toBe(partitionFor(G, true));
  });
});

describe("serverOrigin (E18)", () => {
  it("brackets IPv6", () => {
    expect(serverOrigin({ scheme: "http", host: "fe80::1", port: 8000 })).toBe("http://[fe80::1]:8000");
    expect(serverOrigin({ scheme: "http", host: "192.168.16.204", port: 8000 })).toBe("http://192.168.16.204:8000");
    expect(serverOrigin({ scheme: "https", host: "dash.lan", port: 8443 })).toBe("https://dash.lan:8443");
  });
});

describe("buildCandidates / pickVerifiedHost (P1, P2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const ref = (host: string, scheme: "http" | "https" = "http") => ({ scheme, host, port: 8000 });

  it("orders stored https → stored http → discovered; dedupes; no hard cap (batching bounds the probing)", () => {
    const c = buildCandidates(
      [ref("s1"), ref("s2", "https")],
      [ref("d1"), ref("d2"), ref("s1"), ref("d3"), ref("d4")],
    );
    expect(c.map((x) => x.ref.host)).toEqual(["s2", "s1", "d1", "d2", "d3", "d4"]);
    expect(c.map((x) => x.source)).toEqual(["stored", "stored", "discovered", "discovered", "discovered", "discovered"]);
  });

  it("P1: 5 stalled stored + 3 discovery, 3rd proves after 300 ms ⇒ discovery host within 5 s; all started concurrently", async () => {
    const candidates = buildCandidates(
      [1, 2, 3, 4, 5].map((i) => ref(`srv${i}`)),
      [ref("disc1"), ref("disc2"), ref("disc3")],
    );
    const started: string[] = [];
    const challenge = (origin: string): Promise<boolean> => {
      started.push(origin);
      if (origin.includes("disc3")) return new Promise((r) => setTimeout(() => r(true), 300));
      if (origin.includes("disc1") || origin.includes("disc2")) return Promise.resolve(false);
      return new Promise<boolean>(() => {});
    };
    const p = pickVerifiedHost(candidates, challenge);
    expect(started).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(5000);
    const picked = await p;
    expect(picked?.ref.host).toBe("disc3");
  });

  it("resolves early once the best remaining candidate is decided", async () => {
    const candidates = buildCandidates([ref("a"), ref("b")], []);
    const p = pickVerifiedHost(candidates, async (o) => o.includes("//a"));
    expect((await p)?.ref.host).toBe("a");
  });

  it("P2: all stall ⇒ null at 5000 ms", async () => {
    const candidates = buildCandidates([ref("a"), ref("b")], [ref("d")]);
    const p = pickVerifiedHost(candidates, () => new Promise<boolean>(() => {}));
    let settled = false;
    p.then(() => {
      settled = true;
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(4950);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toBeNull();
  });

  it("all rejected ⇒ null immediately; empty ⇒ null", async () => {
    expect(await pickVerifiedHost(buildCandidates([ref("a")], []), async () => false)).toBeNull();
    expect(await pickVerifiedHost([], async () => true)).toBeNull();
  });
});

describe("describeDiscovered bounds (audit)", () => {
  it("caps entries and per-advert addresses; a malformed fp is treated as not advertised", () => {
    const flood = Array.from({ length: 500 }, (_, i) => advert({ instance: `i${i}`, host: `10.0.${Math.floor(i / 250)}.${i % 250}`, fingerprint: F }));
    expect(describeDiscovered(flood, { isPaired: () => false })).toHaveLength(200);
    const many = advert({ addresses: Array.from({ length: 50 }, (_, i) => `10.9.9.${i}`), fingerprint: F, instance: "x" });
    expect(describeDiscovered([many], { isPaired: () => false })[0]!.addresses).toHaveLength(8);
    const [bad] = describeDiscovered([advert({ fingerprint: "sha256:not-a-fingerprint", instance: "y" })], { isPaired: () => false });
    expect(bad).toMatchObject({ state: "identity-not-advertised" });
    expect(bad!.fingerprint).toBeUndefined();
  });
});

describe("describeDiscovered rejects hostile adverts (CodeRabbit)", () => {
  it("drops entries with a non-plain host or invalid port; filters bad addresses", () => {
    const entries = describeDiscovered(
      [
        advert({ host: "attacker.example#", instance: "a", fingerprint: F }),
        advert({ host: "ok.lan", port: 70000, instance: "b", fingerprint: F }),
        advert({ host: "user@evil", instance: "c", fingerprint: F }),
        advert({ host: "good.lan", instance: "d", fingerprint: F, addresses: ["10.0.0.1", "1.2.3.4/x", "[::1]"] }),
      ],
      { isPaired: () => false },
    );
    expect(entries.map((e) => e.key)).toEqual(["d"]);
    expect(entries[0]!.addresses).toEqual(["10.0.0.1"]);
  });
});

// ── group-servers-by-identity: list "used" marker agrees with Electron host selection (#E5, task 8.5) ──

describe("rankRoutes(credentialed) agrees with buildCandidates (#E5)", () => {
  type R = RankableRoute & { id: string };
  const route = (id: string, scheme: "http" | "https", over: Partial<R> = {}): R => ({
    id,
    host: id,
    port: scheme === "https" ? 443 : 8000,
    scheme,
    source: "saved",
    proven: true,
    ...over,
  });
  const ref = (r: R) => ({ scheme: r.scheme, host: r.host, port: r.port });

  /** The route Electron would actually open: the first candidate (stored https, stored http, discovered) that proves the pin. */
  const electronPick = (stored: R[], discovered: R[]): string | null => {
    const candidates = buildCandidates(stored.map(ref), discovered.map(ref));
    const all = [...stored, ...discovered];
    for (const c of candidates) {
      const r = all.find((x) => x.host === c.ref.host && x.port === c.ref.port && x.scheme === c.ref.scheme);
      if (r?.proven) return r.id;
    }
    return null;
  };
  const listMarker = (stored: R[], discovered: R[]): string | null =>
    rankRoutes([...stored, ...discovered.map((d) => ({ ...d, discovered: true }))], { credentialed: true })?.id ?? null;

  it.each([
    ["stored https slow + stored http fast ⇒ https (latency never consulted)", [route("s-https", "https", { latencyMs: 130 }), route("s-http", "http", { latencyMs: 3 })], [], "s-https"],
    ["newer stored http + older stored http (faster) ⇒ the newer", [route("new", "http", { latencyMs: 40 }), route("old", "http", { latencyMs: 2 })], [], "new"],
    ["stored http + discovered http (faster) ⇒ stored", [route("stored", "http", { latencyMs: 30 })], [route("disc", "http", { latencyMs: 1 })], "stored"],
    ["stored https refused (other identity) + stored http proven ⇒ the http", [route("bad", "https", { proven: false }), route("s-http", "http")], [], "s-http"],
    ["https stored above http stored above discovered even when http is faster", [route("h2", "http", { latencyMs: 1 }), route("h1", "https", { latencyMs: 400 })], [route("d", "http", { latencyMs: 0 })], "h1"],
  ])("#E5: %s", (_name, stored, discovered, expected) => {
    expect(listMarker(stored, discovered)).toBe(expected);
    expect(electronPick(stored, discovered)).toBe(expected);
  });

  it("#E5: nothing proven ⇒ both pick nothing", () => {
    const stored = [route("a", "https", { proven: false }), route("b", "http", { proven: false })];
    expect(listMarker(stored, [])).toBeNull();
    expect(electronPick(stored, [])).toBeNull();
  });

  it("#E5: for every proven/refused combination of stored https, two stored http and two discovered, the marker equals the Electron pick", () => {
    const names = ["s-https", "s-http1", "s-http2", "d1", "d2"];
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const proven = (i: number) => (mask & (1 << i)) !== 0;
      // stored order is the keyring's (https leads; http most-recent first); latency is arbitrary noise.
      const stored = [route("s-https", "https", { proven: proven(0), latencyMs: 300 }), route("s-http1", "http", { proven: proven(1), latencyMs: 5 }), route("s-http2", "http", { proven: proven(2), latencyMs: 1 })];
      const discovered = [route("d1", "http", { proven: proven(3), latencyMs: 0 }), route("d2", "http", { proven: proven(4), latencyMs: 0 })];
      expect(listMarker(stored, discovered), `mask ${mask}`).toBe(electronPick(stored, discovered));
    }
  });
});

// ── harden-peer-address-identity ──────────────────────────────────────────────

const iface = (address: string, netmask: string, family: "IPv4" | "IPv6" = "IPv4", cidr?: string) =>
  ({ address, netmask, family, internal: false, mac: "aa:bb:cc:dd:ee:01", cidr: cidr ?? null }) as never;

describe("orderByLocality (#E5, #E6)", () => {
  const ifaces = {
    en0: [iface("192.168.16.220", "255.255.255.0")],
    bridge102: [iface("192.168.64.1", "255.255.255.0")],
    utun4: [iface("100.83.251.119", "255.255.255.255")],
  };
  it("#E5: on-link first (prefix from netmask), own addresses last, zone kept for matching only, nothing dropped", () => {
    const out = orderByLocality(["10.9.9.9", "172.16.184.1", "192.168.64.1", "192.168.16.203", "fe80::5%en0"], ifaces);
    expect(out).toEqual(["192.168.16.203", "10.9.9.9", "172.16.184.1", "fe80::5%en0", "192.168.64.1"]);
    expect(out).toHaveLength(5);
  });
  it("#E5: the own address is last even when it is on-link", () => {
    expect(orderByLocality(["192.168.16.220", "10.1.1.1"], ifaces)).toEqual(["10.1.1.1", "192.168.16.220"]);
  });
  it("#E6: IPv6 prefix comes from the interface's own mask, not a fixed /64", () => {
    const v6 = { en1: [iface("2001:db8:0:1::5", "ffff:ffff:ffff:ff00::", "IPv6")] };
    expect(orderByLocality(["2001:db8:1::1", "2001:db8:0:ff::1"], v6)).toEqual(["2001:db8:0:ff::1", "2001:db8:1::1"]);
  });
  it("#E6: cidr wins when present", () => {
    const v6 = { en1: [iface("2001:db8:0:1::5", "ffff:ffff:ffff:ffff::", "IPv6", "2001:db8:0:1::5/56")] };
    expect(orderByLocality(["2001:db8:1::1", "2001:db8:0:ff::1"], v6)).toEqual(["2001:db8:0:ff::1", "2001:db8:1::1"]);
  });
});

describe("expandRef (#E3, #E4)", () => {
  const ref = { scheme: "http" as const, host: "pi-dashboard-x-8000.local", port: 8000 };
  const lits = (n: number) => Array.from({ length: n }, (_, i) => `10.0.0.${i + 1}`);
  it.each([
    [7, 7],
    [8, 8],
    [9, 8],
  ])("#E3: %i literals resolve to %i candidates", async (n, expected) => {
    expect(await expandRef(ref, async () => lits(n))).toHaveLength(expected);
  });
  it("#E3: duplicates and non-literals are dropped", async () => {
    const out = await expandRef(ref, async () => ["10.0.0.1", "10.0.0.1", "not an ip"]);
    expect(out.map((r) => r.host)).toEqual(["10.0.0.1"]);
  });
  it("#E4: https and IP literals are not looked up", async () => {
    const lookup = vi.fn(async () => ["10.0.0.1"]);
    const https = { scheme: "https" as const, host: "studio.example", port: 443 };
    expect(await expandRef(https, lookup)).toEqual([https]);
    const ip = { scheme: "http" as const, host: "192.168.16.203", port: 8000 };
    expect(await expandRef(ip, lookup)).toEqual([ip]);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("#X3: a rejecting lookup yields no candidates", async () => {
    expect(await expandRef(ref, async () => Promise.reject(new Error("ENOTFOUND")))).toEqual([]);
  });
  it("#X2: a lookup stalling past the timeout yields no candidates", async () => {
    vi.useFakeTimers();
    try {
      const p = expandRef(ref, () => new Promise<string[]>(() => {}), 2000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await p).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pickVerifiedHost batches (#E7)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ scheme: "http" as const, host: `10.9.0.${i + 1}`, port: 8000 }));

  it("13 failing literals, the proving one 14th ⇒ a second batch runs and picks it", async () => {
    const candidates = buildCandidates([], [...refs(13), { scheme: "http", host: "192.168.16.203", port: 8000 }]);
    const started: string[] = [];
    const p = pickVerifiedHost(candidates, async (origin) => {
      started.push(origin);
      return origin.includes("192.168.16.203");
    });
    await vi.advanceTimersByTimeAsync(0);
    expect((await p)?.ref.host).toBe("192.168.16.203");
    expect(started).toHaveLength(14);
  });
  it("only the first batch is started before it settles", async () => {
    const candidates = buildCandidates([], refs(14));
    const started: string[] = [];
    void pickVerifiedHost(candidates, (origin) => {
      started.push(origin);
      return new Promise<boolean>(() => {});
    });
    expect(started).toHaveLength(12);
  });
  it("stalled first batch ⇒ the second batch never starts before the deadline; null at 5 s", async () => {
    const candidates = buildCandidates([], refs(13));
    const p = pickVerifiedHost(candidates, () => new Promise<boolean>(() => {}));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBeNull();
  });
});

describe("createServerDiscovery locality (#E8)", () => {
  const mk = (servers: DiscoveredServer[], proveLocal?: () => Promise<string | undefined>, hasLocalServer?: () => boolean) => {
    const b = new EventEmitter() as DashboardBrowser;
    b.servers = new Map(servers.map((s, i) => [String(i), s]));
    b.sweep = async () => {};
    b.stop = vi.fn();
    return createServerDiscovery({ createBrowser: () => b, isPaired: () => false, ...(proveLocal ? { proveLocal } : {}), ...(hasLocalServer ? { hasLocalServer } : {}) });
  };
  it("adverts of the pinned fp are returned whatever their locality flag; this machine's own fp is excluded", async () => {
    const L = `sha256:${b64("L")}`;
    const d = mk([advert({ fingerprint: F, isLocal: true, instance: "f" }), advert({ fingerprint: L, instance: "l" })], async () => L);
    await d.resolveLocalFp();
    expect(d.advertsFor(F)).toHaveLength(1);
    expect(d.advertsFor(L)).toHaveLength(0);
  });
  it("localFp(): undefined while unresolved, the fp once proven, none in remote mode", async () => {
    const L = `sha256:${b64("L")}`;
    const local = mk([], async () => L);
    expect(local.localFp()).toBeUndefined();
    await local.resolveLocalFp();
    expect(local.localFp()).toBe(L);
    expect(mk([]).localFp()).toBe("none");
    expect(mk([], async () => undefined, () => false).localFp()).toBe("none");
  });
});
