/**
 * OCI driver: create argv, presence order, preference fallback, port re-read,
 * host-VM hands-off, isolated DOCKER_CONFIG, podman-machine tunnel.
 * See change: add-service-registry-core (test-plan E29–E33, X7, X8).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "../command-runner.js";
import { type ContainerInspect, OciDriver } from "../oci-driver.js";
import { servicesPaths } from "../paths.js";
import { DIGEST, makeManager, ociDef, recordingRunner, tmpRoot, writeDefinitions } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function root() {
  const r = tmpRoot("svc-oci-");
  roots.push(r);
  return r;
}

/** `podman system connection list --format json` as recorded from a real podman 6.1 machine (macOS). */
function connectionFixture(identity: string) {
  return JSON.stringify([
    {
      Name: "podman-machine-default",
      URI: "ssh://core@127.0.0.1:59989/run/user/502/podman/podman.sock",
      Identity: identity,
      IsMachine: true,
      Default: true,
      ReadWrite: true,
    },
    {
      Name: "podman-machine-default-root",
      URI: "ssh://root@127.0.0.1:59989/run/podman/podman.sock",
      Identity: identity,
      IsMachine: true,
      Default: false,
      ReadWrite: true,
    },
  ]);
}

interface Engine {
  info?: Partial<RunResult>;
  machine?: string;
  imagePresent?: boolean;
  hostPort?: () => number;
  running?: boolean;
  connections?: string;
}

/** A scripted docker/podman CLI holding one container. */
function engineFake(e: Engine = {}) {
  let created: string | null = null;
  let running = false;
  let defHash = "hash";
  const inspectOf = (): ContainerInspect => ({
    Id: "cid-1",
    Config: { Labels: { "pi.service": "docling", "pi.owner": "iid-1", "pi.def-hash": defHash } },
    State: { Running: e.running ?? running },
    NetworkSettings: { Ports: { "5001/tcp": [{ HostIp: "127.0.0.1", HostPort: String(e.hostPort?.() ?? 54264) }] } },
  });
  return recordingRunner((_f, args) => {
    switch (args[0]) {
      case "info":
        return e.info ?? { stdout: JSON.stringify({ OSType: "linux" }) };
      case "machine":
        return { stdout: e.machine ?? "[]" };
      case "image":
        return e.imagePresent === false ? { code: 1, stderr: "No such image" } : { stdout: "[{}]" };
      case "ps":
        return { stdout: created ?? "" };
      case "create":
        created = "cid-1";
        defHash = args.find((a) => a.startsWith("pi.def-hash="))?.slice("pi.def-hash=".length) ?? defHash;
        return { stdout: "cid-1\n" };
      case "start":
        running = true;
        return {};
      case "stop":
        running = false;
        return {};
      case "inspect":
        return { stdout: JSON.stringify(created ? [inspectOf()] : []) };
      case "system":
        return { stdout: e.connections ?? "[]" };
      default:
        return { code: 1 };
    }
  });
}

function twoSecretDef(): ServiceDefinition {
  return ociDef({
    oci: { image: DIGEST, ports: { http: { container: 5001, protocol: "http" } }, env: { LOG_LEVEL: "info" } },
    secrets: { password: { env: "PASSWORD_FILE" }, token: {} },
  });
}

describe("E29 — create argv: --init, labels, loopback ports, :ro secret mounts, never -e/--env-file", () => {
  it("captures the argv and the env", async () => {
    const r = root();
    const paths = servicesPaths(r);
    const fake = engineFake();
    const d = new OciDriver({ runtime: "docker", run: fake.run, resolveBinary: (n) => `/usr/bin/${n}`, paths });
    const secrets = { password: "SVCTEST-pw-91f2", token: "SVCTEST-tok-77aa" };
    const inst = await d.start(twoSecretDef(), { secrets, defHash: "hash", instanceId: "iid-1" });
    const create = fake.calls.find((c) => c.args[0] === "create")!;
    const a = create.args;
    expect(a).toContain("--init");
    expect(a.filter((x) => x.startsWith("pi."))).toEqual(["pi.service=docling", "pi.owner=iid-1", "pi.def-hash=hash"]);
    expect(a).toContain("127.0.0.1::5001");
    const mounts = a.filter((x) => x.endsWith(":ro"));
    expect(mounts).toEqual([
      `${path.join(paths.secretsDir("docling"), "password")}:/run/secrets/password:ro`,
      `${path.join(paths.secretsDir("docling"), "token")}:/run/secrets/token:ro`,
    ]);
    expect(a).not.toContain("--env-file");
    const envArgs = a.filter((_x, i) => a[i - 1] === "-e");
    expect(envArgs.sort()).toEqual(["LOG_LEVEL=info", "PASSWORD_FILE=/run/secrets/password"]);
    for (const call of fake.calls) {
      expect(call.args.join(" ")).not.toMatch(/SVCTEST-/);
      expect(call.args[0]).not.toBe("pull");
      expect(call.env?.DOCKER_CONFIG).toBe(paths.emptyDockerConfig);
    }
    expect(fs.readFileSync(path.join(paths.secretsDir("docling"), "password"), "utf8")).toBe(secrets.password);
    expect(fs.statSync(paths.secretsDir("docling")).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(paths.secretsDir("docling"), "token")).mode & 0o777).toBe(0o600);
    expect(inst.endpoints).toEqual({ http: "http://127.0.0.1:54264" });
  });
});

