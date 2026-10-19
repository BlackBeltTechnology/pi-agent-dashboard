/** `SHIM_VERSION` is read from the packaged shim's own literal. See change: edit-office-in-pane-with-craft-web (D4). */
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createShimVersionReader, parseShimVersion, SHIM_SOURCE_PATH } from "../shim.js";
import { cleanupTmp, tmp, writeShim } from "./helpers.js";

afterEach(cleanupTmp);

describe("shim version", () => {
  it("parses the literal and rejects its absence", () => {
    expect(parseShimVersion("// x\nconst SHIM_VERSION = 7;\n")).toBe(7);
    expect(() => parseShimVersion("const SHIM_VERSION = 'a';")).toThrow(/SHIM_VERSION/);
    expect(() => parseShimVersion("  const SHIM_VERSION = 3;")).toThrow(/SHIM_VERSION/);
    expect(() => parseShimVersion("const SHIM_VERSION = 0;")).toThrow(/SHIM_VERSION/);
  });

  it("the packaged shim exists and declares a version", () => {
    expect(fs.existsSync(SHIM_SOURCE_PATH)).toBe(true);
    expect(createShimVersionReader()()).toBeGreaterThanOrEqual(1);
  });

  it("re-reads when the file changes", () => {
    const dir = tmp();
    const file = writeShim(dir, 1);
    const read = createShimVersionReader(file);
    expect(read()).toBe(1);
    writeShim(dir, 2);
    fs.utimesSync(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    expect(read()).toBe(2);
  });
});
