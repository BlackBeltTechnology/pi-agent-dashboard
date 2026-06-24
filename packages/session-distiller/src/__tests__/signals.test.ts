import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSession } from "../jsonl-reader.js";
import { buildTrajectory } from "../trajectory.js";
import { segment } from "../segment.js";
import {
  detectFaults,
  detectDecisions,
  detectCorrections,
  detectProcedures,
  verificationGate,
  extractSignals,
  episodeVerifiedGood,
} from "../signals.js";
import type { Candidate, Trajectory, Turn } from "../types.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "session-multi.jsonl",
);

function load() {
  const traj = buildTrajectory(readSession(FIXTURE).events);
  return { traj, eps: segment(traj) };
}

describe("fault detector (task 3.1)", () => {
  it("detects an isError flip on the same tool", () => {
    const { traj } = load();
    const faults = detectFaults(traj);
    expect(faults.length).toBe(1);
    expect(faults[0].wrongCall.id).toBe("c2");
    expect(faults[0].fixCall.id).toBe("c3");
    expect(faults[0].error).toMatch(/cannot find module/i);
  });

  it("ignores a non-recovering error", () => {
    const t: Trajectory = {
      sessionId: "s",
      cwd: "",
      startedAt: "",
      turns: [],
      pairs: [
        { call: { id: "a", name: "bash", arguments: {} }, result: { toolCallId: "a", text: "boom", isError: true } },
      ],
    };
    expect(detectFaults(t).length).toBe(0);
  });
});

describe("ask_user decision detector (task 3.2)", () => {
  it("captures question + answer", () => {
    const { traj } = load();
    const decisions = detectDecisions(traj);
    expect(decisions.length).toBe(1);
    expect(decisions[0].question).toMatch(/boundary rule/i);
    expect(decisions[0].answer).toMatch(/top-level user messages/i);
  });
});

describe("user correction detector (task 3.3)", () => {
  it("emits a correction after an assistant action", () => {
    const { traj } = load();
    const corrections = detectCorrections(traj);
    expect(corrections.length).toBe(1);
    expect(corrections[0].correction).toMatch(/forks pool/i);
  });
});

describe("procedure detector (task 3.4)", () => {
  it("accepts a long verified episode and rejects short ones", () => {
    const { traj, eps } = load();
    const procs = detectProcedures(traj, eps);
    expect(procs.length).toBe(1);
    expect(procs[0].toolSequence.length).toBeGreaterThan(5);
  });
});

describe("episodeVerifiedGood judges the terminal state", () => {
  const result = (text: string, isError: boolean): Turn => ({
    role: "toolResult",
    toolCalls: [],
    toolResults: [{ toolCallId: "x", text, isError }],
  });
  it("is false when an early pass is followed by a terminal error", () => {
    expect(episodeVerifiedGood([result("tests pass", false), result("boom", true)])).toBe(false);
  });
  it("is true when the terminal result is non-error", () => {
    expect(episodeVerifiedGood([result("boom", true), result("ok", false)])).toBe(true);
  });
});

describe("verification anchor gate (task 3.5)", () => {
  it("drops unverified non-documentation candidates", () => {
    const unverified: Candidate = {
      signal: "fault",
      sessionId: "s",
      signature: "fault:x:y",
      verified: false,
      wrongCall: { id: "a", name: "bash", arguments: {} },
      error: "e",
      fixCall: { id: "b", name: "bash", arguments: {} },
    };
    expect(verificationGate([unverified]).length).toBe(0);
  });

  it("keeps documentation candidates (anchored later by recurrence)", () => {
    const doc: Candidate = {
      signal: "documentation",
      sessionId: "s",
      signature: "doc:x",
      verified: false,
      summary: "## Heading\n- a\n- b",
    };
    expect(verificationGate([doc]).length).toBe(1);
  });
});

describe("extractSignals integration", () => {
  it("returns fault + decision + correction + procedure for the fixture", () => {
    const { traj, eps } = load();
    const classes = extractSignals(traj, eps).map((c) => c.signal).sort();
    expect(classes).toContain("fault");
    expect(classes).toContain("ask_user_decision");
    expect(classes).toContain("user_correction");
    expect(classes).toContain("procedure");
  });
});
