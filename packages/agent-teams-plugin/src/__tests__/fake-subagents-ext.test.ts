/**
 * Self-test of the qa fake subagents extension (`qa/fixtures/fake-subagents.ext.ts`, task 2.7, decision B105): the
 * fixture reuses the recorded contract double and adds child scripts, slot promotion, a state file and a lag probe.
 * A mistake here would make every L2/L3 row that runs against it assert against the wrong "upstream", so the
 * behaviours the rows rely on are pinned here: the capability answer, the run end (completed|failed + idle in one tick),
 * the sentinels, the queue promotion, progress emissions that do not restart a run, the one-shot block, and the
 * state file a qa script reads. Fake timers, no pi process. The fixture lives outside this package's rootDir, so it is loaded
 * with a dynamic import by absolute path (a static import would fail `tsc`: TS6059) and typed by the local surface below.
 * See change: add-agent-teams-in-process.
 */
import { mkdtempSync, readFileSync as readState } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilitiesQuery, SpawnRequest } from "../shared/subagents-contract.js";
import { evaluateCapabilities } from "../shared/subagents-contract.js";
import type { DoubleBus, SubagentsDouble } from "./harness/subagents-double.js";
import { createDoubleBus } from "./harness/subagents-double.js";

interface FakeSubagentsConfig {
  runMs: number;
  maxConcurrent: number;
  progressMs: number;
  blockMs: number;
  lagProbeMs: number;
  stateFile?: string;
}
/** The part of `qa/fixtures/fake-subagents.ext.ts` this test uses. */
interface FixtureModule {
  default: (pi: never) => void;
  configFromEnv: (env?: Record<string, string | undefined>) => FakeSubagentsConfig;
  parseChildScript: (prompt: string | undefined, defaultRunMs: number) => { run: unknown; blockMs?: number };
  installFakeSubagents: (
    bus: DoubleBus,
    cfg: FakeSubagentsConfig,
    activation?: number,
    opts?: { block?: (ms: number) => void },
  ) => { double: SubagentsDouble; state: () => { loop?: { probeMs: number; maxGapMs: number; ticks: number } }; shutdown: () => void };
}
const FIXTURE = fileURLToPath(new URL("../../../../qa/fixtures/fake-subagents.ext.ts", import.meta.url));
const { default: fakeSubagents, configFromEnv, installFakeSubagents, parseChildScript } = (await import(/* @vite-ignore */ FIXTURE)) as FixtureModule;

const CFG: FakeSubagentsConfig = { runMs: 1000, maxConcurrent: 2, progressMs: 0, blockMs: 0, lagProbeMs: 0 };

const spawn = (bus: ReturnType<typeof createDoubleBus>, prompt = "do the thing"): Extract<NonNullable<SpawnRequest["out"]>, { ok: true }> => {
  const req: SpawnRequest = {
    request: { subagent_type: "general-purpose", description: "d", prompt, inline: true, isolated: true, managed: { owner: "agent-teams", keepAlive: true } },
  };
  bus.emit("subagents:spawn", req);
  expect(req.out?.ok).toBe(true);
  return req.out as Extract<NonNullable<SpawnRequest["out"]>, { ok: true }>;
};

