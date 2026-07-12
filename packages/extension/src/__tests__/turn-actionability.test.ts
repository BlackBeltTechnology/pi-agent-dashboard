import { describe, expect, it } from "vitest";
import { classifyTurnActionability } from "../turn-actionability.js";
import {
  EMPTY_STOP,
  ERRORED_TURN,
  LENGTH_TRUNCATED,
  NORMAL_TEXT_STOP,
  THINKING_ONLY_STOP,
  TOOL_CALL_TURN,
  WHITESPACE_TEXT_STOP,
} from "./fixtures/turn-actionability-fixtures.js";

describe("classifyTurnActionability", () => {
  it("classifies a thinking-only stop as empty-actionable (captured defect)", () => {
    expect(classifyTurnActionability(THINKING_ONLY_STOP)).toBe("empty-actionable");
  });

  it("classifies a wholly-empty stop as empty-actionable", () => {
    expect(classifyTurnActionability(EMPTY_STOP)).toBe("empty-actionable");
  });

  it("classifies whitespace-only text as empty-actionable", () => {
    expect(classifyTurnActionability(WHITESPACE_TEXT_STOP)).toBe("empty-actionable");
  });

  it("classifies a turn with visible text as normal", () => {
    expect(classifyTurnActionability(NORMAL_TEXT_STOP)).toBe("normal");
  });

  it("classifies a turn with a tool call as normal", () => {
    expect(classifyTurnActionability(TOOL_CALL_TURN)).toBe("normal");
  });

  it("classifies a length-truncated turn as truncated (NOT empty-actionable)", () => {
    expect(classifyTurnActionability(LENGTH_TRUNCATED)).toBe("truncated");
  });

  it("classifies an errored turn as error", () => {
    expect(classifyTurnActionability(ERRORED_TURN)).toBe("error");
  });

  it("treats a non-empty error object as error even with stopReason stop", () => {
    expect(
      classifyTurnActionability({ role: "assistant", stopReason: "stop", content: [], error: { code: 500 } }),
    ).toBe("error");
  });

  it("treats an empty error object as no error", () => {
    expect(
      classifyTurnActionability({ role: "assistant", stopReason: "stop", content: [], error: {} }),
    ).toBe("empty-actionable");
  });

  it("classifies a bare non-empty string content as normal", () => {
    expect(classifyTurnActionability({ role: "assistant", stopReason: "stop", content: "hello" })).toBe(
      "normal",
    );
  });

  it("classifies a bare empty string content as empty-actionable", () => {
    expect(classifyTurnActionability({ role: "assistant", stopReason: "stop", content: "" })).toBe(
      "empty-actionable",
    );
  });

  it("does not depend on provider identity (max_tokens truncation)", () => {
    expect(
      classifyTurnActionability({ role: "assistant", stopReason: "max_tokens", content: [] }),
    ).toBe("truncated");
  });

  it("returns normal for a null/undefined turn (defensive)", () => {
    expect(classifyTurnActionability(undefined)).toBe("normal");
    expect(classifyTurnActionability(null)).toBe("normal");
  });

  it("keeps a tool call normal even when stopReason is a truncation", () => {
    expect(
      classifyTurnActionability({
        role: "assistant",
        stopReason: "length",
        content: [{ type: "toolCall", id: "t1", name: "read" }],
      }),
    ).toBe("normal");
  });
});
