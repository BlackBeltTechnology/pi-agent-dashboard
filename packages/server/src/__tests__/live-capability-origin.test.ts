/**
 * Origin-bound capability store: labels, host lookup, reuse, onDelete, config reconciliation.
 * See change: serve-live-previews-on-capability-origin (D2; test-plan #E19-#E26, #E40, #E41, #E51, #E54, #P2, #P4, #P5, #X6, #X7).
 */
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CapabilityDeleteReason,
  type CapabilityPrincipal,
  LiveCapabilityStore,
  type LiveCapabilityStoreOptions,
  type MintOptions,
} from "../live-server/live-capability.js";
import { hashPreviewKey } from "../live-server/preview-origin.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ctxBase = { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] };
const principalA: CapabilityPrincipal = { kind: "session", tier: "control", sessionKey: "sess-A" };
const principalB: CapabilityPrincipal = { kind: "session", tier: "control", sessionKey: "sess-B" };
const localP: CapabilityPrincipal = { kind: "local" };

let t = 1_000_000;
const clock = { now: () => t };
const store = (extra: LiveCapabilityStoreOptions = {}) => new LiveCapabilityStore({ now: clock.now, ...extra });
const tier1 = (ancestors = ["http://localhost:8000"]): MintOptions => ({
  preview: {
    tier: 1,
    ancestors,
    buildOrigin: (l) => ({ origin: `http://${l}.localhost:8000`, originHost: `${l}.localhost:8000` }),
  },
});
const tier2 = (ancestors = ["https://dash.example.com"]): MintOptions => ({
  preview: {
    tier: 2,
    ancestors,
    buildOrigin: (l) => ({ origin: `https://${l}.preview.example.com`, originHost: `${l}.preview.example.com` }),
  },
});
const tier4 = (ancestors = ["http://192.168.1.5:8000"]): MintOptions => ({
  preview: {
    tier: 4,
    ancestors,
    buildOrigin: (l) => ({ origin: `http://${l}.192-168-1-5.sslip.io:8000`, originHost: `${l}.192-168-1-5.sslip.io:8000` }),
  },
});
/** Advance the fake clock by `ms`, keeping the entry alive the way the viewer keepalive does. */
function advanceKeepingAlive(s: LiveCapabilityStore, m: { tokenId: string }, minterKey: string, ms: number): void {
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, 15 * MIN);
    t += step;
    left -= step;
    s.touch(m.tokenId, minterKey);
  }
}
const hostOf = (label: string) => `${label}.localhost:8000`;
const look = (s: LiveCapabilityStore, label: string, host = hostOf(label), local = true) =>
  s.lookupByHost(hashPreviewKey(label), host, local);

afterEach(() => {
  vi.useRealTimers();
  t = 1_000_000;
});

describe("labels and index (E19, E20)", () => {
  it("E19: every label matches the shape; no plaintext in the index; no duplicates", () => {
    const s = store();
    const labels = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const p: CapabilityPrincipal = { kind: "session", tier: "control", sessionKey: `s${i}` };
      const m = s.mint(`t${i}`, p, tier1());
      expect(m.token).toMatch(/^[a-z2-7]{26}$/);
      expect(m.originHost).toBe(hostOf(m.token));
      labels.add(m.token);
      expect(s.holdsPlaintext(m.token)).toBe(false);
      expect(s.holdsPlaintext(hostOf(m.token))).toBe(false);
    }
    expect(labels.size).toBe(300);
    const internals = s as unknown as { entries: Map<string, unknown>; byOriginHost: Map<string, string> };
    const state = JSON.stringify([...internals.entries.keys(), ...internals.byOriginHost.keys()]);
    for (const l of labels) expect(state).not.toContain(l);
  });

  it("E20: a label colliding with a live entry is re-drawn; the live entry is unchanged", () => {
    const first = Buffer.alloc(16, 1);
    const second = Buffer.alloc(16, 2);
    let calls = 0;
    const s = store({ labelBytes: () => (++calls <= 2 ? first : second) });
    const a = s.mint("t1", principalA, tier1());
    const b = s.mint("t1", principalB, tier1()); // collides (call 2) → re-draw (call 3)
    expect(b.token).not.toBe(a.token);
    expect(look(s, a.token).ok).toBe(true);
    expect(s.size()).toBe(2);
    // B's session cannot use A's host: the entry is A's but the host is exact — and a different label is B's
    expect(look(s, b.token).ok).toBe(true);
  });

  it("E20: always colliding → the mint fails rather than reusing a label", () => {
    const s = store({ labelBytes: () => Buffer.alloc(16, 3) });
    s.mint("t1", principalA, tier1());
    expect(() => s.mint("t2", principalB, tier1())).toThrow(/unique preview label/);
  });

  it("a label is never a legacy `/live/` token", () => {
    const s = store();
    const m = s.mint("t1", principalA, tier1());
    expect(s.validate("t1", m.token)).toBeNull();
  });
});

