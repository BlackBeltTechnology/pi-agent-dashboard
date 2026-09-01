/**
 * Guard against machine-specific absolute paths in `.pi/settings.json` (#371).
 *
 * Style mirrors `scripts/__tests__/check-conventions.test.mjs` — drive the
 * exported rule fn directly rather than shelling out, so each case is pinned
 * independently of what happens to be checked into `.pi/settings.json`.
 *
 * The negative cases carry the weight. `source` also legally holds `npm:`,
 * `git:`, `https://` and `ssh://` specifiers, none of which are filesystem
 * paths — a naive "does not start with ." rule would reject every one of them
 * and make the guard unusable.
 */
import { describe, expect, it } from "vitest";

import { absoluteSourceViolations } from "../check-pi-settings-paths.mjs";

const at = (packages) => JSON.stringify({ packages });

describe("absolute local sources are rejected (#371)", () => {
  it("flags a POSIX absolute path", () => {
    const v = absoluteSourceViolations(".pi/settings.json", at([{ source: "/Users/robson/Project/x" }]));
    expect(v).toHaveLength(1);
    expect(v[0].source).toBe("/Users/robson/Project/x");
    expect(v[0].file).toBe(".pi/settings.json");
  });

  it("flags a Windows absolute path", () => {
    expect(absoluteSourceViolations("p", at([{ source: "C:\\Users\\dev\\repo" }]))).toHaveLength(1);
  });

  it("flags a home-relative path, which is just as machine-specific", () => {
    expect(absoluteSourceViolations("p", at([{ source: "~/Project/x" }]))).toHaveLength(1);
  });

  it("reports every offending entry, not just the first", () => {
    const v = absoluteSourceViolations("p", at([{ source: "/a" }, { source: ".." }, { source: "/b" }]));
    expect(v.map((x) => x.source)).toEqual(["/a", "/b"]);
  });
});

describe("legal sources are left alone", () => {
  it("accepts the relative form this repo uses", () => {
    expect(absoluteSourceViolations("p", at([{ source: ".." }]))).toEqual([]);
  });

  it.each([
    "npm:@blackbelt-technology/pi-dashboard-shared",
    "git:git@github.com:user/repo@v1.0.0",
    "https://github.com/BlackBeltTechnology/pi-anthropic-messages.git",
    "ssh://git@github.com/user/repo",
  ])("accepts the non-path specifier %s", (source) => {
    expect(absoluteSourceViolations("p", at([{ source }]))).toEqual([]);
  });

  it("accepts the bare-string package form", () => {
    expect(absoluteSourceViolations("p", at(["npm:simple-pkg"]))).toEqual([]);
  });

  it("ignores settings with no packages at all", () => {
    expect(absoluteSourceViolations("p", JSON.stringify({ skills: [] }))).toEqual([]);
  });
});

describe("malformed input fails closed", () => {
  it("reports unparseable JSON instead of silently passing", () => {
    const v = absoluteSourceViolations("p", "{ not json");
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(/parse/i);
  });
});
