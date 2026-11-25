/**
 * serve_mock_site readiness under a base (D11): a launcher that is ready only after the 30 s budget, and one that ignores
 * `--base` and answers at another base. Readiness is the marker `{"mockSite":true}` at `${base}__mock/decisions` and nothing
 * else: an open port, a 503, or the marker at the wrong base is never success.
 *
 * Clock: the 30 s budget is driven with fake `Date`/`setTimeout` (advanced 1 s per real 25 ms) while the launcher child, the
 * sockets and the probe are real. So "ready only after 31-35 s" is modelled as "the readiness trigger fires after the tool
 * has already given up at 30 s of (fake) time".
 * See change: serve-live-previews-on-capability-origin (D11; test-plan #X55, #X56).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import frontendMockupLoop from "../extension.js";
import { children } from "../mock-site-serve.js";
import { freePort, httpGet, launchLog, makeFakeLauncherProject, portRefused } from "./mock-site-fake-launcher";

type Tool = { name: string; execute: (id: string, p: any) => Promise<{ content: { text: string }[]; details: any }> };
function fakePi() {
  const tools = new Map<string, Tool>();
  const events = { emit: vi.fn() };
  const pi: any = { registerTool: (t: Tool) => tools.set(t.name, t), registerCommand() {}, on() {}, events };
  frontendMockupLoop(pi);
  return { tool: tools.get("serve_mock_site")!, events };
}
const roots: string[] = [];
const realSetTimeout = globalThis.setTimeout;
const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

afterEach(() => {
  vi.useRealTimers();
  for (const c of children.values()) c.kill("SIGKILL");
  children.clear();
  delete process.env.FAKE_LOG;
  delete process.env.FAKE_READY_FILE;
  delete process.env.FAKE_IGNORE_BASE;
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

/** Run `start` while the fake clock advances 1 s per real 25 ms; `onTick(elapsedFakeMs)` runs on every step. */
async function runWithFakeClock<T>(start: () => Promise<T>, onTick: (elapsedMs: number) => void | Promise<void> = () => {}): Promise<{ result: T; elapsedMs: number; settledAt: number }> {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const t0 = Date.now();
  let settled = false;
  const p = start().finally(() => {
    settled = true;
  });
  let tick = 0;
  while (!settled) {
    await realSleep(25);
    await vi.advanceTimersByTimeAsync(1000);
    tick++;
    await onTick(Date.now() - t0);
    if (tick > 400) throw new Error("the start never settled");
  }
  const result = await p;
  const elapsedMs = Date.now() - t0;
  vi.useRealTimers();
  return { result, elapsedMs, settledAt: elapsedMs };
}

describe("T.X55 — start timeout under a base: readiness only after the budget", () => {
  it("a launcher that becomes ready after 31 s: `not ready within 30s on port N` + log tail, child killed, port freed, no false success, a later trigger leaves no listener", async () => {
    const { root, log } = makeFakeLauncherProject();
    roots.push(root);
    const ready = path.join(root, "ready.flag");
    process.env.FAKE_LOG = log;
    process.env.FAKE_READY_FILE = ready;
    const { tool } = fakePi();
    const port = await freePort();
    const base = "/some/prefix/";

    let sawListening = false;
    const { result, elapsedMs } = await runWithFakeClock(
      () => tool.execute("t", { dir: root, port, base }),
      async (elapsed) => {
        if (elapsed >= 5000 && elapsed < 28_000 && !sawListening) {
          // The launcher is up and the port is open, yet the tool must not report success: the marker is not served.
          expect((await httpGet(port, `${base}__mock/decisions`)).status).toBe(503);
          sawListening = true;
          expect(children.has(port)).toBe(false); // not registered as running: no false success
        }
      },
    );

    expect(sawListening).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(30_000); // the budget was honoured, not cut short
    expect(elapsedMs).toBeLessThan(33_000);
    const text = result.content[0].text;
    expect(text).toContain(`mock site not ready within 30s on port ${port}`);
    expect(text).toContain(`probed ${base}__mock/decisions`);
    expect(text).toContain("fake-launcher: waiting for readiness on base /some/prefix/"); // the log tail
    expect(result.details.local).toBeUndefined();
    expect(text).not.toMatch(/^\s*local:/m);
    expect(launchLog(log).map((l) => l.argv)).toEqual([expect.arrayContaining(["--base", base, "--port", String(port)])]); // started exactly once
    expect(children.size).toBe(0);
    expect(await portRefused(port)).toBe(true); // child killed, port freed

    // The "31-35 s" moment: the readiness trigger fires AFTER the tool gave up. Nothing can answer any more.
    fs.writeFileSync(ready, "now");
    await realSleep(600);
    expect(await portRefused(port)).toBe(true);
    expect(children.size).toBe(0);
    expect(launchLog(log)).toHaveLength(1); // no respawn
    // The port is reusable at once by a fresh start (a later-ready child left nothing behind).
    process.env.FAKE_READY_FILE = ready; // trigger already present: ready immediately
    const again = await tool.execute("t", { dir: root, port, base });
    expect(again.details.local).toBe(`http://localhost:${port}${base}`);
  }, 60_000);
});

describe("T.X56 — readiness under the wrong base", () => {
  it("app config base `/app/`, launcher ignores --base and serves `/app/`: the probe of `/some/prefix/__mock/decisions` is 404, never ready, the URL is in the error, the child is killed", async () => {
    const { root, log } = makeFakeLauncherProject({ appBase: "/app/" });
    roots.push(root);
    process.env.FAKE_LOG = log;
    process.env.FAKE_IGNORE_BASE = "/app/";
    const { tool } = fakePi();
    const port = await freePort();
    const base = "/some/prefix/";

    let checked = false;
    const { result, elapsedMs } = await runWithFakeClock(
      () => tool.execute("t", { dir: root, port, base }),
      async (elapsed) => {
        if (elapsed >= 5000 && elapsed < 28_000 && !checked) {
          checked = true;
          // The launcher is healthy at `/app/`, and 404 at the requested base: exactly the mismatch the probe must not forgive.
          expect(JSON.parse((await httpGet(port, "/app/__mock/decisions")).body)).toEqual({ mockSite: true });
          expect((await httpGet(port, `${base}__mock/decisions`)).status).toBe(404);
        }
      },
    );

    expect(checked).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(30_000);
    expect(elapsedMs).toBeLessThan(33_000);
    const text = result.content[0].text;
    expect(text).toContain(`mock site not ready within 30s on port ${port}`);
    expect(text).toContain(`probed ${base}__mock/decisions`); // the URL that never answered
    expect(text).not.toContain("/app/__mock/decisions");
    expect(result.details.local).toBeUndefined(); // never reports success
    expect(launchLog(log)[0].argv).toEqual(expect.arrayContaining(["--base", base])); // the flag WAS passed; the launcher ignored it
    expect(children.size).toBe(0);
    expect(await portRefused(port)).toBe(true);
  }, 60_000);
});
