/**
 * Tier-3 pool failure modes (D5): a bind that fails for a reason other than EADDRINUSE, and a listener that fails after
 * it was bound. Real sockets throughout; the one injected fault per case is named in the test.
 * See change: serve-live-previews-on-capability-origin (D5; test-plan #X11, #X13, Q36).
 */
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, createMintRoute, type Harness, hop, refused, request, session, sessionKeyOf } from "./preview-pool-harness.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of cleanups.splice(0).reverse()) await c();
});
const harness = async (opts: Parameters<typeof createHarness>[0]): Promise<Harness> => {
  const h = await createHarness(opts);
  cleanups.push(() => h.close());
  return h;
};

/** The pool's listener servers among everything `http.createServer` built (Fastify's own inert server has no `upgrade` handler). */
const poolServers = (created: http.Server[]): http.Server[] => created.filter((s) => s.listenerCount("upgrade") > 0);

/** Capture every `http.Server` created from now on (the harness's own upstream already exists). */
function captureServers(): http.Server[] {
  const created: http.Server[] = [];
  const real = http.createServer.bind(http);
  vi.spyOn(http, "createServer").mockImplementation(((...a: Parameters<typeof http.createServer>) => {
    const s = real(...a);
    created.push(s);
    return s;
  }) as typeof http.createServer);
  return created;
}

/** Make `listen({port})` fail with `code` for the ports in `faults`; every other port binds for real. */
function injectBindFaults(faults: Map<number, string>): number[] {
  const attempted: number[] = [];
  const realListen = http.Server.prototype.listen;
  vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (this: http.Server, ...args: unknown[]) {
    const opt = args[0] as { port?: number } | undefined;
    const port = opt?.port ?? -1;
    attempted.push(port);
    const code = faults.get(port);
    if (code) {
      process.nextTick(() => this.emit("error", Object.assign(new Error(`listen ${code} 127.0.0.1:${port}`), { code, syscall: "listen" })));
      return this;
    }
    return (realListen as (...a: unknown[]) => http.Server).apply(this, args);
  } as never);
  return attempted;
}

describe("T.X11 — bind failure other than EADDRINUSE", () => {
  it("EACCES then EADDRNOTAVAIL on the first two ports: both skipped, the third binds, nothing leaks, nothing unhandled", async () => {
    const h = await harness({ n: 3 });
    const all = captureServers();
    const { from } = h.range;
    const attempted = injectBindFaults(
      new Map([
        [from, "EACCES"],
        [from + 1, "EADDRNOTAVAIL"],
      ]),
    );
    const unhandled: unknown[] = [];
    const onUncaught = (e: unknown) => unhandled.push(e);
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUncaught);
    cleanups.push(() => {
      process.off("uncaughtException", onUncaught);
      process.off("unhandledRejection", onUncaught);
    });

    const m = await h.mint();
    expect(m.ok && m.port).toBe(from + 2); // skipped, next port tried
    expect(attempted).toEqual([from, from + 1, from + 2]); // exactly one attempt per port, no retry
    const created = poolServers(all);
    expect(created).toHaveLength(3);
    expect(created.filter((s) => s.listening)).toHaveLength(1); // the two failed servers never half-opened
    expect(created[0].listening).toBe(false);
    expect(created[1].listening).toBe(false);
    expect(h.pool.heldPorts()).toEqual([from + 2]);
    expect(h.store.findByPoolPort(from)).toBeNull();
    expect(h.store.findByPoolPort(from + 1)).toBeNull();
    expect(h.store.findByPoolPort(from + 2)).not.toBeNull();
    expect(h.logs.filter((l) => l.includes("pool exhausted"))).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(unhandled).toEqual([]);
    // the failed ports are still free: later allocations may use them
    for (const s of created.slice(0, 2)) expect(s.listenerCount("error")).toBe(0); // no dangling handler either
  });

  it("every port fails (mixed codes): exhausted with ONE log line, no listener, no stored capability", async () => {
    const h = await harness({ n: 3 });
    const all = captureServers();
    const attempted = injectBindFaults(
      new Map([
        [h.range.from, "EACCES"],
        [h.range.from + 1, "EADDRNOTAVAIL"],
        [h.range.from + 2, "EADDRINUSE"],
      ]),
    );
    const out = await h.mint();
    expect(out).toEqual({ ok: false, reason: "exhausted" });
    expect(attempted).toHaveLength(3);
    expect(poolServers(all)).toHaveLength(3);
    expect(all.every((s) => !s.listening)).toBe(true);
    expect(h.pool.heldPorts()).toEqual([]);
    expect(h.store.size()).toBe(0); // no capability was stored for a dead listener
    expect(h.logs.filter((l) => l.includes("pool exhausted"))).toHaveLength(1);
  });

  it("the bind IP vanished (real EADDRNOTAVAIL on every port): the mint route answers tier 4, one log line, nothing stored on the pool", async () => {
    // 192.0.2.0/24 (TEST-NET-1) is on no interface, so the kernel refuses every bind with EADDRNOTAVAIL.
    const h = await harness({ n: 4, bindHost: "192.0.2.77" });
    const all = captureServers();
    const route = await createMintRoute({ pool: h.pool, store: h.store, manager: h.manager, range: h.range, ipDnsSuffix: "sslip.io" });
    cleanups.push(() => route.app.close());

    const res = await route.mint("s1", "t1", "192.0.2.77:8000");
    expect(res.statusCode).toBe(200);
    expect(res.json().tier).toBe(4); // pool failed, ip-dns fallback
    expect(res.body).not.toMatch(/EADDRNOTAVAIL|EACCES|EADDRINUSE/); // the bind error never reaches the caller
    expect(poolServers(all)).toHaveLength(4); // every pool port was tried once
    expect(all.every((s) => !s.listening)).toBe(true);
    expect(h.pool.heldPorts()).toEqual([]);
    for (let p = h.range.from; p <= h.range.to; p++) expect(h.store.findByPoolPort(p), String(p)).toBeNull();
    expect(h.logs.filter((l) => l.includes("pool exhausted"))).toHaveLength(1); // the pool's own sink: one line for the whole failed allocation

    // Without an ip-dns suffix the same failure falls through to tier 5 (legacy path when no tier-5 store is wired).
    const noDns = await createMintRoute({ pool: h.pool, store: h.store, manager: h.manager, range: h.range });
    cleanups.push(() => noDns.app.close());
    const fall = await noDns.mint("s2", "t2", "192.0.2.77:8000");
    expect(fall.statusCode).toBe(200);
    expect(fall.json().tier).not.toBe(3);
    expect(h.pool.heldPorts()).toEqual([]);
  });
});

