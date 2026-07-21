/**
 * `filterByEnabledModels` — filter the dashboard `models_list` by the
 * `enabledModels` patterns in `~/.pi/agent/settings.json`.
 *
 * Matching mirrors pi core's `resolveModelScope`: minimatch (case-insensitive)
 * against both `provider/id` and bare `id`, with an optional `:<thinkingLevel>`
 * suffix stripped. `homedir()` is redirected at a temp dir so the real user
 * settings file is never touched.
 *
 * See change: filter-models-list-by-enabled-models (PR #185).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `var` (not `let`): the mocked homedir() is invoked at import time by
// provider-register (transitive), before beforeEach runs — `var` avoids the TDZ
// and the fallback keeps that import-time call from throwing.
var HOME: string | undefined;
// Non-null accessor for use sites that run after beforeEach has set HOME.
const home = (): string => {
  if (HOME === undefined) throw new Error("HOME not initialised");
  return HOME;
};

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => HOME ?? actual.homedir() };
});

// Imported after the mock is registered (vi.mock is hoisted).
import { filterByEnabledModels } from "../session-sync.js";

type M = { provider: string; id: string };

const MODELS: M[] = [
  { provider: "anthropic", id: "claude-sonnet-4-6" },
  { provider: "anthropic", id: "claude-opus-4-8" },
  { provider: "openai", id: "gpt-5.5" },
  { provider: "openai", id: "gpt-5.4" },
  { provider: "google", id: "gemini-3.1-pro-preview" },
];

function writeSettings(value: unknown): void {
  mkdirSync(join(home(), ".pi", "agent"), { recursive: true });
  writeFileSync(join(home(), ".pi", "agent", "settings.json"), JSON.stringify(value), "utf-8");
}

const ids = (models: M[]) => models.map((m) => `${m.provider}/${m.id}`).sort();

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "pi-enabled-models-"));
});

afterEach(() => {
  rmSync(home(), { recursive: true, force: true });
});

describe("filterByEnabledModels — no-op cases", () => {
  it("returns full list when settings.json is absent", () => {
    expect(filterByEnabledModels(MODELS)).toEqual(MODELS);
  });

  it("returns full list when enabledModels is absent", () => {
    writeSettings({ theme: "earth" });
    expect(filterByEnabledModels(MODELS)).toEqual(MODELS);
  });

  it("returns full list when enabledModels is an empty array", () => {
    writeSettings({ enabledModels: [] });
    expect(filterByEnabledModels(MODELS)).toEqual(MODELS);
  });

  it("returns full list when settings.json is malformed", () => {
    mkdirSync(join(home(), ".pi", "agent"), { recursive: true });
    writeFileSync(join(home(), ".pi", "agent", "settings.json"), "{ not json", "utf-8");
    expect(filterByEnabledModels(MODELS)).toEqual(MODELS);
  });
});

describe("filterByEnabledModels — matching semantics", () => {
  it("exact canonical reference", () => {
    writeSettings({ enabledModels: ["anthropic/claude-sonnet-4-6"] });
    expect(ids(filterByEnabledModels(MODELS))).toEqual(["anthropic/claude-sonnet-4-6"]);
  });

  it("provider wildcard", () => {
    writeSettings({ enabledModels: ["anthropic/*"] });
    expect(ids(filterByEnabledModels(MODELS))).toEqual([
      "anthropic/claude-opus-4-8",
      "anthropic/claude-sonnet-4-6",
    ]);
  });

  it("bare-id substring glob (the case the old exact-only matcher dropped)", () => {
    writeSettings({ enabledModels: ["*sonnet*"] });
    expect(ids(filterByEnabledModels(MODELS))).toEqual(["anthropic/claude-sonnet-4-6"]);
  });

  it("prefix glob within a provider", () => {
    writeSettings({ enabledModels: ["openai/gpt-5.*"] });
    expect(ids(filterByEnabledModels(MODELS))).toEqual(["openai/gpt-5.4", "openai/gpt-5.5"]);
  });

  it("case-insensitive match", () => {
    writeSettings({ enabledModels: ["ANTHROPIC/Claude-Opus-4-8"] });
    expect(ids(filterByEnabledModels(MODELS))).toEqual(["anthropic/claude-opus-4-8"]);
  });

  it("union of multiple patterns, de-duplicated", () => {
    writeSettings({ enabledModels: ["anthropic/*", "*sonnet*", "openai/gpt-5.5"] });
    expect(ids(filterByEnabledModels(MODELS))).toEqual([
      "anthropic/claude-opus-4-8",
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5.5",
    ]);
  });

  it("strips a trailing :thinkingLevel suffix before matching", () => {
    writeSettings({ enabledModels: ["anthropic/*:high"] });
    expect(ids(filterByEnabledModels(MODELS))).toEqual([
      "anthropic/claude-opus-4-8",
      "anthropic/claude-sonnet-4-6",
    ]);
  });

  it("keeps a colon that is not a valid thinking level", () => {
    writeSettings({ enabledModels: ["anthropic/claude-sonnet-4-6"] });
    // A model id genuinely containing a colon should still match exactly.
    const withColon = [{ provider: "custom", id: "model:v2" }];
    writeSettings({ enabledModels: ["custom/model:v2"] });
    expect(ids(filterByEnabledModels(withColon))).toEqual(["custom/model:v2"]);
  });

  it("skips non-string entries but honors the valid ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeSettings({ enabledModels: [123, "anthropic/*", null] });
    expect(ids(filterByEnabledModels(MODELS))).toEqual([
      "anthropic/claude-opus-4-8",
      "anthropic/claude-sonnet-4-6",
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns empty when no model matches any pattern", () => {
    writeSettings({ enabledModels: ["nonexistent/*"] });
    expect(filterByEnabledModels(MODELS)).toEqual([]);
  });
});
