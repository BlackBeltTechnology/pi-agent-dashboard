/**
 * CRUD matrix (rebuild-package-diagrams scripts/crud.mjs): draft, gate, assembly, exports, catalog data.
 * See change: add-crud-matrix.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { PKG } from "./files";

const DSK = join(PKG, ".pi", "skills", "rebuild-package-diagrams");
const DIAGRAMS = join(DSK, "scripts", "diagrams.mjs");
const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [DIAGRAMS, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

const MODEL = `# Domain model

## Order
Capabilities: x
Identity: id
Persistence: row of the table named by cfg.tables.orders.name

- \`id\` — string; required.

## Line
Capabilities: x
Identity: id
Persistence: rows of cfg.tables.lines (table order_lines), collection OrderLines

- \`id\` — string; required.

## Archive
Capabilities: x
Identity: id
Persistence: row of table archive

- \`id\` — string; required.

## ViewState
Capabilities: x
Identity: none
Persistence: In-memory only

- \`zoom\` — number; optional.
`;

const eff = (kind: string, target: string) => ({ kind, step: `${kind} step`, target, cite: "js/a.js:1" });
const SCREENS = [
  {
    id: "SCR-a",
    kind: "route",
    name: "A",
    template: "a.htm",
    scope: [],
    actions: [
      { id: "ACT-add", label: "Add", effects: [eff("validate", "check"), eff("write", "OrderLines.___add(line) and data.addOrder(order)")] },
      { id: "ACT-view", label: "View", effects: [eff("read", "reads cfg.tables.orders rows"), eff("state", "zoom")] },
    ],
  },
  { id: "SCR-b", kind: "route", name: "B", template: "b.htm", scope: [], actions: [{ id: "ACT-del", label: "Del", effects: [eff("write", "Orders.___del({id})"), eff("call", "data.archiveOrder(id)")] }] },
  { id: "SCR-c", kind: "panel", name: "C", template: "c.htm", scope: [], actions: [{ id: "ACT-noop", label: "N", effects: [eff("state", "x")] }] },
];
const recA = () => ({
  screen: "SCR-a",
  entries: [
    { effect: "ACT-add#1", entity: "Line", op: "C", note: "OrderLines.___add" },
    { effect: "ACT-add#1", entity: "Order", op: "C" },
    { effect: "ACT-view#0", entity: "Order", op: "R" },
  ],
  unmapped: [],
});
const recB = () => ({ screen: "SCR-b", entries: [{ effect: "ACT-del#0", entity: "Order", op: "D" }], unmapped: [{ effect: "ACT-del#1", reason: "audit stub" }] });

let dir: string;
let pkg: string;
const put = (rel: string, v: unknown) => {
  mkdirSync(join(pkg, rel, ".."), { recursive: true });
  writeFileSync(join(pkg, rel), typeof v === "string" ? v : JSON.stringify(v));
};
const catalogData = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="catalog-data">([\s\S]*?)<\/script>/)?.[1] ?? "{}");

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "crud-"));
  pkg = join(dir, "pkg");
  mkdirSync(join(pkg, "capabilities", "x"), { recursive: true });
  put("model.md", MODEL);
  put("capabilities/x/spec.md", "# x Specification\n\n## Purpose\nX.\n\n## Requirements\n");
  for (const s of SCREENS) put(`ui/screens/${s.id}.json`, s);
  put("diagrams/use-cases.json", [{ id: "UC-01", name: "Order", actor: "P", trigger: "t", requirements: [], refs: [], entities: ["Order"], screens: ["SCR-a"] }]);
});

describe("crud-draft", () => {
  it("lists write/read/export effects with alias candidates from model.md", () => {
    const out = join(dir, "draft.json");
    const r = run(dir, "crud-draft", pkg, "SCR-a", out);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const d = JSON.parse(readFileSync(out, "utf8"));
    expect(d.screen).toBe("SCR-a");
    expect(d.effects.map((e: { effect: string }) => e.effect)).toEqual(["ACT-add#1", "ACT-view#0"]);
    expect(d.effects[0].candidates).toEqual(["Line", "Order"]);
    expect(d.effects[1].candidates).toEqual(["Order"]);
    expect(d.effects[0]).toMatchObject({ kind: "write", cite: "js/a.js:1" });
  });
  it("aliases: name, plural, table/collection phrases and dotted-identifier segments (no app convention)", async () => {
    const { aliasIndex } = await import(pathToFileURL(join(DSK, "scripts", "crud.mjs")).href);
    const [a] = aliasIndex({ entities: [{ name: "Stock", persistence: "rows of settings.db.tables.stock_rows; table stk" }] });
    expect(a.aliases.sort()).toEqual(["stk", "stock", "stock_rows", "stocks"]);
  });
  it("includes call effects (data-layer functions can write)", () => {
    const out = join(dir, "draft-b.json");
    expect(run(dir, "crud-draft", pkg, "SCR-b", out).code).toBe(0);
    const d = JSON.parse(readFileSync(out, "utf8"));
    expect(d.effects.map((e: { effect: string; kind: string }) => `${e.effect}:${e.kind}`)).toEqual(["ACT-del#0:write", "ACT-del#1:call"]);
    expect(d.effects[1].candidates).toEqual(["Archive", "Order"]);
  });
  it("exits 1 for an unknown screen", () => {
    expect(run(dir, "crud-draft", pkg, "SCR-nope", join(dir, "x.json")).code).toBe(1);
  });
});

describe("check-crud", () => {
  it("passes valid records; --complete needs every screen with data effects", () => {
    put("diagrams/crud/SCR-a.json", recA());
    put("diagrams/crud/SCR-b.json", recB());
    const r = run(dir, "check-crud", pkg, "--complete");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    rmSync(join(pkg, "diagrams/crud/SCR-b.json"));
    expect(run(dir, "check-crud", pkg).code).toBe(0);
    const c = run(dir, "check-crud", pkg, "--complete");
    expect(c.code).toBe(1);
    expect(c.stderr).toContain("SCR-b: no CRUD record");
    put("diagrams/crud/SCR-b.json", recB());
  });
  it("refuses unknown entity/op/effect, an uncovered effect and duplicates", () => {
    put("diagrams/crud/SCR-a.json", {
      screen: "SCR-a",
      entries: [
        { effect: "ACT-add#1", entity: "Ghost", op: "C" },
        { effect: "ACT-add#1", entity: "Line", op: "X" },
        { effect: "ACT-gone#0", entity: "Line", op: "R" },
        { effect: "ACT-add#9", entity: "Line", op: "R" },
        { effect: "ACT-add#0", entity: "Line", op: "R" },
        { effect: "ACT-add#0", entity: "Line", op: "R" },
      ],
      unmapped: [],
    });
    const r = run(dir, "check-crud", pkg);
    expect(r.code).toBe(1);
    for (const m of ["unknown entity Ghost", "op X (need C, R, U or D)", "unknown action ACT-gone", "ACT-add has no effect 9", "duplicate entry ACT-add#0 Line R", "ACT-view#0 (read) not classified"])
      expect(r.stderr).toContain(m);
    put("diagrams/crud/SCR-a.json", { ...recA(), unmapped: [{ effect: "ACT-view#0" }] });
    expect(run(dir, "check-crud", pkg).stderr).toContain("unmapped ACT-view#0: reason missing");
    put("diagrams/crud/SCR-a.json", recA());
  });
});

describe("crud assembly", () => {
  it("build-site embeds matrices by use case and screen plus findings", () => {
    const out = join(dir, "c.html");
    const r = run(dir, "build-site", pkg, out);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const { crud } = catalogData(readFileSync(out, "utf8"));
    expect(crud.byUseCase["UC-01"]).toEqual({ Order: "CR", Line: "C" });
    expect(crud.byScreen["SCR-b"]).toEqual({ Order: "D" });
    expect(crud.byEntity.Order.map((e: { action: string; op: string }) => `${e.action}:${e.op}`)).toEqual(["SCR-a#ACT-add:C", "SCR-a#ACT-view:R", "SCR-b#ACT-del:D"]);
    expect(crud.findings).toEqual({
      neverWritten: [],
      neverRead: ["Line"],
      createdNeverDeleted: ["Line"],
      untouched: ["Archive"],
    });
  });
  it("build-site refuses failing CRUD records", () => {
    put("diagrams/crud/SCR-b.json", { screen: "SCR-b", entries: [{ effect: "ACT-del#0", entity: "Ghost", op: "D" }], unmapped: [] });
    const r = run(dir, "build-site", pkg, join(dir, "bad.html"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown entity Ghost");
    expect(r.stderr).toContain("ACT-del#1 (call) not classified");
    put("diagrams/crud/SCR-b.json", recB());
  });
  it("crud exports CSV matrices and findings", () => {
    const out = join(dir, "crud-out");
    expect(run(dir, "crud", pkg, out).code).toBe(0);
    expect(readFileSync(join(out, "crud.csv"), "utf8")).toBe("entity,UC-01\nLine,C\nOrder,CR\n");
    expect(readFileSync(join(out, "crud-screens.csv"), "utf8")).toBe("entity,SCR-a,SCR-b\nLine,C,\nOrder,CR,D\n");
    const md = readFileSync(join(out, "crud-findings.md"), "utf8");
    expect(md).toContain("## Created but never deleted\n\n- Line");
    expect(md).toContain("## Untouched by the UI\n\n- Archive");
  });
  it("a package without diagrams/crud builds with crud null", () => {
    rmSync(join(pkg, "diagrams", "crud"), { recursive: true });
    const out = join(dir, "n.html");
    expect(run(dir, "build-site", pkg, out).code).toBe(0);
    expect(catalogData(readFileSync(out, "utf8")).crud).toBeNull();
    put("diagrams/crud/SCR-a.json", recA());
    put("diagrams/crud/SCR-b.json", recB());
  });
});
