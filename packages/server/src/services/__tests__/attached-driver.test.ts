/**
 * Attached driver: argv without a shell, external instances, stop confirmed
 * only by the executable matcher. See change: add-service-registry-core
 * (test-plan E38, X5).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachedDriver } from "../attached-driver.js";
import { FakeClock, makeManager, recordingRunner, tmpRoot, writeDefinitions } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function obsDef(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    id: "obs",
    mode: "attached",
    endpoints: { ws: "ws://127.0.0.1:4455" },
    lifecycle: { start: { darwin: ["open", "-a", "A; rm -rf"] }, stop: { darwin: ["osascript", "-e", 'quit app "OBS"'] } },
    process: { name: "OBS" },
    health: { kind: "ws-first-message", endpoint: "ws" },
    idleStopMinutes: 15,
    stopTimeoutSec: 15,
    secrets: { password: { env: "OBS_PASSWORD" } },
    origin: "user",
    ...overrides,
  } as ServiceDefinition;
}

describe("E38 — argv verbatim, never a shell", () => {
  it("spawns shell:false with metacharacters passed through untouched", async () => {
    const spawn = vi.fn(() => Object.assign(new EventEmitter(), { pid: 99, unref: vi.fn() }));
    const d = new AttachedDriver({ run: recordingRunner().run, platform: "darwin", spawn: spawn as never, findProcesses: async () => [] });
    const inst = await d.start(obsDef(), { secrets: { password: "SVCTEST-obs" }, defHash: "h", instanceId: "i" });
    const [file, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { shell: boolean; env: NodeJS.ProcessEnv }];
    expect(file).toBe("open");
    expect(args).toEqual(["-a", "A; rm -rf"]);
    expect(opts.shell).toBe(false);
    expect(opts.env.OBS_PASSWORD).toBe("SVCTEST-obs");
    expect(inst.startedBy).toBe("dashboard");
  });

  it("an already-running instance is adopted as external, nothing spawned", async () => {
    const spawn = vi.fn();
    const d = new AttachedDriver({ run: recordingRunner().run, platform: "darwin", spawn: spawn as never, findProcesses: async () => [812] });
    expect((await d.start(obsDef(), { secrets: {}, defHash: "h", instanceId: "i" })).startedBy).toBe("external");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("no command for this platform → cannot start / stop", () => {
    const d = new AttachedDriver({ run: recordingRunner().run, platform: "linux" });
    expect(d.canStart(obsDef())).toBe(false);
    expect(d.canStop(obsDef())).toBe(false);
  });
});

describe("X3/X5 — stop is judged by the matcher, never by rc or probe", () => {
  function driverWith(clock: FakeClock, stopRc: number, exitAfterMs: number | null) {
    let exitAt: number | null = null;
    const run = recordingRunner(() => {
      exitAt = exitAfterMs === null ? null : clock.now() + exitAfterMs;
      return { code: stopRc };
    });
    const d = new AttachedDriver({
      run: run.run,
      platform: "darwin",
      now: clock.now,
      sleep: clock.sleep,
      findProcesses: async () => (exitAt !== null && clock.now() >= exitAt ? [] : [812]),
    });
    return d;
  }
  it("the stop argv runs verbatim — never wrapped in cmd.exe on win32", async () => {
    const calls: Array<{ file: string; args: readonly string[]; verbatim?: boolean }> = [];
    const d = new AttachedDriver({
      run: async (file, args, opts) => {
        calls.push({ file, args, verbatim: opts?.verbatim });
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      },
      platform: "win32",
      findProcesses: async () => [],
    });
    const def = obsDef({ lifecycle: { stop: { win32: ["taskkill", "/IM", "obs64.exe & calc"] } }, process: { name: "obs64" } });
    await d.stop(def, undefined, 1_000);
    expect(calls).toEqual([{ file: "taskkill", args: ["/IM", "obs64.exe & calc"], verbatim: true }]);
  });
  it("rc 1 but the process exits within stopTimeout → stopped", async () => {
    const clock = new FakeClock();
    expect(await driverWith(clock, 1, 5_000).stop(obsDef(), undefined, 15_000)).toBe("stopped");
  });
  it("rc 0 but the process stays → stop-failed", async () => {
    const clock = new FakeClock();
    expect(await driverWith(clock, 0, null).stop(obsDef(), undefined, 15_000)).toBe("stop-failed");
  });

  it("X5: a blocked attached instance whose process stays → stop-failed (probe failure is no proof)", async () => {
    const r = tmpRoot("svc-att-");
    roots.push(r);
    writeDefinitions(r, [obsDef({ secrets: undefined })]);
    const clock = new FakeClock();
    const spawn = vi.fn(() => Object.assign(new EventEmitter(), { pid: 99, unref: vi.fn() }));
    let running = false;
    const d = new AttachedDriver({
      run: recordingRunner().run,
      platform: "darwin",
      spawn: (() => {
        running = true;
        return spawn();
      }) as never,
      now: clock.now,
      sleep: clock.sleep,
      findProcesses: async () => (running ? [812] : []),
    });
    const { manager, probeOk } = makeManager(r, { drivers: { attached: d }, clock, platform: "darwin" });
    probeOk.value = false;
    expect((await manager.ensure("obs")).state).toBe("blocked");
    const res = await manager.stop("obs");
    expect(res.state).toBe("stop-failed");
  });
});
