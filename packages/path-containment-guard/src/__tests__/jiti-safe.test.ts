import * as fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs helper, no declarations
import { hasCodePositionImportMeta, transformToCjs } from "../../../../scripts/lib-jiti-scope.mjs";

const srcDir = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");

describe("jiti CJS transpile safety for -e-only entries (X9b)", () => {
  // `jiti-cjs-transpile-safety` seeds from pi.extensions / server main / plugin entries;
  // this package has none, so its two loadable files are checked explicitly.
  it.each(["extension.ts", "scope.ts", "config.ts", "decide.ts"])("%s has no import.meta in code position after a CJS transform", (name) => {
    const abs = nodePath.join(srcDir, name);
    const cjs = transformToCjs(fs.readFileSync(abs, "utf8"), abs);
    expect(hasCodePositionImportMeta(cjs)).toBe(false);
  });
});
