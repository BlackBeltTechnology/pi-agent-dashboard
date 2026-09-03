/**
 * Regression guard for the cost-basis default.
 *
 * Caught live: on a fresh install nothing is stored under
 * `plugins["cost-estimator"]`, and JSON-Schema defaults are NOT materialized by
 * `getPluginConfig()`. The route therefore fell through to the METERED basis and
 * reported a theoretical pay-as-you-go price as though it were cash out — the
 * single framing error this plugin exists to prevent.
 *
 * These tests pin the resolved defaults so that regresses loudly.
 */
import { describe, expect, test } from "vitest";

import { DEFAULT_SUBSCRIPTION_PLAN, SUBSCRIPTION_PLANS } from "../engine/defaults.js";
import { resolveConfig, seatMonthly } from "../server/index.js";

describe("plugin config resolution", () => {
  test("an unset config resolves to the subscription basis, not the meter", () => {
    const config = resolveConfig(undefined);
    expect(config.seatPlan).toBe(DEFAULT_SUBSCRIPTION_PLAN);
    expect(seatMonthly(config), "a fresh install must not report the theoretical meter as cash out").not.toBeNull();
  });

  test("an empty stored object resolves the same as unset", () => {
    expect(resolveConfig({})).toEqual(resolveConfig(undefined));
    expect(resolveConfig(null)).toEqual(resolveConfig(undefined));
  });

  test("stored values win over defaults, including falsy-but-meaningful ones", () => {
    const config = resolveConfig({ seats: 3, gapCapMinutes: 30, seatPlan: "glm-pro" });
    expect(config.seats).toBe(3);
    expect(config.gapCapMinutes).toBe(30);
    expect(config.seatPlan).toBe("glm-pro");
    // untouched keys still fall back
    expect(config.hoursPerDay).toBe(8);
  });

  test("explicit 'metered' is honoured — the default must not override an opt-out", () => {
    expect(seatMonthly(resolveConfig({ seatPlan: "metered" }))).toBeNull();
  });

  test("seat price comes from the plan catalogue", () => {
    const config = resolveConfig({ seatPlan: "anthropic-max-20x" });
    expect(seatMonthly(config)).toBe(SUBSCRIPTION_PLANS["anthropic-max-20x"].monthly);
  });

  test("custom plan uses the entered price, and falls back to metered when unset", () => {
    expect(seatMonthly(resolveConfig({ seatPlan: "custom", seatMonthlyUsd: 42 }))).toBe(42);
    // A custom plan with no price is not a $0 subscription — it is unconfigured.
    expect(seatMonthly(resolveConfig({ seatPlan: "custom", seatMonthlyUsd: 0 }))).toBeNull();
  });

  test("an unknown plan id degrades to metered rather than throwing", () => {
    expect(seatMonthly(resolveConfig({ seatPlan: "no-such-plan" }))).toBeNull();
  });
});
