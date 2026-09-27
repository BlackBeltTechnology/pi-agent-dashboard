/**
 * #E12: music-analysis SKILL.md pins the sourcing, quiet-recording, licence and
 * cache guidance. See change: add-music-production-skills.
 */
import { describe, expect, it } from "vitest";
import { skill } from "./files";

const text = skill("music-analysis");

describe("music-analysis SKILL.md", () => {
  it("lists the acceptable audio sources", () => {
    expect(text).toMatch(/purchased file/i);
    expect(text).toMatch(/from the artist/i);
    expect(text).toMatch(/own recording/i);
    expect(text).toMatch(/never download or extract audio from a\s+streaming service/i);
  });

  it("documents the quiet-recording peak check and gain rule", () => {
    expect(text).toContain("volumedetect");
    expect(text).toMatch(/below [−-]12 dBFS/);
    expect(text).toMatch(/about [−-]2 dBFS/);
    expect(text).toMatch(/note the applied gain/i);
  });

  it("warns that the tag models are non-commercial and names the commercial path", () => {
    expect(text).toContain("CC BY-NC-SA 4.0");
    expect(text).toMatch(/non-commercial/i);
    expect(text).toMatch(/commercial deliverable[\s\S]{0,80}quick tier plus\s+stems without tags/i);
  });

  it("names the model and third-party weight caches", () => {
    expect(text).toContain("pi-music-production/models/");
    expect(text).toMatch(/torch hub cache/i);
    expect(text).toContain("hub/checkpoints/");
    expect(text).toMatch(/demucs/);
    expect(text).toMatch(/beat_this/);
  });

  it("builds project venvs with uv from the pinned files, deep tier separate", () => {
    expect(text).toContain("requirements-core.txt");
    expect(text).toContain("requirements-mir.txt");
    expect(text).toMatch(/uv venv/);
    expect(text).toMatch(/its OWN venv/);
  });

  it("instructs confirming the drop by ear", () => {
    expect(text).toMatch(/confirm the drop by ear/i);
  });
});