describe("E30 — presence order and reasons", () => {
  const cases: Array<[string, Engine, boolean, string]> = [
    ["engine down + podman machine stopped", { info: { code: 125 }, machine: JSON.stringify([{ Name: "m", Running: false }]) }, true, "host-vm-stopped"],
    ["engine down", { info: { code: 1 } }, true, "runtime-unreachable"],
    ["image absent", { imagePresent: false }, true, "image-absent"],
    ["Windows-container mode", { info: { stdout: JSON.stringify({ OSType: "windows" }) } }, true, "unsupported-platform"],
  ];
  it("binary missing → runtime-missing, no command at all", async () => {
    const fake = engineFake();
    const d = new OciDriver({ runtime: "podman", run: fake.run, resolveBinary: () => null, paths: servicesPaths(root()) });
    expect(await d.presence(ociDef())).toMatchObject({ ok: false, reason: "runtime-missing" });
    expect(fake.calls).toEqual([]);
  });
  it.each(cases)("%s → %s", async (_l, engine, binary, reason) => {
    const fake = engineFake(engine);
    const d = new OciDriver({ runtime: "podman", run: fake.run, resolveBinary: (n) => (binary ? `/usr/bin/${n}` : null), paths: servicesPaths(root()) });
    expect(await d.presence(ociDef())).toMatchObject({ ok: false, reason });
    const order = fake.calls.map((c) => c.args[0]);
    const firstImage = order.indexOf("image");
    if (firstImage >= 0) {
      expect(order.indexOf("info")).toBeLessThan(firstImage);
      expect(engine.info?.code ?? 0).toBe(0);
    } else {
      expect(reason).not.toBe("image-absent");
    }
  });
  it("engine down is never reported as image-absent", async () => {
    const fake = engineFake({ info: { code: 1 }, imagePresent: false });
    const d = new OciDriver({ runtime: "docker", run: fake.run, resolveBinary: (n) => `/usr/bin/${n}`, paths: servicesPaths(root()) });
    expect((await d.presence(ociDef())) as { reason: string }).toMatchObject({ reason: "runtime-unreachable" });
    expect(fake.calls.some((c) => c.args[0] === "image")).toBe(false);
  });
});

describe("E31 — every driver fails: first preference's reason, tried lists all", () => {
  it("docker unreachable, podman image-absent", async () => {
    const r = root();
    writeDefinitions(r, [ociDef({ drivers: ["oci:docker", "oci:podman"] })]);
    const runner = recordingRunner((file, args) => {
      if (args[0] === "info") return file.endsWith("docker") ? { code: 1 } : { stdout: "{}" };
      if (args[0] === "image") return { code: 1 };
      if (args[0] === "desktop") return { code: 1 };
      return { stdout: "" };
    });
    const mk = (runtime: "docker" | "podman") => new OciDriver({ runtime, run: runner.run, resolveBinary: (n) => `/usr/bin/${n}`, paths: servicesPaths(r) });
    const { manager } = makeManager(r, { run: runner.run, drivers: { "oci:docker": mk("docker"), "oci:podman": mk("podman") } });
    const p = await manager.ensure("docling");
    expect(p.state).toBe("unavailable");
    expect(p.reason).toBe("runtime-unreachable");
    expect(p.tried).toEqual([
      { driver: "oci:docker", reason: "runtime-unreachable" },
      { driver: "oci:podman", reason: "image-absent" },
    ]);
    expect((await manager.list()).services[0].tried).toEqual(p.tried);
  });
});