describe("lookupByHost (E21, E51, E26)", () => {
  it("E21: only the exact Host + a local peer (tier 1) hits; others refuse with wrong-host / wrong-port", () => {
    const s = store();
    const m = s.mint("t1", principalA, tier1());
    const h = hashPreviewKey(m.token);
    const L = m.token;
    expect(s.lookupByHost(h, `${L}.preview.example.com`, true)).toEqual({ ok: false, reason: "wrong-host" });
    expect(s.lookupByHost(h, `${L}.localhost:8001`, true)).toEqual({ ok: false, reason: "wrong-port" });
    expect(s.lookupByHost(h, `${L}.localhost`, true)).toEqual({ ok: false, reason: "wrong-port" });
    expect(s.lookupByHost(h, `${L}.localhost:8000`, false)).toEqual({ ok: false, reason: "wrong-host" });
    expect(s.lookupByHost(h, `${L}.localhost:8000`, true).ok).toBe(true);
    expect(s.lookupByHost(hashPreviewKey("nope"), `${L}.localhost:8000`, true)).toEqual({ ok: false, reason: "unknown" });
  });

  it("E51: tier 1 is served to a local peer whatever the principal kind; never to a LAN peer", () => {
    for (const p of [localP, principalA, { kind: "device", tier: "control", deviceId: "d1" } as CapabilityPrincipal, { kind: "network" } as CapabilityPrincipal]) {
      const s = store();
      const m = s.mint("t1", p, tier1());
      expect(look(s, m.token, undefined, true).ok, p.kind).toBe(true);
      expect(look(s, m.token, undefined, false).ok, p.kind).toBe(false);
    }
  });

  it("tiers 2 and 4 do not need a local peer", () => {
    const s = store();
    const m2 = s.mint("t1", principalA, tier2());
    expect(s.lookupByHost(hashPreviewKey(m2.token), m2.originHost as string, false).ok).toBe(true);
    const m4 = s.mint("t1", principalB, tier4());
    expect(s.lookupByHost(hashPreviewKey(m4.token), m4.originHost as string, false).ok).toBe(true);
  });

  it("E26: idle/absolute boundaries; a hit touches; an expired host leaves the admission set", () => {
    const s = store();
    const m = s.mint("t1", principalA, tier1());
    t += 30 * MIN - 1;
    expect(look(s, m.token).ok).toBe(true); // touch at t-1ms
    t += 30 * MIN - 1;
    expect(look(s, m.token).ok).toBe(true); // extended by the touch
    t += 30 * MIN; // exactly the idle limit
    expect(s.isAdmittedHost(m.originHost as string)).toBe(false);
    expect(look(s, m.token)).toEqual({ ok: false, reason: "expired" });
    expect(look(s, m.token)).toEqual({ ok: false, reason: "unknown" }); // X7: no tombstone
    expect(s.admittedHostCount()).toBe(0);
  });

  it("E26: static targets idle out at 10 minutes", () => {
    const s = store();
    const m = s.mint("t1", principalA, { ...tier1(), kind: "static" });
    t += 10 * MIN;
    expect(look(s, m.token)).toEqual({ ok: false, reason: "expired" });
  });

  it("X5: a liveness callback that throws is not an admit", () => {
    const s = store({
      isTargetLive: () => {
        throw new Error("boom");
      },
    });
    const m = s.mint("t1", principalA, tier1());
    expect(() => look(s, m.token)).toThrow();
  });
});

