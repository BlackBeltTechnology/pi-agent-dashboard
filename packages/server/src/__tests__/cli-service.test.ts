/**
 * `pi-dashboard service` CLI: the `--json` exit-0 rule, `no-server`, exec
 * exit-code forwarding + lease release, and lease recovery across a server
 * restart. See change: add-service-registry-core (test-plan E43–E45, X6).
 */
import fs from "node:fs";
import net from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
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