describe("E32 — host port re-read after every start", () => {
  it("54264 then 62520 after a restart", async () => {
    const r = root();
    writeDefinitions(r, [ociDef()]);
    const ports = [54264, 62520];
    let starts = 0;
    const fake = engineFake({ hostPort: () => ports[Math.min(starts, 1)] });
    const run = fake.run;
    const counting: typeof run = async (f, a, o) => {
      const res = await run(f, a, o);
      if (a[0] === "stop") starts++;
      return res;
    };
    const d = new OciDriver({ runtime: "docker", run: counting, resolveBinary: (n) => `/usr/bin/${n}`, paths: servicesPaths(r), sleep: async () => {} });
    const { manager } = makeManager(r, { run: counting, drivers: { "oci:docker": d } });
    expect((await manager.ensure("docling")).endpoints).toEqual({ http: "http://127.0.0.1:54264" });
    await manager.stop("docling");
    expect((await manager.ensure("docling")).endpoints).toEqual({ http: "http://127.0.0.1:62520" });
    expect(fake.calls.filter((c) => c.args[0] === "create").length).toBe(1); // retained, restarted
  });
});

describe("E33 — host VMs are never started or stopped", () => {
  it("stopped podman machine: ensure + idle-stop issue no machine/desktop control argv", async () => {
    const r = root();
    writeDefinitions(r, [ociDef({ drivers: ["oci:podman"] })]);
    const machine = { stopped: true };
    const engine = engineFake();
    const runner = recordingRunner((_f, args) => {
      if (args[0] === "info") return machine.stopped ? { code: 125 } : { stdout: "{}" };
      if (args[0] === "machine") return { stdout: JSON.stringify([{ Name: "podman-machine-default", Running: !machine.stopped }]) };
      return engine.run(_f, args);
    });
    const d = new OciDriver({ runtime: "podman", run: runner.run, resolveBinary: (n) => `/usr/bin/${n}`, paths: servicesPaths(r), cacheMs: 0, sleep: async () => {} });
    const { manager, clock } = makeManager(r, { run: runner.run, drivers: { "oci:podman": d } });
    const p = await manager.ensure("docling");
    expect([p.state, p.reason]).toEqual(["unavailable", "host-vm-stopped"]);
    machine.stopped = false;
    const ok = await manager.ensure("docling");
    expect(ok.state).toBe("healthy");
    manager.release("docling", ok.leaseId as string);
    await manager.tick();
    clock.advance(16 * 60_000);
    await manager.tick();
    const forbidden = runner.calls.filter(
      (c) => (c.args[0] === "machine" && ["start", "stop", "rm"].includes(c.args[1])) || c.args[0] === "desktop" && c.args[1] !== "status",
    );
    expect(forbidden).toEqual([]);
    expect(runner.calls.some((c) => c.args[0] === "stop")).toBe(true); // the container was idle-stopped
  });
});

describe("X7 — a broken registry credHelper cannot break a local start", () => {
  it("every runtime call uses an EMPTY dashboard-owned DOCKER_CONFIG", async () => {
    const r = root();
    const home = path.join(r, "home");
    fs.mkdirSync(path.join(home, ".docker"), { recursive: true });
    fs.writeFileSync(path.join(home, ".docker", "config.json"), JSON.stringify({ credHelpers: { "ghcr.io": "failing-helper" } }));
    const paths = servicesPaths(path.join(r, "dash"));
    const fake = engineFake();
    const d = new OciDriver({ runtime: "docker", run: fake.run, resolveBinary: (n) => `/usr/bin/${n}`, paths });
    await d.start(ociDef(), { secrets: {}, defHash: "hash", instanceId: "iid-1" });
    for (const c of fake.calls) {
      expect(c.env?.DOCKER_CONFIG).toBe(paths.emptyDockerConfig);
      expect(c.env?.DOCKER_CONFIG?.startsWith(home)).toBe(false);
    }
    expect(fs.readdirSync(paths.emptyDockerConfig)).toEqual([]);
    expect(fake.calls.some((c) => c.file.includes("failing-helper"))).toBe(false);
  });
});

