/**
 * Boot adoption: OCI label matching, native pid/token/port verification,
 * read-only boot, one `ps -a` per runtime. See change:
 * add-service-registry-core (test-plan E25, E26, E27, P2).
 */
import fs from "node:fs";
import net from "node:net";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeDriver } from "../native-driver.js";
import type { ContainerInspect } from "../oci-driver.js";
import { OciDriver } from "../oci-driver.js";
import { servicesPaths } from "../paths.js";
import { makeManager, ociDef, recordingRunner, tmpRoot, writeDefinitions } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function root() {
  const r = tmpRoot("svc-adopt-");
  roots.push(r);
  return r;
}

function container(id: string, opts: { service?: string; owner?: string; running?: boolean; port?: number } = {}): ContainerInspect {
  return {
    Id: id,
    Config: { Labels: { "pi.service": opts.service ?? "docling", "pi.owner": opts.owner ?? "iid-1", "pi.def-hash": "h" } },
    State: { Running: opts.running ?? true },
    NetworkSettings: { Ports: { "5001/tcp": [{ HostIp: "127.0.0.1", HostPort: String(opts.port ?? 54264) }] } },
  };
}

/** A docker/podman CLI fake answering `ps -a -q` and `inspect` from a container table. */
function runtimeFake(table: ContainerInspect[]) {
  return recordingRunner((_file, args) => {
    if (args[0] === "ps") return { stdout: table.map((c) => c.Id).join("\n") };
    if (args[0] === "inspect") return { stdout: JSON.stringify(table.filter((c) => args.includes(c.Id))) };
    return { code: 1 };
  });
}

function bootWith(table: ContainerInspect[]) {
  const r = root();
  writeDefinitions(r, [ociDef()]);
  const runner = runtimeFake(table);
  const oci = new OciDriver({ runtime: "docker", run: runner.run, resolveBinary: (n) => `/usr/bin/${n}`, paths: servicesPaths(r) });
  const h = makeManager(r, { run: runner.run, drivers: { "oci:docker": oci } });
  return { ...h, runner };
}

describe("E25 — OCI adoption by label", () => {
  it.each([
    ["no container", [], "stopped", undefined, undefined],
    ["one running", [container("c1")], "idle", undefined, { http: "http://127.0.0.1:54264" }],
    ["one exited", [container("c1", { running: false })], "stopped", undefined, undefined],
    ["two matches", [container("c1"), container("c2")], "unavailable", "duplicate-instances", undefined],
    ["other pi.owner", [container("c9", { owner: "someone-else" })], "unavailable", "owner-conflict", undefined],
  ] as const)("%s → %s %s", async (_label, table, state, reason, endpoints) => {
    const { manager, runner } = bootWith([...table]);
    await manager.boot();
    const s = (await manager.list()).services[0];
    expect(s.state).toBe(state);
    expect(s.reason).toBe(reason);
    expect(s.endpoints).toEqual(endpoints);
    expect(runner.calls.some((c) => c.args[0] === "create" || c.args[0] === "run" || c.args[0] === "start")).toBe(false);
  });

  it("duplicates and owner conflicts are sticky: ensure creates nothing", async () => {
    for (const table of [[container("c1"), container("c2")], [container("c9", { owner: "x" })]]) {
      const { manager, runner } = bootWith(table);
      await manager.boot();
      const p = await manager.ensure("docling");
      expect(p.state).toBe("unavailable");
      expect(p.endpoints).toBeUndefined();
      expect(runner.calls.some((c) => c.args[0] === "create")).toBe(false);
    }
  });

  it("an adopted running container is served without creating a new one", async () => {
    const { manager, runner } = bootWith([container("c1")]);
    await manager.boot();
    const p = await manager.ensure("docling");
    expect(p.state).toBe("healthy");
    expect(p.endpoints).toEqual({ http: "http://127.0.0.1:54264" });
    expect(runner.calls.some((c) => c.args[0] === "create")).toBe(false);
  });
});

