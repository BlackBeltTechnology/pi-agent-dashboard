/**
 * Engine work-source fan-out: dynamic width + deferral (E2/E4/E7/E8), empty
 * no-op (E5), manual vend (E12), per-child `${{trigger}}` (E13/E14), lease
 * release on every terminal path (X3/X4/X5), source-error settle (X6), skipped
 * fire leases nothing (X8), idempotency-key injection, and the domain-free
 * engine invariant (X9).
 * See change: automation-work-source-fanout.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../server/action-registry.js";
import { createEngine } from "../server/engine.js";
import { listRuns, readChildRuns } from "../server/run-store.js";
import { WorkSourceRegistry } from "../server/work-source-registry.js";
import type { AutomationAction, DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";
import type { LeasedHandle, WorkSource } from "../shared/work-source.js";

/** In-memory fake work-source: single-flight leasing + ack/nack bookkeeping. */
class FakeSource implements WorkSource {
  available: string[];
  leases = new Map<string, string>();
  acked: string[] = [];
  nacked: string[] = [];
  nextCalls = 0;
  throwOnNext = false;
  private c = 0;
  constructor(items: string[]) {
    this.available = [...items];
  }
  next(n: number): LeasedHandle[] {
    this.nextCalls += 1;
    if (this.throwOnNext) throw new Error("source unreadable");
    const out: LeasedHandle[] = [];
    while (out.length < n && this.available.length > 0) {
      const item = this.available.shift()!;
      const token = `t${this.c++}`;
      this.leases.set(token, item);
      out.push({ item, leaseToken: token, idempotencyKey: `key:${item}` });
    }
    return out;
  }
  ack(token: string): void {
    const item = this.leases.get(token);
    if (item === undefined) return;
    this.leases.delete(token);
    this.acked.push(item);
  }
  nack(token: string): void {
    const item = this.leases.get(token);
    if (item === undefined) return;
    this.leases.delete(token);
    this.nacked.push(item);
    this.available.push(item);
  }
}

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-fanout-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function batchAutomation(
  name: string,
  opts: { source?: string; maxConcurrentSpawns?: number; action?: AutomationAction } = {},
): DiscoveredAutomation {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  return {
    name,
    scope: "folder",
    dir,
    valid: true,
    config: {
      on: { kind: "schedule.batch", cron: "* * * * *", source: opts.source ?? "fake" },
      action: opts.action ?? { kind: "skill", skill: "$x" },
      ...(opts.maxConcurrentSpawns ? { maxConcurrentSpawns: opts.maxConcurrentSpawns } : {}),
      model: "@fast",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: "skip",
    },
  };
}

function makeEngine(
  source: WorkSource,
  spawnCalls: Array<Record<string, unknown>>,
  opts: {
    spawnOk?: boolean;
    resolveRegistry?: () => ActionRegistry;
    abortSpawnedRun?: () => Promise<boolean>;
  } = {},
) {
  const reg = new WorkSourceRegistry();
  reg.register("fake", source);
  return createEngine({
    spawnSession: async (o) => {
      spawnCalls.push(o as Record<string, unknown>);
      return opts.spawnOk === false
        ? { success: false, message: "spawn boom" }
        : { success: true, spawnToken: `tok-${spawnCalls.length}` };
    },
    ...(opts.abortSpawnedRun ? { abortSpawnedRun: opts.abortSpawnedRun } : {}),
    listScopes: () => [{ base: repo, scope: "folder" }],
    workSources: reg,
    config: () => ({
      defaultVisibility: "hidden",
      retention: 100,
      defaultModel: "anthropic/claude-sonnet-4-5",
      scanFolder: true,
      scanGlobal: false,
      maxRunAgeMs: 30 * 60 * 1000,
      maxConcurrentSpawns: 4,
    }),
    readRoles: () => ({ fast: "anthropic/claude-haiku-4-5" }),
    ...(opts.resolveRegistry ? { resolveRegistry: opts.resolveRegistry } : {}),
    warn: () => {},
  });
}

function parent(name: string, runId: string): RunRecord {
  return listRuns(repo, name).find((r) => r.runId === runId)!;
}
function childrenOf(name: string, runId: string): RunRecord[] {
  return readChildRuns(repo, parent(name, runId));
}
const flush = () => new Promise((r) => setImmediate(r));

