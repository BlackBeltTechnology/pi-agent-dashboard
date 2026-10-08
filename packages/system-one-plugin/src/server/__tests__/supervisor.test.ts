// @vitest-environment node
/**
 * Managed backend supervisor. Tasks 6.1–6.9 (test-plan E28–E31, X10–X14).
 * Exemplar: packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts
 * plus the fake engine from task 1.4.
 * See change: add-system-one-registry.
 */
import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite0600, predict, stateDir, userConfigPath } from "@blackbelt-technology/pi-system-one";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeBackend, startFakeBackend } from "../../../../system-one/src/__tests__/helpers/fake-backend.js";
import { _resetForTests } from "../../../../system-one/src/config.js";
import { binDir, type Clock, defaultDeps, runDir, Supervisor, type SupervisorDeps, toolDir } from "../supervisor.js";

const ENGINE = fileURLToPath(new URL("./fixtures/fake-engine.mjs", import.meta.url));
const children: ChildProcess[] = [];
const fakes: FakeBackend[] = [];

beforeEach(() => {
  rmSync(userConfigPath(), { force: true });
  rmSync(stateDir(), { recursive: true, force: true });
  _resetForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const k of ["FAKE_MODELS", "FAKE_HEALTHY", "FAKE_TRAP_TERM"]) delete process.env[k];
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of children.splice(0)) {
    try {
      if (c.pid) process.kill(c.pid, "SIGKILL");
    } catch {
      // gone
    }
  }
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

function writeUser(backends: Record<string, unknown>): void {
  mkdirSync(dirname(userConfigPath()), { recursive: true });
  writeFileSync(userConfigPath(), JSON.stringify({ version: 1, backends, presets: { p: { chain: Object.keys(backends) } }, activePreset: "p" }));
}
const readUser = () => JSON.parse(readFileSync(userConfigPath(), "utf8"));

