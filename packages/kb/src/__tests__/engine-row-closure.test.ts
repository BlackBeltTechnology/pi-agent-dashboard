// Guard tests for the narrowed engine fingerprint (change: throttle-kb-reindex, D1; test-plan
// #S12-#S18). Two mechanical guards stand in for the discipline the old all-of-src hash gave:
//  1. closure guard — the static import closure of src/indexer.ts must be ⊆ ROW_PRODUCING_FILES ∪
//     the declared non-row list, so a new row-producing import cannot silently fall outside `rowsHash`;
//  2. DDL golden — sqlite-store.ts is NOT hashed (it also holds search code), so its table
//     definitions are pinned with SCHEMA_VERSION; a DDL change without a bump fails.
// Accepted limitation (D1): an `insert*` body edit that leaves the DDL unchanged stays green.
// Exemplar: engine-fingerprint.test.ts (sandbox copies of the real src).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain-JS lib without type declarations
import { ROW_PRODUCING_FILES } from "../../bin/lib/engine-fingerprint.mjs";
import { copyKbSrc, KB_PKG } from "./helpers/src-sandbox.js";

/** Imported by the indexer closure but deliberately NOT in `rowsHash` (D1): `types.ts` is type-only
 *  (erased), `sqlite-store.ts` is governed by SCHEMA_VERSION + the DDL golden, `config.ts` by
 *  `indexOptionsHash` / the gate. */
const NON_ROW_LIST = ["src/types.ts", "src/sqlite-store.ts", "src/config.ts"];
const ENTRY = "src/indexer.ts";

/** Static (and `import()` / `export … from`) relative imports of TS source `text`, as package-relative `src/…ts` paths.
 *  Walks the real syntax tree, so a comment between `from` and the specifier is no blind spot and a commented-out
 *  or string-embedded import is not counted. */
function importsInText(text: string, rel: string): string[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const specs: string[] = [];
  const stringArg = (n: ts.Node | undefined): void => {
    if (n && ts.isStringLiteralLike(n)) specs.push(n.text);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) stringArg(n.moduleSpecifier);
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) stringArg(n.arguments[0]);
    else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) stringArg(n.argument.literal);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return specs.filter((spec) => /^\.{1,2}\//.test(spec)).map((spec) => posix.normalize(posix.join(dirname(rel), spec.replace(/\.js$/, ".ts"))));
}

const importsOf = (pkg: string, rel: string): string[] => importsInText(readFileSync(join(pkg, rel), "utf8"), rel);

/** Transitive closure of `entry` (package-relative paths, entry included). */
function importClosure(pkg: string, entry = ENTRY): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.pop() as string;
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!existsSync(join(pkg, rel))) throw new Error(`closure guard: ${entry} imports ${rel}, which does not exist`);
    queue.push(...importsOf(pkg, rel));
  }
  return seen;
}

/** Throws naming every closure member that is neither row-producing nor declared non-row. */
function assertClosureGuard(pkg: string): void {
  const allowed = new Set<string>([...ROW_PRODUCING_FILES, ...NON_ROW_LIST]);
  const leaked = [...importClosure(pkg)].filter((f) => !allowed.has(f)).sort();
  if (leaked.length) {
    throw new Error(`engine closure guard: ${ENTRY} reaches ${leaked.join(", ")} — add each to ROW_PRODUCING_FILES (packages/kb/bin/lib/engine-fingerprint.mjs) or to the non-row list in this test, deliberately`);
  }
}

/** The pinned store shape. Update BOTH values together, in the same change that bumps SCHEMA_VERSION. */
const DDL_PIN = { schemaVersion: 4, ddlSha256: "fcf5286909177070ef1ad4c4f110acbe55da12c44b369a9277b2ff55acbe002a" };

function storeShape(pkg: string): { schemaVersion: number; ddlSha256: string } {
  const text = readFileSync(join(pkg, "src", "sqlite-store.ts"), "utf8").replace(/\r\n/g, "\n");
  const version = /export const SCHEMA_VERSION = (\d+);/.exec(text);
  const ddl = /const DDL = `([\s\S]*?)\n`;/.exec(text);
  if (!version || !ddl) throw new Error("DDL golden: cannot find SCHEMA_VERSION / DDL in src/sqlite-store.ts — update this test's extraction");
  const normalized = ddl[1].split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n");
  return { schemaVersion: Number(version[1]), ddlSha256: createHash("sha256").update(normalized).digest("hex") };
}

function assertDdlGolden(pkg: string, pin: { schemaVersion: number; ddlSha256: string } = DDL_PIN): void {
  const now = storeShape(pkg);
  if (now.ddlSha256 === pin.ddlSha256 && now.schemaVersion === pin.schemaVersion) return;
  if (now.ddlSha256 !== pin.ddlSha256 && now.schemaVersion === pin.schemaVersion) {
    throw new Error(`DDL golden: the sqlite-store.ts table definitions changed but SCHEMA_VERSION is still ${now.schemaVersion} — bump SCHEMA_VERSION (and then update the pin in engine-row-closure.test.ts to {${now.schemaVersion + 1}, ${now.ddlSha256}})`);
  }
  throw new Error(`DDL golden: SCHEMA_VERSION is ${now.schemaVersion} / DDL digest ${now.ddlSha256} but the pin says ${pin.schemaVersion} / ${pin.ddlSha256} — update the pin in engine-row-closure.test.ts`);
}

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "kb-closure-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sandbox = (name: string) => copyKbSrc(join(root, name));
const editStore = (pkg: string, fn: (t: string) => string) => {
  const f = join(pkg, "src", "sqlite-store.ts");
  writeFileSync(f, fn(readFileSync(f, "utf8")));
};

