import { describe, expect, it } from "vitest";
import {
  addPattern,
  buildScopeCatalogue,
  countInScope,
  parseScope,
  providerState,
  sameScopeEntries,
  serializeScope,
  toggleModel,
  toggleProvider,
} from "../model-scope.js";

/**
 * Pure logic of the enabledModels scope editor. See change:
 * pi-settings-full-coverage (test-plan #E15–#E19, design D7).
 */
const rows = [
  { id: "anthropic/claude-opus-5-5", provider: "anthropic" },
  { id: "anthropic/claude-sonnet-4-6", provider: "anthropic" },
  { id: "openrouter/anthropic/claude-x", provider: "openrouter" }, // slash id: `openrouter/*` cannot cover it
  { id: "openrouter/x:free", provider: "openrouter" },
  { id: "nv/meta/llama", provider: "nv" },
  { id: "nv/qwen", provider: "nv" },
  { id: "deepseek/deepseek-flash", provider: "deepseek" },
  { id: "deepseek/deepseek-v4-pro", provider: "deepseek" },
];
const cat = buildScopeCatalogue(rows);

describe("parseScope / serializeScope", () => {
  it("E15 classifies entries and round-trips without edits", () => {
    const entries = ["openrouter/*", "*sonnet*", "anthropic/claude-opus-5-5:high", "anthropic/*:high"];
    const parsed = parseScope(entries, cat);
    expect(parsed.patterns.map((p) => p.raw)).toEqual(["openrouter/*", "*sonnet*"]);
    expect(parsed.picks.map((p) => [p.raw, p.target])).toEqual([["anthropic/claude-opus-5-5:high", "anthropic/claude-opus-5-5"]]);
    expect(parsed.wholeProviders.map((p) => [p.raw, p.target])).toEqual([["anthropic/*:high", "anthropic"]]);
    expect(serializeScope(parsed)).toEqual(entries);
    expect(sameScopeEntries(serializeScope(parsed), entries)).toBe(true);
  });

  it("E16 a catalogue id containing a colon is a pick, not a model with a level", () => {
    const parsed = parseScope(["openrouter/x:free"], cat);
    expect(parsed.picks).toEqual([{ raw: "openrouter/x:free", kind: "pick", target: "openrouter/x:free" }]);
  });

  it("an unknown provider glob and unknown model stay patterns", () => {
    const parsed = parseScope(["nope/*", "anthropic/not-a-model"], cat);
    expect(parsed.patterns.map((p) => p.raw)).toEqual(["nope/*", "anthropic/not-a-model"]);
  });

  it("matching is case-insensitive", () => {
    expect(parseScope(["Anthropic/*"], cat).wholeProviders).toHaveLength(1);
    expect(parseScope(["ANTHROPIC/CLAUDE-OPUS-5-5"], cat).picks).toHaveLength(1);
  });
});

describe("edits", () => {
  it("E17 a provider whose ids contain `/` is toggled on as explicit picks, not `p/*`", () => {
    expect(toggleProvider([], cat, "nv", true)).toEqual(["nv/meta/llama", "nv/qwen"]);
    expect(providerState(parseScope(["nv/meta/llama", "nv/qwen"], cat), "nv", cat)).toBe("all");
  });

  it("a plain provider toggles on as a glob and off removing its entries and picks", () => {
    const on = toggleProvider(["anthropic/claude-opus-5-5"], cat, "anthropic", true);
    expect(on).toEqual(["anthropic/*"]);
    expect(toggleProvider(["anthropic/*", "openai/x"], cat, "anthropic", false)).toEqual(["openai/x"]);
  });

  it("E18 deselecting one model of a whole provider rewrites the glob into picks of the rest", () => {
    const flash = cat.models.find((m) => m.full === "deepseek/deepseek-flash");
    if (!flash) throw new Error("fixture");
    expect(toggleModel(["deepseek/*"], cat, flash, false)).toEqual(["deepseek/deepseek-v4-pro"]);
  });

  it("deselecting keeps a thinking-level suffix on the rewritten picks", () => {
    const flash = cat.models.find((m) => m.full === "deepseek/deepseek-flash");
    if (!flash) throw new Error("fixture");
    expect(toggleModel(["deepseek/*:high"], cat, flash, false)).toEqual(["deepseek/deepseek-v4-pro:high"]);
  });

  it("a model covered by a pattern cannot be toggled", () => {
    const sonnet = cat.models.find((m) => m.full === "anthropic/claude-sonnet-4-6");
    if (!sonnet) throw new Error("fixture");
    expect(toggleModel(["*sonnet*"], cat, sonnet, false)).toEqual(["*sonnet*"]);
  });

  it("toggling a single pick on then off is a no-op", () => {
    const opus = cat.models.find((m) => m.full === "anthropic/claude-opus-5-5");
    if (!opus) throw new Error("fixture");
    const on = toggleModel(["openai/*"], cat, opus, true);
    expect(on).toEqual(["openai/*", "anthropic/claude-opus-5-5"]);
    expect(toggleModel(on, cat, opus, false)).toEqual(["openai/*"]);
  });

  it("addPattern ignores blanks and duplicates", () => {
    expect(addPattern(["a"], "  ")).toEqual(["a"]);
    expect(addPattern(["a"], "a")).toEqual(["a"]);
    expect(addPattern(["a"], " *x* ")).toEqual(["a", "*x*"]);
  });

  it("the in-scope count uses the shared matcher", () => {
    // pi also tests the bare id: openrouter's `anthropic/claude-x` matches `anthropic/*` too.
    expect(countInScope(["anthropic/*"], cat)).toBe(3);
    expect(countInScope(["*sonnet*", "nv/qwen"], cat)).toBe(2);
    expect(countInScope([], cat)).toBe(0);
  });
});
