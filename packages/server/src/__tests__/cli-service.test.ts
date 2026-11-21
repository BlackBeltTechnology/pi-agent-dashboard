/**
 * `pi-dashboard service` CLI: the `--json` exit-0 rule, `no-server`, exec
 * exit-code forwarding + lease release, and lease recovery across a server
 * restart. See change: add-service-registry-core (test-plan E43–E45, X6).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import { httpProofHeaders } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, FakeDriver, injectFetch, makeManager, ociDef, tmpRoot, writeDefinitions } from "../services/__tests__/helpers.js";
import { cmdService } from "../services/cli-service.js";

const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

async function harness(arrange?: (d: FakeDriver) => void) {
  const r = tmpRoot("svc-cli-");
  roots.push(r);
  writeDefinitions(r, [ociDef()]);
  const driver = new FakeDriver("oci:docker", async () => {});
  arrange?.(driver);
  const h = makeManager(r, { drivers: { "oci:docker": driver } });
  const app = await buildApp(h.manager);
  apps.push(app);
  return { ...h, driver, app, root: r };
}

async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((res) => s.listen(0, "127.0.0.1", () => res()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((res) => s.close(() => res()));
  return p;
}

async function run(argv: string[], deps: Partial<Parameters<typeof cmdService>[1]> & { port?: number }) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await cmdService(argv, { port: deps.port ?? 1, out: (s) => out.push(s), err: (s) => err.push(s), ...deps });
  return { code, out, err };
}

describe("E43 — `--json` always exits 0; plain exits 0 only when healthy", () => {
  it.each([
    ["healthy", undefined, 0],
    ["unavailable", (d: FakeDriver) => { d.presenceResult = { ok: false, reason: "image-absent", hint: "pull it" }; }, 1],
  ] as const)("%s", async (state, arrange, plainCode) => {
    const { app } = await harness(arrange);
    const json = await run(["ensure", "docling", "--json"], { fetch: injectFetch(() => app) });
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out[0])).toMatchObject({ id: "docling", state });
    const plain = await run(["ensure", "docling"], { fetch: injectFetch(() => app) });
    expect(plain.code).toBe(plainCode);
  });

  it("no-server: --json exit 0, plain exit non-zero", async () => {
    const port = await closedPort();
    expect((await run(["ensure", "docling", "--json"], { port })).code).toBe(0);
    expect((await run(["ensure", "docling"], { port })).code).not.toBe(0);
  });

  it("other verbs follow the same rule", async () => {
    const port = await closedPort();
    for (const verb of [["list"], ["status", "docling"], ["stop", "docling"], ["pin", "docling"]]) {
      const j = await run([...verb, "--json"], { port });
      expect(j.code, verb.join(" ")).toBe(0);
      expect(JSON.parse(j.out[0])).toMatchObject({ ok: false, state: "no-server" });
      expect((await run(verb, { port })).code, verb.join(" ")).not.toBe(0);
    }
  });
});

describe("flag operands", () => {
  it.each([["add", "--file"], ["ensure", "docling", "--holder", "--json"]])("%s … without a value is a usage error, no request", async (...argv) => {
    const fetchSpy = vi.fn();
    const r = await run(argv as string[], { fetch: fetchSpy as never });
    expect(r.code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("E44 — dashboard down", () => {
  it('prints {"id":"docling","state":"no-server",…} and exits 0', async () => {
    const r = await run(["ensure", "docling", "--json"], { port: await closedPort() });
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.out[0]);
    expect(payload).toMatchObject({ id: "docling", state: "no-server" });
    expect(typeof payload.hint).toBe("string");
  });
});

describe("E45 — exec forwards the child's exit code and releases the lease", () => {
  it("node -e process.exit(7) → exit 7, zero live leases", async () => {
    const { app, manager, clock } = await harness();
    const r = await run(["exec", "docling", "--", process.execPath, "-e", "process.exit(7)"], { fetch: injectFetch(() => app) });
    expect(r.code).toBe(7);
    expect(manager.leases.live("docling", clock.now())).toBe(0);
  });

  it("an unhealthy service is not exec'd", async () => {
    const { app } = await harness((d) => {
      d.presenceResult = { ok: false, reason: "runtime-missing" };
    });
    const r = await run(["exec", "docling", "--", process.execPath, "-e", "process.exit(0)"], { fetch: injectFetch(() => app) });
    expect(r.code).toBe(1);
  });
});

describe("X6 — exec survives a server restart", () => {
  it("next heartbeat → lease-unknown → re-ensure → a new lease; no idle-stop while the child runs", async () => {
    const first = await harness();
    let current: FastifyInstance | null = first.app;
    const seen: string[] = [];
    const inner = injectFetch(() => current);
    const f = (async (u: string | URL | Request, i?: RequestInit) => {
      const res = await inner(u, i);
      seen.push(`${new URL(String(u)).pathname.split("/").pop()}:${res.status}`);
      return res;
    }) as typeof fetch;

    // Restart mid-exec: a second manager over the same files (no leases).
    const restarted = makeManager(first.root, { drivers: { "oci:docker": first.driver } });
    const app2 = await buildApp(restarted.manager);
    apps.push(app2);
    const swap = setTimeout(() => {
      current = app2;
    }, 120);
    const r = await run(["exec", "docling", "--", process.execPath, "-e", "setTimeout(()=>{}, 700)"], { fetch: f, heartbeatMs: 60 });
    clearTimeout(swap);
    expect(r.code).toBe(0);
    const i404 = seen.indexOf("heartbeat:404");
    expect(i404).toBeGreaterThan(0);
    expect(seen[i404 + 1]).toBe("ensure:200");
    expect(seen.slice(i404 + 2)).toContain("heartbeat:200");
    expect(seen[seen.length - 1]).toBe("release:200");

    // While a lease is live, the restarted manager never idle-stops.
    const p = await restarted.manager.ensure("docling");
    for (let m = 0; m < 60; m += 4) {
      restarted.clock.advance(4 * 60_000); // heartbeat cadence well inside the 300 s TTL
      expect(restarted.manager.heartbeat("docling", p.leaseId as string).ok).toBe(true);
      await restarted.manager.tick();
    }
    expect(first.driver.calls.stop).toBe(0);
  });
});

describe("E22 — service verbs mint a fresh proof per request", () => {
  it("two consecutive verbs send distinct nonces to the host literal", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const f = vi.fn(async (input: unknown, init?: RequestInit) => {
      seen.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const authHeaders = (method: string, target: string) =>
      httpProofHeaders("lt", `http://127.0.0.1:8000${target}`, method);
    await run(["list", "--json"], { port: 8000, fetch: f, authHeaders });
    await run(["list", "--json"], { port: 8000, fetch: f, authHeaders });
    expect(seen).toHaveLength(2);
    expect(seen.every((r) => r.url.startsWith("http://127.0.0.1:8000/"))).toBe(true);
    const nonces = seen.map((r) => r.headers["X-Pi-Local-Proof"].split(".")[2]);
    expect(new Set(nonces).size).toBe(2);
  });
});

describe("X5 (add-obs-studio-plugin) — exec stdout carries only the child's bytes", () => {
  /** A child stand-in: records its spawn options and exits after `ms`. */
  function stubChild(ms: number, seen: Array<Record<string, unknown>>) {
    return ((_cmd: string, _args: readonly string[], opts: Record<string, unknown>) => {
      seen.push(opts);
      const ee = new EventEmitter();
      setTimeout(() => ee.emit("exit", 0, null), ms);
      return ee;
    }) as never;
  }

  it("success + release: exec itself writes nothing to stdout; the child inherits stdio", async () => {
    const { app } = await harness();
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(["exec", "docling", "--", "pi-obs", "serve", "--stdio"], { fetch: injectFetch(() => app), spawnChild: stubChild(30, seen) });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([]);
    expect(seen[0]).toMatchObject({ stdio: "inherit", shell: false });
  });

  it("heartbeat 404 → re-ensure path: still nothing on stdout", async () => {
    const first = await harness();
    let current: FastifyInstance | null = first.app;
    const restarted = makeManager(first.root, { drivers: { "oci:docker": first.driver } });
    const app2 = await buildApp(restarted.manager);
    apps.push(app2);
    const swap = setTimeout(() => {
      current = app2;
    }, 60);
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(["exec", "docling", "--", "pi-obs", "serve", "--stdio"], { fetch: injectFetch(() => current), heartbeatMs: 40, spawnChild: stubChild(400, seen) });
    clearTimeout(swap);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([]);
  });
});

