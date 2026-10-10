import { describe, expect, it } from "vitest";
import type { DeckIR } from "../types.js";
import { validate } from "../validate.js";
import { validIR } from "./fixtures.js";

/** Six slides `s0..s5` so `transitionCycle` resolution is observable. */
function deck(): DeckIR {
  const ir = validIR();
  const base = ir.slides[0];
  ir.slides = Array.from({ length: 6 }, (_, i) => ({ ...base, index: i + 1, id: `s${i}`, title: `S${i}` }));
  return ir;
}
const paths = (ir: DeckIR) => validate(ir).errors.map((e) => e.path);

describe("camera paths in the IR", () => {
  it("rejects an unknown transition id", () => {
    const ir = deck();
    ir.overrides.slides = { s1: { transition: "spin" } };
    expect(paths(ir)).toContain('overrides.slides["s1"].transition');
  });

  it("accepts every built-in id, transitionCycle and transitionAmount", () => {
    const ir = deck();
    ir.overrides.deck = { transitionCycle: ["dolly", "revolve", "crane", "bank", "flythrough", "swing"], transitionAmount: 1.5 };
    ir.overrides.slides = { s4: { transition: "iris", transitionAmount: 0.5 }, s5: { transition: "fade" } };
    expect(validate(ir).errors).toEqual([]);
  });

  it("accepts a well-formed path", () => {
    const ir = deck();
    ir.overrides.slides = {
      s2: { transition: "path", cameraPath: { ease: "out", keys: [{ t: 0.3, offset: [0.2, 0.1, 0], look: 0.4 }, { t: 0.7, roll: 10, fov: 55 }] } },
    };
    expect(validate(ir).errors).toEqual([]);
  });

  it("fails on unordered keys, naming the offending key", () => {
    const ir = deck();
    ir.overrides.slides = { s2: { transition: "path", cameraPath: { keys: [{ t: 0.6 }, { t: 0.4 }] } } };
    expect(paths(ir)).toContain('overrides.slides["s2"].cameraPath.keys[1].t');
  });

  it("fails when cameraPath sits on a slide whose resolved transition is not path", () => {
    const ir = deck();
    ir.overrides.slides = { s2: { cameraPath: { keys: [{ t: 0.5 }] } } };
    expect(paths(ir)).toContain('overrides.slides["s2"].cameraPath');
  });

  it("resolves through the cycle: a cycle entry `path` needs a cameraPath", () => {
    const ir = deck();
    ir.overrides.deck = { transitionCycle: ["dolly", "path"] };
    ir.overrides.slides = { s1: { cameraPath: { keys: [{ t: 0.5, offset: [0, 0.2, 0] }] } }, s5: { transition: "cut" } };
    // s1 resolves to path (has one), s3 resolves to path (missing), s5 is overridden.
    expect(paths(ir)).toEqual(['overrides.slides["s3"].transition']);
  });

  it("rejects out-of-range key fields and more than eight keys", () => {
    const ir = deck();
    ir.overrides.slides = { s1: { transition: "path", cameraPath: { keys: [{ t: 0.5, roll: 90 }] } } };
    expect(validate(ir).ok).toBe(false);
    ir.overrides.slides = { s1: { transition: "path", cameraPath: { keys: Array.from({ length: 9 }, (_, i) => ({ t: (i + 1) / 10 })) } } };
    expect(validate(ir).ok).toBe(false);
    ir.overrides.slides = { s1: { transition: "path", cameraPath: { keys: [{ t: 1 }] } } };
    expect(validate(ir).ok).toBe(false);
  });
});
