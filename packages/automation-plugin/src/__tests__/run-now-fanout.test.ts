/**
 * Manual run-now per-invoice fan-out (§ run-now-fans-out-per-invoice).
 *
 * Run-now must honour `scope: per-invoice` like the scheduler fire: fan out to
 * one force-started run per queued invoice (distinct bound id + scoped env),
 * empty queue → no run, missing enumerator → no run, non-per-invoice → one run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../server/action-registry.js";
import { createEngine } from "../server/engine.js";
import type { Concurrency, DiscoveredAutomation } from "../shared/automation-types.js";

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-runnow-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

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
    warn: () => {},
  });
}

describe("run-now per-invoice fan-out", () => {
  it("fans out one force-started run per queued invoice, id + env resolved, returns first id", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const ids = ["inv-1", "inv-2", "inv-3"];
    // concurrency: queue — run-now force-starts each run directly, bypassing the
    // concurrency gate, so all N start immediately (N startRunFor calls).
    const engine = makeEngine(spawnCalls, seen, async () => ids);
    const automation = perInvoiceAutomation("drain", "queue");

    const res = await engine.runNow(automation);

    // N queued → N runs started
    expect(spawnCalls).toHaveLength(3);
    expect(seen).toHaveLength(3);

    // each run bound to a distinct invoice id, env scoped
    expect(spawnCalls.map((c) => c.env?.IB_INVOICE_ID)).toEqual(ids);
    for (const c of spawnCalls) expect(c.env?.IB_TOOLSET).toBe("scoped-invoice");

    // ${invoice_id} resolved in the dispatched flow inputs, per run
    expect(seen.map((p) => (p.inputs as { invoice_id?: string }).invoice_id)).toEqual(ids);
    for (const p of seen) {
      expect((p.inputs as { invoice_id?: string }).invoice_id).not.toBe("${invoice_id}");
    }

    // returns the FIRST started run's id (contract holds)
    expect(res.ok).toBe(true);
    expect(res.runId).toBe(spawnCalls[0].automationRun?.runId);
    expect(res.runId).toBeTruthy();
  });

  it("empty queue starts no run and reports success with no id", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine(spawnCalls, seen, async () => []);
    const automation = perInvoiceAutomation("drain", "queue");

    const res = await engine.runNow(automation);

    expect(spawnCalls).toHaveLength(0);
    expect(res).toEqual({ ok: true });
  });

  it("missing enumerator starts no run and reports failure (never a literal-token run)", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine(spawnCalls, seen, undefined);
    const automation = perInvoiceAutomation("drain", "queue");

    const res = await engine.runNow(automation);

    expect(spawnCalls).toHaveLength(0);
    expect(seen).toHaveLength(0);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("a non-per-invoice automation starts exactly one run and returns its id (unchanged)", async () => {
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

    const res = await engine.runNow(automation);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].env).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.runId).toBe(spawnCalls[0].automationRun?.runId);
  });
});