describe("E26 — native adoption needs pid + package token + port", () => {
  const nativeDef = {
    id: "docling",
    mode: "managed",
    drivers: ["native"],
    native: { runner: "uvx", package: "docling-serve@1.36.0", args: ["--port", "${port.http}"], ports: { http: { protocol: "http" } } },
    health: { kind: "http", endpoint: "http" },
    origin: "user",
  } as ServiceDefinition;

  it.each([
    ["pid dead", { alive: false, cmd: "uvx --from docling-serve@1.36.0 docling-serve", holders: [777] }, "stopped", undefined, false],
    ["alive + token + port", { alive: true, cmd: "uvx --offline --from docling-serve@1.36.0 docling-serve", holders: [777] }, "idle", undefined, true],
    ["alive + token, port held by a stranger", { alive: true, cmd: "uvx --from docling-serve@1.36.0 x", holders: [999] }, "unavailable", "adoption-uncertain", true],
    ["alive, port check impossible", { alive: true, cmd: "uvx --from docling-serve@1.36.0 x", holders: [] }, "unavailable", "adoption-uncertain", true],
    ["alive, argv rewritten", { alive: true, cmd: "python -m uvicorn app", holders: [777] }, "unavailable", "adoption-uncertain", true],
  ] as const)("%s → %s", async (_label, world, state, reason, fileKept) => {
    const r = root();
    writeDefinitions(r, [nativeDef]);
    const paths = servicesPaths(r);
    fs.mkdirSync(paths.runDir("docling"), { recursive: true });
    fs.writeFileSync(
      paths.instanceFile("docling"),
      JSON.stringify({ pid: 777, argv: [], ports: { http: 41231 }, package: "docling-serve@1.36.0", defHash: "h", startedAt: "" }),
    );
    const spawn = vi.fn();
    const native = new NativeDriver({
      run: recordingRunner().run,
      resolveBinary: (n) => `/usr/bin/${n}`,
      paths,
      spawn: spawn as never,
      isAlive: () => world.alive,
      readCommandLine: async () => world.cmd,
      portHolders: async () => [...world.holders],
      pgidOf: async () => null,
    });
    const { manager } = makeManager(r, { drivers: { native } });
    await manager.boot();
    const s = (await manager.list()).services[0];
    expect(s.state).toBe(state);
    expect(s.reason).toBe(reason);
    expect(fs.existsSync(paths.instanceFile("docling"))).toBe(fileKept);
    if (state === "unavailable") {
      expect((await manager.ensure("docling")).reason).toBe("adoption-uncertain");
    }
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("E27 — boot is read-only: adoption commands only, no probe, no socket", () => {
  it("issues only ps -a / inspect", async () => {
    const { manager, runner, probes } = bootWith([container("c1")]);
    const connect = vi.spyOn(net, "connect");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await manager.boot();
    expect(runner.calls.map((c) => c.args[0]).every((v) => v === "ps" || v === "inspect")).toBe(true);
    expect(runner.calls.length).toBeGreaterThan(0);
    expect(probes.count).toBe(0);
    expect(connect).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("P2 — one `ps -a` per runtime at boot", () => {
  it("50 definitions across docker + podman → ≤ 2 ps calls", async () => {
    const r = root();
    const defs = Array.from({ length: 50 }, (_, i) => ociDef({ id: `s-${i}`, drivers: i % 2 ? ["oci:podman"] : ["oci:docker", "oci:podman"] }));
    writeDefinitions(r, defs);
    const runner = runtimeFake([]);
    const mk = (runtime: "docker" | "podman") =>
      new OciDriver({ runtime, run: runner.run, resolveBinary: (n) => `/usr/bin/${n}`, paths: servicesPaths(r) });
    const { manager } = makeManager(r, { run: runner.run, drivers: { "oci:docker": mk("docker"), "oci:podman": mk("podman") } });
    await manager.boot();
    expect(runner.calls.filter((c) => c.args[0] === "ps").length).toBeLessThanOrEqual(2);
  });
});