describe("X8 — podman machine: host probe fails → owned ssh tunnel", () => {
  it("spawns ssh -N -L with the connection's identity/port, rewrites the endpoint, kills it on stop", async () => {
    const r = root();
    writeDefinitions(r, [ociDef({ drivers: ["oci:podman"] })]);
    const identity = path.join(r, "machine-key");
    fs.writeFileSync(identity, "key");
    const fake = engineFake({ connections: connectionFixture(identity) });
    const child = Object.assign(new EventEmitter(), { pid: 5555, unref: vi.fn() });
    const spawn = vi.fn(() => child);
    const kill = vi.fn(async () => ({ ok: true, forced: false }));
    const d = new OciDriver({
      runtime: "podman",
      run: fake.run,
      resolveBinary: (n) => `/usr/bin/${n}`,
      paths: servicesPaths(r),
      spawn: spawn as never,
      killProcess: kill,
      allocatePort: async () => 47001,
      sleep: async () => {},
      waitForForward: async () => true,
      isProcessAlive: () => true,
    });
    const { manager } = makeManager(r, {
      run: fake.run,
      drivers: { "oci:podman": d },
      probe: async (_def, inst) => inst.endpoints.http === "http://127.0.0.1:47001",
    });
    const p = await manager.ensure("docling");
    expect(p.state).toBe("healthy");
    expect(p.endpoints).toEqual({ http: "http://127.0.0.1:47001" });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(bin).toBe("/usr/bin/ssh");
    expect(args).toEqual(expect.arrayContaining(["-N", "-L", "127.0.0.1:47001:127.0.0.1:54264", "-i", identity, "-p", "59989", "core@127.0.0.1"]));
    await manager.stop("docling");
    expect(kill).toHaveBeenCalledWith(5555, expect.anything());
  });
});

describe("X8 follow-up — a previous server's tunnel never leaks", () => {
  function driverFor(r: string, cmdOf: (pid: number) => string | null) {
    const identity = path.join(r, "machine-key");
    fs.writeFileSync(identity, "key");
    const fake = engineFake({ connections: connectionFixture(identity) });
    const kill = vi.fn(async () => ({ ok: true, forced: false }));
    const waits: number[] = [];
    const d = new OciDriver({
      runtime: "podman",
      run: fake.run,
      resolveBinary: (n) => `/usr/bin/${n}`,
      paths: servicesPaths(r),
      spawn: (() => Object.assign(new EventEmitter(), { pid: 6000, unref: vi.fn() })) as never,
      killProcess: kill,
      allocatePort: async () => 47002,
      waitForForward: async (port) => {
        waits.push(port);
        return true;
      },
      isProcessAlive: () => true,
      readCommandLine: async (pid) => cmdOf(pid),
    });
    return { d, kill, waits, paths: servicesPaths(r) };
  }
  const inst = { driver: "oci:podman" as const, startedBy: "dashboard" as const, endpoints: { http: "http://127.0.0.1:40521" } };

  it("kills a recorded stale ssh forward before opening a new one, records the new pid, waits for the forward", async () => {
    const r = root();
    const { d, kill, waits, paths } = driverFor(r, () => "/usr/bin/ssh -N -L 127.0.0.1:56577:127.0.0.1:40521 -i k core@127.0.0.1");
    fs.mkdirSync(paths.runDir("docling"), { recursive: true });
    fs.writeFileSync(paths.tunnelFile("docling"), JSON.stringify({ pid: 7777, forwards: ["127.0.0.1:56577:127.0.0.1:40521"] }));
    const next = await d.onProbeFailed(ociDef({ drivers: ["oci:podman"] }), inst);
    expect(kill).toHaveBeenCalledWith(7777, expect.anything());
    expect(next?.tunnelPid).toBe(6000);
    expect(JSON.parse(fs.readFileSync(paths.tunnelFile("docling"), "utf8"))).toEqual({ pid: 6000, forwards: ["127.0.0.1:47002:127.0.0.1:40521"] });
    expect(waits).toEqual([47002]);
  });

  it.each([
    ["pid reused by another program", "/usr/bin/vim notes.txt"],
    ["the user's own unrelated ssh -L", "ssh -N -L 8080:db.internal:5432 me@bastion"],
  ])("never signals a recorded pid that is not that exact forward: %s", async (_l, cmd) => {
    const r = root();
    const { d, kill, paths } = driverFor(r, () => cmd);
    fs.mkdirSync(paths.runDir("docling"), { recursive: true });
    fs.writeFileSync(paths.tunnelFile("docling"), JSON.stringify({ pid: 7777, forwards: ["127.0.0.1:56577:127.0.0.1:40521"] }));
    await d.onProbeFailed(ociDef({ drivers: ["oci:podman"] }), inst);
    expect(kill).not.toHaveBeenCalledWith(7777, expect.anything());
  });
});
