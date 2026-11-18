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
import { afterEach, describe, expect, it, vi } from "vitest";

import { absoluteSourceViolations, CORRECTION, emptyFilterViolations, main } from "../check-pi-settings-paths.mjs";

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
    "https://github.com/Example/example-ext.git",
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

// fix-switch-source-empty-overlay: an empty resource filter on a non-delta
// `packages[]` entry disables those files at project scope; on the repo-root
// entry it shadows the global bridge (pi keeps the first entry per file path).
describe("empty resource filters are rejected", () => {
  const F = ".pi/settings.json";
  const INSTALL_NOTE = "pi install";
  let stderr;
  const runMain = (raw) => {
    stderr = [];
    vi.spyOn(console, "error").mockImplementation((...a) => stderr.push(a.join(" ")));
    vi.spyOn(console, "log").mockImplementation(() => {});
    return main([{ file: F, raw }]);
  };
  const err = () => stderr.join("\n");
  afterEach(() => vi.restoreAllMocks());

  it("E15: an empty extensions filter fails with its own hint", () => {
    const raw = '{"packages":[{"source":"..","extensions":[]}]}';
    const v = emptyFilterViolations(F, raw);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: "empty-filter", source: "..", key: "extensions" });
    expect(runMain(raw)).toBe(1);
    expect(err()).toContain("remove the empty key or the entry");
    expect(err()).not.toContain(CORRECTION);
    expect(err()).not.toContain(INSTALL_NOTE);
  });

  it("E16: each resource key is checked", () => {
    for (const key of ["extensions", "skills", "prompts", "themes"]) {
      const v = emptyFilterViolations(F, at([{ source: "..", [key]: [] }]));
      expect(v).toHaveLength(1);
      expect(v[0].key).toBe(key);
    }
  });

  it("E17: a delta entry is exempt", () => {
    expect(emptyFilterViolations(F, '{"packages":[{"source":"npm:x","autoload":false,"skills":[]}]}')).toEqual([]);
  });

  it("E18: clean input passes both rules", () => {
    const raw = at(["npm:a", { source: "..", extensions: ["+packages/extension/src/bridge.ts"] }]);
    expect(absoluteSourceViolations(F, raw)).toEqual([]);
    expect(emptyFilterViolations(F, raw)).toEqual([]);
  });

  it("E19: an absolute source keeps its hints", () => {
    const raw = at([{ source: "/Users/someone/repo", extensions: ["+packages/extension/src/bridge.ts"] }]);
    const v = absoluteSourceViolations(F, raw);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("absolute");
    expect(runMain(raw)).toBe(1);
    expect(err()).toContain(CORRECTION);
    expect(err()).toContain(INSTALL_NOTE);
  });

  it("E20: a mixed file reports both, hints once", () => {
    const raw = at([{ source: "/Users/someone/repo" }, { source: "..", extensions: [] }]);
    expect(runMain(raw)).toBe(1);
    expect(stderr.filter((l) => l.startsWith("error:"))).toHaveLength(2);
    expect(err().split(CORRECTION)).toHaveLength(2);
    expect(err().split(INSTALL_NOTE)).toHaveLength(2);
  });

  it("X4: an unparseable file is reported once", () => {
    const raw = '{"packages": [';
    const v = absoluteSourceViolations(F, raw);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("parse");
    expect(emptyFilterViolations(F, raw)).toEqual([]);
    expect(runMain(raw)).toBe(1);
    expect(stderr.filter((l) => l.startsWith("error:"))).toHaveLength(1);
    expect(err()).not.toContain(CORRECTION);
    expect(err()).not.toContain(INSTALL_NOTE);
  });
});
