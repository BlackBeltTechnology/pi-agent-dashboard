/**
 * Pure helpers + discovery wrapper for Electron server windows.
 * See change: add-electron-server-windows (test-plan E1, E12, E14–E18, P1, P2).
 */
import { EventEmitter } from "node:events";
import type { DashboardBrowser, DiscoveredServer } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCandidates,
  createServerDiscovery,
  describeDiscovered,
  identityVerdict,
  isFingerprint,
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

  it("orders stored https → stored http → discovered; caps discovery at 3; dedupes", () => {
    const c = buildCandidates(
      [ref("s1"), ref("s2", "https")],
      [ref("d1"), ref("d2"), ref("s1"), ref("d3"), ref("d4")],
    );
    expect(c.map((x) => x.ref.host)).toEqual(["s2", "s1", "d1", "d2", "d3"]);
    expect(c.map((x) => x.source)).toEqual(["stored", "stored", "discovered", "discovered", "discovered"]);
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