describe("re-mint reuse (E22, E23, E24)", () => {
  it("E22: reused while MORE than 20 minutes of absolute lifetime remain", () => {
    const s = store();
    const a = s.mint("t1", principalA, tier1());
    advanceKeepingAlive(s, a, "session:sess-A", 12 * HOUR - 20 * MIN - 1000); // 20m+1s remaining
    expect(s.mint("t1", principalA, tier1()).token).toBe(a.token);
    t += 1000; // exactly 20m remaining (idle was touched by the reuse)
    const b = s.mint("t1", principalA, tier1());
    expect(b.token).not.toBe(a.token);
    expect(b.reused).toBe(false);
  });

  it("E22: static targets use the same 20 minute boundary on their 2 h life", () => {
    const s = store();
    const o = { ...tier1(), kind: "static" as const };
    const a = s.mint("t1", principalA, o);
    t += 5 * MIN;
    expect(s.mint("t1", principalA, o).reused).toBe(true);
    advanceKeepingAlive(s, a, "session:sess-A", 2 * HOUR - 5 * MIN - 20 * MIN);
    expect(s.mint("t1", principalA, o).reused).toBe(false);
    expect(a.token).toBeTruthy();
  });

  it("E23: only viewerId may differ; any other single difference mints a new origin", () => {
    const s = store();
    const base = s.mint("t1", principalA, { ...tier1(), viewerId: "viewer-aaaa" });
    expect(s.mint("t1", principalA, { ...tier1(), viewerId: "viewer-bbbb" })).toMatchObject({ token: base.token, reused: true });
    const differs: [string, () => ReturnType<LiveCapabilityStore["mint"]>][] = [
      ["targetId", () => s.mint("t2", principalA, tier1())],
      ["minter", () => s.mint("t1", principalB, tier1())],
      ["policy.egress", () => s.mint("t1", principalA, { ...tier1(), policy: { egress: "open" } })],
      ["policy.scripts", () => s.mint("t1", principalA, { ...tier1(), policy: { scripts: true } })],
      ["ancestors", () => s.mint("t1", principalA, tier1(["http://127.0.0.1:8000"]))],
      ["tier", () => s.mint("t1", principalA, tier2())],
    ];
    for (const [what, run] of differs) {
      const m = run();
      expect(m.reused, what).toBe(false);
      expect(m.token, what).not.toBe(base.token);
    }
  });

  it("E24: dead entries are never resurrected", () => {
    const deleted: CapabilityDeleteReason[] = [];
    const live = new Set(["t1"]);
    const s = store({ onDelete: (_e, r) => deleted.push(r), isTargetLive: (id) => live.has(id) });
    const a = s.mint("t1", principalA, tier1());
    t += 30 * MIN; // idle-expired with ~11.5h left
    const b = s.mint("t1", principalA, tier1());
    expect(b.token).not.toBe(a.token);
    expect(look(s, a.token)).toEqual({ ok: false, reason: "unknown" });
    s.revokeByTarget("t1");
    const c = s.mint("t1", principalA, tier1());
    expect(c.token).not.toBe(b.token);
    expect(deleted).toEqual(["idle", "revoked"]);
    live.clear(); // target gone
    expect(look(s, c.token)).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("onDelete on every deletion path (E25, X6)", () => {
  it("fires exactly once per entry with the right reason, after the entry left both indexes", () => {
    const log: [string, CapabilityDeleteReason, boolean][] = [];
    let s!: LiveCapabilityStore;
    s = store({
      onDelete: (e, r) => log.push([e.targetId, r, s.isAdmittedHost(e.originHost as string)]),
    });
    s.mint("idle", principalA, tier1());
    t += 30 * MIN;
    s.mint("tmp", principalA, tier1()); // sweep → idle
    s.mint("max", principalA, tier1());
    s.revokeByTarget("max");
    s.mint("dev", { kind: "device", tier: "control", deviceId: "D" }, tier1());
    s.revokeByDevice("D");
    s.mint("sess", principalB, tier1());
    s.revokeBySessionKey("sess-B");
    s.mint("off", principalA, tier1());
    s.reconcilePreviewConfig(resolvePreviewOrigins(parsePreviewOrigins({ enabled: false }).value, ctxBase));
    s.mint("shut", principalA, tier1());
    s.close();
    const byTarget = Object.fromEntries(log.map(([id, r]) => [id, r]));
    expect(byTarget).toMatchObject({ idle: "idle", max: "revoked", dev: "revoked", sess: "revoked", off: "disabled", shut: "shutdown" });
    expect(log.every(([, , admitted]) => admitted === false)).toBe(true);
    expect(log.filter(([id]) => id === "idle")).toHaveLength(1);
    expect(s.size()).toBe(0);
    expect(s.admittedHostCount()).toBe(0);
  });

  it("absolute expiry reports `max`", () => {
    const reasons: CapabilityDeleteReason[] = [];
    const s = store({ onDelete: (_e, r) => reasons.push(r) });
    const m = s.mint("t1", principalA, tier1());
    advanceKeepingAlive(s, m, "session:sess-A", 12 * HOUR - 1);
    expect(reasons).toEqual([]);
    t += 1;
    s.mint("other", principalB, tier2()); // sweeps
    expect(reasons).toEqual(["max"]);
  });

  it("P4: per-principal cap 64 and global cap 1024 evict oldest with reason `evicted`", () => {
    const reasons: CapabilityDeleteReason[] = [];
    const s = store({ onDelete: (_e, r) => reasons.push(r) });
    for (let i = 0; i < 200; i++) s.mint("t", principalA, tier1([`http://localhost:${i}`]));
    expect(s.size()).toBe(64);
    expect(reasons.filter((r) => r === "evicted")).toHaveLength(136);
    // identical params collapse to one entry
    const s2 = store();
    for (let i = 0; i < 1000; i++) s2.mint("t", principalA, tier1());
    expect(s2.size()).toBe(1);
    const s3 = store();
    for (let i = 0; i < 1100; i++) s3.mint("t", { kind: "session", tier: "control", sessionKey: `p${i}` }, tier1());
    expect(s3.size()).toBe(1024);
  });

  it("X6: a throwing hook does not stop the other deletions; a hook that mints leaves a consistent store", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    let s!: LiveCapabilityStore;
    s = store({
      onDelete: (e) => {
        calls.push(e.targetId);
        if (e.targetId === "t2") throw new Error(`boom ${e.label}`);
        if (e.targetId === "t3") s.mint("reborn", principalB, tier1());
      },
    });
    for (const id of ["t1", "t2", "t3"]) s.mint(id, principalA, tier1([`http://localhost:${id}`]));
    s.revokeBySessionKey("sess-A");
    expect(calls).toEqual(["t1", "t2", "t3"]);
    expect(s.size()).toBe(1); // only the one minted from inside the hook
    const logged = errors.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("onDelete hook failed");
    expect(logged).not.toMatch(/[a-z2-7]{26}\./);
    errors.mockRestore();
  });
});

describe("config reconciliation (E40, E41, E54)", () => {
  const wildcard = { suffix: "preview.example.com", forHosts: ["dash.example.com"] };
  const cfg = (o: unknown) => resolvePreviewOrigins(parsePreviewOrigins(o).value, ctxBase);

  it("E40/E41: `enabled` flip-flop revokes everything; a later mint gets a NEW label; old labels stay refused", () => {
    const s = store();
    const a = s.mint("t1", principalA, tier1());
    for (let i = 0; i < 10; i++) {
      s.reconcilePreviewConfig(cfg({ enabled: i % 2 === 1 }));
    }
    // enabled flipped to false at i=8 (even=false? i%2===1 → true) — final state i=9: enabled
    expect(look(s, a.token)).toEqual({ ok: false, reason: "unknown" });
    const b = s.mint("t1", principalA, tier1());
    expect(b.token).not.toBe(a.token);
    expect(look(s, a.token).ok).toBe(false);
    expect(look(s, b.token).ok).toBe(true);
  });

  it("E54: entries whose originHost no longer matches their tier's config are revoked; others stay", () => {
    const reasons: Record<string, CapabilityDeleteReason> = {};
    const s = store({ onDelete: (e, r) => (reasons[e.targetId] = r) });
    s.mint("one", principalA, tier1());
    const m2 = s.mint("two", principalA, tier2());
    s.mint("four", principalA, tier4());
    const full = cfg({ wildcard, ipDnsSuffix: "sslip.io" });
    expect(s.reconcilePreviewConfig(full)).toBe(0);
    // suffix changed → tier 2 revoked, others kept
    expect(s.reconcilePreviewConfig(cfg({ wildcard: { ...wildcard, suffix: "other.example.com" }, ipDnsSuffix: "sslip.io" }))).toBe(1);
    expect(reasons).toEqual({ two: "config-changed" });
    expect(s.isAdmittedHost(m2.originHost as string)).toBe(false);
    // ipDnsSuffix removed → tier 4 revoked; tier 1 needs no config
    expect(s.reconcilePreviewConfig(cfg({}))).toBe(1);
    expect(reasons.four).toBe("config-changed");
    expect(reasons.one).toBeUndefined();
    expect(s.size()).toBe(1);
  });

  it("E54: the sweep reads the live config (`getPreviewConfig`) with no listener", () => {
    let current = cfg({ wildcard });
    const s = store({ getPreviewConfig: () => current });
    const m = s.mint("t1", principalA, tier2());
    s.mint("t1", principalB, tier2()); // sweep: still valid
    expect(s.isAdmittedHost(m.originHost as string)).toBe(true);
    current = cfg({ wildcard: { ...wildcard, forHosts: ["dash.example.com"], port: 8443 } });
    s.mint("t2", principalB, tier1()); // sweep → originHost no longer matches (port)
    expect(s.isAdmittedHost(m.originHost as string)).toBe(false);
  });
});

describe("sweeper and leak soak (P5)", () => {
  it("the store owns an unref'd interval that expires idle entries without a mint, and stops when empty", () => {
    vi.useFakeTimers();
    let now = 0;
    const reasons: CapabilityDeleteReason[] = [];
    const s = new LiveCapabilityStore({ now: () => now, onDelete: (_e, r) => reasons.push(r) });
    s.mint("t1", principalA, tier1());
    expect(vi.getTimerCount()).toBe(1);
    now += 31 * MIN;
    vi.advanceTimersByTime(60_000);
    expect(reasons).toEqual(["idle"]);
    expect(s.size()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("24 h churn leaves every index and set empty and no timers", () => {
    vi.useFakeTimers();
    let now = 0;
    const s = new LiveCapabilityStore({ now: () => now });
    for (let h = 0; h < 24; h++) {
      for (let i = 0; i < 50; i++) {
        const p: CapabilityPrincipal = { kind: "session", tier: "control", sessionKey: `s${h}-${i}` };
        const opt = [tier1, tier2, tier4][i % 3]();
        const m = s.mint(`t${i}`, p, { ...opt, viewerId: `viewer-${h}-${i}` });
        s.addAllowOnce(`viewer-${h}-${i}`, "https://x.example");
        if (i % 5 === 0) s.touch(m.tokenId, `session:s${h}-${i}`);
        if (i % 7 === 0) s.revokeBySessionKey(`s${h}-${i}`);
      }
      now += HOUR;
      vi.advanceTimersByTime(HOUR);
    }
    now += 13 * HOUR;
    vi.advanceTimersByTime(13 * HOUR);
    expect(s.size()).toBe(0);
    expect(s.admittedHostCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("P2: lookup is hash-indexed", () => {
  it("100k mixed lookups against a 1,024-entry store stay within 1.2× of the 1-entry store (same run)", () => {
    const fill = (n: number) => {
      const s = store();
      const labels: string[] = [];
      for (let i = 0; i < n; i++) {
        const p: CapabilityPrincipal = { kind: "session", tier: "control", sessionKey: `s${i}` };
        labels.push(s.mint("t", p, tier1()).token);
      }
      return { s, labels };
    };
    const bench = (n: number) => {
      const { s, labels } = fill(n);
      const hashes = labels.map(hashPreviewKey);
      const samples: number[] = [];
      for (let i = 0; i < 100_000; i++) {
        const k = i % hashes.length;
        const mode = i % 4;
        const t0 = performance.now();
        if (mode === 0) s.lookupByHost(hashes[k], hostOf(labels[k]), true);
        else if (mode === 1) s.lookupByHost(hashPreviewKey(`miss${i}`), hostOf(labels[k]), true);
        else if (mode === 2) s.lookupByHost(hashes[k], `${labels[k]}.localhost:8001`, true);
        else s.lookupByHost(hashes[k], `x${labels[k]}.localhost:8000`, true);
        if (i % 50 === 0) samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length * 0.95)];
    };
    const small = bench(1);
    const large = bench(1024);
    // generous noise floor: both are microsecond-scale; a linear scan would be ~1000×
    expect(large).toBeLessThanOrEqual(Math.max(small * 1.2, 0.05));
  });
});
