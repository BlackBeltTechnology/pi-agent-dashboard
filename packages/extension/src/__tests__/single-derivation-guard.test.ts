/**
 * Guard: exactly ONE authored `deriveSupportedThinkingLevels` exists (in the
 * bridge extension, parameterized by `maxSupported`), and the dashboard server
 * derives NO supported-thinking-levels list — it passes through the raw
 * `thinkingLevelMap`. Prevents a second derivation copy drifting from the
 * canonical one.
 *
 * See change: honor-native-models-json-metadata (D-X1, test-plan / task §6.1).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, `file://${here}`)), "utf-8");

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("single supportedThinkingLevels derivation (D-X1)", () => {
  it("the extension declares exactly one deriveSupportedThinkingLevels", () => {
    const src = read("../provider-register.ts");
    expect(count(src, "function deriveSupportedThinkingLevels")).toBe(1);
  });

  it("the server introspection route derives + emits no supportedThinkingLevels", () => {
    const route = read("../../../server/src/routes/models-introspection-routes.ts");
    expect(route).not.toContain("deriveSupportedThinkingLevels");
    // No object-key emission of a supported-levels list (prose mentions are fine).
    expect(route).not.toMatch(/\bsupportedThinkingLevels\s*[:=]/);
  });

  it("the server registry declares no thinking-level derivation", () => {
    const reg = read("../../../server/src/model-proxy/internal-registry.ts");
    expect(reg).not.toContain("deriveSupportedThinkingLevels");
    expect(reg).not.toMatch(/\bsupportedThinkingLevels\s*[:=]/);
  });
});
