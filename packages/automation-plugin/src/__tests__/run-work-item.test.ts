/**
 * `Engine.runWorkItem` — start EXACTLY ONE run for a single, named work item.
 *
 * The guarantees are enforced by the work-source LEASE rather than a bespoke
 * in-flight registry scan, so this package stays free of any domain's
 * vocabulary:
 *   - one child bound to the requested item, its value in the action payload, NO fan-out
 *   - a second request while that item is leased is REFUSED (`in_flight`)
 *   - a different item is never blocked by another's lease
 *   - a batch fire and a targeted request share ONE guard, in both directions
 *   - a dead run RELEASES its item (nack) — re-dispatchable, never stranded
 *   - a source that cannot address items by key reports `unsupported`
 *
 * See change: work-source-seam.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../server/action-registry.js";
import { createEngine } from "../server/engine.js";
import { automationKey } from "../server/scheduler.js";
import { listRuns, readChildRuns } from "../server/run-store.js";
import { WorkSourceRegistry } from "../server/work-source-registry.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";
import type { LeasedHandle } from "../shared/work-source.js";

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-workitem-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/**
 * A keyed async source: `take(key)` leases ONE named item, refusing when that
 * item already holds a live lease — the single-flight guard both entry points
 * share. Mirrors the semantics a real keyed source implements.
 */
class KeyedSource {
  leases = new Map<string, string>(); // token → item
  byItem = new Map<string, string>(); // item → token
  private seq = 0;
  constructor(
    public available: string[] = [],
    private readonly supportsTake = true,
  ) {
    if (!supportsTake) this.take = undefined;
  }

  private lease(item: string): LeasedHandle<string> {
    this.seq += 1;
    const leaseToken = `lease-${this.seq}`;
    this.leases.set(leaseToken, item);
    this.byItem.set(item, leaseToken);
    return { item, leaseToken, idempotencyKey: item };
  }

  next(n: number): LeasedHandle<string>[] {
    const out: LeasedHandle<string>[] = [];
    for (const item of this.available) {
      if (out.length >= n) break;
      if (this.byItem.has(item)) continue;
      out.push(this.lease(item));
    }
    return out;
  }

  take?: ((key: string) => Promise<LeasedHandle<string> | null>) | undefined = async (key: string) => {
    if (this.byItem.has(key)) return null; // in flight
    return this.lease(key);
  };

  ack(token: string): void {
    const item = this.leases.get(token);
    if (item === undefined) return;
    this.leases.delete(token);
    if (this.byItem.get(item) === token) this.byItem.delete(item);
    this.available = this.available.filter((i) => i !== item);
  }

  nack(token: string): void {
    const item = this.leases.get(token);
    if (item === undefined) return;
    this.leases.delete(token);
    if (this.byItem.get(item) === token) this.byItem.delete(item);
    if (!this.available.includes(item)) this.available.push(item);
  }
}

interface SpawnOpts {
  cwd: string;
  // Identity rode inside the opaque `pluginRef` after the goal-detach change.
  // See change: detach-automation-goal-from-core.
  pluginRef?: { automationRun?: { name?: string; runId?: string; idempotencyKey?: string } };
}

/** The item's stable idempotency key, as stamped on a child's spawn. */
const idemKey = (c: SpawnOpts) => c.pluginRef?.automationRun?.idempotencyKey;

function echoRegistry(seen: Array<Record<string, unknown>>): ActionRegistry {
  const reg = new ActionRegistry({ warn: () => {} });
  reg.register({
    id: "flows.run",
    source: "flows",
    label: "Run a flow",
    buildEvent: ({ payload }) => {
      seen.push(payload);
      const inputs = payload.inputs as Record<string, unknown> | undefined;
      return { eventType: "flow:run", data: { flowName: String(payload.flow ?? ""), ...(inputs ? { inputs } : {}) } };
    },
  });
  return reg;
}

function batchAutomation(name = "drain", maxConcurrentSpawns?: number): DiscoveredAutomation {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  return {
    name,
    scope: "folder",
    dir,
    valid: true,
    config: {
      on: { kind: "schedule.batch", cron: "* * * * *", source: "queued" },
      action: {
        kind: "flows.run",
        payload: {
          flow: "demo:process",
          inputs: { item_id: "${{trigger}}" },
        },
      },
      model: "@fast",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: "queue",
      ...(maxConcurrentSpawns ? { maxConcurrentSpawns } : {}),
    },
  } as DiscoveredAutomation;
}

function makeEngine(source: KeyedSource, spawnCalls: SpawnOpts[], seen: Array<Record<string, unknown>> = []) {
  const registry = new WorkSourceRegistry();
  registry.register("queued", source);
  return createEngine({
    spawnSession: async (o) => {
      spawnCalls.push(o as SpawnOpts);
      return { success: true, spawnToken: `tok-${spawnCalls.length}` };
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
      maxConcurrentSpawns: 4,
    }),
    readRoles: () => ({ fast: "anthropic/claude-haiku-4-5" }),
    warn: () => {},
  });
}

const flush = () => new Promise((r) => setImmediate(r));
const parentById = (runId: string) => listRuns(repo).find((r) => r.runId === runId);
const childrenOf = (runId: string) => readChildRuns(repo, parentById(runId)!);

