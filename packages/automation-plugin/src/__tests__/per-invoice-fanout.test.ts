/**
 * Per-invoice automation fan-out (§ wire-per-invoice-automation-drain).
 *
 * A `scope: per-invoice` action fans out to one scoped run per queued invoice:
 *  - fan-out count == queued count, `${invoice_id}` resolved in flow inputs,
 *    and `IB_TOOLSET`/`IB_INVOICE_ID` env forwarded per run;
 *  - `concurrency: queue` serialises the fan-out (one active, rest queued);
 *  - an empty queue fires nothing;
 *  - a missing enumerator skips the fire (never a literal-token run).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../server/action-registry.js";
import { createEngine } from "../server/engine.js";
import { automationKey } from "../server/scheduler.js";
import type { Concurrency, DiscoveredAutomation } from "../shared/automation-types.js";

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-fanout-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/** A flows.run registry whose buildEvent records the (already-interpolated)
 *  payload it receives and forwards `inputs` verbatim (mirrors the real one). */
function flowsRegistry(seen: Array<Record<string, unknown>>): ActionRegistry {
  const reg = new ActionRegistry();
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

function perInvoiceAutomation(name: string, concurrency: Concurrency): DiscoveredAutomation {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  return {
    name,
    scope: "folder",
    dir,
    valid: true,
    config: {
      on: { kind: "schedule", cron: "* * * * *" },
      action: {
        kind: "flows.run",
        payload: {
          flow: "invoicebot:process",
          scope: "per-invoice",
          inputs: { invoice_id: "${invoice_id}" },
          env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "${invoice_id}" },
        },
      },
      model: "@fast",
      mode: "local",
      sandbox: "workspace-write",
      concurrency,
    },
  };
}

interface SpawnOpts {
  cwd: string;
  automationRun?: { name: string; runId: string };
  env?: Record<string, string>;
}

function makeEngine(
  spawnCalls: SpawnOpts[],
  seen: Array<Record<string, unknown>>,
  enumerateQueued?: (cwd: string) => Promise<string[] | null>,
  warnings: string[] = [],
  perInvoiceRunName?: (invoiceId: string) => string | undefined,
) {
  return createEngine({
    spawnSession: async (opts) => {
      spawnCalls.push(opts as SpawnOpts);
      return { success: true, spawnToken: `tok-${spawnCalls.length}` };
    },
    resolveRegistry: () => flowsRegistry(seen),
    listScopes: () => [{ base: repo, scope: "folder" }],
    config: () => ({
      defaultVisibility: "hidden",
      retention: 100,
      defaultModel: "anthropic/claude-sonnet-4-5",
      scanFolder: true,
      scanGlobal: false,
      maxRunAgeMs: 30 * 60 * 1000,
    }),
    readRoles: () => ({ fast: "anthropic/claude-haiku-4-5" }),
    ...(enumerateQueued ? { enumerateQueued } : {}),
    ...(perInvoiceRunName ? { perInvoiceRunName } : {}),
    warn: (m) => warnings.push(m),
  });
}