const channels = (bus: ReturnType<typeof createDoubleBus>): string[] => {
  const seen: string[] = [];
  for (const c of ["created", "started", "completed", "failed", "idle", "disposed"]) bus.on(`subagents:${c}`, () => seen.push(c));
  return seen;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("parseChildScript", () => {
  it.each([
    [undefined, { run: { kind: "run", ms: 7 } }],
    ["plain prompt", { run: { kind: "run", ms: 7 } }],
    ["x [[fake-run:250]] y", { run: { kind: "run", ms: 250 } }],
    ["[[fake-run:forever]]", { run: { kind: "forever" } }],
    ["[[fake-run:fail:40]]", { run: { kind: "fail", ms: 40 } }],
    ["[[fake-run:soon]]", { run: { kind: "run", ms: 7 } }],
    ["[[fake-run:30]] [[fake-block:900]]", { run: { kind: "run", ms: 30 }, blockMs: 900 }],
  ])("%s", (prompt, expected) => {
    expect(parseChildScript(prompt, 7)).toEqual(expected);
  });
});

describe("configFromEnv", () => {
  it("defaults, valid values and rejects nonsense", () => {
    expect(configFromEnv({})).toEqual({ runMs: 1500, maxConcurrent: 4, progressMs: 0, blockMs: 0, lagProbeMs: 0 });
    expect(configFromEnv({ FAKE_SUBAGENTS_RUN_MS: "250", FAKE_SUBAGENTS_MAX_CONCURRENT: "2", FAKE_SUBAGENTS_STATE_FILE: "/tmp/x.json" })).toMatchObject({ runMs: 250, maxConcurrent: 2, stateFile: "/tmp/x.json" });
    expect(configFromEnv({ FAKE_SUBAGENTS_RUN_MS: "-5", FAKE_SUBAGENTS_MAX_CONCURRENT: "0" })).toMatchObject({ runMs: 1500, maxConcurrent: 4 });
  });
});

describe("fake subagents extension", () => {
  it("answers the capability query with a verdict the consumer accepts (maxConcurrent from the config)", () => {
    const bus = createDoubleBus();
    installFakeSubagents(bus, CFG);
    const q: CapabilitiesQuery = {};
    bus.emit("subagents:capabilities", q);
    const verdict = evaluateCapabilities(q.out);
    expect(verdict).toMatchObject({ available: true, limits: { maxConcurrent: 2 } });
  });

  it("a spawned child starts, then ends its run by itself: completed + idle in the same tick", () => {
    const bus = createDoubleBus();
    const seen = channels(bus);
    const fake = installFakeSubagents(bus, CFG);
    const out = spawn(bus);
    expect(out).toMatchObject({ status: "running" });
    expect(seen).toEqual(["created", "started"]);
    vi.advanceTimersByTime(990);
    expect(seen).toEqual(["created", "started"]);
    vi.advanceTimersByTime(20); // zero-delay hops of the fixture count 1 ms each under fake timers
    expect(seen).toEqual(["created", "started", "completed", "idle"]);
    expect(fake.double.children.get(out.agentId)?.state).toBe("idle");
  });

  it("the run length and kind come from the spawn prompt sentinel", () => {
    const bus = createDoubleBus();
    const seen = channels(bus);
    installFakeSubagents(bus, CFG);
    spawn(bus, "[[fake-run:fail:100]]");
    vi.advanceTimersByTime(100);
    expect(seen).toEqual(["created", "started", "failed", "idle"]);
  });

  it("`forever` never ends by itself", () => {
    const bus = createDoubleBus();
    const seen = channels(bus);
    const fake = installFakeSubagents(bus, CFG);
    const out = spawn(bus, "[[fake-run:forever]]");
    vi.advanceTimersByTime(10 * 60_000);
    expect(seen).toEqual(["created", "started"]);
    expect(fake.double.children.get(out.agentId)?.state).toBe("running");
  });

  it("a queued child gets the slot a finished child frees, without the test driving it (1-based queue position)", () => {
    const bus = createDoubleBus();
    const seen = channels(bus);
    const fake = installFakeSubagents(bus, { ...CFG, maxConcurrent: 1 });
    const first = spawn(bus);
    const second = spawn(bus);
    expect(second).toMatchObject({ status: "queued", queuePosition: 1 });
    vi.advanceTimersByTime(1010); // first ends
    vi.advanceTimersByTime(5); // promote -> started -> armed
    expect(fake.double.children.get(first.agentId)?.state).toBe("idle");
    expect(fake.double.children.get(second.agentId)?.state).toBe("running");
    expect(seen.filter((c) => c === "started")).toHaveLength(2);
    vi.advanceTimersByTime(1010);
    expect(fake.double.children.get(second.agentId)?.state).toBe("idle");
  });

  it("progress `started` emissions do not restart the run: one completed per run", () => {
    const bus = createDoubleBus();
    const seen = channels(bus);
    installFakeSubagents(bus, { ...CFG, progressMs: 100 });
    spawn(bus);
    vi.advanceTimersByTime(1010);
    expect(seen.filter((c) => c === "completed")).toHaveLength(1);
    expect(seen.filter((c) => c === "idle")).toHaveLength(1);
    expect(seen.filter((c) => c === "started").length).toBeGreaterThan(5);
  });

  it("a steer on the idle child starts a new run that ends on its own again", () => {
    const bus = createDoubleBus();
    const seen = channels(bus);
    const fake = installFakeSubagents(bus, CFG);
    const out = spawn(bus);
    vi.advanceTimersByTime(1010);
    bus.emit("subagents:steer_request", { id: out.id, message: "more" });
    expect(fake.double.children.get(out.agentId)).toMatchObject({ state: "running", run: 2 });
    vi.advanceTimersByTime(1010);
    expect(seen.filter((c) => c === "completed")).toHaveLength(2);
    expect(fake.double.children.get(out.agentId)?.state).toBe("idle");
  });

  it("blocks the event loop once: the env block at the first child, a sentinel block at its own child", () => {
    const bus = createDoubleBus();
    const block = vi.fn();
    installFakeSubagents(bus, { ...CFG, maxConcurrent: 4, blockMs: 500 }, 1, { block });
    spawn(bus);
    vi.advanceTimersByTime(5);
    expect(block).toHaveBeenCalledTimes(1);
    expect(block).toHaveBeenLastCalledWith(500);
    spawn(bus); // the env block is one-shot
    vi.advanceTimersByTime(5);
    expect(block).toHaveBeenCalledTimes(1);
    spawn(bus, "[[fake-block:42]]");
    vi.advanceTimersByTime(5);
    expect(block).toHaveBeenCalledTimes(2);
    expect(block).toHaveBeenLastCalledWith(42);
  });

  it("writes the observable state: children, event counters and the activation; shutdown empties the list", () => {
    const stateFile = join(mkdtempSync(join(tmpdir(), "fake-subagents-")), "state.json");
    const bus = createDoubleBus();
    const fake = installFakeSubagents(bus, { ...CFG, stateFile }, 3);
    const out = spawn(bus, "[[fake-run:forever]]");
    vi.advanceTimersByTime(200);
    const live = JSON.parse(readState(stateFile, "utf8"));
    expect(live).toMatchObject({ activation: 3, maxConcurrent: 2, children: { [out.agentId]: { state: "running", run: 1, managed: true } }, events: { "subagents:created": 1, "subagents:started": 1 } });
    fake.shutdown();
    const down = JSON.parse(readState(stateFile, "utf8"));
    expect(down).toMatchObject({ activation: 3, children: {}, shutdown: true, events: { "subagents:disposed": 1 } });
  });

  it("tracks the largest event-loop gap beyond the probe interval", () => {
    const bus = createDoubleBus();
    const fake = installFakeSubagents(bus, { ...CFG, lagProbeMs: 100 });
    vi.advanceTimersByTime(1000);
    expect(fake.state().loop).toMatchObject({ probeMs: 100, maxGapMs: 0 });
    expect(fake.state().loop?.ticks).toBeGreaterThanOrEqual(9);
    vi.setSystemTime(Date.now() + 700); // a starved loop: the next tick fires 700 ms late
    vi.advanceTimersByTime(100);
    expect(fake.state().loop?.maxGapMs).toBeGreaterThanOrEqual(700);
  });

  it("the extension entry installs on pi.events and disposes the children on session_shutdown (a reload leaves none)", () => {
    const bus = createDoubleBus();
    const handlers: Record<string, () => void> = {};
    fakeSubagents({ events: bus, on: (name: string, fn: () => void) => void (handlers[name] = fn) } as never);
    const q: CapabilitiesQuery = {};
    bus.emit("subagents:capabilities", q);
    expect(evaluateCapabilities(q.out)).toMatchObject({ available: true });
    const out = spawn(bus, "[[fake-run:forever]]");
    const disposed: unknown[] = [];
    bus.on("subagents:disposed", (e) => disposed.push(e));
    handlers.session_shutdown?.();
    expect(disposed).toEqual([{ agentId: out.agentId, reason: "shutdown" }]);
    const after: CapabilitiesQuery = {};
    bus.emit("subagents:capabilities", after);
    expect(after.out).toBeUndefined(); // uninstalled: nobody answers any more
  });
});
