/**
 * Static contract for `.github/codeql/extensions/` (test-plan #E1, #E2).
 *
 * CodeQL JavaScript models-as-data parse the TYPE column with
 * `('[^']+'|[^.]+)(.*)` (`codeql/javascript-all@2.10.3`,
 * `ApiGraphModelsSpecific.qll` `parseTypeString`; re-check on a library upgrade).
 * The package name therefore ends at the FIRST dot unless the type is
 * single-quoted: an unquoted `@s/p/m.js` parses as package `@s/p/m` + type `js`
 * and matches nothing, silently disabling the model. The directory also holds
 * nothing but model files, so the local wrapper pack (copies `*.model.yml`) and
 * CI's auto-detection (which reads the whole directory) cannot diverge.
 *
 * See change: codeql-model-pack-and-mirror.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const extDir = path.resolve(here, "..", "..", "..", "..", ".github", "codeql", "extensions");

type ModelDoc = { extensions?: Array<{ addsTo?: { extensible?: string }; data?: unknown[][] }> };

/** Columns holding a type string, per extensible predicate (typeModel has two). */
const typeColumns = (extensible: string): number[] => (extensible === "typeModel" ? [0, 1] : [0]);
const QUOTED = /^'[^']+'$/;

/** `file: row` problems for every dotted type string that is not single-quoted. */
export function unquotedDottedTypes(file: string, yaml: string): string[] {
  const doc = parseYaml(yaml) as ModelDoc;
  const out: string[] = [];
  for (const ext of doc.extensions ?? []) {
    const kind = ext.addsTo?.extensible ?? "";
    for (const row of ext.data ?? []) {
      for (const col of typeColumns(kind)) {
        const type = String(row[col] ?? "");
        if (type.includes(".") && !QUOTED.test(type)) out.push(`${file}: ${kind} row ${JSON.stringify(row)} has an unquoted dotted type ${type}`);
      }
    }
  }
  return out;
}

const ALLOWED = [/\.model\.yml$/, /^AGENTS\.md$/, /^codeql-pack\.yml$/];
/** Entries of the extensions directory that are not model files. */
export function unexpectedFiles(names: string[]): string[] {
  return names.filter((n) => !ALLOWED.some((re) => re.test(n)));
}

const modelFiles = fs.readdirSync(extDir).filter((n) => n.endsWith(".model.yml"));

describe("model type strings parse to the intended package (#E1)", () => {
  const fixture = [
    "extensions:",
    "  - addsTo: { pack: codeql/javascript-all, extensible: barrierGuardModel }",
    "    data:",
    '      - ["@s/p/m.js", "Member[f].Argument[0]", "true", "path-injection"]',
    `      - ["'@s/p/q.js'", "Member[f].Argument[0]", "true", "path-injection"]`,
    '      - ["@s/p/m", "Member[f].Argument[0]", "true", "path-injection"]',
    "",
  ].join("\n");

  it("names the file and row of the unquoted dotted type only", () => {
    const problems = unquotedDottedTypes("fixture.model.yml", fixture);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("fixture.model.yml");
    expect(problems[0]).toContain("@s/p/m.js");
    expect(problems[0]).not.toContain("q.js");
  });

  it("checks both type columns of a typeModel", () => {
    const yaml = ["extensions:", "  - addsTo: { pack: codeql/javascript-all, extensible: typeModel }", "    data:", '      - ["a.b", "c.d", "Member[x]"]', ""].join("\n");
    expect(unquotedDottedTypes("t.model.yml", yaml)).toHaveLength(2);
  });

  it("there is at least one model file", () => {
    expect(modelFiles.length).toBeGreaterThan(0);
  });

  it.each(modelFiles)("%s has no unquoted dotted type", (f) => {
    expect(unquotedDottedTypes(f, fs.readFileSync(path.join(extDir, f), "utf8"))).toEqual([]);
  });
});

describe("extensions/ holds only model files (#E2)", () => {
  it("accepts *.model.yml, AGENTS.md and codeql-pack.yml", () => {
    expect(unexpectedFiles(["cwd-guard.model.yml", "AGENTS.md", "codeql-pack.yml"])).toEqual([]);
  });

  it("names a stray yml", () => {
    expect(unexpectedFiles(["cwd-guard.model.yml", "AGENTS.md", "extra.yml"])).toEqual(["extra.yml"]);
  });

  it("the repo directory has no other file", () => {
    expect(unexpectedFiles(fs.readdirSync(extDir))).toEqual([]);
  });
});

describe("containmentAllows barrier rows (#E12, codeql-file-containment-barrier)", () => {
  const doc = parseYaml(fs.readFileSync(path.join(extDir, "cwd-guard.model.yml"), "utf8")) as ModelDoc;
  const rows = (doc.extensions ?? [])
    .filter((e) => e.addsTo?.extensible === "barrierGuardModel")
    .flatMap((e) => e.data ?? [])
    .filter((r) => String(r[1]).startsWith("Member[containmentAllows]"));

  it("has the quoted `.js` row and the dot-free alias, guarding Argument[1] for path-injection", () => {
    expect(rows.map((r) => String(r[0])).sort()).toEqual([
      "'@blackbelt-technology/pi-dashboard-shared/containment-guard.js'",
      "@blackbelt-technology/pi-dashboard-shared/containment-guard",
    ]);
    for (const r of rows) expect(r.slice(1)).toEqual(["Member[containmentAllows].Argument[1]", "true", "path-injection"]);
  });
});
