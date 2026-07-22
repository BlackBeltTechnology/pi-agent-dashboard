/**
 * Read/write IO tests against a temp dir (spec: "Read effective config",
 * "Write the full resolved config"). See change: add-hermes-memory-settings-plugin.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEffectiveConfig, writeResolvedConfig } from "../config-io.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-io-"));
  file = path.join(dir, "hermes-memory-config.json");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readEffectiveConfig", () => {
  it("reports exists:false and all defaults when the file is absent", () => {
    const eff = readEffectiveConfig(file);
    expect(eff.exists).toBe(false);
    expect(eff.fields.nudgeInterval).toEqual({ value: 10, default: 10, isDefault: true });
    expect(eff.fields.memoryMode.isDefault).toBe(true);
    expect(Object.values(eff.fields).every((f) => f.isDefault)).toBe(true);
  });

  it("marks a present key as non-default and leaves others default", () => {
    fs.writeFileSync(file, JSON.stringify({ llmModelOverride: "anthropic/claude-haiku-4-5" }));
    const eff = readEffectiveConfig(file);
    expect(eff.exists).toBe(true);
    expect(eff.fields.llmModelOverride).toEqual({
      value: "anthropic/claude-haiku-4-5",
      default: undefined,
      isDefault: false,
    });
    expect(eff.fields.nudgeInterval.isDefault).toBe(true);
    expect(eff.raw.llmModelOverride).toBe("anthropic/claude-haiku-4-5");
  });

  it("treats a malformed file as present with all defaults", () => {
    fs.writeFileSync(file, "{ not valid json ");
    const eff = readEffectiveConfig(file);
    expect(eff.exists).toBe(true);
    expect(Object.values(eff.fields).every((f) => f.isDefault)).toBe(true);
    expect(eff.fields.nudgeInterval.value).toBe(10);
  });
});

describe("writeResolvedConfig", () => {
  it("creates the parent dir and writes pretty JSON", () => {
    const nested = path.join(dir, "deep", "nested", "hermes-memory-config.json");
    writeResolvedConfig(nested, { nudgeInterval: 7, reviewEnabled: false });
    const text = fs.readFileSync(nested, "utf-8");
    expect(text).toContain('"nudgeInterval": 7');
    expect(text.includes("\n  ")).toBe(true); // 2-space indent
  });

  it("leaves no partial/tmp file behind (atomic rename)", () => {
    writeResolvedConfig(file, { nudgeInterval: 3 });
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).nudgeInterval).toBe(3);
  });

  it("round-trips: a subsequent read reports exists + the saved value", () => {
    writeResolvedConfig(file, { nudgeInterval: 42 });
    const eff = readEffectiveConfig(file);
    expect(eff.exists).toBe(true);
    expect(eff.fields.nudgeInterval).toEqual({ value: 42, default: 10, isDefault: false });
  });
});
