import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSession } from "../jsonl-reader.js";
import { buildTrajectory } from "../trajectory.js";
import { segment, isCorrection } from "../segment.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "session-multi.jsonl",
);

describe("segmentation (task 2.4)", () => {
  it("yields one episode per distinct user-initiated task", () => {
    const traj = buildTrajectory(readSession(FIXTURE).events);
    const eps = segment(traj);
    expect(eps.length).toBe(3);
    expect(eps[0].userPrompt).toMatch(/jsonl reader/i);
    expect(eps[1].userPrompt).toMatch(/segmenter/i);
    expect(eps[2].userPrompt).toMatch(/unit tests/i);
  });

  it("does not split on correction-style user messages", () => {
    const traj = buildTrajectory(readSession(FIXTURE).events);
    const eps = segment(traj);
    // "no, actually use the forks pool instead" stays inside episode 1.
    const ep1Texts = eps[0].turns.map((t) => t.text).filter(Boolean).join(" ");
    expect(ep1Texts).toMatch(/forks pool/i);
  });

  it("splits on a large time gap", () => {
    const traj = buildTrajectory(readSession(FIXTURE).events);
    // A 1ms threshold forces a boundary at every timestamped transition.
    const eps = segment(traj, 1);
    expect(eps.length).toBeGreaterThan(3);
  });

  it("splits on a session_info.name change", () => {
    const mkUser = (text: string, name: string, ts: string) => ({
      role: "user" as const,
      text,
      timestamp: ts,
      name,
      toolCalls: [],
      toolResults: [],
    });
    const traj = {
      sessionId: "s",
      cwd: "",
      startedAt: "",
      turns: [
        mkUser("work on alpha", "alpha", "2026-06-20T10:00:00.000Z"),
        mkUser("keep going", "alpha", "2026-06-20T10:00:01.000Z"),
        mkUser("now beta task", "beta", "2026-06-20T10:00:02.000Z"),
      ],
      pairs: [],
    };
    // suppress the user-task boundary by making messages corrections-only? no:
    // here every user msg is a fresh task too, but the name change still must split.
    const eps = segment(traj, 60_000);
    expect(eps.length).toBeGreaterThanOrEqual(2);
    // the beta turn must not share an episode with alpha turns
    const betaEp = eps.find((e) => e.turns.some((t) => t.name === "beta"))!;
    expect(betaEp.turns.every((t) => t.name === "beta")).toBe(true);
  });

  it("recognizes correction lexicon", () => {
    expect(isCorrection("no, do it differently")).toBe(true);
    expect(isCorrection("actually use forks")).toBe(true);
    expect(isCorrection("Add the reader")).toBe(false);
  });
});
