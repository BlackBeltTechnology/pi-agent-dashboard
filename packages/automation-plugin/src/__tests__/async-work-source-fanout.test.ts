/**
 * Fan-out over an ASYNCHRONOUS work source (`schedule.batch` + a source whose
 * `next` resolves a promise).
 *
 * Relocated from the retired `per-invoice-fanout` / `run-now-fanout` tests: the
 * same guarantees, restated against the shipped work-source seam instead of a
 * payload discriminator + an injected domain enumerator. Every guarantee those
 * files asserted has a home here:
 *   - one child per vended item, each child bound to a DISTINCT item          (was: one run per queued id)
 *   - the item resolves into the child's payload AND its action `env` map      (was: ${invoice_id} + IB_* env)
 *   - an EMPTY vend spawns NOTHING                                            (was: empty queue fires nothing)
 *   - a source that cannot be resolved spawns NOTHING                          (was: no enumerator wired → skip)
 *   - a manual run always yields a settling run id                             (was: run-now on an empty queue)
 *   - a plain (non-batch) automation fires exactly once, no env                (unchanged)
 *   - each child keeps the AUTOMATION's own run name                           (unchanged)
 * Plus the three lease invariants the async path introduces: empty vend settles
 * `done` with zero children, a rejected vend errors with nothing leased, and a
 * failed spawn nacks its own handle.
 *
 * See change: relocate-fanout-to-work-source.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../server/action-registry.js";
import { createEngine } from "../server/engine.js";
import { listRuns, readChildRuns } from "../server/run-store.js";
import { WorkSourceRegistry } from "../server/work-source-registry.js";
import type { Concurrency, DiscoveredAutomation } from "../shared/automation-types.js";
import type { LeasedHandle, WorkSourceContext } from "../shared/work-source.js";

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-async-ws-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/** A work source whose vend is a PROMISE (the shape a store-backed source has). */
class AsyncFakeSource {
  available: string[];
  leases = new Map<string, string>(); // token → item
  nextCalls = 0;
  seenCwd: Array<string | undefined> = [];
  rejectNext = false;
  private seq = 0;

  constructor(items: string[]) {
    this.available = [...items];
  }

  async next(n: number, ctx?: WorkSourceContext): Promise<LeasedHandle<string>[]> {
    this.nextCalls += 1;
    this.seenCwd.push(ctx?.cwd);
    if (this.rejectNext) throw new Error("source unavailable");
    const take = this.available.splice(0, Math.max(0, n));
    return take.map((item) => {
      this.seq += 1;
      const leaseToken = `lease-${this.seq}`;
      this.leases.set(leaseToken, item);
      return { item, leaseToken, idempotencyKey: item };
    });
  }

  ack(token: string): void {
    this.leases.delete(token);
  }

  nack(token: string): void {
    const item = this.leases.get(token);
    if (item === undefined) return;
    this.leases.delete(token);
    this.available.push(item);
  }
}

interface SpawnOpts {
  cwd: string;
  automationRun?: { name: string; runId: string; idempotencyKey?: string };
  env?: Record<string, string>;
}

/** A flows-like action recording the payload it receives after substitution. */
function echoRegistry(seen: Array<Record<string, unknown>>): ActionRegistry {
  const reg = new ActionRegistry({ warn: () => {} });
  reg.register({
    id: "flows.run",
    source: "flows",
    label: "Run a flow",
    buildEvent: ({ payload }) => {
      seen.push(payload);
      const inputs = payload.inputs as Record<string, unknown> | undefined;
      return {
        eventType: "flow:run",
        data: { flowName: String(payload.flow ?? ""), ...(inputs ? { inputs } : {}) },
      };
    },
  });
  return reg;
}

/** A `schedule.batch` automation whose payload + env both reference the item. */
function batchAutomation(
  name: string,
  opts: { concurrency?: Concurrency; maxConcurrentSpawns?: number; source?: string } = {},
): DiscoveredAutomation {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  return {
    name,
    scope: "folder",
    dir,
    valid: true,
    config: {
      on: { kind: "schedule.batch", cron: "* * * * *", source: opts.source ?? "queued" },
      action: {
        kind: "flows.run",
        payload: {
          flow: "demo:process",
          inputs: { item_id: "${{trigger}}" },
          env: { DEMO_PROFILE: "scoped", DEMO_ITEM_ID: "${{trigger}}" },
        },
      },
      model: "@fast",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: opts.concurrency ?? "parallel",
      ...(opts.maxConcurrentSpawns ? { maxConcurrentSpawns: opts.maxConcurrentSpawns } : {}),
    },
  } as DiscoveredAutomation;
}