describe("work-source fan-out width", () => {
  it("E4: dynamic width equals items vended (3 items, bound 4 → 3 children)", () => {
    const src = new FakeSource(["a", "b", "c"]);
    const engine = makeEngine(src, []);
    const { runId } = engine.startRunFor(batchAutomation("w"))!;
    expect(childrenOf("w", runId)).toHaveLength(3);
    expect(src.nextCalls).toBe(1);
  });

  it("E2: bound defers excess (10 items, bound 4 → 4 children, 6 available, no warning)", () => {
    const src = new FakeSource(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const engine = makeEngine(src, []);
    const { runId } = engine.startRunFor(batchAutomation("w"))!;
    expect(childrenOf("w", runId)).toHaveLength(4);
    expect(src.available).toHaveLength(6);
    expect(parent("w", runId).warning).toBeUndefined();
  });

  it("E7: per-automation bound overrides the default (5 items, bound 2 → 2 children)", () => {
    const src = new FakeSource(["a", "b", "c", "d", "e"]);
    const engine = makeEngine(src, []);
    const { runId } = engine.startRunFor(batchAutomation("w", { maxConcurrentSpawns: 2 }))!;
    expect(childrenOf("w", runId)).toHaveLength(2);
    expect(src.available).toHaveLength(3);
  });

  it("E8: within-limit fan-out records no warning (2 items, bound 4)", () => {
    const src = new FakeSource(["a", "b"]);
    const engine = makeEngine(src, []);
    const { runId } = engine.startRunFor(batchAutomation("w"))!;
    expect(childrenOf("w", runId)).toHaveLength(2);
    expect(parent("w", runId).warning).toBeUndefined();
  });

  it("E12: manual run vends from the source (2 items → 2 children, no item-less child)", () => {
    const src = new FakeSource(["a", "b"]);
    const engine = makeEngine(src, []);
    // Manual run-now goes straight through startRunFor (bypasses concurrency).
    const { runId } = engine.startRunFor(batchAutomation("w"))!;
    expect(childrenOf("w", runId)).toHaveLength(2);
    expect(src.leases.size).toBe(2); // both items leased, none item-less
  });
});

describe("work-source empty + error settling", () => {
  it("E5: empty resolution spawns nothing and settles a completed no-op", () => {
    const src = new FakeSource([]);
    const engine = makeEngine(src, []);
    const r = engine.startRunFor(batchAutomation("w"));
    expect(r).toBeNull(); // no parent slot held
    const runs = listRuns(repo, "w");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("done");
    expect(readChildRuns(repo, runs[0]!)).toHaveLength(0);
  });

  it("X6: source next throws → fire errored, no child, nothing leased", () => {
    const src = new FakeSource(["a", "b"]);
    src.throwOnNext = true;
    const engine = makeEngine(src, []);
    const r = engine.startRunFor(batchAutomation("w"));
    expect(r).toBeNull();
    const runs = listRuns(repo, "w");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("error");
    expect(src.leases.size).toBe(0); // nothing left leased
  });
});

describe("per-child trigger injection", () => {
  function echoRegistry(): ActionRegistry {
    const reg = new ActionRegistry();
    reg.register({
      id: "test.echo",
      source: "test",
      label: "Echo",
      buildPrompt: ({ payload }) => String(payload.input ?? ""),
    });
    return reg;
  }

  it("E13/E14: each child resolves its OWN ${{trigger}} from its leased item", () => {
    const src = new FakeSource(["a", "b", "c"]);
    const engine = makeEngine(src, [], { resolveRegistry: echoRegistry });
    const a = batchAutomation("w", { action: { kind: "test.echo", payload: { input: "${{trigger}}" } } });
    const { runId } = engine.startRunFor(a)!;
    const kids = childrenOf("w", runId);
    // The pending run context still holds the per-child resolved prompt.
    const resolved = kids
      .map((k) => engine.pendingForRunId(k.runId)?.promptText)
      .sort();
    expect(resolved).toEqual(["a", "b", "c"]);
  });
});

describe("lease release on terminal status", () => {
  it("X5: done child acks its item, error child nacks its item", async () => {
    const src = new FakeSource(["a", "b"]);
    const engine = makeEngine(src, []);
    engine.startRunFor(batchAutomation("w"));
    await flush();
    // FIFO register: session-1 → item a's child, session-2 → item b's child.
    engine.onSessionRegistered("s1", repo);
    engine.onSessionRegistered("s2", repo);
    engine.onSessionEnded("s1", "did the thing"); // a → done → ack
    engine.onSessionDeath("s2"); // b → error → nack
    expect(src.acked).toEqual(["a"]);
    expect(src.nacked).toEqual(["b"]);
  });

  it("X3: a dead child releases its item back to the pool", async () => {
    const src = new FakeSource(["a"]);
    const engine = makeEngine(src, []);
    engine.startRunFor(batchAutomation("w"));
    await flush();
    engine.onSessionRegistered("s1", repo);
    engine.onSessionDeath("s1"); // no result → error → nack
    expect(src.nacked).toEqual(["a"]);
    expect(src.available).toContain("a"); // redispatchable next fire
  });

  it("X4: a spawn failure releases the leased item", async () => {
    const src = new FakeSource(["a"]);
    const engine = makeEngine(src, [], { spawnOk: false });
    engine.startRunFor(batchAutomation("w"));
    await flush();
    expect(src.nacked).toEqual(["a"]);
    expect(src.available).toContain("a");
  });

  it("releases the lease even when the stop abort rejects (finalize is guarded)", async () => {
    const src = new FakeSource(["a"]);
    const engine = makeEngine(src, [], {
      abortSpawnedRun: async () => {
        throw new Error("abort boom");
      },
    });
    const { runId } = engine.startRunFor(batchAutomation("w"))!;
    await flush();
    engine.onSessionRegistered("s1", repo); // binds the child + its sessionId
    await engine.stopRun(runId); // parent stop → stopChild → abort rejects (caught)
    expect(src.nacked).toEqual(["a"]); // lease still released
  });

  it("spawn-window: a stop during the spawn gap still releases the lease when abort rejects", async () => {
    const src = new FakeSource(["a"]);
    const engine = makeEngine(src, [], {
      abortSpawnedRun: async () => {
        throw new Error("abort boom");
      },
    });
    const { runId } = engine.startRunFor(batchAutomation("w"))!;
    // Stop BEFORE flushing: the spawn promise is still pending, so the child
    // has no sessionId/spawnToken yet — stopChild takes the spawn-window path.
    const stopP = engine.stopRun(runId);
    await flush(); // spawn resolves → spawn-window guard aborts (rejects, caught)
    await stopP;
    expect(src.nacked).toEqual(["a"]); // lease still released
  });

  it("releases the lease when child setup throws synchronously after leasing", async () => {
    const src = new FakeSource(["a"]);
    const engine = makeEngine(src, [], {
      resolveRegistry: () => {
        throw new Error("registry boom"); // buildRunDispatch throws in spawnChild
      },
    });
    engine.startRunFor(batchAutomation("w"));
    await flush(); // the settle is deferred to a microtask (runner-slot safety)
    expect(src.nacked).toEqual(["a"]);
    expect(src.available).toContain("a");
  });

  it("a synchronous single-child failure frees the runner slot (no permanent skip)", async () => {
    const src = new FakeSource(["a", "b"]);
    let boom = true;
    const engine = makeEngine(src, [], {
      resolveRegistry: () => {
        if (boom) throw new Error("registry boom");
        return new ActionRegistry();
      },
    });
    const a = batchAutomation("w"); // concurrency: skip
    engine.runner.fire(a); // first fire: child setup throws synchronously
    await flush();
    boom = false;
    // The slot must be free — a second fire is NOT dropped by skip.
    engine.runner.fire(a);
    await flush();
    expect(src.leases.size).toBeGreaterThan(0); // second fire actually leased+spawned
  });

  it("injects a stable idempotency key onto each child spawn stamp", () => {
    const src = new FakeSource(["a", "b"]);
    const calls: Array<Record<string, unknown>> = [];
    const engine = makeEngine(src, calls);
    engine.startRunFor(batchAutomation("w"));
    const keys = calls
      .map((c) => (c.automationRun as { idempotencyKey?: string }).idempotencyKey)
      .sort();
    expect(keys).toEqual(["key:a", "key:b"]);
  });
});

describe("concurrency gates leasing", () => {
  it("X8: a skipped overlapping fire leases nothing", async () => {
    const src = new FakeSource(["a", "b", "c", "d"]);
    const engine = makeEngine(src, []);
    const a = batchAutomation("w"); // concurrency: skip
    // First fire via the runner leases up to the bound (4) and holds the slot
    // (children never finalize here).
    engine.runner.fire(a);
    await flush();
    expect(src.nextCalls).toBe(1);
    const leasedAfterFirst = src.leases.size;
    // Second fire while the parent is still running → dropped by skip → no vend.
    engine.runner.fire(a);
    await flush();
    expect(src.nextCalls).toBe(1); // next() never called a second time
    expect(src.leases.size).toBe(leasedAfterFirst);
  });
});

describe("X9: the engine is domain-free", () => {
  it("contains no domain-specific item vocabulary", () => {
    const engineSrc = fs.readFileSync(
      path.resolve(process.cwd(), "packages/automation-plugin/src/server/engine.ts"),
      "utf-8",
    );
    expect(/invoiceId|invoicebot/i.test(engineSrc)).toBe(false);
  });
});
