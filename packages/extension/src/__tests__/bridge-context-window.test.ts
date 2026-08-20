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
