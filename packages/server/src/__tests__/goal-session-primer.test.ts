import { describe, expect, it, vi } from "vitest";
import {
  buildGoalPrimerCommands,
  goalSessionTitle,
  primeGoalSession,
} from "../goal/goal-session-primer.js";

describe("buildGoalPrimerCommands", () => {
  it("builds the /goal kickoff from the objective", () => {
    expect(buildGoalPrimerCommands({ objective: "Ship the feature" })).toEqual([
      "/goal Ship the feature",
    ]);
  });

  it("collapses whitespace/newlines in the objective", () => {
    expect(buildGoalPrimerCommands({ objective: "  Ship\n the   feature \t" })).toEqual([
      "/goal Ship the feature",
    ]);
  });

  it("returns [] when the objective is empty", () => {
    expect(buildGoalPrimerCommands({ objective: "   " })).toEqual([]);
  });
});

describe("goalSessionTitle", () => {
  it("returns the single-line objective", () => {
    expect(goalSessionTitle({ objective: "Test goal" })).toBe("Test goal");
  });

  it("caps long objectives at 80 chars", () => {
    const long = "x".repeat(200);
    expect(goalSessionTitle({ objective: long })).toHaveLength(80);
  });
});

describe("primeGoalSession", () => {
  it("renames the card to the objective and dispatches /goal", () => {
    const sendPrompt = vi.fn();
    const renameSession = vi.fn();
    primeGoalSession({ sendPrompt, renameSession }, "sess-1", { objective: "Test goal" });
    expect(renameSession).toHaveBeenCalledWith("sess-1", "Test goal");
    expect(sendPrompt).toHaveBeenCalledWith("sess-1", "/goal Test goal");
  });

  it("is a no-op when the objective is empty", () => {
    const sendPrompt = vi.fn();
    const renameSession = vi.fn();
    primeGoalSession({ sendPrompt, renameSession }, "sess-1", { objective: "" });
    expect(renameSession).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
  });
});
