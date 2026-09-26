/**
 * #E27: music-edit-to-length SKILL.md pins the splice rules and the listening loop.
 * See change: add-music-production-skills.
 */
import { describe, expect, it } from "vitest";
import { skill } from "./files";

const text = skill("music-edit-to-length");

describe("music-edit-to-length SKILL.md", () => {
  it("keeps the drop as the fixed anchor", () => {
    expect(text).toMatch(/fixed drop anchor/i);
    expect(text).toMatch(/drop is the fixed anchor on the video timeline/i);
  });

  it("enters only at section boundaries", () => {
    expect(text).toMatch(/enter only at a section boundary/i);
  });

  it("forbids splicing across a genre boundary", () => {
    expect(text).toMatch(/never splice across a genre or energy boundary/i);
  });

  it("requires listening before the picture is locked", () => {
    expect(text).toMatch(/listen before lock/i);
    expect(text).toContain("--preview");
    expect(text).toContain(".m4a");
  });

  it("keeps rejected versions with a _vN suffix and a reason", () => {
    expect(text).toContain("_vN");
    expect(text).toMatch(/rejection\s+reason/i);
  });
});
