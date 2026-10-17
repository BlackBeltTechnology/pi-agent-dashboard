import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CRAFT_APPS, getApp } from "../registry.js";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";
import {
  checkSnippet,
  commandLines,
  fences,
  fixtureUnion,
  loadFixture,
  loadSkill,
  MEDIA_WORKFLOW_NAMES,
  OFFICE_WORKFLOW_NAMES,
  PKG_DIR,
  quotedIds,
  SKILL_NAMES,
  stepSections,
  unknownWorkflowIds,
  WORKFLOW_APPS,
  WORKFLOW_SIBLINGS,
  WORKFLOW_SKILL_NAMES,
} from "./helpers/skills.js";

afterAll(cleanupTmp);

/** `CRAFT_SKILLS=filmcraft,soundcraft` lints a subset (skill authors run it per skill; CI runs all 23). */
const only = process.env.CRAFT_SKILLS?.split(",").filter(Boolean);
const skills = SKILL_NAMES.filter((n) => !only || only.includes(n)).map((n) => loadSkill(n));
const workflows = WORKFLOW_SKILL_NAMES.filter((n) => !only || only.includes(n)).map((n) => loadSkill(n));
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
    for (const s of [...skills, ...workflows]) {
      for (const f of fences(s.body).filter((x) => x.recipe)) {
        const lines = commandLines(f.code);
        expect(lines.some((l) => /^pi-craft verify\b/.test(l)), `${s.name} recipe "${f.recipe}" has no pi-craft verify line`).toBe(true);
        expect(lines[lines.length - 1], `${s.name} recipe "${f.recipe}" must end with pi-craft verify`).toMatch(/^pi-craft verify\b/);
      }
    }
  });

  it("recipe ids are unique inside a skill", () => {
    for (const s of [...skills, ...workflows]) {
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

// ── Workflow skills (spec craft-media-workflow-skills) ───────────────────────────────────────────────

const hasJq = spawnSync("jq", ["--version"]).status === 0;
const router = () => loadSkill("craft-studio");

describe("workflow skills (lint)", () => {
  it.skipIf(!!only)("ships the four media and the five office workflow skills", () => {
    expect(workflows.map((s) => s.name)).toEqual([...MEDIA_WORKFLOW_NAMES, ...OFFICE_WORKFLOW_NAMES]);
    expect(OFFICE_WORKFLOW_NAMES).toEqual(["craft-brand-kit", "craft-doc-publish", "craft-deck", "craft-photo-pipeline", "craft-data-visual"]);
  });

  it("E2 frontmatter name == dir, description > 60 chars with a quoted user phrasing of >= 6 chars", () => {
    for (const s of workflows) {
      expect(s.frontmatter.name, s.name).toBe(s.name);
      const d = s.frontmatter.description ?? "";
      expect(d.length, s.name).toBeGreaterThan(60);
      expect(d, `${s.name} needs a quoted user phrasing`).toMatch(/"[^"]{6,}"/);
    }
  });

  it("E3 app-only lint is scoped: workflow skills are not app skills", () => {
    expect(appSkills.map((s) => s.name).filter((n) => n.startsWith("craft-"))).toEqual([]);
    for (const s of appSkills) expect(() => getApp(s.name), s.name).not.toThrow();
    for (const s of workflows) expect(() => getApp(s.name), s.name).toThrow();
  });

  it.skipIf(!skills.some((x) => x.name === "craft-studio"))("E4 the router lists the workflows, both splits and defines Craft jobs once", () => {
    const t = router().body;
    for (const n of WORKFLOW_SKILL_NAMES) expect(t, `router misses ${n}`).toContain(n);
    expect(t).toContain("hyperframes-showreel");
    expect(t).toMatch(/^##\s+Craft jobs/m);
    for (const needle of ["craft-jobs/<slug>/", "job.json", "[a-z0-9-]"]) expect(t, needle).toContain(needle);
    expect(t).toMatch(/FilmCraft vs HyperFrames/);
    expect(t).toMatch(/craft-beat-cut[^\n]*vs[^\n]*hyperframes-showreel/);
  });

  it("E5 every step names an output and a gate; media steps carry a pi-craft verify, text steps a check fence", () => {
    for (const s of workflows) {
      const steps = stepSections(s.body);
      expect(steps.length, s.name).toBeGreaterThanOrEqual(4);
      expect(steps.map((x) => x.n), `${s.name} steps are numbered 0..n`).toEqual(steps.map((_, i) => i));
      for (const st of steps) {
        const out = /^\*\*Output:\*\*\s*(.*)$/m.exec(st.text)?.[1];
        const gate = /^\*\*Gate:\*\*\s*(.*)$/m.exec(st.text)?.[1];
        expect(out, `${s.name} step ${st.n} has no **Output:**`).toBeTruthy();
        expect(gate, `${s.name} step ${st.n} has no **Gate:**`).toBeTruthy();
        const code = st.fences.map((f) => f.code).join("\n");
        const verifies = st.fences.flatMap((f) => commandLines(f.code)).filter((l) => /^pi-craft verify\b/.test(l));
        const checks = st.fences.filter((f) => /\bcheck:/.test(f.info));
        if (/\.(wav|mov|mp4)\b/.test(out ?? "")) expect(verifies.length, `${s.name} step ${st.n} outputs media but has no pi-craft verify`).toBeGreaterThan(0);
        if (/\.(srt|json|txt)\b/.test(out ?? "")) expect(checks.length, `${s.name} step ${st.n} outputs a text artefact but has no check: fence`).toBeGreaterThan(0);
        expect(code.length, `${s.name} step ${st.n} has no commands`).toBeGreaterThan(0);
      }
    }
  });

  it("E6 the delivery gate of a media workflow asserts h264 + aac and a frame diff", () => {
    for (const s of workflows.filter((w) => (MEDIA_WORKFLOW_NAMES as readonly string[]).includes(w.name))) {
      const last = stepSections(s.body).at(-1);
      const verifies = (last?.fences ?? []).flatMap((f) => commandLines(f.code)).filter((l) => /^pi-craft verify\b/.test(l));
      expect(
        verifies.some((l) => l.includes("--codec video=h264") && l.includes("--codec audio=aac") && l.includes("--frame-diff")),
        `${s.name}: the final step needs a verify with --codec video=h264 --codec audio=aac --frame-diff`,
      ).toBe(true);
    }
  });

  it("E10 the resume step links the router and mentions job.json, recorded inputs and downstream re-run; the slug rule is not restated", () => {
    for (const s of workflows) {
      const resume = /^## Resume\n([\s\S]*?)(?=^## )/m.exec(s.body)?.[1] ?? "";
      expect(resume, `${s.name} has no ## Resume`).not.toBe("");
      expect(resume).toContain("job.json");
      expect(resume).toMatch(/recorded inputs/);
      expect(resume).toMatch(/downstream/);
      expect(resume).toMatch(/craft-studio/);
      expect(resume).toMatch(/Craft jobs/);
      expect(s.body, `${s.name} restates the slug rule`).not.toContain("[a-z0-9-]");
    }
  });

  it("E11 step 0 names every sibling skill, its package, the CLI and a degraded path or stop", () => {
    for (const s of workflows) {
      const step0 = stepSections(s.body).find((x) => x.n === 0);
      expect(step0, s.name).toBeTruthy();
      const text = step0?.text ?? "";
      const map = WORKFLOW_SIBLINGS[s.name as keyof typeof WORKFLOW_SIBLINGS];
      for (const sib of map.skills) expect(text, `${s.name} step 0 misses ${sib}`).toContain(sib);
      for (const pkg of map.packages) expect(text, `${s.name} step 0 misses package ${pkg}`).toContain(pkg);
      for (const cli of map.clis) expect(text, `${s.name} step 0 misses ${cli}`).toContain(cli);
      expect(text, `${s.name} step 0 needs a degraded path or stop`).toMatch(/\b(stop|skip|continue|ask|offer|degraded|supplies|use the anonymous)\b/i);
    }
  });

  it("E12 craft-video-post: HyperFrames only for code-driven motion, alpha overlay branch and full-frame --size branch", () => {
    const s = workflows.find((x) => x.name === "craft-video-post");
    if (!s) return;
    expect(s.body).toContain("hyperframes-showreel");
    expect(s.body).toMatch(/Alpha branch[^\n]*pi-craft verify --alpha|Alpha branch[\s\S]{0,200}--alpha/);
    expect(s.body).toMatch(/Full-frame branch[\s\S]{0,400}--size/);
    expect(s.body).toMatch(/never author a composition/i);
  });

  it("E13 a failed gate says: re-discover with describe, at most 2 retries, then stop", () => {
    for (const s of workflows) {
      const sec = /^## When a gate fails\n([\s\S]*?)(?=^## )/m.exec(s.body)?.[1] ?? "";
      expect(sec, `${s.name} has no ## When a gate fails`).not.toBe("");
      expect(sec).toMatch(/describe/);
      expect(sec).toMatch(/at most\s+2\s+retries/i);
      expect(sec).toMatch(/stop/i);
    }
  });

  it("E14 every command id a workflow quotes in `pi-craft <app> exec` lines or jsonl rows exists in the union of its apps' command lists", () => {
    for (const s of workflows) {
      const unknown = unknownWorkflowIds(s.body, WORKFLOW_APPS[s.name as keyof typeof WORKFLOW_APPS]);
      expect(unknown, `${s.name} quotes ids unknown to ${WORKFLOW_APPS[s.name as keyof typeof WORKFLOW_APPS].join("+")}`).toEqual([]);
    }
  });

  it("E15 the workflow drift guard names an unknown id and ignores sibling CLI lines", () => {
    const body = [
      "```bash",
      "pi-craft filmcraft exec run --cmd timeline.fooBar",
      "pi-transcribe in.mp4 --lang x.y --out timeline.nope",
      "npx hyperframes render . -o out.mp4 --format timeline.other",
      "pi-craft filmcraft exec --project p.fcproj exec playhead.set seconds=1",
      "```",
    ].join("\n");
    expect(unknownWorkflowIds(body, ["filmcraft", "soundcraft", "effectcraft"])).toEqual(["timeline.fooBar"]);
    expect(unknownWorkflowIds('```jsonl\n{"id":"timeline.nope2","params":{}}\n{"id":"playhead.set","params":{}}\n```', ["filmcraft"])).toEqual(["timeline.nope2"]);
  });

  it("packaging: workflow skills declare the same name in package.json order", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8")) as { pi: { skills: string[] } };
    for (const n of WORKFLOW_SKILL_NAMES) expect(pkg.pi.skills).toContain(`.pi/skills/${n}`);
  });
});

describe.skipIf(!hasJq)("workflow skill-level checks (executed)", () => {
  const FIX = path.join(PKG_DIR, "src", "__tests__", "fixtures");
  const runCheck = (skill: string, name: string, file: string, as: string) => {
    const cwd = tmpDir("craft-check-");
    fs.copyFileSync(file, path.join(cwd, as));
    const code = checkSnippet(loadSkill(skill), name);
    return spawnSync("bash", ["-e", "-o", "pipefail", "-c", code], { cwd, encoding: "utf8" });
  };

  it("E8 the srt check fails on an empty file (0 cues) and passes on one cue", () => {
    expect(runCheck("craft-video-post", "srt", path.join(FIX, "empty.srt"), "cues.srt").status).not.toBe(0);
    expect(runCheck("craft-video-post", "srt", path.join(FIX, "one.srt"), "cues.srt").status).toBe(0);
  });

  it("E9 the hits check passes only for a valid music-hits/1 file with at least one hit", () => {
    const dir = path.join(FIX, "music-hits");
    expect(runCheck("craft-beat-cut", "hits", path.join(dir, "valid.json"), "hits.json").status).toBe(0);
    expect(runCheck("craft-beat-cut", "hits", path.join(dir, "no-hits.json"), "hits.json").status).not.toBe(0);
    expect(runCheck("craft-beat-cut", "hits", path.join(dir, "schema0.json"), "hits.json").status).not.toBe(0);
  });
});

// ── Office workflow skills (spec craft-office-workflow-skills) ───────────────────────────────────────

const officeNames = OFFICE_WORKFLOW_NAMES.filter((n) => !only || only.includes(n));
const officeSkills = officeNames.map((n) => loadSkill(n));
const officeSkill = (n: (typeof OFFICE_WORKFLOW_NAMES)[number]) => loadSkill(n);

/** `##`/`###` sections of a skill body: heading + text up to the next heading. */
function sectionsOf(body: string): { heading: string; text: string }[] {
  const parts = body.split(/^(?=#{2,3} )/m);
  return parts.map((p) => ({ heading: /^#{2,3} (.*)$/m.exec(p)?.[1] ?? "", text: p }));
}
const lines = (body: string) => fences(body).flatMap((f) => commandLines(f.code));

/** A step that exports an svg must preview it as a png and gate that with `--size`. */
function expectSvgPreview(skill: string, st: { n: number; fences: { code: string }[] }): void {
  const code = st.fences.map((f) => f.code).join("\n");
  if (!/--export\s+\S+\.svg\b/.test(code)) return;
  expect(code, `${skill} step ${st.n} makes an svg but has no png preview`).toMatch(/convert\s+\S+\.svg"?\s+"?\S+\.png/);
  expect(code, `${skill} step ${st.n} svg preview needs --size`).toMatch(/pi-craft verify\s+"?\S+\.png"?[^\n]*--size/);
}

describe("office workflow skills (lint)", () => {
  it("E28 the router lists the office workflows, the doc-publish default and the document-converter split", () => {
    const t = router().body;
    for (const n of OFFICE_WORKFLOW_NAMES) expect(t, `router misses ${n}`).toContain(n);
    expect(t).toMatch(/craft-doc-publish[^.]*default|default[^.]*craft-doc-publish/);
    expect(t).toMatch(/document-converter[\s\S]{0,300}(ingest|OCR)[\s\S]{0,300}round-trip[\s\S]{0,300}PlantUML/);
    expect(t).toMatch(/deck3d/);
  });

  it("E29 svg is gated through a png preview; --alpha on png only", () => {
    for (const s of officeSkills) {
      for (const l of lines(s.body).filter((x) => /^pi-craft verify\b/.test(x))) {
        const target = l.split(/\s+/)[2] ?? "";
        expect(target, `${s.name} verifies an svg: ${l}`).not.toMatch(/\.svg\b/);
        if (/--alpha\b/.test(l)) expect(target, `${s.name}: --alpha is for png only: ${l}`).toMatch(/\.png\b/);
      }
      for (const st of stepSections(s.body)) expectSvgPreview(s.name, st);
    }
  });

  it("E29 the failed-gate text names the retry cap 2 and exit 3", () => {
    for (const s of officeSkills) {
      const fail = /^## When a gate fails\n([\s\S]*?)(?=^## )/m.exec(s.body)?.[1] ?? "";
      expect(fail, s.name).toMatch(/at most 2\s+retries/i);
      expect(fail, s.name).toMatch(/exit\s+`3`/);
      expect(fail, s.name).toMatch(/stop and\s+report the\s+missing tool/);
    }
  });

  it("E30 every office skill links the Craft jobs section; brand-kit and doc-publish keep secrets out of job.json", () => {
    for (const s of officeSkills) {
      expect(s.body, s.name).toMatch(/\*\*Craft jobs\*\* convention in `craft-studio`/);
      expect(s.body, `${s.name} restates the slug rule`).not.toContain("[a-z0-9-]");
    }
    for (const n of ["craft-brand-kit", "craft-doc-publish"] as const) {
      if (officeNames.includes(n)) expect(officeSkill(n).body, n).toMatch(/Passwords and API keys are never written to `job\.json`/);
    }
  });

  it("E32 office ids resolve in the union of the mapped apps (including pdfcraft tool names)", () => {
    const { known } = fixtureUnion(["vectorcraft", "wordcraft", "pdfcraft", "gridcraft", "deckcraft", "photocraft", "lightcraft", "designcraft"]);
    for (const id of ["imageTrace.make", "imageTrace.makeAndExpand", "references.toc", "references.updateToc", "doc_protect", "insert.chart", "insert.picture"]) expect(known.has(id), id).toBe(true);
  });

  it.skipIf(!officeNames.includes("craft-doc-publish"))("E34 craft-doc-publish: run --file only, render gate with --pages + --text-contains, prepare gate checks the five report fields", () => {
    const s = officeSkill("craft-doc-publish");
    const all = lines(s.body);
    expect(all.filter((l) => /wordcraft exec run\b/.test(l) && /--template\b/.test(l)), "never run --template").toEqual([]);
    expect(all.some((l) => /wordcraft exec run\b[^\n]*--file\b/.test(l))).toBe(true);
    const render = stepSections(s.body).find((x) => x.n === 2);
    const verify = render?.fences.flatMap((f) => commandLines(f.code)).filter((l) => /^pi-craft verify\b/.test(l)) ?? [];
    expect(verify.some((l) => l.includes("--pages") && l.includes("--text-contains"))).toBe(true);
    const prepare = checkSnippet(s, "prepare");
    for (const field of [".unresolved", ".mermaid.unrendered", ".images.skipped", ".images.remote", ".defaulted"]) expect(prepare, field).toContain(field);
  });

  it.skipIf(!officeNames.includes("craft-brand-kit"))("E35 craft-brand-kit: imageTrace by default; anti-slop-brandkit only behind an explicit request and approval; concept label", () => {
    const s = officeSkill("craft-brand-kit");
    const step1 = stepSections(s.body).find((x) => x.n === 1);
    expect(step1?.text).toContain("imageTrace");
    for (const sec of sectionsOf(s.body).filter((x) => x.text.includes("anti-slop-brandkit"))) {
      expect(sec.text, `section "${sec.heading}"`).toMatch(/explicit/i);
      expect(sec.text, `section "${sec.heading}"`).toMatch(/approv/i);
    }
    expect(s.body).toMatch(/\bconcept\b/i);
    expect(lines(s.body).filter((l) => /anti-slop-brandkit/.test(l))).toEqual([]);
  });

  it.skipIf(!officeNames.includes("craft-deck"))("E36 craft-deck: the deck3d branch has no DeckCraft/PdfCraft step; pptx and HTML are never converted", () => {
    const s = officeSkill("craft-deck");
    const branch = sectionsOf(s.body).find((x) => /deck3d/.test(x.heading));
    expect(branch, "a deck3d section").toBeTruthy();
    expect(lines(branch?.text ?? "").filter((l) => /deckcraft|pdfcraft/i.test(l))).toEqual([]);
    expect(s.body).not.toContain("deck3d-from-pptx");
    expect(s.body).toMatch(/never converted|Do not convert/i);
  });

  it.skipIf(!officeNames.includes("craft-photo-pipeline"))("E37 craft-photo-pipeline stays inside photo develop/retouch/export", () => {
    expect(officeSkill("craft-photo-pipeline").body).not.toMatch(/dataset|lora/i);
  });

  it("every office skill drives its mapped apps in the step table", () => {
    for (const s of officeSkills) {
      for (const app of WORKFLOW_APPS[s.name as keyof typeof WORKFLOW_APPS].filter((a) => ["craft-data-visual"].includes(s.name) === false)) {
        expect(s.body.toLowerCase(), `${s.name} never uses ${app}`).toContain(app);
      }
    }
  });
});

describe.skipIf(!hasJq)("office skill-level checks (executed)", () => {
  const ERRORS = ["#NAME?", "#DIV/0!", "#REF!", "#VALUE!", "#N/A", "#NUM!", "#NULL!"];
  const runReadback = (fixture: string) => {
    const cwd = tmpDir("craft-readback-");
    const bin = tmpDir("craft-readback-bin-");
    fs.writeFileSync(path.join(cwd, "fixture.txt"), fixture);
    fs.writeFileSync(path.join(bin, "pi-craft"), '#!/bin/sh\ncat "$FIXTURE"\n', { mode: 0o755 });
    const code = checkSnippet(loadSkill("craft-data-visual"), "readback");
    return spawnSync("bash", ["-e", "-o", "pipefail", "-c", code], { cwd, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE: path.join(cwd, "fixture.txt") } });
  };

  it("E33 the read-back check fails for each of the seven error values and passes on clean cells", () => {
    for (const err of ERRORS) expect(runReadback(`Quarter  Ratio\nQ1  ${err}\nQ2  1.5\n`).status, err).not.toBe(0);
    expect(runReadback("Quarter  Revenue\nQ1  120\nQ2  150\n").status).toBe(0);
    expect(runReadback("").status, "an empty read-back is not a pass").not.toBe(0);
  });

  it("the prepare check passes only for a clean report with confirmed defaults", () => {
    const run = (report: object, env: Record<string, string> = {}) => {
      const cwd = tmpDir("craft-prepare-check-");
      fs.writeFileSync(path.join(cwd, "prepare.json"), JSON.stringify(report));
      return spawnSync("bash", ["-e", "-o", "pipefail", "-c", checkSnippet(loadSkill("craft-doc-publish"), "prepare")], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
    };
    const clean = { unresolved: [], mermaid: { unrendered: 0 }, images: { skipped: [], remote: [] }, defaulted: [] };
    expect(run(clean).status).toBe(0);
    expect(run({ ...clean, unresolved: ["document_id"] }).status).not.toBe(0);
    expect(run({ ...clean, mermaid: { unrendered: 1 } }).status).not.toBe(0);
    expect(run({ ...clean, images: { skipped: [{ path: "x", reason: "y" }], remote: [] } }).status).not.toBe(0);
    expect(run({ ...clean, images: { skipped: [], remote: ["https://x/y.png"] } }).status).not.toBe(0);
    expect(run({ ...clean, defaulted: ["client_name"] }).status, "unconfirmed defaults").not.toBe(0);
    expect(run({ ...clean, defaulted: ["client_name"] }, { DEFAULTS_CONFIRMED: "1" }).status).toBe(0);
  });
});