function makeEngine(
  source: AsyncFakeSource | undefined,
  spawnCalls: SpawnOpts[],
  seen: Array<Record<string, unknown>> = [],
  opts: { spawnOk?: boolean; warnings?: string[]; maxConcurrentSpawns?: number } = {},
) {
  const registry = new WorkSourceRegistry();
  if (source) registry.register("queued", source);
  return createEngine({
    spawnSession: async (o) => {
      spawnCalls.push(o as SpawnOpts);
      return opts.spawnOk === false
        ? { success: false, message: "spawn boom" }
        : { success: true, spawnToken: `tok-${spawnCalls.length}` };
    },
    resolveRegistry: () => echoRegistry(seen),
    listScopes: () => [{ base: repo, scope: "folder" }],
    workSources: registry,
    config: () => ({
      defaultVisibility: "hidden",
      retention: 100,
      defaultModel: "anthropic/claude-sonnet-4-5",
      scanFolder: true,
      scanGlobal: false,
      maxRunAgeMs: 30 * 60 * 1000,
      maxConcurrentSpawns: opts.maxConcurrentSpawns ?? 4,
    }),
    readRoles: () => ({ fast: "anthropic/claude-haiku-4-5" }),
    warn: (m) => opts.warnings?.push(m),
  });
}

const flush = () => new Promise((r) => setImmediate(r));
const parentRuns = () => listRuns(repo);
const parentById = (runId: string) => parentRuns().find((r) => r.runId === runId);
const childrenOf = (runId: string) => readChildRuns(repo, parentById(runId)!);

