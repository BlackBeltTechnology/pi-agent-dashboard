/**
 * `readModels()` reads the native nested `providers.<p>.models[]` format (via
 * the shared reader), keeps legacy shapes, is defensive per-provider, and
 * console.warns on a JSON syntax error.
 *
 * See change: honor-native-models-json-metadata (test-plan E1/E3/X1, tasks §4).
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readModels } from "../registry-singleton.js";

const MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");

function writeModelsJson(text: string): void {
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
  writeFileSync(MODELS_PATH, text, "utf-8");
}

afterEach(() => {
  if (existsSync(MODELS_PATH)) rmSync(MODELS_PATH);
  vi.restoreAllMocks();
});

describe("readModels — native nested format", () => {
  it("flattens providers.<p>.models[] stamped with the parent provider (E1)", () => {
    writeModelsJson(
      JSON.stringify({
        providers: {
          newapi: {
            models: [
              {
                id: "glm-5.2",
                contextWindow: 200000,
                maxTokens: 65536,
                reasoning: true,
                thinkingLevelMap: { max: "max" },
                compat: { thinkingFormat: "deepseek" },
              },
            ],
          },
        },
      }),
    );
    const out = readModels();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      provider: "newapi",
      id: "glm-5.2",
      contextWindow: 200000,
      maxTokens: 65536,
      reasoning: true,
      thinkingLevelMap: { max: "max" },
      compat: { thinkingFormat: "deepseek" },
    });
  });

  it("nested native entry wins over a legacy top-level entry on collision (E3)", () => {
    writeModelsJson(
      JSON.stringify({
        models: [{ provider: "newapi", id: "glm-5.2", maxTokens: 8192 }],
        providers: { newapi: { models: [{ id: "glm-5.2", maxTokens: 65536 }] } },
      }),
    );
    const out = readModels();
    expect(out).toHaveLength(1);
    expect(out[0].maxTokens).toBe(65536);
  });

  it("a malformed provider block contributes nothing but does not throw (X1)", () => {
    writeModelsJson(
      JSON.stringify({
        providers: { bad: { models: "nope" }, good: { models: [{ id: "m1" }] } },
      }),
    );
    expect(readModels()).toEqual([{ provider: "good", id: "m1" }]);
  });

  it("a syntactically invalid file returns [] and console.warns (X1)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeModelsJson("{ not json");
    expect(readModels()).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/models\.json parse failed/);
  });

  it("returns [] when the file is absent", () => {
    if (existsSync(MODELS_PATH)) rmSync(MODELS_PATH);
    expect(readModels()).toEqual([]);
  });
});
