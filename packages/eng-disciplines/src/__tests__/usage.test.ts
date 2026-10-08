/**
 * rebuild-package-diagrams usage evidence: log sources (job) -> type mapping (gated) -> local-only
 * aggregation per customer, privacy gate, catalog (mapping shared, counts local).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(by.save.counts).toEqual({ A: 2, B: 1 });
    expect(by["orders:update"].counts).toEqual({ A: 2 });
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
});
