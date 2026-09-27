/**
 * #E35: footage-redaction SKILL.md mandates contact-sheet verification and warns
 * that OCR misses transient text. See change: add-music-production-skills.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "..", ".pi", "skills", "footage-redaction");
const text = readFileSync(join(dir, "SKILL.md"), "utf8");

describe("footage-redaction SKILL.md", () => {
  it("contains the contact-sheet command", () => {
    expect(text).toMatch(/ffmpeg .*tile=\d+x\d+/);
    expect(text).toMatch(/contact sheet/i);
  });

  it("warns that OCR is insufficient for transient text", () => {
    expect(text).toMatch(/OCR is insufficient/);
    expect(text).toMatch(/status-bar URL/);
  });

  it("states the source-frame coordinate rule", () => {
    expect(text).toMatch(/SOURCE-frame pixels, before crop and scale/);
  });

  it("ships the script it documents", () => {
    expect(existsSync(join(dir, "scripts", "redact.py"))).toBe(true);
  });
});
