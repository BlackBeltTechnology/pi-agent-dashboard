import { afterEach, describe, expect, it } from "vitest";
import { formatReport, inspectPackage } from "../inspect.js";
import { cleanup, makePackage, makeProject, shotMd, validFilm } from "./fixture.js";

afterEach(cleanup);

describe("inspectPackage", () => {
  it("reports shots, key state and flags missing prompts", () => {
    const base = makePackage({
      shot_01: shotMd({ title: "Good", prompt: "a proper prompt here", seed: 1000 }),
      shot_02: "# Bad\n\nno prompt block\n",
    });
    const report = inspectPackage({ target: base, env: {} });
    expect(report.shots.length).toBe(2);
    expect(report.keyState).toContain("MISSING");
    expect(report.problems).toEqual(["shot_02"]);
    expect(report.shots[0].promptWords).toBeGreaterThan(0);
    expect(report.shots[0].hasPrompt).toBe(true);
    expect(report.shots[1].hasPrompt).toBe(false);
  });

  it("formats a readable table", () => {
    const base = makePackage({ shot_01: shotMd({ title: "Only", prompt: "p p p", seed: 1000 }) });
    const text = formatReport(inspectPackage({ target: base, env: {} }));
    expect(text).toContain("shot_01");
    expect(text).toContain("✓ All shots have a Full Veo prompt block.");
  });
});

describe("inspectPackage — sidecars", () => {
  it("E1: package without film.json keeps the pre-change report shape", () => {
    const { base } = makeProject({ shots: { shot_01: { sidecar: null } } });
    const report = inspectPackage({ target: base, env: {} });
    expect(Object.keys(report).sort()).toEqual(["baseDir", "keyState", "problems", "shots"]);
    expect(Object.keys(report.shots[0]).sort()).toEqual(
      [
        "aspectRatio",
        "enhancePrompt",
        "firstFrame",
        "hasNegative",
        "hasPrompt",
        "name",
        "promptWords",
        "referenceImages",
        "resolution",
        "seamlessNext",
        "seed",
        "title",
      ].sort(),
    );
    const text = formatReport(report).replace(report.baseDir, "<BASE>");
    expect(text).toBe(
      [
        "Package : <BASE>",
        "API key : MISSING — set one before rendering",
        "Shots   : 1",
        "",
        "• shot_01        seed=null    16:9 1080p prompt=  3w  first=shot_01.png          ref=—  [no-negative]",
        "    shot_01",
        "",
        "✓ All shots have a Full Veo prompt block.",
      ].join("\n"),
    );
  });

  it("E18: reports per-shot sidecar state and a Sidecars block before the terminal line", () => {
    const { base } = makeProject({
      film: validFilm(),
      shots: { shot_01: {}, shot_02: { sidecar: null }, shot_03: {} },
    });
    const report = inspectPackage({ target: base, env: {} });
    expect(report.shots.map((s) => s.sidecar)).toEqual(["ok", "missing", "ok"]);
    expect(report.sidecars).toEqual({
      enabled: true,
      timeline: false,
      problems: [{ scope: "shot", message: "shot_02: sidecar missing" }],
    });
    expect(report.problems).toEqual([]);
    const lines = formatReport(report).split("\n");
    const block = lines.findIndex((l) => l.startsWith("Sidecars:"));
    const lastRow = lines.findLastIndex((l) => l.startsWith("    "));
    expect(block).toBeGreaterThan(lastRow);
    expect(lines[block + 1]).toContain("shot_02: sidecar missing");
    expect(lines.at(-1)).toBe("✓ All shots have a Full Veo prompt block.");
  });
});