/** Install shim executables that exec the fake engine (child PID = node). */
function installShims(): void {
  mkdirSync(binDir(), { recursive: true });
  for (const bin of ["von", "laya-serve"]) {
    const p = join(binDir(), bin);
    writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${ENGINE}" "$@"\n`);
    chmodSync(p, 0o755);
  }
}
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as any).port;
      s.close(() => resolve(port));
    });
  });
}
function virtualClock(): Clock & { t: number } {
  const c = {
    t: 1_000_000,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
      await new Promise((r) => setTimeout(r, 1));
    },
  };
  return c;
}
function deps(over: Partial<SupervisorDeps> = {}): SupervisorDeps {
  const d = defaultDeps();
  return {
    ...d,
    findUv: () => "/fake/bin/uv",
    spawn: ((cmd: string, args: string[], opts: any) => {
      const c = nodeSpawn(cmd, args, opts);
      children.push(c);
      return c;
    }) as any,
    healthBudgetMs: 20_000,
    ...over,
  };
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitGone(pid: number, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !alive(pid);
}

describe("E28 port pick (6.1)", () => {
  it("skips busy, dashboard and other-backend ports; persists the pick", async () => {
    writeUser({ m: { kind: "managed", engine: "von" }, other: { kind: "managed", engine: "laya", port: 18404 } });
    const busy = new Set([18400, 18401, 18402]);
    const s = new Supervisor(deps({ portFree: async (p) => !busy.has(p), dashboardPort: () => 18403 }));
    const port = await s.pickPort("m");
    expect(port).toBe(18405);
    // start persists it (then fails on install with the fake uv — irrelevant here)
    const spawn = vi.fn(() => {
      const c: any = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      setTimeout(() => c.emit("exit", 1), 1);
      return c;
    });
    const s2 = new Supervisor(deps({ portFree: async (p) => !busy.has(p), dashboardPort: () => 18403, spawn: spawn as any }));
    await s2.start("m");
    const persisted = readUser().backends.m.port;
    expect(persisted).toBe(18405);
    expect([8000, 8080]).not.toContain(persisted);
  });
});

describe("E29 busy configured port (6.2)", () => {
  it("fails port-in-use without moving or spawning", async () => {
    writeUser({ m: { kind: "managed", engine: "von", port: 18420 } });
    const spawn = vi.fn();
    const s = new Supervisor(deps({ portFree: async (p) => p !== 18420, spawn: spawn as any }));
    expect(await s.start("m")).toMatchObject({ state: "failed", reason: "port-in-use" });
    expect(readUser().backends.m.port).toBe(18420);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("E30 platform + launcher (6.3)", () => {
  for (const platform of ["darwin", "linux", "win32"] as const)
    for (const uv of [true, false]) {
      it(`${platform} uv=${uv}`, async () => {
        writeUser({ m: { kind: "managed", engine: "von", port: await freePort() } });
        const spawn = vi.fn();
        const s = new Supervisor(deps({ platform, findUv: () => (uv ? "/x/uv" : null), spawn: spawn as any }));
        const expected = platform === "win32" ? "unsupported-platform" : uv ? "stopped" : "unavailable";
        expect(s.status("m").state).toBe(expected);
        if (expected !== "stopped") {
          expect((await s.start("m")).state).toBe(expected);
          expect(spawn).not.toHaveBeenCalled();
        }
      });
    }
});

describe("E31 argv (6.4)", () => {
  function recordingSpawn() {
    const calls: Array<{ cmd: string; args: string[]; opts: any }> = [];
    const spawn = vi.fn((cmd: string, args: string[], opts: any) => {
      calls.push({ cmd, args, opts });
      const c: any = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.pid = 4242;
      c.exitCode = null;
      c.signalCode = null;
      if (cmd.endsWith("uv")) {
        mkdirSync(binDir(), { recursive: true });
        for (const b of ["von", "laya-serve"]) writeFileSync(join(binDir(), b), "");
        setTimeout(() => c.emit("exit", 0), 1);
      }
      return c;
    });
    return { calls, spawn };
  }

  for (const engine of ["von", "laya"] as const) {
    it(engine, async () => {
      writeUser({ m: { kind: "managed", engine, port: 18410, checkpoint: "typed-decisions" } });
      const { calls, spawn } = recordingSpawn();
      const s = new Supervisor(deps({ spawn: spawn as any, portFree: async () => true, healthBudgetMs: 1, clock: virtualClock(), signal: (c: any) => c.emit("exit", null, "SIGTERM") }));
      await s.start("m");
      const [install, run] = calls;
      expect(install.args).toEqual(["tool", "install", engine === "von" ? "von-sdk==1.2.3" : "laya[serve]==0.3.20"]);
      expect(install.opts.env.UV_TOOL_DIR).toBe(toolDir());
      expect(install.opts.env.UV_TOOL_BIN_DIR).toBe(binDir());
      expect(toolDir().startsWith(join(stateDir(), "tools"))).toBe(true);
      expect(install.opts.shell).toBeUndefined();
      expect(run.opts.shell).toBeUndefined();
      if (engine === "von") {
        expect(run.cmd).toBe(join(binDir(), "von"));
        expect(run.args.join(" ")).toContain("--host 127.0.0.1 --port 18410");
      } else {
        expect(run.cmd).toBe(join(binDir(), "laya-serve"));
        expect(run.args).toEqual([]);
        expect(run.opts.env).toMatchObject({ LAYA_HOST: "127.0.0.1", LAYA_PORT: "18410", LAYA_MODELS: "typed-decisions" });
      }
    });
  }
});

describe("stop during install (review)", () => {
  it("terminates the installer and never launches the engine", async () => {
    writeUser({ m: { kind: "managed", engine: "von", port: 18415 } });
    const calls: string[] = [];
    let installer: any = null;
    const spawn = vi.fn((cmd: string) => {
      calls.push(cmd);
      const c: any = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.pid = 5151;
      c.exitCode = null;
      c.signalCode = null;
      if (cmd.endsWith("uv")) installer = c; // never exits on its own
      return c;
    });
    const signals: string[] = [];
    const s = new Supervisor(
      deps({
        spawn: spawn as any,
        portFree: async () => true,
        signal: (child: any, sig) => {
          signals.push(sig);
          child.exitCode = 1;
          child.emit("exit", null, sig);
        },
      }),
    );
    const starting = s.start("m");
    await vi.waitFor(() => expect(installer).not.toBeNull());
    expect(s.status("m").state).toBe("installing");
    expect((await s.stop("m")).state).toBe("stopped");
    expect(signals).toContain("SIGTERM");
    await starting;
    expect(calls.filter((c) => !c.endsWith("uv"))).toEqual([]);
    expect(s.status("m").state).toBe("stopped");
  });
});

describe("X10 health + failure (6.5)", () => {
  it("ready via /v1/models", async () => {
    installShims();
    writeUser({ m: { kind: "managed", engine: "von", port: await freePort() } });
    const s = new Supervisor(deps());
    await s.start("m");
    expect(await s.whenSettled("m")).toMatchObject({ state: "ready", lastHealthAt: expect.any(String) });
    await s.stop("m");
  });

  it("ready via the one-noul fallback when /v1/models is 404", async () => {
    installShims();
    process.env.FAKE_MODELS = "404";
    writeUser({ m: { kind: "managed", engine: "laya", port: await freePort() } });
    const s = new Supervisor(deps());
    await s.start("m");
    expect((await s.whenSettled("m")).state).toBe("ready");
    await s.stop("m");
  });

  it("failed at the 120 s budget, keeping the log", async () => {
    installShims();
    process.env.FAKE_HEALTHY = "0";
    writeUser({ m: { kind: "managed", engine: "von", port: await freePort() } });
    const clock = virtualClock();
    const s = new Supervisor(deps({ clock, healthBudgetMs: 120_000 }));
    const t0 = clock.t;
    await s.start("m");
    const st = await s.whenSettled("m");
    expect(st).toMatchObject({ state: "failed", reason: "health-timeout" });
    expect(clock.t - t0).toBeGreaterThanOrEqual(120_000);
    expect(s.log("m").join("\n")).toContain("fake engine on");
    expect(s.log("m").length).toBeLessThanOrEqual(50);
  });
});

describe("X11 crash (6.6)", () => {
  it("becomes failed; the next predict fails fast and the chain continues", async () => {
    installShims();
    const port = await freePort();
    const f = await startFakeBackend();
    fakes.push(f);
    writeUser({ m: { kind: "managed", engine: "von", port }, next: { kind: "http", url: f.url, model: "x" } });
    const s = new Supervisor(deps());
    await s.start("m");
    const ready = await s.whenSettled("m");
    expect(ready.state).toBe("ready");
    process.kill(ready.pid!, "SIGKILL");
    await waitGone(ready.pid!);
    await new Promise((r) => setTimeout(r, 50));
    expect(s.status("m").state).toBe("failed");
    const r = await predict({ consumer: { id: "c", failurePolicy: "fail-open" }, state: "s", questions: { q: { type: "noul", instructions: "i" } } });
    expect(r.ok && r.backendId).toBe("next");
    expect(r.attempts[0]).toMatchObject({ backendId: "m", outcome: "error" });
    expect(r.attempts[0].latencyMs).toBeLessThan(50);
  });
});

describe("X12 stop escalation (6.7)", () => {
  it("SIGTERM, then SIGKILL at 10 s; PID file removed", async () => {
    installShims();
    process.env.FAKE_TRAP_TERM = "1";
    writeUser({ m: { kind: "managed", engine: "von", port: await freePort() } });
    const clock = virtualClock();
    const signals: Array<{ sig: string; at: number }> = [];
    const s = new Supervisor(
      deps({
        clock,
        // Virtual sleep yields ~1 ms real per 500 ms poll, so the default 20 s
        // budget left the real engine child <100 ms to boot "ready" (flaky on
        // loaded CI shards). Polling stops at first health, so this is free.
        healthBudgetMs: 3_600_000,
        signal: (child, sig) => {
          signals.push({ sig: String(sig), at: clock.t });
          child.kill(sig);
        },
      }),
    );
    await s.start("m");
    const st = await s.whenSettled("m");
    expect(st.state).toBe("ready");
    await new Promise((r) => setTimeout(r, 100)); // let the PID file land
    expect(readdirSync(runDir())).toHaveLength(1);
    const t0 = clock.t;
    await s.stop("m");
    expect(signals.map((x) => x.sig)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(signals[1].at - t0).toBeGreaterThanOrEqual(10_000);
    expect(await waitGone(st.pid!)).toBe(true);
    expect(existsSync(runDir()) ? readdirSync(runDir()) : []).toHaveLength(0);
  });
});

describe("X13 orphan cleanup (6.8)", () => {
  it("terminates only a matching live process; removes every PID file", async () => {
    const port = await freePort();
    const orphan = nodeSpawn(process.execPath, [ENGINE, "--port", String(port)], { stdio: "ignore" });
    const unrelated = nodeSpawn("sleep", ["30"], { stdio: "ignore" });
    children.push(orphan, unrelated);
    await new Promise((r) => setTimeout(r, 300));
    const info = defaultDeps().procInfo;
    const o = info(orphan.pid!)!;
    const u = info(unrelated.pid!)!;
    mkdirSync(runDir(), { recursive: true });
    atomicWrite0600(join(runDir(), "a.json"), JSON.stringify({ pid: orphan.pid, ...o, argv: [] }));
    atomicWrite0600(join(runDir(), "b.json"), JSON.stringify({ pid: unrelated.pid, startTime: "Mon Jan  1 00:00:00 2001", command: u.command, argv: [] }));
    const s = new Supervisor(deps());
    expect(await s.cleanupOrphans()).toBe(1);
    expect(await waitGone(orphan.pid!)).toBe(true);
    expect(alive(unrelated.pid!)).toBe(true);
    expect(readdirSync(runDir())).toHaveLength(0);
  });
});

describe("X14 lifecycle binding (6.9)", () => {
  it("shutdown stops both children; boot autostarts only the autostart backend", async () => {
    installShims();
    writeUser({
      a: { kind: "managed", engine: "von", port: await freePort(), autostart: true },
      b: { kind: "managed", engine: "laya", port: await freePort() },
    });
    const s = new Supervisor(deps());
    await s.start("a");
    await s.start("b");
    const [pa, pb] = [(await s.whenSettled("a")).pid!, (await s.whenSettled("b")).pid!];
    s.stopAllSync();
    expect(await waitGone(pa)).toBe(true);
    expect(await waitGone(pb)).toBe(true);

    const boot = new Supervisor(deps());
    await boot.autostart();
    expect((await boot.whenSettled("a")).state).toBe("ready");
    expect(boot.status("b").state).toBe("stopped");
    await boot.stop("a");
  });
});
