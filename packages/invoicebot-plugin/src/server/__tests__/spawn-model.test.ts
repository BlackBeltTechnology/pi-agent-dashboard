/**
 * Spawn-model resolution: `provider/modelId` validation and the first-valid-wins
 * precedence chain (plugin config → dashboard defaultModel → IB_MODEL → none).
 * A malformed candidate is logged and SKIPPED, never fatal — an invoice must not
 * fail to process because a config string was typo'd.
 * See change: pin-invoicebot-spawn-model.
 */
import { describe, expect, it } from "vitest";
import { parseModelRef, resolveSpawnModel } from "../spawn-model.js";

function withLog() {
  const warns: string[] = [];
  return { logger: { info: () => {}, warn: (m: string) => warns.push(m) }, warns };
}

describe("parseModelRef", () => {
  it("accepts provider/modelId and splits on the FIRST separator", () => {
    expect(parseModelRef("openai-codex/gpt-5.4")).toEqual({
      ok: true,
      provider: "openai-codex",
      modelId: "gpt-5.4",
      model: "openai-codex/gpt-5.4",
    });
    // Nested ids stay valid — provider is the first segment only.
    expect(parseModelRef("openrouter/anthropic/claude-x")).toEqual({
      ok: true,
      provider: "openrouter",
      modelId: "anthropic/claude-x",
      model: "openrouter/anthropic/claude-x",
    });
  });

  it("trims surrounding whitespace before validating", () => {
    expect(parseModelRef("  openai-codex/gpt-5.4 \n")).toMatchObject({ ok: true, model: "openai-codex/gpt-5.4" });
  });

  it.each([
    ["no separator", "gpt-5.4"],
    ["empty provider", "/gpt-5.4"],
    ["empty modelId", "openai-codex/"],
    ["inner whitespace", "openai codex/gpt-5.4"],
    ["tab", "openai-codex/gpt\t5.4"],
    ["newline", "openai-codex/gpt\n5.4"],
    ["blank", "   "],
    ["empty", ""],
  ])("rejects %s", (_label, raw) => {
    expect(parseModelRef(raw).ok).toBe(false);
  });

  it.each([[undefined], [null], [42], [{}], [["a/b"]]])("rejects non-string %s", (raw) => {
    expect(parseModelRef(raw as unknown as string).ok).toBe(false);
  });
});

describe("resolveSpawnModel precedence", () => {
  it("plugin config outranks dashboard config and env", () => {
    expect(
      resolveSpawnModel({
        pluginConfigModel: "openai-codex/gpt-5.4",
        dashboardDefaultModel: "anthropic/claude-opus-4-8",
        envModel: "google/gemini",
      }),
    ).toBe("openai-codex/gpt-5.4");
  });

  it("dashboard defaultModel is used when the plugin config is absent", () => {
    expect(
      resolveSpawnModel({ dashboardDefaultModel: "openai-codex/gpt-5.4", envModel: "google/gemini" }),
    ).toBe("openai-codex/gpt-5.4");
  });

  it("IB_MODEL is the backstop when neither config names a model", () => {
    expect(resolveSpawnModel({ envModel: "openai-codex/gpt-5.4" })).toBe("openai-codex/gpt-5.4");
  });

  it("returns undefined when nothing is configured (host default preserved)", () => {
    expect(resolveSpawnModel({})).toBeUndefined();
    expect(resolveSpawnModel({ pluginConfigModel: "", dashboardDefaultModel: "", envModel: "" })).toBeUndefined();
  });

  it("skips a malformed higher-precedence candidate and warns", () => {
    const { logger, warns } = withLog();
    const got = resolveSpawnModel(
      { pluginConfigModel: "claude-opus", dashboardDefaultModel: "openai-codex/gpt-5.4" },
      logger,
    );
    expect(got).toBe("openai-codex/gpt-5.4");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("claude-opus");
  });

  it("skips EVERY malformed candidate and still resolves the last valid one", () => {
    const { logger, warns } = withLog();
    expect(
      resolveSpawnModel(
        { pluginConfigModel: "/bad", dashboardDefaultModel: "also bad", envModel: "openai-codex/gpt-5.4" },
        logger,
      ),
    ).toBe("openai-codex/gpt-5.4");
    expect(warns).toHaveLength(2);
  });

  it("all candidates malformed → undefined, never a throw", () => {
    const { logger, warns } = withLog();
    expect(resolveSpawnModel({ pluginConfigModel: "x", dashboardDefaultModel: "y", envModel: "z" }, logger)).toBeUndefined();
    expect(warns).toHaveLength(3);
  });

  it("accepts `defaultModel` as the plugin-config key alias", () => {
    expect(resolveSpawnModel({ pluginConfigModel: undefined, pluginConfigDefaultModel: "openai-codex/gpt-5.4" })).toBe(
      "openai-codex/gpt-5.4",
    );
  });

  it("tolerates non-string junk in every slot", () => {
    expect(
      resolveSpawnModel({
        pluginConfigModel: 42 as unknown as string,
        dashboardDefaultModel: {} as unknown as string,
        envModel: null as unknown as string,
      }),
    ).toBeUndefined();
  });
});
