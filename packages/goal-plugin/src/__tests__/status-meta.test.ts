/**
 * statusMeta palette/label coverage for the supervisor states.
 *
 * Closes the status union end-to-end (C2i): `respawning` and `failed` render
 * distinct, non-"Pursuing" labels — an unknown status never falls through to
 * "Pursuing" silently for these.
 *
 * See change: add-goal-session-supervisor (task 5.1 / 10.9).
 */
import { describe, expect, it } from "vitest";
import { statusMeta } from "../client/useGoals.js";

describe("statusMeta supervisor states", () => {
  it("respawning is a distinct, non-pursuing visible state", () => {
    const m = statusMeta("respawning");
    expect(m.label).toBe("Respawning");
    expect(m.label).not.toBe("Pursuing");
    expect(m.dot).toBe("↻");
  });

  it("failed renders the terminal breaker verdict", () => {
    const m = statusMeta("failed");
    expect(m.label).toBe("Failed");
    expect(m.dot).toBe("✕");
    expect(m.cls).toContain("red");
  });

  it("existing states are unchanged", () => {
    expect(statusMeta("pursuing").label).toBe("Pursuing");
    expect(statusMeta("paused").label).toBe("Paused");
    expect(statusMeta("achieved").label).toBe("Achieved");
    expect(statusMeta("cleared").label).toBe("Cleared");
  });
});
