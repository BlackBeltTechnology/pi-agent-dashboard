/**
 * D-YAML: migrate a DEPLOYED intake automation onto the work-source contract.
 *
 * The fixture is the engine-authored legacy shape verbatim (`on.kind: schedule`
 * + `payload.scope: per-invoice` + `${invoice_id}` tokens, comments and all), so
 * a drift in what the engine writes shows up here as a failing migration rather
 * than as a silently un-drained workspace.
 *
 * This is the FALLBACK rewrite (used when the engine binding cannot do it — the
 * fixture binding in CI / a worktree). It must target the SAME shape the engine's
 * own migrator emits, so the assertions below pin `inputs.work_item`, not a
 * host-invented hybrid.
 *
 * See change: relocate-fanout-to-work-source.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { migrateIntakeAutomation, QUEUED_INVOICE_SOURCE_ID } from "../automation-migrate.js";

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ib-migrate-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/** The legacy engine-authored intake automation (abridged comments preserved). */
const LEGACY = `# InvoiceBot intake — SCHEDULED per-invoice SCOPED drain: each fire dispatches
# invoicebot:process ONCE PER QUEUED INVOICE, bound to that invoice's arrival id
# Drop folder (feeds arrivals into the queue this drain reads): /w/drop
on:
  kind: schedule
  cron: "*/2 * * * *"      # cadence; adjust to taste
action:
  kind: flows.run
  payload:
    flow: invoicebot:process
    # Fan out over the queued invoices: one scoped run per invoice, bound by id.
    scope: per-invoice
    inputs:
      invoice_id: "\${invoice_id}"   # arrival id, bound BEFORE the scoped run
    env:
      IB_TOOLSET: scoped-invoice
      IB_INVOICE_ID: "\${invoice_id}"
      IB_ALLOWED_TOOLS: "ib_query,ib_review"
model: "@fast"
mode: local
concurrency: queue         # drain the queue serially — no unbounded scoped runs
disabled: true             # enable deliberately (no runaway)
`;

function writeAutomation(body: string, name = "invoicebot-intake"): string {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "automation.yaml");
  fs.writeFileSync(p, body);
  return p;
}

describe("migrateIntakeAutomation", () => {
  it("rewrites the legacy shape to schedule.batch + ${{trigger}}", () => {
    const p = writeAutomation(LEGACY);

    const res = migrateIntakeAutomation(repo);

    expect(res.migrated).toBe(true);
    const after = parseYaml(fs.readFileSync(p, "utf8")) as Record<string, any>;
    expect(after.on.kind).toBe("schedule.batch");
    expect(after.on.source).toBe(QUEUED_INVOICE_SOURCE_ID);
    expect(after.on.cron).toBe("*/2 * * * *"); // cadence preserved
    expect(after.action.payload.scope).toBeUndefined(); // discriminator retired
    // the leased-item key the flow now consumes (the engine's emitted shape)
    expect(after.action.payload.inputs.work_item).toBe("${{trigger}}");
    expect(after.action.payload.inputs.invoice_id).toBeUndefined();
    expect(after.action.payload.flow).toBe("invoicebot:process");
  });

  it("preserves the authorization-bearing env block, retokenized", () => {
    // C-ENV: IB_ALLOWED_TOOLS narrows the child's tool surface and fails OPEN if
    // dropped, so the migration must carry every env key across.
    const p = writeAutomation(LEGACY);

    migrateIntakeAutomation(repo);

    const after = parseYaml(fs.readFileSync(p, "utf8")) as Record<string, any>;
    expect(Object.keys(after.action.payload.env).sort()).toEqual([
      "IB_ALLOWED_TOOLS",
      "IB_INVOICE_ID",
      "IB_TOOLSET",
    ]);
    expect(after.action.payload.env.IB_INVOICE_ID).toBe("${{trigger}}");
    expect(after.action.payload.env.IB_TOOLSET).toBe("scoped-invoice");
    expect(after.action.payload.env.IB_ALLOWED_TOOLS).toBe("ib_query,ib_review");
  });

  it("preserves comments and every unrelated field", () => {
    const p = writeAutomation(LEGACY);

    migrateIntakeAutomation(repo);

    const out = fs.readFileSync(p, "utf8");
    expect(out).toContain("# InvoiceBot intake");
    expect(out).toContain("# Drop folder (feeds arrivals into the queue this drain reads): /w/drop");
    const after = parseYaml(out) as Record<string, any>;
    expect(after.disabled).toBe(true);
    expect(after.concurrency).toBe("queue");
    expect(after.mode).toBe("local");
    expect(after.model).toBe("@fast");
    // no `maxConcurrentSpawns` injected — parallelism stays a deployment setting
    expect(after.maxConcurrentSpawns).toBeUndefined();
    expect(out).not.toContain("${invoice_id}");
  });

  it("is idempotent: a migrated file is left byte-identical", () => {
    const p = writeAutomation(LEGACY);
    migrateIntakeAutomation(repo);
    const once = fs.readFileSync(p, "utf8");

    const second = migrateIntakeAutomation(repo);

    expect(second.migrated).toBe(false);
    expect(second.reason).toBe("already migrated");
    expect(fs.readFileSync(p, "utf8")).toBe(once);
  });

  it("leaves an automation that is not the legacy shape alone", () => {
    const body = "on:\n  kind: schedule\n  cron: \"* * * * *\"\naction:\n  kind: prompt\n  prompt: ./prompt.md\n";
    const p = writeAutomation(body);

    const res = migrateIntakeAutomation(repo);

    expect(res.migrated).toBe(false);
    expect(res.reason).toBe("not the legacy shape");
    expect(fs.readFileSync(p, "utf8")).toBe(body);
  });

  it("degrades quietly on an absent or unparseable file", () => {
    expect(migrateIntakeAutomation(repo).reason).toBe("absent");
    writeAutomation("on: [this: is: not: valid\n");
    expect(migrateIntakeAutomation(repo).migrated).toBe(false);
  });
});
