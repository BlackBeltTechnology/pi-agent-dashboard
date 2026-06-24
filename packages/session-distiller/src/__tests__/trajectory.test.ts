import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSession } from "../jsonl-reader.js";
import { buildTrajectory, pairToolCalls } from "../trajectory.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "session-multi.jsonl",
);

function traj() {
  return buildTrajectory(readSession(FIXTURE).events);
}

describe("trajectory normalization (task 2.2)", () => {
  it("captures session metadata from header / model_change / session_info", () => {
    const t = traj();
    expect(t.sessionId).toBe("sess1");
    expect(t.cwd).toBe("/repo");
    expect(t.model).toBe("claude-opus-4-8");
    expect(t.name).toBe("harvest-work");
  });

  it("pairs every toolCall to its toolResult", () => {
    const t = traj();
    const totalCalls = t.turns.reduce((n, tu) => n + tu.toolCalls.length, 0);
    expect(t.pairs.length).toBe(totalCalls);
    const unpaired = t.pairs.filter((p) => !p.result);
    expect(unpaired.length).toBe(0);
    // spot-check a known flip pair
    const c2 = t.pairs.find((p) => p.call.id === "c2");
    expect(c2?.result?.isError).toBe(true);
    const c3 = t.pairs.find((p) => p.call.id === "c3");
    expect(c3?.result?.isError).toBe(false);
  });

  it("extracts text and thinking blocks onto assistant turns", () => {
    const t = traj();
    const withText = t.turns.find((tu) => tu.text?.startsWith("I will add it"));
    expect(withText).toBeTruthy();
    const withThinking = t.turns.find((tu) => tu.thinking === "missing dep");
    expect(withThinking).toBeTruthy();
  });

  it("flags unpaired calls when a result is missing", () => {
    const pairs = pairToolCalls([
      { role: "assistant", toolCalls: [{ id: "x", name: "bash", arguments: {} }], toolResults: [] },
    ]);
    expect(pairs[0].result).toBeUndefined();
  });
});
