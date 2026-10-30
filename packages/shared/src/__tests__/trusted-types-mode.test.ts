import { describe, expect, it } from "vitest";
import { resolveTrustedTypesMode } from "../trusted-types-mode.js";

/**
 * Trusted Types mode resolution decision table (test-plan #E1).
 * See change: enforce-trusted-types-default.
 */
type Mode = "off" | "report" | "enforce";
const U = undefined;

const rows: Array<[string, unknown, unknown, Mode, Mode, string[]]> = [
  // label, env, config, cspMode, expected mode, warned sources
  ["all unset, csp report", U, U, "report", "report", []],
  ["all unset, csp unset-equivalent report", U, U, "report", "report", []],
  ["all unset, csp off", U, U, "off", "off", []],
  ["all unset, csp enforce", U, U, "enforce", "report", []],
  ["env with whitespace/case", " Report ", U, "enforce", "report", []],
  ["env OFF uppercase", "OFF", U, "enforce", "off", []],
  ["env typo", "reprot", U, "report", "report", ["env"]],
  ["env enforce, config typo shadowed", "enforce", "enforced", "report", "enforce", ["config"]],
  ["config number", U, 5, "report", "report", ["config"]],
  ["config object", U, {}, "report", "report", ["config"]],
  ["env empty string is unset", "", U, "report", "report", []],
  ["env whitespace-only is unset", "   ", U, "report", "report", []],
  ["env beats config", "enforce", "off", "report", "enforce", []],
  ["config report under csp enforce", U, "report", "enforce", "report", []],
  ["config enforce, csp report", U, "enforce", "report", "enforce", []],
  ["config enforce, csp off (explicit wins)", U, "enforce", "off", "enforce", []],
  ["both typos", "x", "y", "report", "report", ["config", "env"]],
];

describe("#E1 resolveTrustedTypesMode", () => {
  for (const [label, env, config, cspMode, mode, warned] of rows) {
    it(label, () => {
      const r = resolveTrustedTypesMode({ env, config, cspMode });
      expect(r.mode).toBe(mode);
      expect(r.warnings.map((w) => w.source).sort()).toEqual([...warned].sort());
    });
  }

  it("reports which source decided", () => {
    expect(resolveTrustedTypesMode({ env: "off", config: "report", cspMode: "report" }).source).toBe("env");
    expect(resolveTrustedTypesMode({ env: U, config: "off", cspMode: "report" }).source).toBe("config");
    expect(resolveTrustedTypesMode({ env: U, config: U, cspMode: "report" }).source).toBe("default");
  });

  it("never echoes the raw value in a warning message", () => {
    const secret = "S3CR3T-value";
    const r = resolveTrustedTypesMode({ env: secret, config: { x: secret }, cspMode: "report" });
    expect(r.warnings).toHaveLength(2);
    for (const w of r.warnings) expect(w.message).not.toContain(secret);
  });

  it("is total over unknown inputs", () => {
    for (const bad of [null, true, [], Symbol("x"), () => 1, Number.NaN]) {
      expect(() => resolveTrustedTypesMode({ env: bad, config: bad, cspMode: "report" })).not.toThrow();
    }
  });
});
