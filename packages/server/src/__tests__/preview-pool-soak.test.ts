/**
 * Tier-3 pool under load (D5): a leak soak over a full 100-port pool, a concurrent-mint burst through the mint route,
 * and the cost of scanning past 99 foreign-held ports.
 * See change: serve-live-previews-on-capability-origin (D5; test-plan #P7, #P8, #P9).
 */
import { execFileSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewPool, POOL_PRINCIPAL_CAP } from "../live-server/preview-pool.js";
import { createHarness, createMintRoute, fdCount, freeRange, type Harness, hop, openUpgrade, refused, request, session, sessionKeyOf } from "./preview-pool-harness.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ports = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** Listening TCP ports of THIS process inside `[from, to]` according to `lsof` (or `null` when lsof is unavailable). */
function lsofListening(from: number, to: number): number[] | null {
  try {
    const out = execFileSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-iTCP", "-sTCP:LISTEN", "-Fn"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out
      .split("\n")
      .filter((l) => l.startsWith("n"))
      .map((l) => Number(l.slice(l.lastIndexOf(":") + 1)))
      .filter((p) => p >= from && p <= to);
  } catch (e) {
    // lsof exits 1 when it finds nothing; anything else (ENOENT) means unavailable
    return (e as { status?: number }).status === 1 ? [] : null;
  }
}

/** One full cycle for a throwaway principal, then settle: creates the lazily-built pool app and the forwarder's upstream connection. */
async function warmCycle(h: Harness): Promise<number> {
  const m = await h.mint(session("warm"));
  if (!m.ok) throw new Error("warm mint");
  const cookie = await hop(m.port, m.k, "warm");
  expect((await request(m.port, "/x", { cookie })).body).toBe("upstream-body");
  h.store.revokeBySessionKey(sessionKeyOf("warm"));
  for (let i = 0; i < 50 && !(await refused(m.port)); i++) await sleep(20);
  await sleep(100);
  return fdCount();
}

/** 100 cycles, one per pool port, each leaving a keep-alive HTTP socket and an upgrade socket open; then revoke them all with the sockets still open. */
async function soakWave(h: Harness, wave: number): Promise<number[]> {
  const live: { port: number; key: string }[] = [];
  const agents: http.Agent[] = [];
  const clients: net.Socket[] = [];
  for (let i = 0; i < 100; i++) {
    const key = `w${wave}-${i}`;
    const m = await h.mint(session(key));
    if (!m.ok) throw new Error(`wave ${wave} mint ${i}: ${m.reason}`);
    const cookie = await hop(m.port, m.k, key);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    agents.push(agent);
    expect((await request(m.port, "/x", { cookie, agent })).body).toBe("upstream-body"); // keep-alive socket stays open
    clients.push(await openUpgrade(m.port, cookie)); // upgrade socket stays open
    live.push({ port: m.port, key });
  }
  expect(h.pool.heldPorts().sort((a, b) => a - b)).toEqual(ports(h.range.from, 100)); // every port is in use at once
  // alternating order so neither end of the range is special
  for (const l of wave === 0 ? live : [...live].reverse()) h.store.revokeBySessionKey(sessionKeyOf(l.key));
  expect(h.pool.heldPorts()).toEqual([]);
  for (const a of agents) a.destroy();
  for (const c of clients) c.destroy();
  for (const l of live) expect(await refused(l.port), `port ${l.port}`).toBe(true);
  return live.map((l) => l.port);
}

