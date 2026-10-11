/**
 * Native driver: argv composition + detached spawn, offline presence, bind
 * failure → failed with backoff, group stop. See change:
 * add-service-registry-core (test-plan E34, E36, X9).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeDriver } from "../native-driver.js";
import { servicesPaths } from "../paths.js";
import { makeManager, recordingRunner, tmpRoot, writeDefinitions } from "./helpers.js";

const roots: string[] = [];
const servers: net.Server[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  for (const s of servers.splice(0)) s.close();
  vi.restoreAllMocks();
});
function root() {
  const r = tmpRoot("svc-native-");
  roots.push(r);
  return r;
}

function nativeDef(runner: "uvx" | "npx" = "uvx"): ServiceDefinition {
  return {
    id: "docling",
    mode: "managed",
    drivers: ["native"],
    native: {
      runner,
      package: runner === "uvx" ? "docling-serve@1.36.0" : "@x/server@2.0.1",
      args: ["--port", "${port.http}"],
      ports: { http: { protocol: "http" } },
    },
    health: { kind: "http", endpoint: "http", path: "/health" },
    secrets: { apikey: { env: "DOCLING_API_KEY" } },
    origin: "user",
  } as ServiceDefinition;
}

/** Same recipe without the store secret (manager-driven cases: no secret to resolve). */
function bareNativeDef(): ServiceDefinition {
  const { secrets: _s, ...rest } = nativeDef();
  return rest as ServiceDefinition;
}

function fakeChild(pid = 4321) {
  return Object.assign(new EventEmitter(), { pid, unref: vi.fn() });
}

