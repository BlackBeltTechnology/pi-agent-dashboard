/**
 * Pure decision logic of scripts/codeql-local.mjs (test-plan #E14, #E15, #E17,
 * #E19–#E22, #E24, #E29 writer, #P1).
 *
 * See change: add-local-codeql-ratchet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptEntry,
  baselineGrowth,
  globToRegExp,
  indexFilters,
  keyOf,
  matchingIgnoreGlob,
  parseGithubRemote,
  pruneBaseline,
  ratchetDecision,
  reasonError,
  resultKeys,
  serializeBaseline,
  validateBaseline,
} from "../codeql-local.mjs";
import { baselineOf, entry, sarifOf } from "./fixtures/codeql-harness.mjs";

const PI = "js/path-injection";
const res = (ruleId, file, hash, line = 1, message = "m") => ({ ruleId, file, lineHash: hash, startLine: line, message, key: keyOf(ruleId, file, hash) });

describe("ratchetDecision (#E14)", () => {
  const cases = [
    ["key absent", [], [res(PI, "a.ts", "h:1")], "new", 1],
    ["above baseline", [entry(PI, "a.ts", "h:1", 1)], [res(PI, "a.ts", "h:1", 3), res(PI, "a.ts", "h:1", 9)], "new", 1],
    ["at baseline", [entry(PI, "a.ts", "h:1", 2)], [res(PI, "a.ts", "h:1", 3), res(PI, "a.ts", "h:1", 9)], "pass", 0],
    ["below baseline", [entry(PI, "a.ts", "h:1", 2)], [res(PI, "a.ts", "h:1", 3)], "pass", 0],
  ];
  for (const [name, entries, results, status, n] of cases) {
    it(name, () => {
      const d = ratchetDecision(baselineOf(entries), results);
      expect(d.status).toBe(status);
      expect(d.newResults).toHaveLength(n);
      for (const r of d.newResults) expect(r).toMatchObject({ ruleId: PI, file: "a.ts", message: "m" });
    });
  }

  it("reports a stale entry with baseline and current counts", () => {
    const d = ratchetDecision(baselineOf([entry(PI, "a.ts", "h:1", 2)]), [res(PI, "a.ts", "h:1")]);
    expect(d.staleEntries).toEqual([{ ruleId: PI, file: "a.ts", lineHash: "h:1", baseline: 2, current: 1 }]);
  });
});

describe("validateBaseline — fixture V (#E15)", () => {
  const verdict = (e, extra = {}) => validateBaseline(baselineOf([{ ruleId: PI, file: "a.ts", lineHash: "60907dd70d778:1", count: 1, reason: "untriaged", ...e }], extra)).ok;
  const reasons = [
    ["untriaged", true],
    ["untriaged ", false],
    ["operator-authz: GET /api/x behind guard", true],
    ["operator-authz:", false],
    ["false-positive: constant input", true],
    ["accepted-risk: dev-only tool", true],
    ["github-dismissed (#12, false positive): no comment", true],
    ["github-dismissedX: y", false],
    ["because", false],
  ];
  for (const [reason, ok] of reasons) it(`reason ${JSON.stringify(reason)} → ${ok ? "valid" : "invalid"}`, () => expect(verdict({ reason })).toBe(ok));

  it("operator-authz only on the three preset rules", () => {
    expect(verdict({ ruleId: "js/request-forgery", reason: "operator-authz: x" })).toBe(false);
    for (const ruleId of ["js/command-line-injection", "js/shell-command-constructed-from-input"]) {
      expect(verdict({ ruleId, reason: "operator-authz: x" })).toBe(true);
    }
  });
  for (const [h, ok] of [["60907dd70d778:1", true], ["332c0eff7e57397a:1", true], ["-@7", true], ["abc", false], ["-", false]]) {
    it(`lineHash ${h} → ${ok ? "valid" : "invalid"}`, () => expect(verdict({ lineHash: h })).toBe(ok));
  }
  for (const [f, ok] of [[" a.ts", false], ["a.ts ", false], ["a.ts", true]]) it(`file ${JSON.stringify(f)}`, () => expect(verdict({ file: f })).toBe(ok));
  for (const [c, ok] of [[0, false], [1.5, false], ["2", false], [2, true]]) it(`count ${JSON.stringify(c)}`, () => expect(verdict({ count: c })).toBe(ok));

  it("duplicate (ruleId, file, lineHash) is invalid", () => {
    const e = entry(PI, "a.ts", "h:1");
    expect(validateBaseline(baselineOf([e, { ...e }])).ok).toBe(false);
  });
  it("header problems are invalid", () => {
    expect(validateBaseline({ ...baselineOf(), version: 2 }).ok).toBe(false);
    expect(validateBaseline({ ...baselineOf(), packs: {} }).ok).toBe(false);
    expect(validateBaseline(null).ok).toBe(false);
  });
  it("a missing entry field is invalid", () => {
    expect(validateBaseline(baselineOf([{ ruleId: PI, file: "a.ts", lineHash: "h:1", count: 1 }])).ok).toBe(false);
  });
});

describe("resultKeys (#E17)", () => {
  it("keys per rule+file+hash, decodes the URI, keys hashless results by line", () => {
    const sarif = sarifOf([
      { ruleId: "js/a", file: "x.js", line: 5, hash: "ab:1" },
      { ruleId: "js/b", file: "x.js", line: 5, hash: "ab:1" },
      { ruleId: "js/c", file: "sp%20ace/q.js", line: 2, hash: "cd:1" },
      { ruleId: "js/d", file: "h.js", line: 7, hash: null },
    ]);
    const { results, warnings } = resultKeys(sarif);
    expect(new Set(results.slice(0, 2).map((r) => r.key)).size).toBe(2);
    expect(results[2].file).toBe("sp ace/q.js");
    expect(results[3].lineHash).toBe("-@7");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^CODEQL WARNING:/);
    const moved = resultKeys(sarifOf([{ ruleId: "js/d", file: "h.js", line: 9, hash: null }])).results[0];
    expect(moved.lineHash).toBe("-@9");
    expect(moved.key).not.toBe(results[3].key);
  });
  it("accepts several SARIF documents", () => {
    const { results } = resultKeys([sarifOf([{ ruleId: "a", file: "f" }]), sarifOf([{ ruleId: "b", file: "g" }])]);
    expect(results).toHaveLength(2);
  });
});

describe("baselineGrowth (#E19–#E22)", () => {
  const authz = "operator-authz: GET /api/x behind the network guard";
  it("#E19 accepted with a reason passes and is printed", () => {
    const r = baselineGrowth(baselineOf(), baselineOf([entry(PI, "a.ts", "h:1", 1, authz)]));
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("count 0 → 1");
    expect(r.lines.join("\n")).toContain(authz);
  });
  it("#E19 triage then accept in one branch passes", () => {
    const r = baselineGrowth(baselineOf([entry(PI, "a.ts", "h:1", 2)]), baselineOf([entry(PI, "a.ts", "h:1", 3, authz)]));
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toMatch(/count 2 → 3.*"untriaged" → /);
  });
  it("#E20 (a) new untriaged key fails", () => {
    const r = baselineGrowth(baselineOf(), baselineOf([entry(PI, "a.ts", "h:1")]));
    expect(r.ok).toBe(false);
    expect(r.violations.join("\n")).toContain("a.ts");
  });
  it("#E20 (b) raising an untriaged count fails", () => {
    expect(baselineGrowth(baselineOf([entry(PI, "a.ts", "h:1", 2)]), baselineOf([entry(PI, "a.ts", "h:1", 3)])).ok).toBe(false);
  });
  it("#E20 (c) a changed key cannot evade the per rule+file total", () => {
    const r = baselineGrowth(baselineOf([entry(PI, "a.ts", "h:1", 3)]), baselineOf([entry(PI, "a.ts", "h:2", 2), entry(PI, "a.ts", "h:3", 2)]));
    expect(r.ok).toBe(false);
    expect(r.violations.join("\n")).toContain(`${PI} a.ts`);
  });
  it("#E20 (d) relabelling to untriaged fails", () => {
    const r = baselineGrowth(baselineOf([entry(PI, "a.ts", "h:1", 1, "false-positive: x")]), baselineOf([entry(PI, "a.ts", "h:1", 1)]));
    expect(r.ok).toBe(false);
    expect(r.violations.join("\n")).toContain("a.ts");
  });
  it("#E21 noGrowth rejects a new key and a raised count whatever the reason", () => {
    expect(baselineGrowth(baselineOf(), baselineOf([entry(PI, "a.ts", "h:1", 1, authz)]), { noGrowth: true }).ok).toBe(false);
    const ref = baselineOf([entry(PI, "a.ts", "h:1", 1, "false-positive: x")]);
    expect(baselineGrowth(ref, baselineOf([entry(PI, "a.ts", "h:1", 2, "false-positive: x")]), { noGrowth: true }).ok).toBe(false);
    expect(baselineGrowth(ref, ref, { noGrowth: true }).ok).toBe(true);
  });
  it("#E22 lowering, removal and triage pass and are printed", () => {
    const lowered = baselineGrowth(baselineOf([entry(PI, "a.ts", "h:1", 3)]), baselineOf([entry(PI, "a.ts", "h:1", 1)]));
    expect(lowered.ok).toBe(true);
    const removed = baselineGrowth(baselineOf([entry(PI, "a.ts", "h:1", 2, "false-positive: y")]), baselineOf());
    expect(removed.ok).toBe(true);
    expect(removed.lines[0]).toContain("count 2 → 0");
    expect(removed.lines[0]).toContain("false-positive: y");
    const triaged = baselineGrowth(baselineOf([entry(PI, "a.ts", "h:1", 2)]), baselineOf([entry(PI, "a.ts", "h:1", 2, "false-positive: x")]));
    expect(triaged.ok).toBe(true);
    expect(triaged.lines[0]).toContain("false-positive: x");
  });
  it("#P1 400 entries, 50 changed: pure comparison is fast", () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => entry(PI, `f${i}.ts`, `${i.toString(16)}:1`, 2, "false-positive: x"));
    const ref = baselineOf(mk(400));
    const work = baselineOf(mk(400).map((e, i) => (i < 50 ? { ...e, count: 1 } : e)));
    const t = performance.now();
    const r = baselineGrowth(ref, work);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(r.lines).toHaveLength(50);
  });
});

describe("pruneBaseline (#E24)", () => {
  it("lowers, removes, never raises, keeps reasons, reports removals", () => {
    const base = baselineOf([
      entry("r/a", "a.ts", "h:1", 2),
      entry("r/b", "b.ts", "h:1", 1, "github-dismissed (#12, false positive): x"),
      entry("r/c", "c.ts", "h:1", 1, "false-positive: z"),
    ]);
    const counts = { [keyOf("r/a", "a.ts", "h:1")]: 1, [keyOf("r/c", "c.ts", "h:1")]: 3 };
    const { baseline, changes } = pruneBaseline(base, counts);
    expect(baseline.entries.map((e) => [e.ruleId, e.count, e.reason])).toEqual([
      ["r/a", 1, "untriaged"],
      ["r/c", 1, "false-positive: z"],
    ]);
    expect(changes.find((c) => c.ruleId === "r/b")).toMatchObject({ removed: true, reason: "github-dismissed (#12, false positive): x" });
  });
});

describe("acceptEntry", () => {
  const counts = { [keyOf(PI, "a.ts", "h:1")]: 2 };
  const target = { ruleId: PI, file: "a.ts", lineHash: "h:1" };
  it("sets the key to its current count with the reason", () => {
    const r = acceptEntry(baselineOf(), counts, { ...target, reason: "false-positive: constant input" });
    expect(r.ok).toBe(true);
    expect(r.baseline.entries[0]).toMatchObject({ count: 2, reason: "false-positive: constant input" });
  });
  it("refuses without excess, untriaged, bad reasons and an unchanged reason", () => {
    expect(acceptEntry(baselineOf([entry(PI, "a.ts", "h:1", 2)]), counts, { ...target, reason: "false-positive: x" }).ok).toBe(false);
    expect(acceptEntry(baselineOf(), counts, { ...target, reason: "untriaged" }).ok).toBe(false);
    expect(acceptEntry(baselineOf(), counts, { ...target, reason: "x" }).ok).toBe(false);
    expect(acceptEntry(baselineOf([entry(PI, "a.ts", "h:1", 1, "false-positive: same  text")]), counts, { ...target, reason: " false-positive: same text " }).ok).toBe(false);
  });
});

describe("serializeBaseline (#E29 writer)", () => {
  it("is byte-stable regardless of entry order and ends with a newline", () => {
    const es = [entry("r/b", "b.ts", "h:2"), entry("r/a", "b.ts", "h:1"), entry("r/z", "a.ts", "h:9")];
    const one = serializeBaseline(baselineOf(es));
    const two = serializeBaseline(baselineOf([...es].reverse()));
    expect(one).toBe(two);
    expect(one.endsWith("\n")).toBe(true);
    expect(JSON.parse(one).entries.map((e) => e.ruleId)).toEqual(["r/z", "r/a", "r/b"]);
  });
});

describe("shared-config translation", () => {
  it("indexFilters drops a trailing /** and joins with newlines", () => {
    expect(indexFilters(["**/__tests__/**", "tests/**", "**/*.test.ts"])).toBe("exclude:**/__tests__\nexclude:tests\nexclude:**/*.test.ts");
  });
  it("#E11 spike/** becomes exactly the root-only extractor filter", () => {
    expect(indexFilters(["spike/**"])).toBe("exclude:spike");
  });
  it("globToRegExp / matchingIgnoreGlob cover the config's glob shapes", () => {
    expect(globToRegExp("**/*.test.ts").test("a/b.test.ts")).toBe(true);
    expect(globToRegExp("**/*.test.ts").test("b.test.ts")).toBe(true);
    expect(globToRegExp("**/*.test.ts").test("b.ts")).toBe(false);
    const globs = ["**/__tests__/**", "tests/**", "openspec/changes/**/mockup*", "**/mockups/**"];
    expect(matchingIgnoreGlob("src/__tests__/a.js", globs)).toBe("**/__tests__/**");
    expect(matchingIgnoreGlob("openspec/changes/x/mockup/a.html", globs)).toBe("openspec/changes/**/mockup*");
    expect(matchingIgnoreGlob("mockups/m.js", globs)).toBe("**/mockups/**");
    expect(matchingIgnoreGlob("scripts/x.mjs", globs)).toBeNull();
    expect(matchingIgnoreGlob("lib/a.js", globs)).toBeNull();
  });
});

