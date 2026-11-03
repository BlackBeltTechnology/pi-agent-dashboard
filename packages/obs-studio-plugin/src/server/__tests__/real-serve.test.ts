/**
 * X3 bridge lifetime with a REAL `pi-obs serve --stdio` child (via
 * `process.execPath` + `bin/pi-obs.mjs`) behind a stub `service exec` parent:
 * EOF → serve exits within 1 s; a request flows end-to-end to a fake OBS;
 * dispose with a child ignoring EOF closes stdin first and kills only after
 * the grace period. See change: add-obs-studio-plugin (test-plan X3).
 *
 * The stub forwards no signals (like the real exec), so dispose orphans the
 * EOF-ignoring grandchild. The stub records its pid (`STUB_CHILD_PID_FILE`);
 * `afterEach` reaps it and asserts it is gone (#1071).
 * See change: stabilize-flaky-unit-tests (test-plan E4, X1, X2, X5, X6).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isProcessAlive, killProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeObs, startFakeObs } from "../../core/__tests__/fake-obs.js";
import { BridgeManager } from "../bridge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PI_OBS = path.resolve(here, "..", "..", "..", "bin", "pi-obs.mjs");
const STUB_EXEC = path.join(here, "fixtures", "stub-exec.mjs");

/**
 * Read the stub's grandchild pid. Absent → undefined (nothing to reap). Present
 * but empty / non-numeric → throw: the stub writes it synchronously, so a
 * malformed file is a defect, never a skippable state (test-plan E4).
 */
function readStubPid(file: string): number | undefined {
  if (!fs.existsSync(file)) return undefined;
  const raw = fs.readFileSync(file, "utf8");
  const pid = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`malformed stub pid file ${file}: ${JSON.stringify(raw)}`);
  return pid;
}

/**
 * Bounded liveness poll: `killProcess` returns right after SIGKILL, before the
 * OS has necessarily finished termination, so a one-shot read can false-fail.
 * A pid still alive at `timeoutMs` rejects instead of hanging (test-plan X2).
 */
async function assertGone(pid: number, isAlive: (pid: number) => boolean = isProcessAlive, timeoutMs = 2000) {
  await vi.waitFor(() => expect(isAlive(pid), `pid ${pid} still alive`).toBe(false), { timeout: timeoutMs, interval: 50 });
}

/** Reap the pid recorded in `file` (if any) and assert it is gone. */
async function reapStubChild(file: string) {
  const pid = readStubPid(file);
  if (pid === undefined) return;
  await killProcess(pid, { timeoutMs: 1000 });
  await assertGone(pid);
}

const fakes: FakeObs[] = [];
const tmpDirs: string[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
  for (const dir of tmpDirs.splice(0)) {
    try {
      await reapStubChild(path.join(dir, "pid"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** A fresh tmp dir (removed in `afterEach`) and the pid-file path inside it. */
function pidFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "real-serve-"));
  tmpDirs.push(dir);
  return path.join(dir, "pid");
}

function manager(env: Record<string, string> = {}, grace = 5000) {
  const spawned: Array<ReturnType<typeof spawn>> = [];
  const m = new BridgeManager({
    cliArgv: [process.execPath, STUB_EXEC],
    nodePath: process.execPath,
    piObsEntry: PI_OBS,
    spawn: (argv) => {
      const c = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
      spawned.push(c);
      return c;
    },
    disposeGraceMs: grace,
  });
  return { m, spawned };
}

describe("X3 real serve child", () => {
  it("a request flows end-to-end; stdin EOF → serve (and exec) exit within 1 s", async () => {
    const f = await startFakeObs({ password: "pw", handlers: { GetSceneList: () => ({ currentProgramSceneName: "Webcam", scenes: [{ sceneName: "Webcam", sceneIndex: 0 }] }) } });
    fakes.push(f);
    // X5: without STUB_IGNORE_EOF the stub never writes the pid file.
    const file = pidFile();
    const { m, spawned } = manager({ STUB_CHILD_PID_FILE: file });
    const r = await m.request("obs", f.url, "scene.list");
    expect(r).toEqual({ current: "Webcam", scenes: ["Webcam"] });
    const child = spawned[0];
    const exited = new Promise<number>((res) => child.once("exit", (c) => res(c ?? -1)));
    const t0 = Date.now();
    child.stdin?.end();
    expect(await exited).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(fs.existsSync(file)).toBe(false);
  }, 20_000);

  it("dispose with a child ignoring EOF: stdin closed first, exec killed only after the grace period", async () => {
    const file = pidFile();
    const { m, spawned } = manager({ STUB_IGNORE_EOF: "1", STUB_CHILD_PID_FILE: file }, 600);
    void m.request("obs", "ws://127.0.0.1:1", "status").catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    // X1: the grandchild pid is recorded before dispose; afterEach reaps it.
    const pid = await vi.waitFor(() => {
      const p = readStubPid(file);
      expect(p).toBeGreaterThan(0);
      return p as number;
    });
    expect(isProcessAlive(pid)).toBe(true);
    // X5: grandchild argv unchanged (the issue's `pkill -f setInterval` still matches).
    if (process.platform !== "win32") expect(execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" })).toContain("setInterval");
    const child = spawned[0];
    let endedAt = 0;
    child.stdin?.once("finish", () => {
      endedAt = Date.now();
    });
    const killedAt = new Promise<number>((res) => child.once("exit", () => res(Date.now())));
    const t0 = Date.now();
    await m.dispose("obs");
    const k = await killedAt;
    expect(endedAt).toBeGreaterThan(0);
    expect(endedAt - t0).toBeLessThan(100);
    expect(k - t0).toBeGreaterThanOrEqual(550);
  }, 20_000);
});

describe("readStubPid (test-plan E4)", () => {
  it("absent file → undefined", () => {
    expect(readStubPid(path.join(path.dirname(pidFile()), "nope"))).toBe(undefined);
  });

  it("valid pid → the positive integer", () => {
    const file = pidFile();
    fs.writeFileSync(file, "4242");
    expect(readStubPid(file)).toBe(4242);
    fs.rmSync(file);
  });

  it.each([
    ["empty", ""],
    ["non-numeric", "abc"],
  ])("%s file → throws naming the path and contents", (_label, contents) => {
    const file = pidFile();
    fs.writeFileSync(file, contents);
    expect(() => readStubPid(file)).toThrow(`malformed stub pid file ${file}: ${JSON.stringify(contents)}`);
    fs.rmSync(file);
  });
});

describe("reap helpers (POSIX; test-plan X2, X6)", () => {
  it.runIf(process.platform !== "win32")("X2: the bounded poll tolerates a termination lag", async () => {
    let calls = 0;
    await assertGone(999_999, () => ++calls < 4);
    expect(calls).toBe(4);
  });

  it.runIf(process.platform !== "win32")("X2: a pid still alive at the deadline fails instead of hanging", async () => {
    const t0 = Date.now();
    await expect(assertGone(999_999, () => true, 300)).rejects.toThrow("pid 999999 still alive");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it.runIf(process.platform !== "win32")("X6: an already-dead pid reaps without throwing", async () => {
    const c = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const pid = c.pid as number;
    await new Promise((r) => c.once("exit", r));
    await assertGone(pid);
    await expect(killProcess(pid, { timeoutMs: 1000 })).resolves.toEqual({ ok: false, forced: false });
    await assertGone(pid);
  });
});
