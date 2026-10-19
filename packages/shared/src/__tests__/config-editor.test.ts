import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_CONFIG, loadConfig } from "../config.js";
import { MAX_PREVIEW_BYTES } from "../file-kind.js";

describe("loadConfig — editor large-file limit block", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("default tracks MAX_PREVIEW_BYTES (10 MiB)", () => {
    expect(DEFAULT_EDITOR_CONFIG.largeFileLimitMb * 1024 * 1024).toBe(MAX_PREVIEW_BYTES);
  });

  it("resolves an absent editor block to the default", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    expect(loadConfig().editor).toEqual({ largeFileLimitMb: 10 });
  });

  // test-plan #E1
  const cases: Array<[unknown, number]> = [
    [0, 1],
    [1, 1],
    [10, 10],
    [256, 256],
    [257, 256],
    [5000, 256],
    [10.4, 10],
    [10.6, 11],
    ["64", 10],
    [null, 10],
    [Number.NaN, 10], // JSON.stringify(NaN) === "null"
  ];
  for (const [input, expected] of cases) {
    it(`largeFileLimitMb ${JSON.stringify(input)} -> ${expected}`, () => {
      fs.writeFileSync(configFile, JSON.stringify({ editor: { largeFileLimitMb: input } }));
      expect(loadConfig().editor.largeFileLimitMb).toBe(expected);
    });
  }

  it("resolves a missing largeFileLimitMb inside an editor block to 10", () => {
    fs.writeFileSync(configFile, JSON.stringify({ editor: {} }));
    expect(loadConfig().editor.largeFileLimitMb).toBe(10);
  });
});