describe("per-invoice fan-out", () => {
  it("fans out one scoped run per queued invoice, id + env resolved per run", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const ids = ["inv-1", "inv-2", "inv-3"];
    const engine = makeEngine(spawnCalls, seen, async () => ids);
    const automation = perInvoiceAutomation("drain", "parallel");

    await engine.fire(automation);

    // fan-out count == queued count
    expect(spawnCalls).toHaveLength(3);
    expect(seen).toHaveLength(3);

    // env resolved per run (IB_INVOICE_ID = the bound id, toolset scoped)
    expect(spawnCalls.map((c) => c.env?.IB_INVOICE_ID)).toEqual(ids);
    for (const c of spawnCalls) expect(c.env?.IB_TOOLSET).toBe("scoped-invoice");

    // ${invoice_id} resolved in the dispatched flow inputs, per run
    expect(seen.map((p) => (p.inputs as { invoice_id?: string }).invoice_id)).toEqual(ids);
    // the literal token never leaks through
    for (const p of seen) {
      expect((p.inputs as { invoice_id?: string }).invoice_id).not.toBe("${invoice_id}");
    }
  });

  it("honours concurrency: queue — one active run, the rest queued, drained serially", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine(spawnCalls, seen, async () => ["inv-1", "inv-2", "inv-3"]);
    const automation = perInvoiceAutomation("drain", "queue");
    const key = automationKey(automation);

    await engine.fire(automation);

    // serialised: only the first invoice's run is active; the other two queued
    expect(spawnCalls).toHaveLength(1);
    expect(engine.runner.activeRunId(key)).not.toBeNull();
    expect(engine.runner.queuedCount(key)).toBe(2);
    expect(spawnCalls[0].env?.IB_INVOICE_ID).toBe("inv-1");

    // completing the active run starts the next queued invoice
    engine.runner.completeRun(key);
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[1].env?.IB_INVOICE_ID).toBe("inv-2");

    engine.runner.completeRun(key);
    expect(spawnCalls).toHaveLength(3);
    expect(spawnCalls[2].env?.IB_INVOICE_ID).toBe("inv-3");
    expect(engine.runner.queuedCount(key)).toBe(0);
  });

  it("empty queue fires nothing", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine(spawnCalls, seen, async () => []);
    const automation = perInvoiceAutomation("drain", "queue");

    await engine.fire(automation);

    expect(spawnCalls).toHaveLength(0);
    expect(engine.runner.activeRunId(automationKey(automation))).toBeNull();
  });

  it("skips the fire when no queued-invoice enumerator is wired", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];
    const engine = makeEngine(spawnCalls, seen, undefined, warnings);
    const automation = perInvoiceAutomation("drain", "queue");

    await engine.fire(automation);

    // no run at all — never a single run carrying the unresolved token
    expect(spawnCalls).toHaveLength(0);
    expect(seen).toHaveLength(0);
    expect(warnings.some((w) => w.includes("no queued-invoice enumerator"))).toBe(true);
  });

  it("a non-per-invoice action fires exactly once (unchanged)", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    // enumerator present but must be ignored for a plain action
    const engine = makeEngine(spawnCalls, seen, async () => ["inv-1", "inv-2"]);
    const dir = path.join(repo, ".pi", "automation", "plain");
    fs.mkdirSync(dir, { recursive: true });
    const automation: DiscoveredAutomation = {
      name: "plain",
      scope: "folder",
      dir,
      valid: true,
      config: {
        on: { kind: "schedule", cron: "* * * * *" },
        action: { kind: "flows.run", payload: { flow: "invoicebot:process" } },
        model: "@fast",
        mode: "local",
        sandbox: "workspace-write",
        concurrency: "queue",
      },
    };

    await engine.fire(automation);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].env).toBeUndefined();
  });
});

describe("per-invoice run naming (adopt-scoped-producer-session)", () => {
  const scopedName = (id: string) => `invoicebot-scoped:${encodeURIComponent(id)}`;

  it("surfaces each per-invoice fan-out run under the injected scoped name", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const ids = ["inv-1", "inv 2"]; // includes a space to prove encodeURIComponent parity
    const engine = makeEngine(spawnCalls, seen, async () => ids, [], scopedName);
    const automation = perInvoiceAutomation("drain", "parallel");

    await engine.fire(automation);

    expect(spawnCalls.map((c) => c.automationRun?.name)).toEqual(ids.map(scopedName));
    // the automation's own name is NOT used for a per-invoice run
    for (const c of spawnCalls) expect(c.automationRun?.name).not.toBe("drain");
  });

  it("falls back to the automation name when no namer is injected", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    // enumerator present, namer absent → per-invoice runs keep the automation name
    const engine = makeEngine(spawnCalls, seen, async () => ["inv-1"]);
    const automation = perInvoiceAutomation("drain", "parallel");

    await engine.fire(automation);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].automationRun?.name).toBe("drain");
  });

  it("a folder/global (non-per-invoice) fire keeps the automation name even when a namer is present", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine(spawnCalls, seen, async () => ["inv-1"], [], scopedName);
    const dir = path.join(repo, ".pi", "automation", "plain");
    fs.mkdirSync(dir, { recursive: true });
    const automation: DiscoveredAutomation = {
      name: "plain",
      scope: "folder",
      dir,
      valid: true,
      config: {
        on: { kind: "schedule", cron: "* * * * *" },
        action: { kind: "flows.run", payload: { flow: "invoicebot:process" } },
        model: "@fast",
        mode: "local",
        sandbox: "workspace-write",
        concurrency: "queue",
      },
    };

    await engine.fire(automation);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].automationRun?.name).toBe("plain");
  });
});