describe("T.P7 — mint → first navigation → revoke leaves no descriptor, listener or held port (200 cycles, 100-port pool)", () => {
  it("two full waves over all 100 ports, keep-alive and upgrade sockets open at revoke: fd count back to baseline, 0 listening pool ports", async () => {
    const h = await createHarness({ n: 100 });
    cleanups.push(() => h.close());
    const baseline = await warmCycle(h);
    const rssBefore = process.memoryUsage().rss;

    const used = new Set<number>();
    for (const wave of [0, 1]) for (const p of await soakWave(h, wave)) used.add(p);
    expect(used.size).toBe(100); // all 100 ports cycled, twice: 200 cycles
    expect(h.deleted.length).toBe(201); // 200 + the warm-up cycle; every deletion released its listener

    expect(h.pool.heldPorts()).toEqual([]);
    expect(lsofListening(h.range.from, h.range.to) ?? []).toEqual([]);
    for (const p of ports(h.range.from, 100)) expect(await refused(p), `port ${p}`).toBe(true);

    // Same warm-up procedure, same measurement: the descriptor count equals the baseline (invariant, no threshold).
    await warmCycle(h);
    expect(fdCount()).toBe(baseline);
    // RSS trend is recorded only (Q48): never asserted.
    console.info(`[P7] cycles=200 fd baseline=${baseline} final=${fdCount()} rss ${(rssBefore / 1048576).toFixed(0)}MB → ${(process.memoryUsage().rss / 1048576).toFixed(0)}MB`);
  }, 120_000);
});

/** 10 principals, 50 DISTINCT (principal, target) mints: p0 asks for 20 (over its cap of 8), p1..p9 ask for 30 between them. */
function burstCalls(): { principal: string; target: string }[] {
  const calls: { principal: string; target: string }[] = [];
  for (let t = 0; t < 20; t++) calls.push({ principal: "p0", target: `t${t}` });
  for (let p = 1; p <= 9; p++) for (let t = 0; t < (p <= 3 ? 4 : 3); t++) calls.push({ principal: `p${p}`, target: `t${t}` });
  return calls;
}

