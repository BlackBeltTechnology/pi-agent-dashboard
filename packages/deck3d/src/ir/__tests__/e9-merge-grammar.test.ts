/**
 * E9 (task 10.9) — ir: Overrides grammar — arrays replace, objects merge.
 *
 * In-memory `applyOverrides(ir)`: a derived `slides[id].effects=["tokens","fog"]`
 * is replaced wholesale by `["starfield"]`; a derived `camera` object merges with
 * `{distance: 9}`. The persisted derived `slides[]` is never mutated.
 */
import { describe, expect, it } from "vitest";
import { applyOverrides } from "../merge.js";
import { validIR } from "./fixtures.js";

describe("E9 overrides grammar", () => {
  it("replaces effect arrays, deep-merges camera objects and leaves derived slides untouched", () => {
    const ir = validIR();
    const derived = ir.slides[0];
    derived.camera = { distance: 7 };
    derived.effects = [{ id: "tokens" }, { id: "fog" }];
    ir.overrides.slides = {
      intro: {
        effects: [{ id: "starfield" }],
        camera: { distance: 9 },
      },
    };

    const merged = applyOverrides(ir);

    // Arrays replace exactly — the derived list is not appended to.
    expect(merged.slides[0].effects).toEqual([{ id: "starfield" }]);
    expect(merged.slides[0].effects?.map((e) => e.id)).toEqual(["starfield"]);

    // Objects deep-merge over the derived value.
    expect(merged.slides[0].camera).toEqual({ distance: 9 });

    // The persisted derived slide is unchanged: the merge is a fresh view.
    expect(ir.slides[0].effects?.map((e) => e.id)).toEqual(["tokens", "fog"]);
    expect(ir.slides[0].camera).toEqual({ distance: 7 });
  });
});