describe("dismissed reason grammar (#E13, #E14)", () => {
  const dismissed = (head) => `github-dismissed (${head}): operator-authz: x`;
  it("#E13 accepts several positive alert numbers and the three GitHub reasons only", () => {
    expect(reasonError("github-dismissed (#12, #13, won't fix): operator-authz: x", PI)).toBeNull();
    expect(reasonError(dismissed("#12, x"), PI)).not.toBeNull();
    expect(reasonError(dismissed("#0, false positive"), PI)).not.toBeNull();
    expect(reasonError(dismissed("#12, used in tests"), PI)).toBeNull();
    expect(reasonError(dismissed("#12, #13"), PI)).not.toBeNull();
    expect(reasonError("github-dismissed (#12, false positive): ", PI)).not.toBeNull();
  });

  it("#E14 every entry of the committed baseline still validates", () => {
    const committed = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "codeql-baseline.json"), "utf8"));
    expect(committed.entries.length).toBeGreaterThan(0);
    for (const e of committed.entries) expect(reasonError(e.reason, e.ruleId), `${e.ruleId} ${e.file} ${e.lineHash}`).toBeNull();
  });
});

describe("parseGithubRemote (#E16)", () => {
  it("accepts the four plain github.com forms", () => {
    for (const url of ["git@github.com:o/r.git", "ssh://git@github.com/o/r", "https://github.com/o/r/", "https://github.com/o/r.git"]) {
      expect(parseGithubRemote(url), url).toEqual({ owner: "o", repo: "r" });
    }
  });
  it("refuses another host, dot segments, escapes and extra path", () => {
    for (const url of ["https://gitlab.com/o/r", "git@github.com:o/..", "https://github.com/o%2F/r", "https://github.com/o/r/x", "https://github.com/../r", "file:///o/r", ""]) {
      expect(parseGithubRemote(url), url).toBeNull();
    }
  });
});
