/**
 * rebuild-package-diagrams usage evidence: log sources (job) -> type mapping (gated) -> local-only
 * aggregation per customer, privacy gate, catalog (mapping shared, counts local).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PKG } from "./files";

const DIAGRAMS = join(PKG, ".pi", "skills", "rebuild-package-diagrams", "scripts", "diagrams.mjs");
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [DIAGRAMS, ...args], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const catalogData = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="catalog-data">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
const T = (iso: string) => Date.parse(iso);

const A_LOG = [
  { user: "józsi.kovács", time: T("2024-01-03T08:00:00Z"), type: "save", object: { name: "Gyártás 17" } },
  { user: "józsi.kovács", time: T("2024-01-03T09:00:00Z"), type: "moveProc", object: { name: "Gyártás 17" } },
  { user: "anna.nagy", time: T("2024-02-10T10:00:00Z"), type: "save", object: { name: "Rendelés X" } },
  { user: "anna.nagy", time: T("2024-02-10T10:05:00Z"), type: "error,fix,align", object: { name: "Rendelés X" } },
];
const B_LOG = [{ user: "bob", time: T("2023-05-01T08:00:00Z"), type: "save", object: { name: "Secret order" } }];
const SCREENS = [
  { id: "SCR-a", kind: "route", name: "A", template: "a.htm", scope: [], actions: ["ACT-save", "ACT-move", "ACT-other"].map((id) => ({ id, label: id, effects: [] })) },
];
const MAPPING = () => ({
  types: [
    { type: "save", cite: "js/a.js:1", actions: ["SCR-a#ACT-save"], useCases: ["UC-01"], kind: "user" },
    { type: "moveProc", cite: "js/a.js:2", actions: ["SCR-a#ACT-move"], useCases: [], kind: "user" },
    { type: "error,fix,align", cite: "js/a.js:3", actions: [], useCases: [], kind: "repair" },
  ],
  unmapped: [{ type: "orders:update", reason: "table change log, no UI action" }],
});

let dir: string;
let pkg: string;
let app: string;
let job: string;
const put = (root: string, rel: string, v: unknown) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), typeof v === "string" || Buffer.isBuffer(v) ? (v as string) : JSON.stringify(v));
};
const mapping = (v: unknown) => put(pkg, "diagrams/usage/mapping.json", v);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-"));
  pkg = join(dir, "pkg");
  app = join(dir, "app");
  put(pkg, "model.md", "# Domain model\n\n## Order\nCapabilities: x\nIdentity: id\nPersistence: table orders\n\n- `id` — string; required.\n");
  put(pkg, "capabilities/x/spec.md", "# x Specification\n\n## Purpose\nX.\n\n## Requirements\n");
  for (const s of SCREENS) put(pkg, `ui/screens/${s.id}.json`, s);
  put(pkg, "diagrams/use-cases.json", [{ id: "UC-01", name: "Save", actor: "P", trigger: "t", requirements: [], refs: [], entities: ["Order"] }]);
  put(app, "js/a.js", 'log("save", plan);\nlog("moveProc", p);\nfix("align", q);\n');
  // A: legacy code page JSON; B: UTF-16 LE BOM JSON; A changes: CSV
  put(dir, "src/a_db.json", Buffer.from(JSON.stringify({ log: A_LOG }), "latin1"));
  put(dir, "src/b_db.json", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify({ log: B_LOG }), "utf16le")]));
  put(dir, "src/a_changes.csv", "table,modType,time\norders,update,2024-01-05T10:00:00Z\norders,update,2024-01-06T10:00:00Z\n");
  job = join(dir, "src", "job.json");
  put(dir, "src/job.json", {
    sources: [
      { customer: "A", file: "a_db.json", encoding: "windows-1250", format: "json", table: "log", columns: { type: "type", user: "user", time: "time", object: "object" }, kind: "event" },
      { customer: "B", file: "b_db.json", format: "json", table: "log", columns: { type: "type", user: "user", time: "time", object: "object" }, kind: "event" },
      { customer: "A", file: "a_changes.csv", format: "csv", columns: { type: ["table", "modType"], time: "time" }, kind: "change" },
    ],
  });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("usage evidence", () => {
  it("usage-draft: types with counts per customer (all encodings + CSV), code candidates by literal", () => {
    const out = join(dir, "draft.json");
    const r = run("usage-draft", pkg, app, job, out);
    expect(r.stderr).toBe("");
    const d = JSON.parse(readFileSync(out, "utf8"));
    const by = Object.fromEntries(d.types.map((t: { type: string }) => [t.type, t]));
    // no per-customer counts or source file names reach the mapper (LLM context): total only
    expect(by.save.seen).toBe(3);
    expect(by["orders:update"].seen).toBe(2);
    expect(by.save.counts).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/a_db\.json|"A"|"B"/);
    expect(by.save.candidates).toContain("js/a.js:1");
    expect(by["error,fix,align"].candidates).toContain("js/a.js:3");
    expect(JSON.stringify(d)).not.toContain("józsi");
  });

  it("check-usage refuses ungrounded mappings; --complete needs every seen type", () => {
    const bad = (types: unknown[], msg: RegExp, extra: string[] = []) => {
      mapping({ types, unmapped: MAPPING().unmapped });
      const r = run("check-usage", pkg, app, job, ...extra);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(msg);
    };
    const [save] = MAPPING().types;
    bad([{ ...save, cite: "js/a.js:2" }], /save: cite js\/a\.js:2 does not contain 'save'/);
    bad([{ ...save, actions: ["SCR-a#ACT-zz"] }], /save: unknown action SCR-a#ACT-zz/);
    bad([{ ...save, useCases: ["UC-99"] }], /save: unknown use case UC-99/);
    bad([{ ...save, kind: "robot" }], /save: kind robot/);
    bad([save, save], /duplicate type save/);
    bad([save], /type moveProc \(seen 1\) is neither mapped nor unmapped/, ["--complete"]);
    mapping(MAPPING());
    const r = run("check-usage", pkg, app, job, "--complete");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("usage aggregates per customer (pseudonymized, local), findings respect logging coverage", () => {
    mapping(MAPPING());
    const out = join(pkg, "_local", "usage");
    const r = run("usage", pkg, job, out);
    expect(r.stderr).toBe("");
    const u = JSON.parse(readFileSync(join(out, "usage.json"), "utf8"));
    expect(u.customers.A.events).toBe(6);
    expect(u.customers.A.users).toBe(2);
    expect(u.customers.A.byUseCase).toEqual({ "UC-01": 2 });
    expect(u.customers.A.byAction).toEqual({ "SCR-a#ACT-save": 2, "SCR-a#ACT-move": 1 });
    expect(u.customers.A.byKind).toEqual({ user: 3, repair: 1, unmapped: 2 });
    expect(u.customers.A.months).toEqual({ "2024-01": 4, "2024-02": 2 });
    expect(u.customers.A.span).toEqual({ first: "2024-01-03", last: "2024-02-10", activeDays: 4 });
    const md = readFileSync(join(out, "usage-findings.md"), "utf8");
    expect(md).toMatch(/## Not logged[\s\S]*SCR-a#ACT-other/);
    expect(md).toMatch(/## Logged but never seen[\s\S]*B: SCR-a#ACT-move/);
    expect(md).toMatch(/user~1/);
    const all = readdirSync(out).map((f) => readFileSync(join(out, f), "utf8")).join("\n");
    for (const secret of ["józsi", "anna.nagy", "bob", "Gyártás", "Secret order"]) expect(all).not.toContain(secret);
  });

  it("check-usage-output fails on a leaked source value without printing it", () => {
    const out = join(pkg, "_local", "usage");
    expect(run("check-usage-output", out, job).code).toBe(0);
    writeFileSync(join(out, "oops.md"), "note about Secret order\n");
    const r = run("check-usage-output", out, job);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/oops\.md: contains a source value/);
    expect(r.stderr).not.toContain("Secret");
    rmSync(join(out, "oops.md"));
  });

  it("privacy gate ignores event types, short numbers, sub-word hits and reviewed public values", async () => {
    const { leakErrors, sourceSecrets } = await import(join(PKG, ".pi", "skills", "rebuild-package-diagrams", "scripts", "usage.mjs"));
    const ev = [
      { type: "save", user: "józsi", object: { phase: "pack", qty: "100", id: "611478", kind: "save", step: "process" } },
    ];
    const sec = sourceSecrets(ev, { publicValues: ["process"] });
    expect([...sec].sort()).toEqual(["611478", "józsi", "pack"]);
    const d = mkdtempSync(join(tmpdir(), "leak-"));
    writeFileSync(join(d, "ok.md"), "save 100 times; package; process:insert\n");
    expect(leakErrors(d, sec)).toEqual([]);
    writeFileSync(join(d, "bad.md"), "order 611478 by józsi in pack\n");
    expect(leakErrors(d, sec)).toEqual(["bad.md: contains a source value (3 distinct)"]);
    rmSync(d, { recursive: true, force: true });
  });

  it("shared catalog carries the mapping only; --local adds the counts", () => {
    mapping(MAPPING());
    const shared = join(dir, "c.html");
    expect(run("build-site", pkg, shared).code).toBe(0);
    const d = catalogData(readFileSync(shared, "utf8"));
    expect(d.usage.mapping.find((t: { type: string }) => t.type === "save").actions).toEqual(["SCR-a#ACT-save"]);
    expect(d.usage.customers).toBeUndefined();
    expect(readFileSync(shared, "utf8")).not.toContain('"events"');
    const local = join(dir, "l.html");
    expect(run("build-site", pkg, local, "--local").code).toBe(0);
    expect(catalogData(readFileSync(local, "utf8")).usage.customers.A.events).toBe(6);
  });

  it("usage writes _local/.gitignore so local aggregates are never committed", () => {
    mapping(MAPPING());
    rmSync(join(pkg, "_local"), { recursive: true, force: true });
    expect(run("usage", pkg, job, join(pkg, "_local", "usage")).code).toBe(0);
    expect(readFileSync(join(pkg, "_local", ".gitignore"), "utf8")).toBe("*\n");
    // the draft may be the first thing written under a fresh _local/
    rmSync(join(pkg, "_local"), { recursive: true, force: true });
    const d = run("usage-draft", pkg, app, job, join(pkg, "_local", "usage-draft.json"));
    expect(d.stderr).toBe("");
    expect(readFileSync(join(pkg, "_local", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("CSV sources: quoted cells may hold newlines; a row with the wrong cell count is an error", () => {
    put(dir, "src/q.csv", 'kind,msg\nsave,"line one\nline two"\nsave,ok\n');
    put(dir, "src/q-job.json", { sources: [{ customer: "Q", file: "q.csv", format: "csv", columns: { type: "kind", object: "msg" }, kind: "event" }] });
    const out = join(dir, "q-draft.json");
    const r = run("usage-draft", pkg, app, join(dir, "src", "q-job.json"), out);
    expect(r.stderr).toBe("");
    expect(JSON.parse(readFileSync(out, "utf8")).types.map((t: { type: string }) => t.type)).toEqual(["save"]);
    put(dir, "src/q.csv", "kind,msg\nsave,a,b\n");
    const bad = run("usage-draft", pkg, app, join(dir, "src", "q-job.json"), out);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/q\.csv row 2: 3 cells, header has 2/);
  });

  it("refuses type columns that carry user/object values or free text, never printing them", () => {
    // type column = the user column: every type is a user name
    put(dir, "src/leak-job.json", { sources: [{ customer: "A", file: "a_db.json", encoding: "windows-1250", format: "json", table: "log", columns: { type: "user", user: "user", object: "object" }, kind: "event" }] });
    const leakJob = join(dir, "src", "leak-job.json");
    const draft = run("usage-draft", pkg, app, leakJob, join(dir, "leak-draft.json"));
    expect(draft.code).toBe(1);
    expect(draft.stderr).toMatch(/2 event types contain a user\/object value/);
    expect(draft.stderr).not.toMatch(/józsi|anna/);
    mapping(MAPPING());
    const chk = run("check-usage", pkg, app, leakJob, "--complete");
    expect(chk.code).toBe(1);
    expect(chk.stderr).not.toMatch(/józsi|anna/);
    // too many distinct types for a vocabulary
    put(dir, "src/many-job.json", { maxTypes: 2, sources: [{ customer: "A", file: "a_db.json", encoding: "windows-1250", format: "json", table: "log", columns: { type: "type" }, kind: "event" }] });
    const many = run("usage-draft", pkg, app, join(dir, "src", "many-job.json"), join(dir, "many.json"));
    expect(many.code).toBe(1);
    expect(many.stderr).toMatch(/3 distinct event types \(max 2\)/);
  });

  it("check-usage refuses a shared mapping that names a source value, without printing it", () => {
    mapping({ ...MAPPING(), unmapped: [...MAPPING().unmapped, { type: "józsi.kovács", reason: "x" }] });
    const r = run("check-usage", pkg, app, job);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/mapping: 1 type contains a source value/);
    expect(r.stderr).not.toContain("józsi");
    mapping(MAPPING());
  });

  it("aggregation counts types named like Object members correctly", async () => {
    const { aggregateUsage } = await import(join(PKG, ".pi", "skills", "rebuild-package-diagrams", "scripts", "usage.mjs"));
    const ev = ["constructor", "toString", "__proto__", "toString"].map((type) => ({ customer: "toString", type, user: "u", time: null }));
    const u = aggregateUsage(ev, { types: [] }, { screens: [] }, []);
    expect({ ...u.customers.toString.byType }).toEqual(Object.fromEntries([["constructor", 1], ["toString", 2], ["__proto__", 1]]));
    expect(u.customers.toString.events).toBe(4);
  });

  it("a source with a missing table or no rows is an error; broken symlinks in the app are skipped", () => {
    put(dir, "src/t-job.json", { sources: [{ customer: "A", file: "a_db.json", encoding: "windows-1250", format: "json", table: "nolog", columns: { type: "type" }, kind: "event" }] });
    const t = run("usage-draft", pkg, app, join(dir, "src", "t-job.json"), join(dir, "t.json"));
    expect(t.code).toBe(1);
    expect(t.stderr).toMatch(/a_db\.json: no table nolog/);
    put(dir, "src/e.csv", "kind,msg\n");
    put(dir, "src/e-job.json", { sources: [{ customer: "A", file: "e.csv", format: "csv", columns: { type: "kind" }, kind: "event" }] });
    const e = run("usage-draft", pkg, app, join(dir, "src", "e-job.json"), join(dir, "e.json"));
    expect(e.code).toBe(1);
    expect(e.stderr).toMatch(/e\.csv: no rows/);
    // one customer without the table / with no rows is normal: a note, not an error
    put(dir, "src/mixed-job.json", { sources: [
      { customer: "A", file: "a_db.json", encoding: "windows-1250", format: "json", table: "log", columns: { type: "type" }, kind: "event" },
      { customer: "B", file: "b_db.json", format: "json", table: "lllogs", columns: { type: "type" }, kind: "change" },
      { customer: "A", file: "a_db.json", encoding: "windows-1250", format: "json", table: "lllogs", columns: { type: "type" }, kind: "change" },
    ] });
    const m = run("usage-draft", pkg, app, join(dir, "src", "mixed-job.json"), join(dir, "m.json"));
    expect(m.code).toBe(1);
    expect(m.stderr).toMatch(/table lllogs is in no source/);
    put(dir, "src/b2.json", { lllogs: [{ type: "x" }] });
    put(dir, "src/mixed-job.json", { sources: [
      { customer: "A", file: "a_db.json", encoding: "windows-1250", format: "json", table: "log", columns: { type: "type" }, kind: "event" },
      { customer: "B", file: "b2.json", format: "json", table: "lllogs", columns: { type: "type" }, kind: "change" },
      { customer: "A", file: "a_db.json", encoding: "windows-1250", format: "json", table: "lllogs", columns: { type: "type" }, kind: "change" },
      { customer: "C", file: "e.csv", format: "csv", columns: { type: "kind" }, kind: "event" },
    ] });
    const ok = run("usage-draft", pkg, app, join(dir, "src", "mixed-job.json"), join(dir, "m.json"));
    expect(ok.code).toBe(0);
    expect(ok.stderr).toMatch(/note: a_db\.json: no table lllogs/);
    expect(ok.stderr).toMatch(/note: e\.csv: no rows/);
    symlinkSync(join(app, "gone.js"), join(app, "js", "dead.js"));
    const r = run("usage-draft", pkg, app, job, join(dir, "s.json"));
    rmSync(join(app, "js", "dead.js"));
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("a mapping cite outside the app is never read", () => {
    writeFileSync(join(dir, "outside.js"), 'log("save")\n');
    const [save, ...rest] = MAPPING().types;
    mapping({ ...MAPPING(), types: [{ ...save, cite: "../outside.js:1" }, ...rest] });
    const r = run("check-usage", pkg, app, job);
    mapping(MAPPING());
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/save: cite \.\.\/outside\.js:1 does not contain 'save'/);
  });
});