describe("E34 — structured recipe → composed argv, detached spawn", () => {
  it("allocates the port, composes argv offline, records the instance, secrets via env only", async () => {
    const r = root();
    const paths = servicesPaths(r);
    const spawn = vi.fn(() => fakeChild());
    const d = new NativeDriver({
      run: recordingRunner().run,
      resolveBinary: (n) => `/usr/bin/${n}`,
      paths,
      platform: "linux",
      spawn: spawn as never,
      allocatePort: async () => 47123,
    });
    const inst = await d.start(nativeDef(), { secrets: { apikey: "SVCTEST-k" }, defHash: "h", instanceId: "i" });
    const [file, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { detached: boolean; env: NodeJS.ProcessEnv; shell: boolean }];
    expect([file, ...args]).toEqual(["/usr/bin/uvx", "--offline", "--from", "docling-serve@1.36.0", "docling-serve", "--port", "47123"]);
    expect(opts.detached).toBe(true);
    expect(opts.shell).toBe(false);
    expect(opts.env.DOCLING_API_KEY).toBe("SVCTEST-k");
    expect(args.join(" ")).not.toContain("SVCTEST");
    expect(inst).toMatchObject({ pid: 4321, endpoints: { http: "http://127.0.0.1:47123" }, startedBy: "dashboard" });
    const rec = JSON.parse(fs.readFileSync(paths.instanceFile("docling"), "utf8"));
    expect(rec).toMatchObject({ pid: 4321, ports: { http: 47123 }, package: "docling-serve@1.36.0" });
    expect(JSON.stringify(rec)).not.toContain("SVCTEST");
    expect(fs.statSync(paths.instanceFile("docling")).mode & 0o777).toBe(0o600);
  });

  it("npx: --no --package=<pkg> -- <bin>", async () => {
    const spawn = vi.fn(() => fakeChild());
    const d = new NativeDriver({ run: recordingRunner().run, resolveBinary: (n) => `/usr/bin/${n}`, paths: servicesPaths(root()), platform: "darwin", spawn: spawn as never, allocatePort: async () => 1 });
    await d.start(nativeDef("npx"), { secrets: {}, defHash: "h", instanceId: "i" });
    const [file, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect([file, ...args]).toEqual(["/usr/bin/npx", "--no", "--package=@x/server@2.0.1", "--", "server", "--port", "1"]);
  });
});

describe("E36 — presence never fetches", () => {
  it("uvx offline probe fails, no marker → package-absent; only offline invocations", async () => {
    const runner = recordingRunner(() => ({ code: 1, stderr: "not found in the cache" }));
    const d = new NativeDriver({ run: runner.run, resolveBinary: (n) => `/usr/bin/${n}`, paths: servicesPaths(root()), platform: "linux" });
    expect(await d.presence(nativeDef())).toMatchObject({ ok: false, reason: "package-absent" });
    expect(runner.calls.length).toBeGreaterThan(0);
    for (const c of runner.calls) expect(c.args).toContain("--offline");
  });
  it("npx presence is the prefetch marker alone (no invocation)", async () => {
    const r = root();
    const paths = servicesPaths(r);
    const runner = recordingRunner();
    const d = new NativeDriver({ run: runner.run, resolveBinary: (n) => `/usr/bin/${n}`, paths, platform: "linux" });
    expect(await d.presence(nativeDef("npx"))).toMatchObject({ ok: false, reason: "package-absent" });
    fs.mkdirSync(paths.runDir("docling"), { recursive: true });
    fs.writeFileSync(paths.prefetchMarker("docling"), JSON.stringify({ package: "@x/server@2.0.1" }));
    expect(await d.presence(nativeDef("npx"))).toEqual({ ok: true });
    expect(runner.calls).toEqual([]);
  });
  it("missing runner → runner-absent", async () => {
    const d = new NativeDriver({ run: recordingRunner().run, resolveBinary: () => null, paths: servicesPaths(root()) });
    expect(await d.presence(nativeDef())).toMatchObject({ ok: false, reason: "runner-absent" });
  });
  it("manager ensure: package-absent, nothing spawned", async () => {
    const r = root();
    writeDefinitions(r, [bareNativeDef()]);
    const spawn = vi.fn();
    const runner = recordingRunner(() => ({ code: 1 }));
    const native = new NativeDriver({ run: runner.run, resolveBinary: (n) => `/usr/bin/${n}`, paths: servicesPaths(r), spawn: spawn as never });
    const { manager } = makeManager(r, { run: runner.run, drivers: { native } });
    expect(await manager.ensure("docling")).toMatchObject({ state: "unavailable", reason: "package-absent" });
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("X9 — allocated port taken before bind → failed with retryAt", () => {
  it("the child dies on EADDRINUSE; the start is failed and backed off", async () => {
    const r = root();
    writeDefinitions(r, [bareNativeDef()]);
    const squatter = net.createServer();
    servers.push(squatter);
    await new Promise<void>((res) => squatter.listen(0, "127.0.0.1", () => res()));
    const taken = (squatter.address() as net.AddressInfo).port;
    let alive = true;
    const spawn = vi.fn(() => {
      // the runner would bind `taken` and exit with EADDRINUSE
      setTimeout(() => {
        alive = false;
      }, 0);
      return fakeChild();
    });
    const native = new NativeDriver({
      run: recordingRunner().run,
      resolveBinary: (n) => `/usr/bin/${n}`,
      paths: servicesPaths(r),
      spawn: spawn as never,
      allocatePort: async () => taken,
      isAlive: () => alive,
    });
    const { manager } = makeManager(r, {
      drivers: { native },
      probe: async () => {
        await new Promise((res) => setTimeout(res, 5));
        return false;
      },
    });
    // presence: uvx offline probe ok
    const p = await manager.ensure("docling");
    expect(p.state).toBe("failed");
    expect(p.retryAt).toBeDefined();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect((await manager.ensure("docling")).state).toBe("failed");
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe("stop — killProcessGroup, confirmed by the group being gone", () => {
  it("stopped when the group is gone; stop-failed when it survives", async () => {
    const r = root();
    const paths = servicesPaths(r);
    let alive = true;
    const kpg = vi.fn(async () => {
      alive = false;
      return { ok: true, forced: false };
    });
    const d = new NativeDriver({ run: recordingRunner().run, resolveBinary: (n) => `/usr/bin/${n}`, paths, killProcessGroup: kpg, isAlive: () => alive });
    expect(await d.stop(nativeDef(), { driver: "native", startedBy: "dashboard", endpoints: {}, pid: 77 }, 2_000)).toBe("stopped");
    expect(kpg).toHaveBeenCalledWith(77, expect.objectContaining({ timeoutMs: 2_000 }));
    alive = true;
    kpg.mockImplementation(async () => ({ ok: true, forced: true }));
    expect(await d.stop(nativeDef(), { driver: "native", startedBy: "dashboard", endpoints: {}, pid: 77 }, 2_000)).toBe("stop-failed");
  });
});

describe("audit — a recorded pid is re-verified before any signal", () => {
  function withRecord(cmd: string) {
    const r = root();
    const paths = servicesPaths(r);
    fs.mkdirSync(paths.runDir("docling"), { recursive: true });
    fs.writeFileSync(paths.instanceFile("docling"), JSON.stringify({ pid: 777, argv: [], ports: { http: 41231 }, package: "docling-serve@1.36.0", defHash: "h", startedAt: "" }));
    const kpg = vi.fn(async () => ({ ok: true, forced: false }));
    const d = new NativeDriver({
      run: recordingRunner().run,
      resolveBinary: (n) => `/usr/bin/${n}`,
      paths,
      killProcessGroup: kpg,
      isAlive: () => true,
      readCommandLine: async () => cmd,
    });
    return { r, d, kpg, paths };
  }
  it("pid reused by an unrelated group → record dropped, nothing signalled", async () => {
    const { d, kpg, paths } = withRecord("-zsh");
    expect(await d.stop(nativeDef(), undefined, 2_000)).toBe("stopped");
    expect(kpg).not.toHaveBeenCalled();
    expect(fs.existsSync(paths.instanceFile("docling"))).toBe(false);
  });
  it("explicit --force signals the recorded group", async () => {
    const { d, kpg } = withRecord("-zsh");
    await d.stop(nativeDef(), undefined, 2_000, { force: true });
    expect(kpg).toHaveBeenCalledWith(777, expect.anything());
  });
  it("manager remove of an adoption-uncertain service never force-signals", async () => {
    const { r, d, kpg } = withRecord("-zsh");
    writeDefinitions(r, [bareNativeDef()]);
    (d as unknown as { deps: { portHolders: () => Promise<number[]> } }).deps.portHolders = async () => [];
    const { manager } = makeManager(r, { drivers: { native: d } });
    await manager.boot();
    expect((await manager.list()).services[0].reason).toBe("adoption-uncertain");
    expect((await manager.remove("docling")).ok).toBe(true);
    expect(kpg).not.toHaveBeenCalled();
  });
});

