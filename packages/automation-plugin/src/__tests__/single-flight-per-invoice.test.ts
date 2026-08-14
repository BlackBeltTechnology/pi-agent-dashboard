/**
 * Per-invoice single-flight guard (single-flight-per-invoice-dispatch).
 *
 * ONE mechanism — the `invoiceInFlight` predicate over the engine's `pending`
 * run registry — shared by BOTH dispatch paths:
 *  - the scheduler / folder run-now fan-out (`perInvoiceFanout` filters live ids);
 *  - the single-invoice `runInvoice` entry point (pre-checks the same predicate).
 * A queued invoice stays queued until a run claims it, so a second fire must NOT
 * start a second run for a record that already has a live one. And the guard must
 * RELEASE the invoice when its run dies, so nothing gets permanently stranded.
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
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-sflight-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function flowsRegistry(): ActionRegistry {
  const reg = new ActionRegistry();
  reg.register({
    id: "flows.run",
    source: "flows",
    label: "Run a flow",
    buildEvent: ({ payload }) => {
      const inputs = payload.inputs as Record<string, unknown> | undefined;
      return { eventType: "flow:run", data: { flowName: String(payload.flow ?? ""), ...(inputs ? { inputs } : {}) } };
    },
  });
  return reg;
}

function perInvoiceAutomation(name = "drain", concurrency: Concurrency = "parallel"): DiscoveredAutomation {
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

function makeEngine(spawnCalls: SpawnOpts[], queued: () => string[]) {
  return createEngine({
    spawnSession: async (opts) => {
      spawnCalls.push(opts as SpawnOpts);
      return { success: true, spawnToken: `tok-${spawnCalls.length}` };
    },
    resolveRegistry: () => flowsRegistry(),
    listScopes: () => [{ base: repo, scope: "folder" }],
    enumerateQueued: async () => queued(),
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

/** The sessionId the engine bound to the Nth spawned run (via automationRun.runId). */
function bindSession(engine: ReturnType<typeof createEngine>, runId: string, sessionId: string) {
  engine.onSessionRegisteredForRun(sessionId, runId);
}

describe("per-invoice single-flight — scheduler fan-out", () => {
  it("a second fire does NOT re-dispatch an invoice whose run is still live", async () => {
    const spawnCalls: SpawnOpts[] = [];
    // inv-A stays queued across both fires (its run hasn't claimed it yet).
    const engine = makeEngine(spawnCalls, () => ["inv-A"]);
    const automation = perInvoiceAutomation();

    await engine.fire(automation); // fire #1 → starts a run for inv-A
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].env?.IB_INVOICE_ID).toBe("inv-A");

    await engine.fire(automation); // fire #2 ~cron later, inv-A still queued + live
    expect(spawnCalls).toHaveLength(1); // NOT re-dispatched
  });

  it("only the in-flight invoice is filtered; a new queued invoice still fires", async () => {
    const spawnCalls: SpawnOpts[] = [];
    let queue = ["inv-A"];
    const engine = makeEngine(spawnCalls, () => queue);
    const automation = perInvoiceAutomation();

    await engine.fire(automation); // starts inv-A
    expect(spawnCalls).toHaveLength(1);

    queue = ["inv-A", "inv-B"]; // inv-A still live, inv-B newly queued
    await engine.fire(automation);
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[1].env?.IB_INVOICE_ID).toBe("inv-B");
  });

  it("releases the invoice after its run dies — re-dispatchable (no permanent stranding)", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(spawnCalls, () => ["inv-A"]);
    const automation = perInvoiceAutomation();

    await engine.fire(automation); // run #1 for inv-A
    expect(spawnCalls).toHaveLength(1);
    const runId1 = spawnCalls[0].automationRun!.runId;
    bindSession(engine, runId1, "sess-1");

    // A second fire while live is still filtered.
    await engine.fire(automation);
    expect(spawnCalls).toHaveLength(1);

    // The run's session DIES before completion — the invoice must free up.
    engine.onSessionDeath("sess-1");

    // Next fire re-dispatches inv-A (the queued file was never claimed).
    await engine.fire(automation);
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[1].env?.IB_INVOICE_ID).toBe("inv-A");
  });

  it("releases the invoice after normal session completion", async () => {
    const spawnCalls: SpawnOpts[] = [];
    // Normal completion uses the same finishAndRelease → removePending path as
    // death/stop/reaper finalization.
    const engine = makeEngine(spawnCalls, () => ["inv-A"]);
    const automation = perInvoiceAutomation();

    await engine.fire(automation);
    const runId1 = spawnCalls[0].automationRun!.runId;
    bindSession(engine, runId1, "sess-1");

    engine.onSessionEnded("sess-1", "done"); // normal completion releases too

    await engine.fire(automation);
    expect(spawnCalls).toHaveLength(2);
  });
});

describe("per-invoice single-flight — manual run-invoice shares the guard", () => {
  it("run-invoice refuses while a scheduler fan-out run for that invoice is live", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(spawnCalls, () => ["inv-A"]);
    const automation = perInvoiceAutomation();

    await engine.fire(automation); // scheduler starts inv-A
    expect(spawnCalls).toHaveLength(1);

    const res = engine.runInvoice(automation, "inv-A"); // manual, same invoice
    expect(res).toEqual({ ok: false, reason: "in_flight" });
    expect(spawnCalls).toHaveLength(1);
  });

  it("scheduler fan-out refuses to re-dispatch an invoice a run-invoice already started", async () => {
    const spawnCalls: SpawnOpts[] = [];
    const engine = makeEngine(spawnCalls, () => ["inv-A"]);
    const automation = perInvoiceAutomation();

    const res = engine.runInvoice(automation, "inv-A"); // manual starts inv-A
    expect(res.ok).toBe(true);
    expect(spawnCalls).toHaveLength(1);

    await engine.fire(automation); // scheduler enumerates inv-A (still queued + live)
    expect(spawnCalls).toHaveLength(1); // filtered — not re-dispatched
  });
});