describe("row closure guard (S12-S14)", () => {
  it("S12 baseline: the real indexer import closure ⊆ ROW_PRODUCING_FILES ∪ the non-row list", () => {
    expect(() => assertClosureGuard(KB_PKG)).not.toThrow();
    const closure = importClosure(KB_PKG);
    for (const f of ROW_PRODUCING_FILES) expect(closure.has(f) || f === ENTRY, `${f} is row-producing but not reachable from the indexer`).toBe(true);
  });

  it("S13 fault-seeding: indexer.ts gaining `import \"./newmod.js\"` fails the guard naming newmod.ts", () => {
    const pkg = sandbox("s13");
    writeFileSync(join(pkg, "src", "newmod.ts"), "export const x = 1;\n");
    appendFileSync(join(pkg, "src", "indexer.ts"), '\nimport "./newmod.js";\n');
    expect(() => assertClosureGuard(pkg)).toThrow(/src\/newmod\.ts/);
  });

  it("S14 transitive: chunker.ts importing a new helper.ts fails the guard naming helper.ts", () => {
    const pkg = sandbox("s14");
    writeFileSync(join(pkg, "src", "helper.ts"), "export const h = 1;\n");
    appendFileSync(join(pkg, "src", "chunker.ts"), '\nimport { h } from "./helper.js";\nexport const useH = h;\n');
    expect(() => assertClosureGuard(pkg)).toThrow(/src\/helper\.ts/);
  });
});

describe("closure guard import walk — comments are no blind spot", () => {
  it("S14b a comment between `from` and the specifier still yields the import; commented-out imports yield none", () => {
    expect(importsInText('import { h } from /* explanation */ "./helper.js";\n', "src/indexer.ts")).toEqual(["src/helper.ts"]);
    expect(importsInText('import {\n  h,\n} from // why\n  "./helper.js";\nexport * from "../x.js";\nconst m = await import("./dyn.js");\n', "src/indexer.ts")).toEqual(["src/helper.ts", "x.ts", "src/dyn.ts"]);
    expect(importsInText('// import "./no.js";\n/* import "./no2.js"; */\nconst s = "import \\"./no3.js\\"";\n', "src/indexer.ts")).toEqual([]);
  });

  it("S14c fault-seeding: chunker.ts importing helper.ts through a commented `from` fails the guard naming helper.ts", () => {
    const pkg = sandbox("s14c");
    writeFileSync(join(pkg, "src", "helper.ts"), "export const h = 1;\n");
    appendFileSync(join(pkg, "src", "chunker.ts"), '\nimport { h } from /* explanation */ "./helper.js";\nexport const useH = h;\n');
    expect(() => assertClosureGuard(pkg)).toThrow(/src\/helper\.ts/);
  });
});

describe("store DDL golden (S15-S18)", () => {
  const addColumn = (t: string) => t.replace("CREATE TABLE IF NOT EXISTS kb_meta (k TEXT PRIMARY KEY, v TEXT);", "CREATE TABLE IF NOT EXISTS kb_meta (k TEXT PRIMARY KEY, v TEXT, extra TEXT);");
  const bump = (t: string) => t.replace(/export const SCHEMA_VERSION = (\d+);/, (_m, v) => `export const SCHEMA_VERSION = ${Number(v) + 1};`);

  it("S15 golden baseline: the current sqlite-store.ts matches the pinned {SCHEMA_VERSION, sha256(DDL)}", () => {
    expect(() => assertDdlGolden(KB_PKG)).not.toThrow();
  });

  it("S16 negative: a DDL change with SCHEMA_VERSION unchanged fails telling the author to bump SCHEMA_VERSION", () => {
    const pkg = sandbox("s16");
    editStore(pkg, addColumn);
    expect(() => assertDdlGolden(pkg)).toThrow(/bump SCHEMA_VERSION/);
  });

  it("S17 decision table: DDL changed + bumped → fails until the pin is updated, passes once it is", () => {
    const pkg = sandbox("s17");
    editStore(pkg, (t) => bump(addColumn(t)));
    expect(() => assertDdlGolden(pkg)).toThrow(/update the pin/);
    expect(() => assertDdlGolden(pkg, storeShape(pkg))).not.toThrow();
  });

  it("S18 limitation pin: an insert* body edit with an identical DDL stays green (review-governed, accepted per D1)", () => {
    const pkg = sandbox("s18");
    editStore(pkg, (t) => t.replace(/(\n  insertChunk\(c: Chunk\) \{)/, "$1\n    void 0; // behaviour edit the DDL golden cannot see"));
    expect(readFileSync(join(pkg, "src", "sqlite-store.ts"), "utf8")).toContain("behaviour edit the DDL golden cannot see");
    expect(() => assertDdlGolden(pkg)).not.toThrow();
  });
});
