import { describe, expect, it } from "vitest";
import { currentModelState } from "../current-model-state.js";

const qwen = { model: "m5-qwen/halogen-qwen3.8-flash-next", thinkingLevel: "high" };
const bonsai = { model: "prism-local/bonsai2-27b-mtp", thinkingLevel: "low" };

describe("currentModelState", () => {
  it("uses the live session, not the last historical model selection", () => {
    expect(currentModelState(qwen, bonsai)).toEqual(qwen);
  });

  it("does not overwrite a new live choice when older response history arrives", () => {
    expect(currentModelState(bonsai, qwen)).toEqual(bonsai);
  });

  it("keeps explicit thinking off instead of an older historical level", () => {
    expect(currentModelState({ ...qwen, thinkingLevel: "off" }, bonsai)).toEqual({
      ...qwen, thinkingLevel: "off",
    });
  });

  it("falls back to transcript state for an archived or metadata-free session", () => {
    expect(currentModelState(undefined, bonsai)).toEqual(bonsai);
    expect(currentModelState({}, bonsai)).toEqual(bonsai);
  });

  it("uses transcript thinking only when live metadata does not supply it", () => {
    expect(currentModelState({ model: qwen.model }, bonsai)).toEqual({
      model: qwen.model, thinkingLevel: bonsai.thinkingLevel,
    });
  });

  it("keeps transcript precedence for an ended session with stale disk metadata", () => {
    expect(currentModelState({ ...bonsai, status: "ended" }, qwen)).toEqual(qwen);
  });

  it("retains ended metadata as fallback before the transcript loads", () => {
    expect(currentModelState({ ...bonsai, status: "ended" }, {})).toEqual(bonsai);
  });

  it("supports a session whose history has not loaded", () => {
    expect(currentModelState(qwen, {})).toEqual(qwen);
    expect(currentModelState(undefined, {})).toEqual({ model: undefined, thinkingLevel: undefined });
  });
});
