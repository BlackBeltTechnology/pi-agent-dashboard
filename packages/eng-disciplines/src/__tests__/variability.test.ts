/**
 * rebuild-package-diagrams customer variability: draft, gate, evaluation per variant/customer,
 * reachability, findings, exports, catalog embed. Inputs: ui/_config-reads.json + ui/_effective/.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const READS = {
  reads: [
    { path: "db.tables.calendar", cites: ["js/a.js:3"] },
    { path: "lang", cites: ["js/a.js:4"] },
    { path: "orders.unique", cites: ["js/a.js:1"] },
    { path: "planner.normalization", cites: ["js/a.js:2"] },
  ],
  variants: [
    { id: "A--demo", variant: "conf/A/demo.json", customer: "A", env: "demo" },
    { id: "A--prod", variant: "conf/A/prod.json", customer: "A", env: "prod" },
    { id: "B--prod", variant: "conf/B/prod.json", customer: "B", env: "prod" },
  ],
};
const EFF: Record<string, unknown> = {
  "A--demo": { orders: { unique: true }, db: { tables: {} }, lang: "hu" },
  "A--prod": { orders: { unique: true }, db: { tables: { calendar: "cal" } }, lang: "hu" },
  "B--prod": { orders: {}, db: { tables: { calendar: "cal2" } }, lang: "en" },
};
const F = {
  unique: { id: "F-unique", name: "Unique orders", kind: "toggle", condition: { path: "orders.unique", op: "truthy" }, cites: ["js/a.js:1"], affects: { screens: ["DLG-u"], actions: ["SCR-a#ACT-u"], refs: ["BR-1"] } },
  normalize: { id: "F-normalize", name: "Normalization", kind: "toggle", condition: { path: "planner.normalization", op: "truthy" }, cites: ["js/a.js:2"], affects: { actions: ["SCR-a#ACT-n"] }, deadEverywhere: true },
  calendar: { id: "F-calendar", name: "Shift calendar", kind: "toggle", condition: { path: "db.tables.calendar", op: "exists" }, cites: ["js/a.js:3"], affects: { screens: ["SCR-cal"] } },
  lang: { id: "F-lang", name: "Language set", kind: "option", condition: { path: "lang", op: "exists" }, cites: ["js/a.js:4"], affects: {} },
};
const good = () => ({ features: [F.unique, F.normalize, F.calendar, F.lang], data: [] });
const scr = (id: string, actions: string[]) => ({ id, kind: "route", name: id, template: "a.htm", scope: [], actions: actions.map((a) => ({ id: a, label: a, effects: [] })) });

let dir: string;
let pkg: string;
let app: string;
const put = (root: string, rel: string, v: unknown) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), typeof v === "string" ? v : JSON.stringify(v));
};
const feats = (v: unknown) => put(pkg, "diagrams/variability/features.json", v);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "var-"));
  pkg = join(dir, "pkg");
  app = join(dir, "app");
  put(pkg, "model.md", "# Domain model\n\n## Order\nCapabilities: x\nIdentity: id\nPersistence: table orders\n\n- `id` — string; required.\n");
  put(pkg, "rules.md", "# Rules\n\n## BR-1\nStatement: one.\n");
  put(pkg, "capabilities/x/spec.md", "# x Specification\n\n## Purpose\nX.\n\n## Requirements\n");
  for (const s of [scr("SCR-a", ["ACT-u", "ACT-n"]), scr("DLG-u", []), scr("SCR-cal", [])]) put(pkg, `ui/screens/${s.id}.json`, s);
  put(pkg, "ui/_config-reads.json", READS);
  for (const [id, conf] of Object.entries(EFF)) put(pkg, `ui/_effective/${id}.json`, { variant: id, conf });
  put(pkg, "diagrams/use-cases.json", []);
  put(app, "js/a.js", "if (cfg.orders.unique) u();\nvar n = cfg.planner.normalization;\nvar t = cfg.db.tables.calendar;\nvar lang = cfg.lang;\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("customer variability", () => {
  it("variability-draft: read paths x variant values, varying and absent flags, grouped by top-level key", () => {
    const out = join(dir, "draft.json");
    expect(run("variability-draft", pkg, out).code).toBe(0);
    const d = JSON.parse(readFileSync(out, "utf8"));
    const by = Object.fromEntries(d.paths.map((p: { path: string }) => [p.path, p]));
    expect(by["orders.unique"]).toMatchObject({ group: "orders", varying: true, absentEverywhere: false, values: { "A--demo": true, "A--prod": true } });
    expect("B--prod" in by["orders.unique"].values).toBe(false);
    expect(by["planner.normalization"]).toMatchObject({ varying: false, absentEverywhere: true });
    expect(d.variants.map((v: { id: string }) => v.id)).toEqual(["A--demo", "A--prod", "B--prod"]);
  });

  it("check-variability refuses ungrounded or inconsistent features", () => {
    const bad = (features: unknown[], msg: RegExp, data: unknown[] = []) => {
      feats({ features, data });
      const r = run("check-variability", pkg, app);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(msg);
    };
    bad([{ ...F.unique, cites: ["js/a.js:4"] }], /F-unique: cite js\/a\.js:4 does not read 'unique'/);
    bad([{ ...F.unique, condition: { path: "foo.bar", op: "truthy" } }], /F-unique: path foo\.bar is not read by the code/);
    bad([{ ...F.normalize, deadEverywhere: false }], /F-normalize: condition false in every variant; mark deadEverywhere/);
    bad([{ ...F.calendar, deadEverywhere: true }], /F-calendar: deadEverywhere but on in A--prod/);
    bad([{ ...F.unique, condition: { path: "orders.unique", op: "like" } }], /F-unique: op like/);
    bad([{ ...F.unique, condition: { path: "orders.unique", op: "eq" } }], /F-unique: op eq needs a value/);
    bad([{ ...F.unique, affects: { screens: ["SCR-zz"], actions: ["SCR-a#ACT-zz"], refs: ["BR-9"] } }], /unknown screen SCR-zz[\s\S]*unknown action SCR-a#ACT-zz[\s\S]*dangling ref BR-9/);
    bad([F.unique, F.unique], /duplicate feature F-unique/);
    bad([], /data foo: path is not read by the code/, [{ path: "foo", reason: "x" }]);
    feats(good());
    const r = run("check-variability", pkg, app);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("cite check reads UTF-16 (BOM) sources too", () => {
    writeFileSync(join(app, "js", "u16.js"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("// x\nif (cfg.lang) y();\n", "utf16le")]));
    feats({ features: [F.unique, F.normalize, F.calendar, { ...F.lang, cites: ["js/u16.js:2"] }], data: [] });
    const r = run("check-variability", pkg, app);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("--complete: every varying read path is in a feature (or below one) or in data", () => {
    feats({ features: [F.unique, F.normalize, F.calendar], data: [] });
    const r = run("check-variability", pkg, app, "--complete");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/varying path lang is neither a feature nor data/);
    feats({ features: [F.unique, F.normalize, F.calendar], data: [{ path: "lang", reason: "UI language" }] });
    expect(run("check-variability", pkg, app, "--complete").code).toBe(0);
  });

  it("variability export: matrices (env variants flagged, not counted), reachability, findings, feature model", () => {
    feats(good());
    const out = join(dir, "vm");
    const r = run("variability", pkg, out);
    expect(r.stderr).toBe("");
    const csv = readFileSync(join(out, "variability.csv"), "utf8").trim().split("\n");
    expect(csv[0]).toBe("feature,A--demo (demo),A--prod,B--prod");
    expect(csv).toContain("F-calendar,off,on,on");
    const cust = readFileSync(join(out, "variability-customers.csv"), "utf8").trim().split("\n");
    expect(cust[0]).toBe("feature,A,B");
    expect(cust).toContain("F-unique,on,off");
    expect(cust).toContain("F-calendar,on,on");
    const md = readFileSync(join(out, "variability-findings.md"), "utf8");
    expect(md).toMatch(/## Dead everywhere[\s\S]*F-normalize/);
    expect(md).toMatch(/## Single-customer features[\s\S]*F-unique \(A\)/);
    expect(md).toMatch(/## Constant across all variants[\s\S]*F-lang/);
    expect(md).toMatch(/## Customers without an own feature[\s\S]*- B/);
    expect(md).toMatch(/## Unreachable UI per customer[\s\S]*B: DLG-u, SCR-a#ACT-n, SCR-a#ACT-u/);
    const fm = readFileSync(join(out, "feature-model.xml"), "utf8");
    expect(fm).toContain('<feature name="F-unique"');
    expect(fm).toContain("<featureModel>");
  });

  it("build-site embeds variability (null without records) and refuses a failing record", () => {
    feats(good());
    const out = join(dir, "c.html");
    expect(run("build-site", pkg, out).code).toBe(0);
    const v = catalogData(readFileSync(out, "utf8")).variability;
    expect(v.customers).toEqual(["A", "B"]);
    expect(v.byCustomer["F-unique"]).toEqual({ A: "on", B: "off" });
    expect(v.unreachable.B).toEqual(["DLG-u", "SCR-a#ACT-n", "SCR-a#ACT-u"]);
    feats({ features: [F.unique, F.unique], data: [] });
    expect(run("build-site", pkg, join(dir, "c2.html")).code).toBe(1);
    rmSync(join(pkg, "diagrams", "variability"), { recursive: true });
    expect(run("build-site", pkg, join(dir, "c3.html")).code).toBe(0);
    expect(catalogData(readFileSync(join(dir, "c3.html"), "utf8")).variability).toBeNull();
  });
});
