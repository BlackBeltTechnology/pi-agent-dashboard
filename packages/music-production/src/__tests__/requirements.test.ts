/**
 * #E9: both requirements files sit at the package root and pin every line exactly;
 * a `.*` suffix is allowed only for the torch/torchaudio pair.
 * See change: add-music-production-skills.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PKG, read } from "./files";

const FILES = ["requirements-core.txt", "requirements-mir.txt"];

function requirementLines(file: string): string[] {
  return read(join(PKG, file))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

describe("requirements files", () => {
  it.each(FILES)("%s exists at the package root", (f) => {
    expect(existsSync(join(PKG, f))).toBe(true);
  });

  it.each(FILES)("%s pins every requirement with ==", (f) => {
    const lines = requirementLines(f);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, line).toMatch(/^[A-Za-z0-9._-]+==[0-9A-Za-z.*]+$/);
      const [name, version] = line.split("==");
      if (version.includes("*")) expect(["torch", "torchaudio"], line).toContain(name);
    }
  });

  it("the deep tier carries the verified stack", () => {
    const mir = requirementLines("requirements-mir.txt");
    for (const pin of ["essentia-tensorflow==2.1b6.dev1438", "beat-this==1.1.0", "demucs==4.1.0", "torch==2.11.*", "torchaudio==2.11.*"]) {
      expect(mir).toContain(pin);
    }
  });
});
