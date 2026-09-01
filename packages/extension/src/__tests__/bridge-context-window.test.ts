/**
 * The ADVANCING auto-naming transcript window (`extractLatestTurnWindow`).
 *
 * Naming used to send the FIRST user message and FIRST assistant reply forever,
 * so every retry re-sent a byte-identical request and a session that opened
 * with a greeting was skipped for life. The window now advances to the latest
 * substantive turn — while sending exactly as much as before.
 *
 * See change: fix-auto-naming-reasoning-model (design D6, test-plan #E18, #E19).
 */
import { describe, expect, it } from "vitest";
import { extractLatestTurnWindow } from "../bridge-context.js";

const ctxOf = (entries: any[]) => ({ sessionManager: { getEntries: () => entries } });

describe("extractLatestTurnWindow", () => {
  it("E18: selects the most recent NON-EMPTY user entry, skipping tool-result-only", () => {
    const window = extractLatestTurnWindow(ctxOf([
      { role: "user", content: "Refactor the auth middleware for tokens" },
      { role: "assistant", content: "on it" },
      { role: "user", content: "Now add rate limiting to the login route" },
      { role: "assistant", content: "done" },
      // A tool-result-only entry carries the `user` role but no text — it is
      // not something a human said, so it can never be the naming window.
      { role: "user", content: [{ type: "tool_result", output: "exit 0" }] },
      { role: "user", content: "   " },
    ]));
    expect(window.userMsg).toBe("Now add rate limiting to the login route");
    expect(window.assistantReply).toBe("done");
  });

  it("pairs the user entry with the assistant reply of that same turn", () => {
    const window = extractLatestTurnWindow(ctxOf([
      { role: "user", content: "first question here padded out" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question here padded out" },
      { role: "assistant", content: "second answer" },
    ]));
    expect(window).toEqual({ userMsg: "second question here padded out", assistantReply: "second answer" });
  });

  it("E19: preserves the slice bounds exactly — user 200, assistant 2000", () => {
    const window = extractLatestTurnWindow(ctxOf([
      { role: "user", content: "u".repeat(5000) },
      { role: "assistant", content: "a".repeat(5000) },
    ]));
    expect(window.userMsg).toHaveLength(200);
    expect(window.assistantReply).toHaveLength(2000);
  });

  it("reads text parts out of array content", () => {
    const window = extractLatestTurnWindow(ctxOf([
      { role: "user", content: [{ type: "image" }, { type: "text", text: "look at this and fix the bug" }] },
      { role: "assistant", content: [{ type: "text", text: "fixed" }] },
    ]));
    expect(window).toEqual({ userMsg: "look at this and fix the bug", assistantReply: "fixed" });
  });

  it("returns an empty window rather than throwing on a malformed ctx", () => {
    expect(extractLatestTurnWindow(undefined)).toEqual({});
    expect(extractLatestTurnWindow({})).toEqual({});
    expect(extractLatestTurnWindow(ctxOf([]))).toEqual({});
    expect(extractLatestTurnWindow(ctxOf([{ role: "assistant", content: "orphan" }]))).toEqual({});
  });

  it("omits the assistant side when the latest turn has no reply yet", () => {
    const window = extractLatestTurnWindow(ctxOf([
      { role: "user", content: "a question with no answer yet" },
    ]));
    expect(window).toEqual({ userMsg: "a question with no answer yet", assistantReply: undefined });
  });
});

/**
 * CodeRabbit finding: the window selected the latest NON-EMPTY user turn, but
 * the pre-filter rejects short confirmations — so a substantive request
 * followed by "ok" was skipped, violating this change's own scenario E20
 * ("a trivial latest message does not mask a substantive session").
 *
 * See change: fix-auto-naming-reasoning-model (test-plan #E20, #E21).
 */
describe("extractLatestTurnWindow — prefilter-eligible selection", () => {
  it("E20: skips past a trailing trivial confirmation to the substantive turn", () => {
    const w = extractLatestTurnWindow(ctxOf([
      { role: "user", content: "Refactor the auth middleware to support tokens" },
      { role: "assistant", content: "on it" },
      { role: "user", content: "ok" },
      { role: "assistant", content: "👍" },
    ]));
    expect(w.userMsg).toBe("Refactor the auth middleware to support tokens");
    expect(w.assistantReply).toBe("on it");
  });

  it("skips past several trivial turns", () => {
    const w = extractLatestTurnWindow(ctxOf([
      { role: "user", content: "Add rate limiting to the login route" },
      { role: "assistant", content: "done" },
      { role: "user", content: "thanks" },
      { role: "user", content: "ok" },
      { role: "user", content: "/commit" },
    ]));
    expect(w.userMsg).toBe("Add rate limiting to the login route");
  });

  it("E21: with nothing substantive ever said, falls back to the latest non-empty turn", () => {
    // The pre-filter must still see a message and report `skipped-prefilter`;
    // an empty window would be indistinguishable from a missing transcript.
    const w = extractLatestTurnWindow(ctxOf([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "thanks" },
    ]));
    expect(w.userMsg).toBe("thanks");
  });

  it("still prefers the LATEST substantive turn when several qualify", () => {
    const w = extractLatestTurnWindow(ctxOf([
      { role: "user", content: "First substantive request goes here" },
      { role: "assistant", content: "first" },
      { role: "user", content: "Second substantive request goes here" },
      { role: "assistant", content: "second" },
      { role: "user", content: "ok" },
    ]));
    expect(w).toEqual({ userMsg: "Second substantive request goes here", assistantReply: "second" });
  });
});