describe("engine.runWorkItem", () => {
  it("starts exactly one run bound to the item, value in the payload, no fan-out", async () => {
    const src = new KeyedSource(["a", "b", "c"]);
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine(src, spawnCalls, seen);

    const res = await engine.runWorkItem(batchAutomation(), "b");
    await flush();

    expect(res.ok).toBe(true);
    expect(res.runId).toBeTruthy();
    expect(spawnCalls).toHaveLength(1); // never the other two available items
    expect(childrenOf(res.runId!)).toHaveLength(1);
    expect(seen[0]!.inputs).toEqual({ item_id: "b" });
    expect(idemKey(spawnCalls[0]!)).toBe("b");
  });

  it("refuses a second start while that item is leased", async () => {
    const src = new KeyedSource(["a"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    const first = await engine.runWorkItem(batchAutomation(), "a");
    expect(first.ok).toBe(true);

    const second = await engine.runWorkItem(batchAutomation(), "a");
    expect(second).toEqual({ ok: false, reason: "in_flight" });
    expect(spawnCalls).toHaveLength(1);
  });

  it("does not block a DIFFERENT item", async () => {
    const src = new KeyedSource(["a", "b"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    expect((await engine.runWorkItem(batchAutomation(), "a")).ok).toBe(true);
    expect((await engine.runWorkItem(batchAutomation(), "b")).ok).toBe(true);
    await flush();

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls.map(idemKey).sort()).toEqual(["a", "b"]);
  });

  it("a BATCH fire's lease blocks a targeted request for the same item", async () => {
    const src = new KeyedSource(["a", "b"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    engine.startRunFor(batchAutomation());
    await flush();
    expect(spawnCalls).toHaveLength(2); // a + b leased by the fire

    const res = await engine.runWorkItem(batchAutomation(), "a");
    expect(res).toEqual({ ok: false, reason: "in_flight" });
    expect(spawnCalls).toHaveLength(2);
  });

  it("a targeted lease keeps the next BATCH fire from re-dispatching that item", async () => {
    const src = new KeyedSource(["a", "b"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    expect((await engine.runWorkItem(batchAutomation(), "a")).ok).toBe(true);
    await flush();

    engine.startRunFor(batchAutomation());
    await flush();

    // only `b` fans out — `a` is already in flight
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls.map(idemKey)).toEqual(["a", "b"]);
  });

  it("a targeted run's finalize leaves a concurrent batch fire's runner slot intact", async () => {
    // Regression: `runWorkItem` bypasses the runner (no `begin`), so its parent
    // finalize must NOT call `runner.completeRun` — doing so would drain/delete
    // the runner slot held by a concurrent scheduled batch fire of the SAME
    // automation key, silently breaking its `concurrency` policy.
    const src = new KeyedSource(["a", "b"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);
    const auto = batchAutomation("drain", 1); // bound 1 → the batch leases ONE item
    const key = automationKey(auto);

    // Real runner-managed batch fire: acquires `active[key]`, leases `a`, its
    // child never finalizes here (so the slot stays held).
    engine.runner.fire(auto);
    await flush();
    expect(engine.runner.activeRunId(key)).toBeTruthy();
    expect(spawnCalls).toHaveLength(1); // only `a` leased by the batch

    // Targeted run for the OTHER item; drive its child to death → finalizeParent.
    const res = await engine.runWorkItem(batchAutomation("drain", 1), "b");
    await flush();
    expect(res.ok).toBe(true);
    const child = childrenOf(res.runId!)[0]!;
    engine.onSessionRegisteredForRun("sess-targeted", child.runId);
    engine.onSessionDeath("sess-targeted");
    await flush();

    // The batch's runner slot MUST survive the targeted run's finalize.
    expect(engine.runner.activeRunId(key)).toBeTruthy();
  });

  it("releases the item when its run dies — re-dispatchable, never stranded", async () => {
    const src = new KeyedSource(["a"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    const first = await engine.runWorkItem(batchAutomation(), "a");
    await flush();
    const child = childrenOf(first.runId!)[0]!;
    engine.onSessionRegisteredForRun("sess-1", child.runId);
    engine.onSessionDeath("sess-1");

    expect(src.byItem.has("a")).toBe(false);
    expect(src.available).toEqual(["a"]);

    const again = await engine.runWorkItem(batchAutomation(), "a");
    expect(again.ok).toBe(true);
    expect(spawnCalls).toHaveLength(2);
  });

  it("reports `unsupported` for a source that cannot address items by key", async () => {
    const src = new KeyedSource(["a"], false);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);

    const res = await engine.runWorkItem(batchAutomation(), "a");

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unsupported");
    expect(spawnCalls).toHaveLength(0);
  });

  it("reports `unsupported` for an automation with no work source", async () => {
    const src = new KeyedSource(["a"]);
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(src, spawnCalls);
    const dir = path.join(repo, ".pi", "automation", "plain");
    fs.mkdirSync(dir, { recursive: true });
    const plain = {
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

    const res = await engine.runWorkItem(plain, "a");

    expect(res.reason).toBe("unsupported");
    expect(spawnCalls).toHaveLength(0);
  });
});
