/**
 * Integration: EVERY invoicebot-owned spawn pins the configured model.
 *
 * Reproduces the live defect — a scoped session was spawned with no `model`, so
 * the host fell back to its built-in Anthropic default and the session died on
 * `OAuth refresh failed for anthropic: invalid_grant` while the deployment was
 * configured for `openai-codex/gpt-5.4` throughout.
 *
 * Drives the REAL resolver over a REAL dashboard `config.json` (temp HOME) and
 * asserts the resolved model lands on BOTH spawn paths: the processing/flow
 * spawn (`dispatchFlow`) and the scoped detail spawn (`ensureScopedSession`).
 * See change: pin-invoicebot-spawn-model.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FlowRunSpec } from "../engine/port.js";
import { createSessionLink, type SessionLinkDeps } from "../session-link.js";
import { resolveSpawnModel } from "../spawn-model.js";

const CWD = "/work/acme";
const FLOW: FlowRunSpec = { flowName: "invoicebot:process", task: "source://inv1" };
const CONFIGURED = "openai-codex/gpt-5.4";

let home: string;
let prevHome: string | undefined;
let prevIbModel: string | undefined;

/** Write the dashboard config the server would read. */
function writeDashboardConfig(cfg: Record<string, unknown>): void {
  const dir = join(home, ".pi", "dashboard");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
}

/** Exactly the wiring the plugin server entry performs. */
function makeResolver(pluginConfig: Record<string, unknown> = {}) {
  const warns: string[] = [];
  const logger = { info: () => {}, warn: (m: string) => warns.push(m) };
  const resolve = () =>
    resolveSpawnModel(
      {
        pluginConfigModel: pluginConfig.model as string | undefined,
        pluginConfigDefaultModel: pluginConfig.defaultModel as string | undefined,
        dashboardDefaultModel: loadConfig().defaultModel,
        envModel: process.env.IB_MODEL,
      },
      logger,
    );
  return { resolve, warns };
}

function makeDeps(resolveSpawnModelFn?: () => string | undefined) {
  const spawns: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  const deps: SessionLinkDeps = {
    spawnSession: async (opts) => {
      spawns.push(opts as unknown as Record<string, unknown>);
      return { success: true, spawnToken: "tok-1" };
    },
    emitEventToSession: () => true,
    getSession: () => undefined,
    listAll: () => [],
    onEvent: () => () => {},
    resolveRecordedSessionIds: async () => [],
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    spawnBindTimeoutMs: 60,
    ...(resolveSpawnModelFn ? { resolveSpawnModel: resolveSpawnModelFn } : {}),
  };
  return { deps, spawns, logs };
}

beforeEach(() => {
  prevHome = process.env.HOME;
  prevIbModel = process.env.IB_MODEL;
  home = mkdtempSync(join(tmpdir(), "ib-model-home-"));
  process.env.HOME = home;
  delete process.env.IB_MODEL;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevIbModel === undefined) delete process.env.IB_MODEL;
  else process.env.IB_MODEL = prevIbModel;
  rmSync(home, { recursive: true, force: true });
});

