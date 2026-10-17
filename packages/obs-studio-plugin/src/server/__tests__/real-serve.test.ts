/**
 * X3 bridge lifetime with a REAL `pi-obs serve --stdio` child (via
 * `process.execPath` + `bin/pi-obs.mjs`) behind a stub `service exec` parent:
 * EOF → serve exits within 1 s; a request flows end-to-end to a fake OBS;
 * dispose with a child ignoring EOF closes stdin first and kills only after
 * the grace period. See change: add-obs-studio-plugin (test-plan X3).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeObs, startFakeObs } from "../../core/__tests__/fake-obs.js";
import { BridgeManager } from "../bridge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PI_OBS = path.resolve(here, "..", "..", "..", "bin", "pi-obs.mjs");
const STUB_EXEC = path.join(here, "fixtures", "stub-exec.mjs");

const fakes: FakeObs[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});

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
    const { m, spawned } = manager();
    const r = await m.request("obs", f.url, "scene.list");
    expect(r).toEqual({ current: "Webcam", scenes: ["Webcam"] });
    const child = spawned[0];
    const exited = new Promise<number>((res) => child.once("exit", (c) => res(c ?? -1)));
    const t0 = Date.now();
    child.stdin?.end();
    expect(await exited).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1000);
  }, 20_000);

  it("dispose with a child ignoring EOF: stdin closed first, exec killed only after the grace period", async () => {
    const { m, spawned } = manager({ STUB_IGNORE_EOF: "1" }, 600);
    void m.request("obs", "ws://127.0.0.1:1", "status").catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
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