describe("exec signal forwarding (#1103, change: harden-path-and-process-guards)", () => {
  const SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
  const CODE = { SIGTERM: 143, SIGINT: 130, SIGHUP: 129 } as const;
  type Child = EventEmitter & { kill: ReturnType<typeof vi.fn> };

  /** A stub child; `onKill` decides how it reacts to each signal it is sent. */
  function mkChild(events: string[], onKill: (sig: NodeJS.Signals, ee: Child) => void = () => {}): Child {
    const ee = new EventEmitter() as Child;
    ee.kill = vi.fn((sig: NodeJS.Signals) => {
      events.push(`kill:${sig}`);
      onKill(sig, ee);
      return true;
    });
    ee.once("exit", () => events.push("exit"));
    return ee;
  }
  const exitsOn = (...sigs: NodeJS.Signals[]) => (sig: NodeJS.Signals, ee: Child) => {
    if (sigs.includes(sig)) queueMicrotask(() => ee.emit("exit", null, sig));
  };

  function stubFetch(events: string[], opts: { releaseGate?: Promise<void>; releaseFails?: boolean } = {}) {
    return (async (url: string | URL | Request) => {
      const leaf = new URL(String(url)).pathname.split("/").pop() as string;
      if (leaf === "release") {
        events.push("release:start");
        if (opts.releaseFails) throw new Error("ECONNRESET");
        await opts.releaseGate;
        events.push("release");
      }
      const data = leaf === "ensure" ? { id: "docling", state: "healthy", leaseId: "L1" } : { ok: true };
      return { status: 200, json: async () => ({ success: true, data }) } as Response;
    }) as typeof fetch;
  }

  function start(child: Child | (() => Child), o: { events?: string[]; killGraceMs?: number; releaseGate?: Promise<void>; releaseFails?: boolean; source?: EventEmitter } = {}) {
    const events = o.events ?? [];
    const source = o.source ?? new EventEmitter();
    const done = run(["exec", "docling", "--", "svc-child"], {
      fetch: stubFetch(events, o),
      spawnChild: (() => (typeof child === "function" ? child() : child)) as never,
      signalSource: source,
      ...(o.killGraceMs !== undefined ? { killGraceMs: o.killGraceMs } : {}),
    });
    return { done, source, events };
  }
  const listeners = (src: EventEmitter) => SIGNALS.map((s) => src.listenerCount(s));
  const kills = (c: Child, sig: string) => c.kill.mock.calls.filter((a) => a[0] === sig).length;

  afterEach(() => vi.useRealTimers());

  it("#S25 SIGTERM is forwarded once; the lease is released after the child exits; exit 143", async () => {
    const events: string[] = [];
    const child = mkChild(events, exitsOn("SIGTERM"));
    const { done, source } = start(child, { events });
    await new Promise((r) => setImmediate(r));
    source.emit("SIGTERM");
    const r = await done;
    expect(r.code).toBe(143);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(events.indexOf("exit")).toBeLessThan(events.indexOf("release"));
    expect(events.indexOf("kill:SIGTERM")).toBeLessThan(events.indexOf("exit"));
  });

  it.each(SIGNALS)("#S26 %s reaches the child; exit status 128+n", async (sig) => {
    const child = mkChild([], exitsOn(sig));
    const { done, source } = start(child);
    await new Promise((r) => setImmediate(r));
    source.emit(sig);
    expect((await done).code).toBe(CODE[sig]);
    expect(child.kill).toHaveBeenCalledWith(sig);
  });

  it.each([0, 1, 2, 255])("#S27 a child that handles SIGTERM and exits %i yields exec status %i", async (n) => {
    const events: string[] = [];
    const child = mkChild(events, (_s, ee) => queueMicrotask(() => ee.emit("exit", n, null)));
    const { done, source } = start(child, { events });
    await new Promise((r) => setImmediate(r));
    source.emit("SIGTERM");
    expect((await done).code).toBe(n);
    expect(events).toContain("release");
  });

  it.each([[undefined, 5000], [200, 200]])("#S28 kill-grace boundary (killGraceMs=%s → %i ms): SIGKILL once, then 137", async (override, grace) => {
    vi.useFakeTimers();
    const events: string[] = [];
    const child = mkChild(events, exitsOn("SIGKILL"));
    const { done, source } = start(child, { events, ...(override ? { killGraceMs: override } : {}) });
    await vi.advanceTimersByTimeAsync(0);
    source.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(grace - 1);
    expect(kills(child, "SIGKILL")).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(kills(child, "SIGKILL")).toBe(1);
    const r = await done;
    expect(r.code).toBe(137);
    expect(events).toContain("release");
    expect(kills(child, "SIGKILL")).toBe(1);
  });

  it("#S29 a child that exits within the grace cancels the timer; no SIGKILL ever", async () => {
    vi.useFakeTimers();
    const child = mkChild([], (sig, ee) => {
      if (sig === "SIGTERM") setTimeout(() => ee.emit("exit", null, "SIGTERM"), 1000);
    });
    const { done, source } = start(child);
    await vi.advanceTimersByTimeAsync(0);
    source.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await done).code).toBe(143);
    expect(kills(child, "SIGKILL")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("#S30 repeated signals are forwarded but never re-arm or shorten the single grace timer", async () => {
    vi.useFakeTimers();
    const child = mkChild([], exitsOn("SIGKILL"));
    const { done, source } = start(child);
    await vi.advanceTimersByTimeAsync(0);
    source.emit("SIGINT");
    source.emit("SIGINT"); // same signal twice at +0
    await vi.advanceTimersByTimeAsync(2000);
    source.emit("SIGTERM");
    source.emit("SIGHUP"); // different signals later
    expect(kills(child, "SIGINT")).toBe(2);
    expect(kills(child, "SIGTERM")).toBe(1);
    expect(kills(child, "SIGHUP")).toBe(1);
    await vi.advanceTimersByTimeAsync(2998);
    expect(kills(child, "SIGKILL")).toBe(0); // 4998 ms after the FIRST signal
    await vi.advanceTimersByTimeAsync(2);
    expect(kills(child, "SIGKILL")).toBe(1); // exactly 5 s after the first, not re-armed
    await done;
    expect(kills(child, "SIGKILL")).toBe(1);
  });

  it("#S32 listeners are removed after a normal exit, a signalled exit and a spawn error", async () => {
    for (const mode of ["normal", "signalled", "error"] as const) {
      const source = new EventEmitter();
      const base = listeners(source);
      const child = mkChild([], exitsOn("SIGTERM"));
      const { done } = start(child, { source });
      await new Promise((r) => setImmediate(r));
      expect(listeners(source)).toEqual([1, 1, 1]);
      if (mode === "normal") child.emit("exit", 0, null);
      else if (mode === "signalled") source.emit("SIGTERM");
      else child.emit("error", Object.assign(new Error("spawn svc-child ENOENT"), { code: "ENOENT" }));
      const r = await done;
      if (mode === "error") expect(r.code).toBe(127);
      expect(listeners(source), mode).toEqual(base);
    }
  });

  it("#P5 200 mixed runs leak no listeners or timers", async () => {
    vi.useFakeTimers();
    const source = new EventEmitter();
    const baseline = vi.getTimerCount();
    for (let i = 0; i < 200; i++) {
      const child = mkChild([], exitsOn("SIGTERM"));
      // Wait until exec has spawned the child and installed its handlers (no timing guess).
      const spawned = new Promise<void>((resolve) => child.once("newListener", () => resolve()));
      const { done } = start(child, { source });
      await vi.advanceTimersByTimeAsync(0);
      await spawned;
      expect(listeners(source), `iteration ${i}`).toEqual([1, 1, 1]);
      if (i % 2) source.emit("SIGTERM");
      else child.emit("exit", 0, null);
      await done;
      expect(listeners(source), `iteration ${i}`).toEqual([0, 0, 0]);
      expect(vi.getTimerCount(), `iteration ${i}`).toBe(baseline); // no growth: no leaked heartbeat/grace timer
    }
  });

  it("#X13 a signal while the lease release is in flight is a no-op; exec returns the child's status", async () => {
    let open!: () => void;
    const releaseGate = new Promise<void>((r) => (open = r));
    const child = mkChild([]);
    const { done, source } = start(child, { releaseGate });
    await new Promise((r) => setImmediate(r));
    child.emit("exit", 0, null);
    await new Promise((r) => setImmediate(r)); // release now pending
    source.emit("SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
    open();
    expect((await done).code).toBe(0);
    expect(listeners(source)).toEqual([0, 0, 0]);
  });

  it("#X14 a failing lease release still returns the child's status and removes the handlers", async () => {
    const child = mkChild([], exitsOn("SIGTERM"));
    const { done, source } = start(child, { releaseFails: true });
    await new Promise((r) => setImmediate(r));
    source.emit("SIGTERM");
    expect((await done).code).toBe(143);
    expect(listeners(source)).toEqual([0, 0, 0]);
  });

  it("#X15 child.kill throwing (ESRCH) on forward and on SIGKILL never crashes exec", async () => {
    vi.useFakeTimers();
    const child = mkChild([], () => {
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    });
    const { done, source } = start(child);
    await vi.advanceTimersByTimeAsync(0);
    source.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(5000);
    expect(kills(child, "SIGKILL")).toBe(1);
    child.emit("exit", null, "SIGKILL");
    expect((await done).code).toBe(137);
  });

  it("#X16 a spawn error before or after a signal cleans up, releases and exits non-zero", async () => {
    vi.useFakeTimers();
    for (const afterSignal of [false, true]) {
      const events: string[] = [];
      const source = new EventEmitter();
      const child = mkChild(events);
      const { done } = start(child, { events, source });
      await vi.advanceTimersByTimeAsync(0);
      if (afterSignal) source.emit("SIGTERM");
      child.emit("error", new Error("ENOENT"));
      const r = await done;
      expect(r.code).toBe(127);
      expect(events).toContain("release");
      expect(listeners(source)).toEqual([0, 0, 0]);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});
