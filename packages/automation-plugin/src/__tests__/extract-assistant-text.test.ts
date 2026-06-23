/**
 * Run result capture: `extractAssistantText` must capture genuine assistant
 * message output (array-of-blocks content) and never the injected action
 * prompt. See change: fix-automation-result-capture.
 *
 * Wire shapes VERIFIED live (task 1.1) against a Gemini PONG run by logging
 * raw forwarded events for the tracked run session. The assistant reply
 * forwards as:
 *   message_start (content: [])  ->  message_update* (streaming)  ->
 *   turn_end { message: { role: "assistant",
 *       content: [{ type: "thinking", ... }, { type: "text", text: "PONG" }] } }
 *   ->  agent_end
 * There is NO assistant `message_end`; only USER messages emit `message_end`.
 * The injected prompt arrives as an `input` event + a user message_start/end.
 * Capture is therefore anchored on `turn_end`.
 */
import { describe, it, expect } from "vitest";
import { extractAssistantText } from "../server/index.js";

function assistantTurn(content: unknown) {
  return { eventType: "turn_end", data: { message: { role: "assistant", content } } };
}

describe("extractAssistantText", () => {
  it("captures array-of-blocks assistant content from turn_end (real PONG shape)", () => {
    const ev = assistantTurn([
      { type: "thinking", thinking: "**Focusing on Simple Reply**\n..." },
      { type: "text", text: "PONG", textSignature: "CiQBDD..." },
    ]);
    expect(extractAssistantText(ev)).toBe("PONG");
  });

  it("concatenates multiple text blocks and drops non-text blocks", () => {
    const ev = assistantTurn([
      { type: "text", text: "Found 2 bugs." },
      { type: "toolCall", id: "t1", name: "x" },
      { type: "text", text: " Fixed both." },
    ]);
    expect(extractAssistantText(ev)).toBe("Found 2 bugs. Fixed both.");
  });

  it("captures string assistant content (older shape)", () => {
    const ev = assistantTurn("plain reply");
    expect(extractAssistantText(ev)).toBe("plain reply");
  });

  it("does NOT capture the user-role message_end prompt echo", () => {
    const ev = {
      eventType: "message_end",
      data: { message: { role: "user", content: [{ type: "text", text: "do the thing" }] } },
    };
    expect(extractAssistantText(ev)).toBeNull();
  });

  it("does NOT capture the `input` prompt-delivery event", () => {
    const ev = { eventType: "input", data: { text: "do the thing", source: "extension" } };
    expect(extractAssistantText(ev)).toBeNull();
  });

  it("does NOT capture streaming assistant message_update (avoids dup)", () => {
    const ev = {
      eventType: "message_update",
      data: { message: { role: "assistant", content: [{ type: "text", text: "PON" }] } },
    };
    expect(extractAssistantText(ev)).toBeNull();
  });

  it("does NOT capture an assistant message_end (not the live anchor)", () => {
    const ev = {
      eventType: "message_end",
      data: { message: { role: "assistant", content: [{ type: "text", text: "PONG" }] } },
    };
    expect(extractAssistantText(ev)).toBeNull();
  });

  it("does NOT capture a thinking-only turn (no text block)", () => {
    const ev = assistantTurn([{ type: "thinking", thinking: "pondering..." }]);
    expect(extractAssistantText(ev)).toBeNull();
  });

  it("defensively excludes a captured chunk equal to the injected promptText", () => {
    const prompt = "Reply with exactly the single word PONG and nothing else.";
    const ev = assistantTurn([{ type: "text", text: prompt }]);
    expect(extractAssistantText(ev, prompt)).toBeNull();
  });

  it("still captures a genuine reply when promptText is provided", () => {
    const prompt = "Reply with exactly the single word PONG and nothing else.";
    const ev = assistantTurn([{ type: "text", text: "PONG" }]);
    expect(extractAssistantText(ev, prompt)).toBe("PONG");
  });

  it("returns null for empty / whitespace-only assistant content", () => {
    expect(extractAssistantText(assistantTurn([{ type: "text", text: "   " }]))).toBeNull();
    expect(extractAssistantText(assistantTurn([]))).toBeNull();
  });

  it("returns null for malformed events (undefined / missing data)", () => {
    expect(extractAssistantText(undefined)).toBeNull();
    expect(extractAssistantText({ eventType: "turn_end" })).toBeNull();
  });

  it("captures root-level assistant fallback shapes (data.role + data.content/text)", () => {
    expect(
      extractAssistantText({
        eventType: "turn_end",
        data: { role: "assistant", content: [{ type: "text", text: "PONG" }] },
      }),
    ).toBe("PONG");
    expect(
      extractAssistantText({
        eventType: "turn_end",
        data: { role: "assistant", text: "PONG" },
      }),
    ).toBe("PONG");
  });
});
