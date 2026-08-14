/**
 * engine.runInvoice — start EXACTLY ONE scoped run for a single invoice through
 * the shared per-invoice run core (serve-and-start-queued-invoice):
 *  - one run bound to the id, `IB_TOOLSET`/`IB_INVOICE_ID` env forwarded, no
 *    fan-out over other queued invoices;
 *  - one-in-flight refusal (a second call while the run is tracked → in_flight),
 *    covering a scheduler fan-out run for the same invoice too.
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
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-runinv-"));
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
      return { eventType: "flow:run", data: { flowName: String(payload.flow ?? ""), ...(inputs ? { inputs } : {}) } };
    },
  });
  return reg;
}

function perInvoiceAutomation(name: string, concurrency: Concurrency = "queue"): DiscoveredAutomation {
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

function makeEngine(spawnCalls: SpawnOpts[], seen: Array<Record<string, unknown>>) {
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
  });
}

describe("engine.runInvoice", () => {
  it("starts exactly one scoped run bound to the invoice id, no fan-out", () => {
    const spawnCalls: SpawnOpts[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine(spawnCalls, seen);
    const automation = perInvoiceAutomation("drain");

    const res = engine.runInvoice(automation, "inv-7");

    expect(res.ok).toBe(true);
    expect(res.runId).toBeTruthy();
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].env).toMatchObject({ IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv-7" });
    expect(seen).toHaveLength(1);
    expect(seen[0].inputs).toEqual({ invoice_id: "inv-7" });
  });

  it("refuses a second start while the first run is in flight", () => {
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(spawnCalls, []);
    const automation = perInvoiceAutomation("drain");

    const first = engine.runInvoice(automation, "inv-7");
    expect(first.ok).toBe(true);

    const second = engine.runInvoice(automation, "inv-7");
    expect(second).toEqual({ ok: false, reason: "in_flight" });
    // still only one spawn — no second run
    expect(spawnCalls).toHaveLength(1);
  });

  it("a different invoice id is not blocked by an in-flight one", () => {
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(spawnCalls, []);
    const automation = perInvoiceAutomation("drain");

    expect(engine.runInvoice(automation, "inv-7").ok).toBe(true);
    expect(engine.runInvoice(automation, "inv-8").ok).toBe(true);
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls.map((s) => s.env?.IB_INVOICE_ID).sort()).toEqual(["inv-7", "inv-8"]);
  });

  it("a scheduler fan-out run for the same invoice also blocks a run-invoice", () => {
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(spawnCalls, []);
    const automation = perInvoiceAutomation("drain", "parallel");

    // Scheduler fans out over the queued invoice inv-9 (its run is now tracked).
    engine.startRunFor(automation, { firedAt: Date.now(), vars: { invoice_id: "inv-9" }, invoiceId: "inv-9" });
    expect(spawnCalls).toHaveLength(1);

    const res = engine.runInvoice(automation, "inv-9");
    expect(res).toEqual({ ok: false, reason: "in_flight" });
    expect(spawnCalls).toHaveLength(1);
  });
});
