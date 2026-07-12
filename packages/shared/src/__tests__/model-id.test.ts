import { describe, expect, it } from "vitest";
import { parseModelId } from "../model-id.js";

describe("parseModelId", () => {
  it("no slash → empty provider, whole label as id", () => {
    expect(parseModelId("gpt-4")).toEqual({ provider: "", modelId: "gpt-4" });
  });

  it("single slash → provider + id", () => {
    expect(parseModelId("anthropic/claude-3.5-sonnet")).toEqual({
      provider: "anthropic",
      modelId: "claude-3.5-sonnet",
    });
  });

  it("multi-slash → first-slash split, remainder keeps slashes", () => {
    expect(parseModelId("openrouter/anthropic/claude-3.5-sonnet")).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-3.5-sonnet",
    });
    expect(parseModelId("a/b/c")).toEqual({ provider: "a", modelId: "b/c" });
  });

  it("leading slash → no provider", () => {
    expect(parseModelId("/x")).toEqual({ provider: "", modelId: "/x" });
  });

  it("empty string → no provider, empty id", () => {
    expect(parseModelId("")).toEqual({ provider: "", modelId: "" });
  });
});