describe("T.X13 — a listener fails after it was bound", () => {
  it("an `error` on the established listener deletes the entry (listener-error, no re-bind); the capability stops answering; the next mint re-allocates", async () => {
    const h = await harness({ n: 2 });
    const all = captureServers();
    const m = await h.mint(session("s1"));
    if (!m.ok) throw new Error("mint");
    const cookie = await hop(m.port, m.k, "s1");
    expect((await request(m.port, "/x", { cookie })).body).toBe("upstream-body");
    expect(poolServers(all)).toHaveLength(1);
    const listener = poolServers(all)[0];
    const binds = vi.spyOn(http.Server.prototype, "listen");

    // The fault: the established listener emits `error` (a real emit on the real server; a missing handler would throw).
    expect(() => listener.emit("error", Object.assign(new Error("listener broke"), { code: "EIO" }))).not.toThrow();

    expect(h.deleted).toEqual(["listener-error"]);
    expect(h.store.findByPoolPort(m.port)).toBeNull();
    expect(h.store.size()).toBe(0);
    expect(h.pool.heldPorts()).toEqual([]);
    expect(binds).not.toHaveBeenCalled(); // no re-bind attempt
    expect(h.logs.some((l) => l.includes("pool release") && l.includes("listener-error"))).toBe(true);
    // The request after the failure: the capability does not answer.
    expect(await refused(m.port)).toBe(true);
    await expect(request(m.port, "/x", { cookie })).rejects.toThrow();
    // The next mint re-allocates (the port is free again) and works end to end.
    const again = await h.mint(session("s1"));
    expect(again.ok && again.port).toBe(m.port);
    if (!again.ok) throw new Error("re-mint");
    const cookie2 = await hop(again.port, again.k, "s1");
    expect((await request(again.port, "/x", { cookie: cookie2 })).body).toBe("upstream-body");
    h.store.revokeBySessionKey(sessionKeyOf("s1"));
    expect(h.pool.heldPorts()).toEqual([]); // and the re-allocated listener is released like any other
  });

  it("a listener closed from outside (its socket gone) deletes the entry once; other listeners are untouched", async () => {
    const h = await harness({ n: 3 });
    const all = captureServers();
    const a = await h.mint(session("a"));
    const b = await h.mint(session("b"));
    if (!a.ok || !b.ok) throw new Error("mint");
    const cookieB = await hop(b.port, b.k, "b");

    poolServers(all)[0].close(); // external close of A's listening socket
    for (let i = 0; i < 50 && h.deleted.length === 0; i++) await new Promise((r) => setTimeout(r, 10));

    expect(h.deleted).toEqual(["listener-error"]); // exactly one deletion, from the `close` event
    expect(h.store.findByPoolPort(a.port)).toBeNull();
    expect(await refused(a.port)).toBe(true);
    expect(h.pool.heldPorts()).toEqual([b.port]);
    expect((await request(b.port, "/x", { cookie: cookieB })).body).toBe("upstream-body"); // B unaffected
    const next = await h.mint(session("c"));
    expect(next.ok && next.port).toBe(a.port); // the freed port is re-allocated
  });
});
