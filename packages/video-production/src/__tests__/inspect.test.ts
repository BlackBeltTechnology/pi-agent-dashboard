import { afterEach, describe, expect, it } from "vitest";
import { formatReport, inspectPackage } from "../inspect.js";
import { cleanup, makePackage, shotMd } from "./fixture.js";

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
