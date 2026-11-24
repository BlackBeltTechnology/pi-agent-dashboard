/**
 * Cost of the `mock-site:base-reservation` wait before a launch (D11): no listener and an immediate `null` answer add no
 * measurable delay; a listener that never settles delays the launch by exactly the 2 s budget (fake timers).
 * "Before launch" is measured emit → `child_process.spawn` call, so the figure is the emitter's own wait, not node boot time.
 * See change: serve-live-previews-on-capability-origin (D11; test-plan #P25).
 */
import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import frontendMockupLoop from "../extension.js";
import { children, RESERVATION_WAIT_MS } from "../mock-site-serve.js";
import { freePort, makeFakeLauncherProject } from "./mock-site-fake-launcher";

const spawned = vi.hoisted(() => ({ at: [] as number[] }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      spawned.at.push(Date.now());
      return actual.spawn(...args);
    },
  };
});

type Tool = { name: string; execute: (id: string, p: any) => Promise<{ content: { text: string }[]; details: any }> };
type Probe = { port: number; pending?: Promise<unknown>; signal: AbortSignal };
function fakePi(onProbe?: (p: Probe) => void) {
  const tools = new Map<string, Tool>();
  const emitted: { at: number; probe: Probe }[] = [];
  const pi: any = {
    registerTool: (t: Tool) => tools.set(t.name, t),
    registerCommand() {},
    on() {},
    events: { emit: (_c: string, d: Probe) => { emitted.push({ at: Date.now(), probe: d }); onProbe?.(d); } },
  };
  frontendMockupLoop(pi);
  return { tool: tools.get("serve_mock_site")!, emitted };
}
const roots: string[] = [];
const realSetTimeout = globalThis.setTimeout;
const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));
afterEach(() => {
  vi.useRealTimers();
  for (const c of children.values()) c.kill("SIGKILL");
  children.clear();
  spawned.at.length = 0;
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const RUNS = 3;

describe("T.P25 — base-reservation wait before launch", () => {
  it("(a) no listener and (b) a listener answering null at once: < 100 ms between the probe and the launch, over 3 runs each", async () => {
    const { root } = makeFakeLauncherProject();
    roots.push(root);
    for (const [name, answer] of [["no listener", undefined], ["immediate null", () => Promise.resolve(null)]] as const) {
      for (let run = 0; run < RUNS; run++) {
        const { tool, emitted } = fakePi(answer ? (p) => { p.pending = answer(); } : undefined);
        const port = await freePort();
        spawned.at.length = 0;
        const r = await tool.execute("t", { dir: root, port });
        expect(r.details.local, `${name} #${run}`).toBe(`http://localhost:${port}`);
        expect(emitted, `${name} #${run}`).toHaveLength(1);
        expect(spawned.at, `${name} #${run}`).toHaveLength(1);
        expect(spawned.at[0] - emitted[0].at, `${name} #${run}: probe → launch`).toBeLessThan(100);
        expect(emitted[0].probe.signal.aborted).toBe(false); // an absent / null answer is not a failure
        await tool.execute("t", { stop: true, port });
      }
    }
  }, 60_000);

  it("(c) a listener that never settles: the launch begins 2000 ms (±250) after the probe, signal aborted, root start; 3 runs", async () => {
    const { root } = makeFakeLauncherProject();
    roots.push(root);
    for (let run = 0; run < RUNS; run++) {
      const { tool, emitted } = fakePi((p) => { p.pending = new Promise(() => {}); });
      const port = await freePort();
      spawned.at.length = 0;
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      let settled = false;
      const p = tool.execute("t", { dir: root, port }).finally(() => { settled = true; });
      for (let i = 0; !settled; i++) {
        await realSleep(10);
        await vi.advanceTimersByTimeAsync(100);
        if (i > 2000) throw new Error("the start never settled");
      }
      const r = await p;
      vi.useRealTimers();
      expect(emitted, `run ${run}`).toHaveLength(1);
      expect(spawned.at, `run ${run}`).toHaveLength(1);
      const waited = spawned.at[0] - emitted[0].at;
      expect(waited, `run ${run}: probe → launch`).toBeGreaterThanOrEqual(RESERVATION_WAIT_MS - 250);
      expect(waited, `run ${run}: probe → launch`).toBeLessThanOrEqual(RESERVATION_WAIT_MS + 250);
      expect(emitted[0].probe.signal.aborted).toBe(true); // the wait expired: the host is told to release
      expect(r.details.local).toBe(`http://localhost:${port}`);
      expect(r.content[0].text).toContain("base reservation unavailable");
      await tool.execute("t", { stop: true, port });
    }
  }, 120_000);
});
