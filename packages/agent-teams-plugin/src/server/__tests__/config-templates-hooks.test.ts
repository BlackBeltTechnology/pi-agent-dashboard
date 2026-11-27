/**
 * Templates-hooks config knobs (tasks 1.2): defaults, integer domains with a
 * default + ONE startup warning per distinct invalid value, `planModeTools`
 * sanitising, and the two effective-cap accessors.
 * See change: add-agent-teams-templates-hooks.
 */
import { describe, expect, it } from "vitest";
import { capturingLogger } from "../../__tests__/harness/store-env.js";
import { PLAN_MAX_LINES } from "../../shared/constants.js";
import { createConfigReader, effectiveHookTimeoutMs, effectivePlanMaxChars, effectivePlanMaxLines, type TeamsConfig } from "../config.js";

function reader(raw: Record<string, unknown> | undefined) {
  const { logger, logs } = capturingLogger();
  let current = raw;
  const read = createConfigReader(() => current, logger);
  return { read, logs, set: (r: Record<string, unknown> | undefined) => void (current = r) };
}

describe("defaults", () => {
  it("come from the shipped schema when nothing is configured", () => {
    const { read, logs } = reader(undefined);
    expect(read()).toMatchObject({ maxTemplateBytes: 65536, hookTimeoutMs: 10000, hookMaxRetries: 3, planMaxChars: 6000, planModeTools: ["read", "grep", "find", "ls"] });
    expect(logs.warn).toEqual([]);
  });

  it("valid values are taken as configured (hookMaxRetries 0 is allowed)", () => {
    const { read, logs } = reader({ maxTemplateBytes: 1024, hookTimeoutMs: 500, hookMaxRetries: 0, planMaxChars: 100, planModeTools: ["read", "ls"] });
    expect(read()).toMatchObject({ maxTemplateBytes: 1024, hookTimeoutMs: 500, hookMaxRetries: 0, planMaxChars: 100, planModeTools: ["read", "ls"] });
    expect(logs.warn).toEqual([]);
  });

  it("leaves the core knobs untouched", () => {
    const { read } = reader({ maxTeammates: 7 });
    expect(read()).toMatchObject({ maxTeammates: 7, opGateBudgetMs: 12000, maxMessageChars: 8000 });
  });
});

describe("integer domains", () => {
  it.each<[string, unknown, number]>([
    ["hookTimeoutMs", 0, 10000],
    ["hookTimeoutMs", -5, 10000],
    ["hookTimeoutMs", 1.5, 10000],
    ["hookMaxRetries", -1, 3],
    ["hookMaxRetries", "3", 3],
    ["planMaxChars", 0, 6000],
    ["planMaxChars", Number.NaN, 6000],
    ["maxTemplateBytes", 0, 65536],
  ])("%s = %s falls back to %s with one warning", (key, bad, fallback) => {
    const { read, logs } = reader({ [key]: bad });
    expect(read()[key as keyof TeamsConfig]).toBe(fallback);
    read();
    read();
    expect(logs.warn.filter((w) => w.includes(key))).toHaveLength(1);
  });

  it("a different invalid value warns again; a later valid value applies without a restart", () => {
    const { read, logs, set } = reader({ hookMaxRetries: -1 });
    read();
    set({ hookMaxRetries: -2 });
    read();
    expect(logs.warn).toHaveLength(2);
    set({ hookMaxRetries: 5 });
    expect(read().hookMaxRetries).toBe(5);
  });
});

describe("planModeTools", () => {
  it("drops bash, edit, write and unknown names and names them in one warning", () => {
    const { read, logs } = reader({ planModeTools: ["read", "bash", "write", "edit", "frobnicate", "grep", "read"] });
    expect(read().planModeTools).toEqual(["read", "grep"]);
    read();
    expect(logs.warn).toHaveLength(1);
    for (const n of ["bash", "write", "edit", "frobnicate"]) expect(logs.warn[0]).toContain(n);
  });

  it("[read, bash, write] → [read]", () => {
    expect(reader({ planModeTools: ["read", "bash", "write"] }).read().planModeTools).toEqual(["read"]);
  });

  it("a non-array value falls back to the default with a warning; an explicit [] stays empty", () => {
    const bad = reader({ planModeTools: "read" });
    expect(bad.read().planModeTools).toEqual(["read", "grep", "find", "ls"]);
    expect(bad.logs.warn).toHaveLength(1);
    expect(reader({ planModeTools: [] }).read().planModeTools).toEqual([]);
  });

  it("non-string entries are dropped", () => {
    expect(reader({ planModeTools: ["ls", 3, null] }).read().planModeTools).toEqual(["ls"]);
  });
});

describe("effective caps", () => {
  const base = reader({}).read();
  const cfg = (over: Partial<TeamsConfig>): TeamsConfig => ({ ...base, ...over });

  it("plan chars = min(planMaxChars, maxMessageChars − 500)", () => {
    expect(effectivePlanMaxChars(cfg({}))).toBe(6000);
    expect(effectivePlanMaxChars(cfg({ planMaxChars: 9000 }))).toBe(7500);
    expect(effectivePlanMaxChars(cfg({ maxMessageChars: 2000, planMaxChars: 6000 }))).toBe(1500);
    expect(effectivePlanMaxChars(cfg({ maxMessageChars: 100 }))).toBe(1);
  });

  it("plan lines are core's PLAN_MAX_LINES (120)", () => {
    expect(effectivePlanMaxLines()).toBe(PLAN_MAX_LINES);
    expect(PLAN_MAX_LINES).toBe(120);
  });

  it("hook timeout is capped by the op-gate budget", () => {
    expect(effectiveHookTimeoutMs(cfg({}))).toBe(10000);
    expect(effectiveHookTimeoutMs(cfg({ hookTimeoutMs: 30000 }))).toBe(12000);
    expect(effectiveHookTimeoutMs(cfg({ hookTimeoutMs: 30000, opGateBudgetMs: 0 }))).toBe(1);
  });
});
