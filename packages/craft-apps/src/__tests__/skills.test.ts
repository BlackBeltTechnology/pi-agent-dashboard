import { describe, expect, it } from "vitest";
import { CRAFT_APPS, getApp } from "../registry.js";
import { commandLines, fences, loadFixture, loadSkill, quotedIds, SKILL_NAMES } from "./helpers/skills.js";

/** `CRAFT_SKILLS=filmcraft,soundcraft` lints a subset (skill authors run it per skill; CI runs all 14). */
const only = process.env.CRAFT_SKILLS?.split(",").filter(Boolean);
const skills = SKILL_NAMES.filter((n) => !only || only.includes(n)).map((n) => loadSkill(n));
const appSkills = skills.filter((s) => s.name !== "craft-studio");
const full = !only;

/** Headings every per-app skill must carry (spec craft-app-skills "One skill per app"). */
const REQUIRED_HEADINGS: [string, RegExp][] = [
  ["what it is for / formats", /^##\s+.*(what|formats?|overview)/im],
  ["CLI dialect", /^##\s+.*dialect/im],
  ["state / persistence", /^##\s+.*(state|persist)/im],
  ["discovery", /^##\s+.*discover/im],
  ["traps", /^##\s+.*(traps?|gotchas?|pitfalls?)/im],
  ["recipes", /^##\s+.*recipes?/im],
];

describe("skill set", () => {
  it.skipIf(!full)("ships the router plus one skill per app (14)", () => {
    expect(skills).toHaveLength(14);
    expect(skills.map((s) => s.name)).toEqual(["craft-studio", ...CRAFT_APPS.map((a) => a.id)]);
  });

  it("every skill has frontmatter name == directory and a description", () => {
    for (const s of skills) {
      expect(s.frontmatter.name, s.name).toBe(s.name);
      expect((s.frontmatter.description ?? "").length, s.name).toBeGreaterThan(60);
    }
  });

  it.skipIf(!skills.some((x) => x.name === "craft-studio"))("the router description names ArtCraft craft apps, headless creative work and choosing an app", () => {
    const d = loadSkill("craft-studio").frontmatter.description;
    expect(d).toMatch(/ArtCraft/);
    expect(d).toMatch(/craft apps?/i);
    expect(d).toMatch(/headless/i);
    expect(d).toMatch(/(which|choose|pick|select)[^.]*app/i);
  });

  it("each app skill description names the app, its domain and quoted user phrasings", () => {
    for (const s of appSkills) {
      const app = getApp(s.name);
      const d = s.frontmatter.description;
      expect(d.toLowerCase(), s.name).toContain(app.name.toLowerCase());
      expect(d, `${s.name} needs typical user phrasings in double quotes`).toMatch(/"[^"]{6,}"/);
    }
  });

  it("each app skill covers dialect, state, discovery, traps and recipes", () => {
    for (const s of appSkills) {
      for (const [what, re] of REQUIRED_HEADINGS) expect(s.body, `${s.name}: missing section for ${what}`).toMatch(re);
    }
  });

  it("each app skill has 2-4 recipes; the router has at least one", () => {
    for (const s of appSkills) {
      const n = fences(s.body).filter((f) => f.recipe).length;
      expect(n, `${s.name} recipes`).toBeGreaterThanOrEqual(2);
      expect(n, `${s.name} recipes`).toBeLessThanOrEqual(4);
    }
    if (full) expect(fences(loadSkill("craft-studio").body).filter((f) => f.recipe).length).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!skills.some((x) => x.name === "craft-studio"))("the router states the policies it owns", () => {
    const t = loadSkill("craft-studio").body;
    for (const app of CRAFT_APPS) expect(t, `router table misses ${app.id}`).toContain(app.id);
    for (const needle of [/never guess/i, /pi-craft verify/, /--allow-unconfined/, /ProRes 4444/, /bash route/i, /out of scope|not supported|never drive/i, /describe|commands/]) expect(t).toMatch(needle);
  });
});

describe("recipes are verified", () => {
  it("every recipe fence contains a `pi-craft verify` line and ends with one", () => {
    for (const s of skills) {
      for (const f of fences(s.body).filter((x) => x.recipe)) {
        const lines = commandLines(f.code);
        expect(lines.some((l) => /^pi-craft verify\b/.test(l)), `${s.name} recipe "${f.recipe}" has no pi-craft verify line`).toBe(true);
        expect(lines[lines.length - 1], `${s.name} recipe "${f.recipe}" must end with pi-craft verify`).toMatch(/^pi-craft verify\b/);
      }
    }
  });

  it("recipe ids are unique inside a skill", () => {
    for (const s of skills) {
      const ids = fences(s.body).flatMap((f) => (f.recipe ? [f.recipe] : []));
      expect(new Set(ids).size, s.name).toBe(ids.length);
    }
  });
});

describe("skill drift (offline, recorded command lists)", () => {
  it("every command id quoted in an app skill's code fences exists in the recorded command list", () => {
    for (const s of appSkills) {
      const fx = loadFixture(s.name);
      const known = new Set(fx.commandIds);
      const namespaces = new Set(fx.commandIds.map((i) => i.split(".")[0]));
      for (const f of fences(s.body)) {
        for (const id of quotedIds(f.code, namespaces)) {
          expect(known.has(id), `${s.name} skill quotes "${id}", unknown to ${s.name} ${fx.version}`).toBe(true);
        }
      }
    }
  });

  it("the guard works: a renamed id with a real namespace is flagged, file names are not", () => {
    const fx = loadFixture("filmcraft");
    const known = new Set(fx.commandIds);
    const ns = new Set(fx.commandIds.map((i) => i.split(".")[0]));
    const unknown = quotedIds("timeline.setPlayhead 3 && playhead.set 3", ns).filter((id) => !known.has(id));
    expect(unknown).toEqual(["timeline.setPlayhead"]);
    expect(quotedIds("out.mp4 final.mov clip.wav", ns)).toEqual([]);
  });
});

describe("dialect facts the spec pins", () => {
  it.skipIf(!skills.some((x) => x.name === "filmcraft"))("the filmcraft skill covers the playhead trap", () => {
    const t = loadSkill("filmcraft").body;
    expect(t).toMatch(/source\.overwrite/);
    expect(t).toMatch(/source\.insert/);
    expect(t).toMatch(/playhead\.set/);
    expect(t).toMatch(/current playhead|at the playhead/i);
  });

  it.skipIf(!skills.some((x) => x.name === "pdfcraft"))("the pdfcraft skill discovers with `pdfcraft-cli tools`, not `commands`", () => {
    const t = loadSkill("pdfcraft").body;
    expect(t).toContain("pdfcraft-cli tools");
    expect(t).not.toMatch(/pdfcraft-cli commands|pi-craft pdfcraft exec commands/);
  });
});
