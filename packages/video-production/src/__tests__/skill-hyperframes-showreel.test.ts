/**
 * #E28-#E30: hyperframes-showreel is guidance only, so its behaviour is pinned as
 * content assertions — pipeline order, footage-only + pitfalls, QA gate + generator
 * reference. See change: add-music-production-skills.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "..", ".pi", "skills", "hyperframes-showreel");
const text = readFileSync(join(dir, "SKILL.md"), "utf8");

/** Numbered steps of the `## Pipeline` section. */
function pipelineSteps(): Map<number, string> {
  const section = text.split(/^## Pipeline$/m)[1].split(/^## /m)[0];
  const steps = new Map<number, string>();
  for (const line of section.split("\n")) {
    const m = line.match(/^(\d+)\. (.*)$/);
    if (m) steps.set(Number(m[1]), m[2]);
  }
  return steps;
}

describe("hyperframes-showreel SKILL.md — pipeline (#E28)", () => {
  const steps = pipelineSteps();

  it("lists steps 1-11 in order", () => {
    expect([...steps.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const order = ["sampling", "edit script", "redaction", "composition, pass 1", "veo fx", "check",
      "preview", "music", "delivery render", "export qa", "upload"];
    order.forEach((kw, i) => expect(steps.get(i + 1)?.toLowerCase(), `step ${i + 1}`).toContain(kw));
  });

  it("step 3 cuts clips via footage-redaction", () => {
    expect(steps.get(3)).toContain("footage-redaction");
  });

  it("step 8 names both music skills and requires regeneration", () => {
    const s8 = steps.get(8) ?? "";
    expect(s8).toContain("music-edit-to-length");
    expect(s8).toContain("beat-sync-video");
    expect(s8).toMatch(/regenerate the composition/i);
    expect(s8).toContain("_edit.json");
    expect(s8).toContain("_hits.json");
  });
});

describe("hyperframes-showreel SKILL.md — rules and pitfalls (#E29)", () => {
  it("states the footage-only and screen-blend FX rules", () => {
    expect(text).toMatch(/footage-only rule/i);
    expect(text).toMatch(/no AI\s+insert may depict a process that has no footage/i);
    expect(text).toMatch(/mix-blend-mode: screen/);
    expect(text).toMatch(/black background/i);
  });

  it("lists pitfalls (a)-(e)", () => {
    for (const p of ["(a)", "(b)", "(c)", "(d)", "(e)"]) expect(text).toContain(`**${p}`);
    expect(text).toMatch(/every `<audio>` element needs an `id`/i);
    expect(text).toMatch(/never hand-edit generated files/i);
    expect(text).toMatch(/washed\s+out/i);
  });

  it("project scope copies; global removal only after explicit confirmation", () => {
    expect(text).toContain("~/.agents/skills");
    expect(text).toMatch(/\*\*copy\*\* the directories just\s+installed into the user project's `\.pi\/skills\/`/);
    expect(text).toMatch(/Do \*\*not\*\* modify the global store by\s+default/);
    expect(text).toMatch(/only after the user explicitly confirms/i);
    expect(text).toMatch(/coexist at different\s+versions/i);
  });

  it("names the music-production co-install and the fallback", () => {
    expect(text).toContain("pi install npm:@blackbelt-technology/pi-dashboard-music-production");
    expect(text).toMatch(/continue with the unedited music track and no punches/i);
  });
});

describe("hyperframes-showreel — QA gate and generator reference (#E30)", () => {
  it("contains the ffprobe, loudnorm and frame-strip commands with criteria", () => {
    expect(text).toMatch(/ffprobe .*format=duration/);
    expect(text).toMatch(/loudnorm=print_format=json/);
    expect(text).toMatch(/tile=8x1/);
    expect(text).toMatch(/±0\.1 s/);
    expect(text).toMatch(/[−-]14 LUFS/);
  });

  it("ships and links references/generator-pattern.md", () => {
    expect(existsSync(join(dir, "references", "generator-pattern.md"))).toBe(true);
    expect(text).toContain("(references/generator-pattern.md)");
  });

  it("ships no generator script", () => {
    expect(existsSync(join(dir, "scripts"))).toBe(false);
  });
});
