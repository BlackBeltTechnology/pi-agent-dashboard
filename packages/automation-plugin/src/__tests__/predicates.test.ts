/**
 * Predicate gating for the session-card-badge claim.
 * See change: add-automation-plugin.
 */
import { describe, it, expect } from "vitest";
import { isAutomationRun } from "../client/predicates.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const base = (p: Partial<DashboardSession>): DashboardSession =>
  ({ id: "s", cwd: "/r", source: "dashboard", status: "running", startedAt: 0, ...p }) as DashboardSession;

describe("isAutomationRun", () => {
  it("is true only for kind=automation sessions", () => {
    expect(isAutomationRun(base({ kind: "automation" }))).toBe(true);
    expect(isAutomationRun(base({}))).toBe(false);
    expect(isAutomationRun(null)).toBe(false);
    expect(isAutomationRun(undefined)).toBe(false);
  });
});