describe("T.P8 — 50 concurrent tier-3 mints from 10 principals on a 20-port pool (cap 8 each)", () => {
  it("exactly 20 tier 3 + 30 fallbacks, no port twice, no principal above 8, all 200, counts equal the live listeners", async () => {
    const range = await freeRange(20);
    const manager = {
      get: (id: string) => (id.startsWith("t") ? { id, label: id, host: "127.0.0.1", port: 5173 } : undefined),
      getStatic: () => undefined,
      has: (id: string) => id.startsWith("t"),
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    let pool!: ReturnType<typeof createPreviewPool>;
    const store = new LiveCapabilityStore({ isTargetLive: () => true, onDelete: (e, r) => pool.onDelete(e, r) });
    pool = createPreviewPool({
      range: () => range,
      bindHost: () => "0.0.0.0",
      findByPoolPort: (p) => store.findByPoolPort(p),
      revokeByPoolPort: (p, r) => store.revokeByPoolPort(p, r),
      manager,
      interfaceAddresses: () => ["192.168.1.5"],
      log: () => {},
    });
    const route = await createMintRoute({ pool, store, manager, range, ipDnsSuffix: "sslip.io" });
    cleanups.push(async () => {
      await route.app.close();
      store.close();
      await pool.close();
    });

    const calls = burstCalls();
    expect(calls).toHaveLength(50);
    const out = await Promise.all(calls.map((c) => route.mint(c.principal, c.target).then((r) => ({ ...c, r }))));

    expect(out.every((o) => o.r.statusCode === 200)).toBe(true);
    expect(out.map((o) => o.r.body).join("")).not.toMatch(/EADDRINUSE|EADDRNOTAVAIL|EACCES/);
    const t3 = out.filter((o) => o.r.json().tier === 3);
    const rest = out.filter((o) => o.r.json().tier !== 3);
    expect(t3).toHaveLength(20);
    expect(rest).toHaveLength(30);
    expect(rest.every((o) => o.r.json().tier === 4)).toBe(true); // ipDnsSuffix configured: the fallback is tier 4
    const bound = t3.map((o) => Number(new URL(o.r.json().origin).port)).sort((a, b) => a - b);
    expect(new Set(bound).size).toBe(20); // no port bound twice
    expect(bound).toEqual(ports(range.from, 20));
    const perPrincipal = new Map<string, number>();
    for (const o of t3) perPrincipal.set(o.principal, (perPrincipal.get(o.principal) ?? 0) + 1);
    expect(Math.max(...perPrincipal.values())).toBeLessThanOrEqual(POOL_PRINCIPAL_CAP);
    expect(perPrincipal.get("p0")).toBe(POOL_PRINCIPAL_CAP); // the greedy principal stopped at its cap
    // Counts equal the live listeners, on every side: the pool, the store and the sockets.
    expect(pool.heldPorts().sort((a, b) => a - b)).toEqual(bound);
    for (const p of bound) expect(store.findByPoolPort(p), `store entry for port ${p}`).not.toBeNull();
    expect(store.size()).toBe(50); // 20 tier-3 + 30 tier-4 capabilities, each stored once
    for (const p of bound) expect(await refused(p), `port ${p}`).toBe(false);
  }, 60_000);
});

/** Hold `[from, to)` with foreign listeners; resolves to a closer. */
async function holdForeign(from: number, to: number): Promise<() => Promise<void>> {
  const holders: net.Server[] = [];
  for (let p = from; p < to; p++) {
    const s = net.createServer();
    await new Promise<void>((res, rej) => {
      s.once("error", rej);
      s.listen(p, "127.0.0.1", () => res());
    });
    holders.push(s);
  }
  return async () => void (await Promise.all(holders.map((s) => new Promise<void>((r) => s.close(() => r())))));
}

/** `mints` allocate → release cycles on `range`; per mint: `listen()` attempts and latency. */
async function measureMints(range: { from: number; to: number }, label: string, mints: number, foreign: boolean) {
  const release = foreign ? await holdForeign(range.from, range.to) : async () => {}; // the LAST port is the only free one: a full scan
  const h = await createHarness({ range });
  const listenSpy = vi.spyOn(http.Server.prototype, "listen");
  const attempts: number[] = [];
  const lat: number[] = [];
  for (let i = 0; i < mints; i++) {
    const key = `${label}-${i}`;
    const calls0 = listenSpy.mock.calls.length;
    const t0 = performance.now();
    const m = await h.mint(session(key));
    lat.push(performance.now() - t0);
    attempts.push(listenSpy.mock.calls.length - calls0);
    if (!m.ok) throw new Error(`${label} mint ${i}: ${m.reason}`);
    expect(m.port).toBe(foreign ? range.to : range.from);
    h.store.revokeBySessionKey(sessionKeyOf(key)); // free the port for the next mint
  }
  listenSpy.mockRestore();
  expect(h.pool.heldPorts()).toEqual([]);
  await h.close();
  await release();
  lat.sort((a, b) => a - b);
  return { attempts, p95: lat[Math.ceil(0.95 * lat.length) - 1], p50: lat[Math.floor(lat.length / 2)] };
}

describe("T.P9 — pool scan cost past foreign-held ports", () => {
  it("100-port pool, 99 foreign holders: every mint binds the one free port within ≤ 100 attempts (no retry loop); latency is recorded against an empty pool", async () => {
    const MINTS = 1000;
    const range = await freeRange(100);
    const empty = await measureMints(range, "empty", MINTS, false);
    const crowded = await measureMints(range, "crowded", MINTS, true);

    // Invariants (deterministic): a bounded scan, one attempt per port at most, never a retry loop.
    expect(Math.max(...empty.attempts)).toBe(1);
    expect(Math.max(...crowded.attempts)).toBeLessThanOrEqual(100);
    expect(Math.min(...crowded.attempts)).toBe(100); // exactly one attempt per port: 99 refused + the free one
    // Latency is trend-only (Q48): recorded, never compared against a threshold.
    console.info(`[P9] ${MINTS} mints per pool; attempts empty=${empty.attempts[0]} crowded=${crowded.attempts[0]}; p50/p95 ms empty=${empty.p50.toFixed(2)}/${empty.p95.toFixed(2)} crowded=${crowded.p50.toFixed(2)}/${crowded.p95.toFixed(2)}`);
  }, 120_000);
});
