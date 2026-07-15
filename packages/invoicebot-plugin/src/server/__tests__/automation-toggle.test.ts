/**
 * Automation enable/disable surface: the flip helper (byte-preservation,
 * enable↔disable, never-create) + the two `/automation` routes (flip + list),
 * covering reject-on-missing-name, traversal name, bad cwd, and discovery for
 * the two-automation and single-automation cases. Faux, zero-network.
 * See change: surface-automation-enable (tasks §4.1–§4.4).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineResult, InvoiceEngine } from "../engine/port.js";
import { flipAutomationDisabled, listInvoicebotAutomations } from "../automation-toggle.js";
import { mountInvoiceBotRoutes } from "../routes.js";

/** A realistic scaffolded intake automation with an inline comment. */
const INTAKE_YAML = `on:
  kind: schedule
  cron: "*/2 * * * *" # cadence; adjust to taste
action:
  kind: flows.run
  payload:
    flow: invoicebot:process
    inputs:
      folder: "/drop"
model: "@fast"
mode: local
concurrency: skip
disabled: true
`;

const PULL_YAML = `on:
  kind: schedule
  cron: "*/5 * * * *"
action:
  kind: flows.run
  payload:
    flow: invoicebot:pull
model: "@fast"
mode: local
concurrency: skip
`;

function writeAutomation(cwd: string, name: string, yaml: string): string {
  const dir = join(cwd, ".pi", "automation", name);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "automation.yaml");
  writeFileSync(p, yaml);
  return p;
}

function makeStubEngine(): InvoiceEngine {
  const mk = () => async (): Promise<EngineResult> => ({ content: [{ type: "text", text: "" }], details: { ok: true } });
  return { query: mk(), review: mk(), setup: mk(), rules: mk() };
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "ib-auto-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("flipAutomationDisabled (helper)", () => {
  it("enable then disable toggles ONLY disabled; every other field + inline comment preserved", () => {
    const p = writeAutomation(cwd, "invoicebot-intake", INTAKE_YAML);

    // enable → disabled cleared to false
    const r1 = flipAutomationDisabled(cwd, "invoicebot-intake", true);
    expect(r1.enabled).toBe(true);
    const afterEnable = readFileSync(p, "utf8");
    expect(afterEnable).toContain("disabled: false");
    // every non-disabled line is byte-identical to the source (comment preserved)
    expect(afterEnable).toBe(INTAKE_YAML.replace("disabled: true", "disabled: false"));

    // disable → disabled true again, still byte-identical elsewhere
    const r2 = flipAutomationDisabled(cwd, "invoicebot-intake", false);
    expect(r2.enabled).toBe(false);
    const afterDisable = readFileSync(p, "utf8");
    expect(afterDisable).toBe(INTAKE_YAML);
  });

  it("throws (never creates) when the automation.yaml is absent", () => {
    expect(() => flipAutomationDisabled(cwd, "invoicebot-intake", true)).toThrow(/not found/);
    expect(existsSync(join(cwd, ".pi", "automation", "invoicebot-intake"))).toBe(false);
  });
});

describe("listInvoicebotAutomations (helper)", () => {
  it("lists two automations with correct per-automation enabled state", () => {
    writeAutomation(cwd, "invoicebot-intake", INTAKE_YAML); // disabled: true
    writeAutomation(cwd, "invoicebot-pull", PULL_YAML); // no disabled → enabled
    const list = listInvoicebotAutomations(cwd);
    expect(list).toEqual([
      { name: "invoicebot-intake", enabled: false },
      { name: "invoicebot-pull", enabled: true },
    ]);
  });

  it("lists exactly one automation for a drop-folder-only install", () => {
    writeAutomation(cwd, "invoicebot-intake", INTAKE_YAML);
    expect(listInvoicebotAutomations(cwd)).toEqual([{ name: "invoicebot-intake", enabled: false }]);
  });

  it("returns [] when no automation dir exists", () => {
    expect(listInvoicebotAutomations(cwd)).toEqual([]);
  });
});

describe("/api/plugins/invoicebot/automation routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    mountInvoiceBotRoutes(app, { engine: makeStubEngine(), dispatchFlow: async () => undefined });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  async function postFlip(body: Record<string, unknown>) {
    const res = await app.inject({ method: "POST", url: "/api/plugins/invoicebot/automation", payload: body });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  }
  async function getList(query: string) {
    const res = await app.inject({ method: "GET", url: `/api/plugins/invoicebot/automation?${query}` });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  }

  it("flips enable and returns the resulting state", async () => {
    const p = writeAutomation(cwd, "invoicebot-intake", INTAKE_YAML);
    const { status, json } = await postFlip({ cwd, name: "invoicebot-intake", enabled: true });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, name: "invoicebot-intake", enabled: true });
    expect(readFileSync(p, "utf8")).toContain("disabled: false");
  });

  it("rejects a missing name → 400, no file written", async () => {
    const { status, json } = await postFlip({ cwd, enabled: true });
    expect(status).toBe(400);
    expect(json.error).toBeDefined();
    expect(existsSync(join(cwd, ".pi", "automation"))).toBe(false);
  });

  it("rejects a traversal name → 400, filesystem untouched", async () => {
    const { status } = await postFlip({ cwd, name: "../../etc", enabled: true });
    expect(status).toBe(400);
    expect(existsSync(join(cwd, ".pi", "automation"))).toBe(false);
  });

  it("rejects a slash-bearing name → 400", async () => {
    const { status } = await postFlip({ cwd, name: "foo/bar", enabled: true });
    expect(status).toBe(400);
  });

  it("404 when the named automation does not exist (creates nothing)", async () => {
    const { status, json } = await postFlip({ cwd, name: "invoicebot-intake", enabled: true });
    expect(status).toBe(404);
    expect(json.error).toBe("automation not found");
    expect(existsSync(join(cwd, ".pi", "automation", "invoicebot-intake"))).toBe(false);
  });

  it("rejects absent cwd → 400, no FS access", async () => {
    const { status } = await postFlip({ name: "invoicebot-intake", enabled: true });
    expect(status).toBe(400);
  });

  it("rejects a non-existent cwd → 400", async () => {
    const { status } = await postFlip({ cwd: join(cwd, "does-not-exist"), name: "invoicebot-intake", enabled: true });
    expect(status).toBe(400);
  });

  it("rejects a NUL-bearing cwd → 400", async () => {
    const { status } = await postFlip({ cwd: `${cwd}\0`, name: "invoicebot-intake", enabled: true });
    expect(status).toBe(400);
  });

  it("rejects a non-boolean enabled → 400", async () => {
    writeAutomation(cwd, "invoicebot-intake", INTAKE_YAML);
    const { status } = await postFlip({ cwd, name: "invoicebot-intake", enabled: "yes" });
    expect(status).toBe(400);
  });

  it("GET lists both automations with per-automation state", async () => {
    writeAutomation(cwd, "invoicebot-intake", INTAKE_YAML);
    writeAutomation(cwd, "invoicebot-pull", PULL_YAML);
    const { status, json } = await getList(`cwd=${encodeURIComponent(cwd)}`);
    expect(status).toBe(200);
    expect(json.automations).toEqual([
      { name: "invoicebot-intake", enabled: false },
      { name: "invoicebot-pull", enabled: true },
    ]);
  });

  it("GET rejects a bad cwd → 400", async () => {
    const { status } = await getList("cwd=");
    expect(status).toBe(400);
  });
});