describe("async work-source fan-out", () => {
  it("spawns one child per vended item, each bound to a DISTINCT item", async () => {
    const src = new AsyncFakeSource(["a", "b", "c"]);
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine(src, spawnCalls, seen);

    const fire = engine.startRunFor(batchAutomation("drain"))!;
    await flush();

    expect(spawnCalls).toHaveLength(3);
    expect(childrenOf(fire.runId)).toHaveLength(3);
    // the item resolves per child, and no two children share one
    const items = seen.map((p) => (p.inputs as { item_id?: string }).item_id);
    expect(items).toEqual(["a", "b", "c"]);
    expect(new Set(items).size).toBe(3);
    for (const p of seen) expect((p.inputs as { item_id?: string }).item_id).not.toBe("${{trigger}}");
    // and the source saw the firing automation's workspace
    expect(src.seenCwd).toEqual([repo]);
  });

  it("forwards the action `env` map to the spawn, resolved per child", async () => {
    // C-ENV: this map is the only channel a per-run profile/authorization key
    // can travel on. Dropping it fails OPEN (a wider surface, no error), so the
    // forwarding is asserted at the engine's spawn boundary.
    const src = new AsyncFakeSource(["a", "b"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    engine.startRunFor(batchAutomation("drain"));
    await flush();

    expect(spawnCalls.map((c) => c.env?.DEMO_ITEM_ID)).toEqual(["a", "b"]);
    for (const c of spawnCalls) expect(c.env?.DEMO_PROFILE).toBe("scoped");
  });

  it("stamps each child with the item's stable idempotency key and the AUTOMATION's name", async () => {
    const src = new AsyncFakeSource(["a", "b"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    engine.startRunFor(batchAutomation("drain"));
    await flush();

    expect(spawnCalls.map((c) => c.automationRun?.idempotencyKey)).toEqual(["a", "b"]);
    for (const c of spawnCalls) expect(c.automationRun?.name).toBe("drain");
  });

  it("bounds parallelism and DEFERS the excess to a later fire", async () => {
    // The bound is the settings default (PI_AUTOMATION_MAX_CONCURRENT_SPAWNS
    // feeds it via settingsDefaultBound in the plugin entry).
    const src = new AsyncFakeSource(["a", "b", "c", "d", "e"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls, [], { maxConcurrentSpawns: 2 });

    const fire = engine.startRunFor(batchAutomation("drain"))!;
    await flush();

    expect(spawnCalls).toHaveLength(2);
    expect(childrenOf(fire.runId)).toHaveLength(2);
    expect(src.available).toEqual(["c", "d", "e"]); // not truncated — deferred
    expect(parentById(fire.runId)?.warning).toBeUndefined();

    const second = engine.startRunFor(batchAutomation("drain"))!;
    await flush();
    expect(spawnCalls).toHaveLength(4);
    expect(childrenOf(second.runId)).toHaveLength(2);
  });

  it("a per-automation bound overrides the settings default", async () => {
    const src = new AsyncFakeSource(["a", "b", "c"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls, [], { maxConcurrentSpawns: 4 });

    engine.startRunFor(batchAutomation("drain", { maxConcurrentSpawns: 1 }));
    await flush();

    expect(spawnCalls).toHaveLength(1);
    expect(src.available).toEqual(["b", "c"]);
  });
});

describe("async work-source lease invariants", () => {
  it("an EMPTY vend spawns NOTHING and settles the occurrence done", async () => {
    const src = new AsyncFakeSource([]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    // A manual run still yields a run id (the operator's click always settles).
    const fire = engine.startRunFor(batchAutomation("drain"))!;
    expect(fire.runId).toBeTruthy();
    await flush();

    expect(spawnCalls).toHaveLength(0);
    expect(childrenOf(fire.runId)).toHaveLength(0);
    expect(parentById(fire.runId)?.status).toBe("done");
    expect(src.leases.size).toBe(0);
    // the slot is released — the next fire is admitted
    expect(engine.runner.activeRunId("folder:drain")).toBeNull();
  });

  it("two consecutive empty runs each return a DISTINCT settling run id", async () => {
    const src = new AsyncFakeSource([]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    const first = engine.startRunFor(batchAutomation("drain"))!;
    await flush();
    const second = engine.startRunFor(batchAutomation("drain"))!;
    await flush();

    expect(first.runId).toBeTruthy();
    expect(second.runId).toBeTruthy();
    expect(second.runId).not.toBe(first.runId);
    expect(spawnCalls).toHaveLength(0);
  });

  it("a REJECTED vend errors the occurrence with nothing leased and nothing spawned", async () => {
    const src = new AsyncFakeSource(["a", "b"]);
    src.rejectNext = true;
    const spawnCalls: SpawnOpts[] = [];
    const warnings: string[] = [];
    const engine = makeEngine(src, spawnCalls, [], { warnings });

    const fire = engine.startRunFor(batchAutomation("drain"))!;
    await flush();

    expect(spawnCalls).toHaveLength(0);
    expect(childrenOf(fire.runId)).toHaveLength(0);
    expect(parentById(fire.runId)?.status).toBe("error");
    expect(src.leases.size).toBe(0);
    expect(src.available).toEqual(["a", "b"]); // untouched
    expect(warnings.some((w) => w.includes("source unavailable"))).toBe(true);
    expect(engine.runner.activeRunId("folder:drain")).toBeNull();
  });

  it("a FAILED spawn after leasing NACKs that handle (no item stranded)", async () => {
    const src = new AsyncFakeSource(["a", "b"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls, [], { spawnOk: false });

    const fire = engine.startRunFor(batchAutomation("drain"))!;
    await flush();
    await flush();

    expect(spawnCalls).toHaveLength(2);
    // both children failed → both leases returned to the pool
    expect(src.leases.size).toBe(0);
    expect(src.available.sort()).toEqual(["a", "b"]);
    expect(parentById(fire.runId)?.status).toBe("error");
  });

  it("a completed child ACKs its item (dropped, never re-vended)", async () => {
    const src = new AsyncFakeSource(["a"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    const fire = engine.startRunFor(batchAutomation("drain"))!;
    await flush();
    const child = childrenOf(fire.runId)[0]!;
    engine.onSessionRegisteredForRun("sess-1", child.runId);
    engine.onSessionEnded("sess-1", "- done");

    expect(src.leases.size).toBe(0);
    expect(src.available).toEqual([]); // acked → gone
    expect(parentById(fire.runId)?.status).toBe("done");
  });

  it("an unresolvable source spawns nothing and reports the failure", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const warnings: string[] = [];
    // No source registered under the id the automation names.
    const engine = makeEngine(undefined, spawnCalls, [], { warnings });

    const fire = engine.startRunFor(batchAutomation("drain"));

    expect(fire).toBeNull();
    expect(spawnCalls).toHaveLength(0);
    expect(warnings.some((w) => w.includes("not registered"))).toBe(true);
    expect(parentRuns()[0]?.status).toBe("error");
  });
});

describe("non-batch automations are unaffected", () => {
  it("a plain automation fires exactly once and forwards no env", async () => {
    const src = new AsyncFakeSource(["a", "b"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);
    const dir = path.join(repo, ".pi", "automation", "plain");
    fs.mkdirSync(dir, { recursive: true });
    const automation = {
      name: "plain",
      scope: "folder",
      dir,
      valid: true,
      config: {
        on: { kind: "schedule", cron: "* * * * *" },
        action: { kind: "flows.run", payload: { flow: "demo:process" } },
        model: "@fast",
        mode: "local",
        sandbox: "workspace-write",
        concurrency: "queue",
      },
    } as DiscoveredAutomation;

    engine.startRunFor(automation);
    await flush();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.env).toBeUndefined();
    expect(src.nextCalls).toBe(0); // the source is never consulted
  });
});
