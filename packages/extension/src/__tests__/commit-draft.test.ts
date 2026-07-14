/**
 * Tests for the commit-draft fallback ladder (fork-subagent → diff-only → stub)
 * using a stub agent. Verifies timeout degrades to a fallback and never hangs.
 * See change: add-session-uncommitted-indicator-and-commit.
 */
import { describe, expect, it, vi } from "vitest";
import {
  clampDiff,
  draftCommitMessage,
  sanitizeDraft,
  stubMessage,
} from "../commit-draft.js";

describe("stubMessage", () => {
  it("single file", () => expect(stubMessage(["a.ts"])).toBe("chore: update a.ts"));
  it("many files lists them", () => {
    const m = stubMessage(["a.ts", "b.ts"]);
    expect(m).toContain("chore: update 2 files");
    expect(m).toContain("- a.ts");
  });
  it("empty", () => expect(stubMessage([])).toBe("chore: update files"));
});

describe("clampDiff / sanitizeDraft", () => {
  it("clamps oversized diffs", () => {
    const out = clampDiff("x".repeat(100), 10);
    expect(out).toContain("[diff truncated at 10 bytes]");
  });
  it("strips code fences", () => {
    expect(sanitizeDraft("```\nfeat: x\n```")).toBe("feat: x");
    expect(sanitizeDraft("```diff\nfeat: y\n```")).toBe("feat: y");
  });
});

describe("draftCommitMessage ladder", () => {
  const buildDiff = () => "diff --git a/x b/x";

  it("rung 1: fork-subagent with context", async () => {
    const runAgent = vi.fn(async (_seed: string) => "feat: add thing");
    const res = await draftCommitMessage({
      files: ["x.ts"], buildDiff, buildContext: () => "ctx", runAgent,
    });
    expect(res).toEqual({ message: "feat: add thing", source: "fork-subagent" });
    expect(runAgent.mock.calls[0][0]).toContain("Session context");
  });

  it("rung 2: diff-only when no context", async () => {
    const runAgent = vi.fn(async (_seed: string) => "fix: y");
    const res = await draftCommitMessage({
      files: ["x.ts"], buildDiff, buildContext: () => undefined, runAgent,
    });
    expect(res).toEqual({ message: "fix: y", source: "diff-only" });
    expect(runAgent.mock.calls[0][0]).not.toContain("Session context");
  });

  it("rung 2: falls to diff-only when the context rung throws", async () => {
    const runAgent = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("chore: recovered");
    const res = await draftCommitMessage({
      files: ["x.ts"], buildDiff, buildContext: () => "ctx", runAgent,
    });
    expect(res.source).toBe("diff-only");
    expect(res.message).toBe("chore: recovered");
  });

  it("rung 3: stub when no agent", async () => {
    const res = await draftCommitMessage({ files: ["x.ts"], buildDiff });
    expect(res.source).toBe("stub");
  });

  it("rung 3: stub when the agent always fails", async () => {
    const runAgent = vi.fn(async () => { throw new Error("nope"); });
    const res = await draftCommitMessage({
      files: ["a.ts", "b.ts"], buildDiff, buildContext: () => "ctx", runAgent,
    });
    expect(res.source).toBe("stub");
    expect(res.message).toContain("2 files");
  });

  it("timeout degrades to a fallback (never hangs)", async () => {
    // Context rung hangs; diff-only resolves fast → diff-only wins.
    const runAgent = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {})) // never resolves
      .mockResolvedValueOnce("fix: after-timeout");
    const res = await draftCommitMessage({
      files: ["x.ts"], buildDiff, buildContext: () => "ctx", runAgent, timeoutMs: 20,
    });
    expect(res.source).toBe("diff-only");
    expect(res.message).toBe("fix: after-timeout");
  });

  it("both rungs time out → stub", async () => {
    const runAgent = vi.fn(() => new Promise<string>(() => {}));
    const res = await draftCommitMessage({
      files: ["x.ts"], buildDiff, buildContext: () => "ctx", runAgent, timeoutMs: 20,
    });
    expect(res.source).toBe("stub");
  });
});