describe("invoicebot spawns pin the configured model (pin-invoicebot-spawn-model)", () => {
  it("the SCOPED detail spawn carries the dashboard-configured model", async () => {
    writeDashboardConfig({ defaultModel: CONFIGURED });
    const { resolve } = makeResolver();
    const ctx = makeDeps(resolve);

    await createSessionLink(ctx.deps).ensureScopedSession(CWD, "inv1");

    expect(ctx.spawns).toHaveLength(1);
    expect(ctx.spawns[0].model).toBe(CONFIGURED);
    // Regression guard: the live failure was an Anthropic fallback.
    expect(String(ctx.spawns[0].model)).not.toContain("anthropic");
    // The pre-existing scope contract is untouched.
    expect(ctx.spawns[0].env).toEqual({ IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv1" });
  });

  it("never resolves an Anthropic or DeepSeek fallback when a model IS configured", async () => {
    // The live failure was an Anthropic spawn default; a DeepSeek role fallback
    // was the sibling symptom. With a configured model neither may appear.
    writeDashboardConfig({ defaultModel: CONFIGURED });
    const { resolve } = makeResolver();
    const ctx = makeDeps(resolve);

    await createSessionLink(ctx.deps).ensureScopedSession(CWD, "inv-guard");
    await createSessionLink(ctx.deps).dispatchFlow({ cwd: CWD, flow: FLOW, invoiceId: "inv-guard" });

    expect(ctx.spawns).toHaveLength(2);
    for (const s of ctx.spawns) {
      expect(s.model).toBe(CONFIGURED);
      expect(String(s.model)).not.toMatch(/anthropic|claude|deepseek/i);
    }
  });

  it("the PROCESSING/flow spawn carries the identical model", async () => {
    writeDashboardConfig({ defaultModel: CONFIGURED });
    const { resolve } = makeResolver();
    const ctx = makeDeps(resolve);

    await createSessionLink(ctx.deps).dispatchFlow({ cwd: CWD, flow: FLOW, invoiceId: "inv1" });

    expect(ctx.spawns).toHaveLength(1);
    expect(ctx.spawns[0].model).toBe(CONFIGURED);
  });

  it("plugin config outranks the dashboard config on a real spawn", async () => {
    writeDashboardConfig({ defaultModel: "anthropic/claude-opus-4-8" });
    const { resolve } = makeResolver({ model: CONFIGURED });
    const ctx = makeDeps(resolve);

    await createSessionLink(ctx.deps).ensureScopedSession(CWD, "inv2");

    expect(ctx.spawns[0].model).toBe(CONFIGURED);
  });

  it("IB_MODEL backs the spawn when no config file names a model", async () => {
    process.env.IB_MODEL = CONFIGURED;
    const { resolve } = makeResolver();
    const ctx = makeDeps(resolve);

    await createSessionLink(ctx.deps).ensureScopedSession(CWD, "inv3");

    expect(ctx.spawns[0].model).toBe(CONFIGURED);
  });

  it("a MALFORMED configured model falls back to the next candidate and still spawns", async () => {
    writeDashboardConfig({ defaultModel: "claude-opus-no-provider" });
    process.env.IB_MODEL = CONFIGURED;
    const { resolve, warns } = makeResolver();
    const ctx = makeDeps(resolve);

    const out = await createSessionLink(ctx.deps).ensureScopedSession(CWD, "inv4");

    expect(ctx.spawns).toHaveLength(1); // spawn happened — never blocked
    expect(ctx.spawns[0].model).toBe(CONFIGURED);
    expect(warns.join(" ")).toContain("claude-opus-no-provider");
    expect(out).toBeUndefined(); // bind timeout in this harness, not a spawn failure
  });

  it("every candidate malformed → no model key, spawn still happens", async () => {
    writeDashboardConfig({ defaultModel: "bogus" });
    process.env.IB_MODEL = "also-bogus";
    const { resolve } = makeResolver({ model: "still bogus" });
    const ctx = makeDeps(resolve);

    await createSessionLink(ctx.deps).ensureScopedSession(CWD, "inv5");

    expect(ctx.spawns).toHaveLength(1);
    expect("model" in ctx.spawns[0]).toBe(false);
  });

  it("no configured model at all → spawn options carry no `model` key (host default preserved)", async () => {
    const { resolve } = makeResolver();
    const ctx = makeDeps(resolve);

    await createSessionLink(ctx.deps).ensureScopedSession(CWD, "inv6");

    expect(ctx.spawns).toHaveLength(1);
    expect("model" in ctx.spawns[0]).toBe(false);
  });

  it("a caller that supplies no resolver keeps the previous behaviour exactly", async () => {
    writeDashboardConfig({ defaultModel: CONFIGURED });
    const ctx = makeDeps(); // no resolveSpawnModel dep

    await createSessionLink(ctx.deps).ensureScopedSession(CWD, "inv7");

    expect("model" in ctx.spawns[0]).toBe(false);
  });
});
