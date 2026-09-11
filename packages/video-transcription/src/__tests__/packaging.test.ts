import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Packaging invariants that a clean-install check verifies in the wild — kept
 * here so they run offline on every commit: the native embedding dependency is
 * optional, the bin is registered, and the 28 MB model / voiceprint data are
 * never vendored.
 *
 * See change: add-speaker-id-enrollment.
 */
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
  bin?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

describe("packaging", () => {
  it("S1/4.7 the native binding is an optionalDependency, never a dependency", () => {
    expect(pkg.optionalDependencies?.["sherpa-onnx-node"]).toBeDefined();
    expect(pkg.dependencies?.["sherpa-onnx-node"]).toBeUndefined();
  });

  it("S2 registers both CLI bins", () => {
    expect(pkg.bin?.["pi-voiceid"]).toBe("src/bin/voiceid.ts");
    expect(pkg.bin?.["pi-transcribe"]).toBe("src/bin/transcribe.ts");
  });

  it("S4/5.4 the published files never include a model or voiceprint data", () => {
    const published = [
      ...(pkg.files ?? []),
      // npm always publishes these regardless of `files`
      "package.json",
      "README.md",
    ];
    for (const pattern of published) {
      expect(pattern).not.toMatch(/onnx|voiceprint/i);
    }
    // no model artifact currently sits inside the package tree
    const onnx = fs
      .readdirSync(path.join(packageDir, "src"))
      .filter((f) => f.endsWith(".onnx"));
    expect(onnx).toEqual([]);
  });
});
