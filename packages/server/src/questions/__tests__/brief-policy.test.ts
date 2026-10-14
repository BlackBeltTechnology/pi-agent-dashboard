/**
 * Brief policy + prompt (test-plan #E2 boundary, #E4 decision table, #E15 prompt redaction).
 * See change: add-pending-question-stack (D4).
 */
import { describe, expect, it } from "vitest";
import { buildBriefPrompt } from "../brief-prompt.js";
import { decideBriefPolicy } from "../brief-policy.js";

describe("decideBriefPolicy (test-plan #E2)", () => {
  const msg = (n: number) => "m".repeat(n);
  it.each([
    [0, "generate"],
    [239, "generate"],
    [240, "provided"],
    [241, "provided"],
  ])("message of %s chars (min 240) → %s", (len, expected) => {
    const message = len === 0 ? undefined : msg(len);
    expect(decideBriefPolicy({ message, autoBrief: true, minBriefChars: 240 }).kind).toBe(expected);
  });

  it("provided carries the message verbatim as the brief", () => {
    expect(decideBriefPolicy({ message: msg(300), autoBrief: true, minBriefChars: 240 })).toEqual({ kind: "provided", brief: msg(300) });
  });

  it("a provided message wins even with autoBrief=false", () => {
    expect(decideBriefPolicy({ message: msg(240), autoBrief: false, minBriefChars: 240 }).kind).toBe("provided");
  });

  it("minBriefChars=0: a blank/absent message is still not a brief", () => {
    expect(decideBriefPolicy({ message: undefined, autoBrief: true, minBriefChars: 0 }).kind).toBe("generate");
    expect(decideBriefPolicy({ message: "   ", autoBrief: true, minBriefChars: 0 }).kind).toBe("generate");
    expect(decideBriefPolicy({ message: "x", autoBrief: true, minBriefChars: 0 }).kind).toBe("provided");
  });

  it("non-string message is treated as absent", () => {
    expect(decideBriefPolicy({ message: 42 as unknown, autoBrief: true, minBriefChars: 240 }).kind).toBe("generate");
  });

  it("autoBrief=false and a short message → disabled (test-plan #E4)", () => {
    expect(decideBriefPolicy({ message: "short", autoBrief: false, minBriefChars: 240 }).kind).toBe("disabled");
  });
});

describe("buildBriefPrompt", () => {
  const snap = { toolCalls: [{ name: "bash", summary: "npm test" }], redactionVersion: 1, assistantText: "I was fixing the build." };

  it("includes question, options, message, snapshot and the ≤120-word contract", () => {
    const { system, user } = buildBriefPrompt({
      question: "Resume or hand back?",
      type: "select",
      options: ["Resume", "Hand back"],
      message: "ctx message",
      snapshot: snap,
    });
    expect(system).toMatch(/120 words/);
    expect(system).toMatch(/each option/i);
    expect(user).toContain("Resume or hand back?");
    expect(user).toContain("Resume");
    expect(user).toContain("Hand back");
    expect(user).toContain("ctx message");
    expect(user).toContain("I was fixing the build.");
    expect(user).toContain("bash: npm test");
  });

  it.each(["input", "editor"])("%s: no per-option instruction", (type) => {
    const { system } = buildBriefPrompt({ question: "q", type, snapshot: snap });
    expect(system).not.toMatch(/each option/i);
  });

  it("batch lists every sub-question with its options", () => {
    const { user } = buildBriefPrompt({
      question: "Batch",
      type: "batch",
      subQuestions: [{ method: "select", title: "Pick one", options: ["x", "y"] }, { method: "input", title: "Name?" }],
      snapshot: snap,
    });
    expect(user).toContain("Pick one");
    expect(user).toContain("Name?");
    expect(user).toContain("x");
  });

  it("notes when there is no assistant text", () => {
    const { user } = buildBriefPrompt({ question: "q", type: "confirm", snapshot: { toolCalls: [], redactionVersion: 1, assistantAbsentReason: "none" } });
    expect(user).toMatch(/no assistant text|limited context/i);
  });

  it("redacts secrets in every part of the assembled prompt (test-plan #E15)", () => {
    const { system, user } = buildBriefPrompt({
      question: "use password: hunter2hunter2 ?",
      type: "select",
      options: ["Authorization: Bearer abc123def456ghi789", "ok"],
      message: "key sk-abcdefghijklmnop1234",
      snapshot: { toolCalls: [{ name: "bash", summary: "AKIAABCDEFGHIJKLMNOP" }], redactionVersion: 1, assistantText: "api_key=supersecretvalue" },
    });
    const all = `${system}\n${user}`;
    for (const leak of ["hunter2hunter2", "abc123def456ghi789", "sk-abcdefghijklmnop1234", "AKIAABCDEFGHIJKLMNOP", "supersecretvalue"]) {
      expect(all).not.toContain(leak);
    }
  });
});
