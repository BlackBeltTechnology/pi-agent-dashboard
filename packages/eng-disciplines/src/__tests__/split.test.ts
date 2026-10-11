/**
 * Diagram size budget + structural splitting (rebuild-package-diagrams scripts/split.mjs).
 * See change: add-diagram-splitting.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { PKG } from "./files";

const SCRIPTS = join(PKG, ".pi", "skills", "rebuild-package-diagrams", "scripts");
const DIAGRAMS = join(SCRIPTS, "diagrams.mjs");
let S: any;
let I: any;
const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [DIAGRAMS, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

const act = (id: string, kind: string, extra = {}) => ({ id, label: id, trigger: { kind }, effects: [{ kind: "write", step: `Do ${id}` }], ...extra });
/** Route SCR-big: 6 toolbar, 6 context-menu, 4 key actions; panel opened from it; a second route; an orphan dialog. */
const ui = () => ({
  forms: {},
  screens: [
    {
      id: "SCR-big",
      kind: "route",
      name: "Big",
      fields: [{ key: "q", label: "Q", type: "text" }],
      actions: [
        ...[1, 2, 3, 4, 5, 6].map((n) => act(`ACT-bar-${n}`, "toolbar")),
        ...[1, 2, 3, 4, 5, 6].map((n) => act(`ACT-menu-${n}`, "context-menu")),
        ...[1, 2, 3, 4].map((n) => act(`ACT-key-${n}`, "key")),
      ],
      dialogs: [{ id: "DLG-sure", kind: "confirm", from: "ACT-bar-1" }],
      navigation: [{ to: "SCR-panel" }],
    },
    { id: "SCR-panel", kind: "panel", name: "Panel", actions: [act("ACT-p", "click")], navigation: [{ to: "DLG-edit" }] },
    { id: "DLG-edit", kind: "modal", name: "Edit", actions: [act("ACT-ok", "modal-button")] },
    { id: "SCR-small", kind: "route", name: "Small", actions: [act("ACT-s", "click")], navigation: [{ to: "DLG-edit" }] },
    { id: "DLG-orphan", kind: "modal", name: "Orphan", actions: [] },
  ],
});

beforeAll(async () => {
  S = await import(pathToFileURL(join(SCRIPTS, "split.mjs")).href);
  I = await import(pathToFileURL(join(SCRIPTS, "ifml.mjs")).href);
});

describe("budget", () => {
  it("defaults to 30 nodes / 40 edges and reads --max-nodes/--max-edges", () => {
    expect(S.budgetOf([])).toEqual({ nodes: 30, edges: 40 });
    expect(S.budgetOf(["x", "--max-nodes", "10", "--max-edges", "12"])).toEqual({ nodes: 10, edges: 12 });
    expect(() => S.budgetOf(["--max-nodes", "0"])).toThrow(/--max-nodes/);
  });
});

describe("IFML areas and parts", () => {
  it("assigns non-route records to the nearest route by navigation (ties: first route), unreached to shared", () => {
    const areas = S.ifmlAreas(ui());
    expect(areas.map((a: { id: string; screens: string[] }) => [a.id, a.screens])).toEqual([
      ["AREA-SCR-big", ["SCR-big", "SCR-panel"]],
      ["AREA-SCR-small", ["SCR-small", "DLG-edit"]],
      ["AREA-shared", ["DLG-orphan"]],
    ]);
  });

  it("keeps an area within budget as one part", () => {
    const r = S.ifmlParts(ui(), { nodes: 500, edges: 500 });
    expect(r.parts.map((p: { id: string }) => p.id)).toEqual(["P-AREA-SCR-big", "P-AREA-SCR-small", "P-AREA-shared"]);
  });

  it("splits a screen over budget into trigger-kind groups, chunked to the budget, each part a valid XMI within budget", () => {
    const budget = { nodes: 16, edges: 40 };
    const r = S.ifmlParts(ui(), budget);
    const big = r.parts.filter((p: { screens: { id: string }[] }) => p.screens.some((s) => s.id === "SCR-big"));
    expect(big.map((p: { id: string }) => p.id)).toEqual(["P-SCR-big-toolbar", "P-SCR-big-context-menu", "P-SCR-big-key"]);
    expect(big[0].screens[0].actions).toEqual(["ACT-bar-1", "ACT-bar-2", "ACT-bar-3", "ACT-bar-4", "ACT-bar-5", "ACT-bar-6"]);
    for (const p of r.parts) {
      expect(p.size.nodes, p.id).toBeLessThanOrEqual(budget.nodes);
      expect(I.checkIfmlXmi(p.xmi), p.id).toEqual([]);
    }
    // the panel left SCR-big's area as its own part; tighter budget chunks a kind group
    expect(r.parts.map((p: { id: string }) => p.id)).toContain("P-SCR-panel");
    const tight = S.ifmlParts(ui(), { nodes: 8, edges: 40 });
    expect(tight.parts.map((p: { id: string }) => p.id)).toContain("P-SCR-big-toolbar-2");
  });

  it("forms/fields that do not fit beside the first action get their own parts, chunked by field; every part fits", () => {
    const u = ui();
    const fld = (k: string) => ({ key: k, label: k, type: "text", conditions: [{ kind: "validation", when: `${k}!=null` }] });
    u.forms = { "FRM-big": { id: "FRM-big", fields: Array.from({ length: 9 }, (_, i) => fld(`f${i}`)) } } as never;
    (u.screens[0] as Record<string, unknown>).forms = [{ form: "FRM-big" }];
    u.screens[0].fields = Array.from({ length: 4 }, (_, i) => fld(`s${i}`));
    const budget = { nodes: 16, edges: 40 };
    const r = S.ifmlParts(u, budget);
    const big = r.parts.filter((p: { screens: { id: string }[] }) => p.screens.some((s) => s.id === "SCR-big"));
    for (const p of big) {
      expect(p.size.nodes, p.id).toBeLessThanOrEqual(budget.nodes);
      expect(I.checkIfmlXmi(p.xmi), p.id).toEqual([]);
    }
    const forms = big.filter((p: { id: string }) => p.id.startsWith("P-SCR-big-forms"));
    expect(forms.length).toBeGreaterThan(1);
    // every field lands in exactly one part, with the whole-model element id
    const all = big.map((p: { xmi: string }) => p.xmi).join("\n");
    for (const k of [...Array.from({ length: 9 }, (_, i) => `FRM-big.f${i}`), ...Array.from({ length: 4 }, (_, i) => `fields.s${i}`)])
      expect(all.split(`xmi:id="P.SCR-big.${k}"`).length - 1, k).toBe(1);
    // action parts carry no forms
    expect(big.find((p: { id: string }) => p.id === "P-SCR-big-toolbar").xmi).not.toContain('xmi:type="ifml:Form"');
  });

  it("packs adjacent small trigger-kind groups into one part", () => {
    const u = ui();
    u.screens[0].actions.push(act("ACT-dbl", "dblclick"), act("ACT-wheel", "wheel"));
    const r = S.ifmlParts(u, { nodes: 16, edges: 40 });
    const ids = r.parts.map((p: { id: string }) => p.id);
    expect(ids).toContain("P-SCR-big-key-dblclick-wheel");
    const p = r.parts.find((x: { id: string }) => x.id === "P-SCR-big-key-dblclick-wheel");
    expect(p.title).toBe("Big · key, dblclick, wheel");
    // more than 3 kinds abbreviate; long screen names are clipped
    u.screens[0].name = "A very long screen name that goes on and on";
    u.screens[0].actions.push(act("ACT-up", "mouseup"));
    const q = S.ifmlParts(u, { nodes: 18, edges: 40 }).parts.find((x: { id: string }) => x.id.startsWith("P-SCR-big-key"));
    expect(q.id).toBe("P-SCR-big-key-dblclick-plus2");
    expect(q.title).toBe("A very long screen name that g… · key, dblclick +2");
    expect(p.screens[0].actions).toEqual(["ACT-key-1", "ACT-key-2", "ACT-key-3", "ACT-key-4", "ACT-dbl", "ACT-wheel"]);
  });

  it("overview: one node per area, cross-area navigation counted, Mermaid with stable ids", () => {
    const r = S.ifmlParts(ui(), { nodes: 16, edges: 40 });
    expect(r.overview.nodes.map((n: { id: string }) => n.id)).toEqual(["AREA-SCR-big", "AREA-SCR-small", "AREA-shared"]);
    expect(r.overview.edges).toEqual([{ from: "AREA-SCR-big", to: "AREA-SCR-small", count: 1 }]);
    expect(r.overview.mermaid).toMatch(/^flowchart TB/);
    expect(r.overview.mermaid).toContain("a0 -->|1| a1");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(S.ifmlParts(ui(), { nodes: 16, edges: 40 }))).toBe(JSON.stringify(S.ifmlParts(ui(), { nodes: 16, edges: 40 })));
  });
});

describe("state machine and sequence splitting", () => {
  const sm = () => ({
    id: "SM-x",
    states: [{ id: "a", initial: true }, { id: "b" }],
    transitions: [...[1, 2, 3, 4, 5].map((n) => ({ from: "a", to: "b", trigger: `t${n}` })), { from: "b", to: "a", trigger: "back" }],
  });
  it("merges parallel transitions only when over the edge budget", () => {
    expect(S.mergeParallel(sm(), { nodes: 30, edges: 40 })).toBeNull();
    expect(S.mergeParallel(sm(), { nodes: 30, edges: 3 })).toEqual([
      { from: "a", to: "b", count: 5, transitions: [0, 1, 2, 3, 4] },
      { from: "b", to: "a", count: 1, transitions: [5] },
    ]);
  });

  const msg = (n: number) => ({ from: "user", to: "SCR", label: `m${n}` });
  const seq = () => ({
    id: "SEQ-x",
    participants: [{ id: "user" }, { id: "SCR" }, { id: "c_db" }],
    messages: [msg(1), msg(2), { fragment: "alt", label: "ok", messages: [msg(3), { from: "SCR", to: "c_db", label: "m4" }], else: { label: "no", messages: [msg(5)] } }, msg(6), msg(7)],
  });
  it("cuts a fragment only when it alone exceeds the budget, each piece keeping its frame", () => {
    const big = { id: "SEQ-y", participants: [{ id: "user" }, { id: "SCR" }], messages: [msg(0), { fragment: "alt", label: "ok", messages: [1, 2, 3, 4, 5].map(msg), else: { label: "no", messages: [msg(6)] } }] };
    const parts = S.sequenceParts(big, { nodes: 30, edges: 2 });
    const frames = parts.flatMap((p: any) => p.messages.filter((m: any) => m.fragment).map((m: any) => `${m.label}:${m.messages.length}`));
    expect(frames).toEqual(["ok (1/3):2", "ok (2/3):2", "ok (3/3):1", "else no:1"]);
    for (const p of parts) expect(p.messages.reduce((n: number, m: any) => n + (m.fragment ? m.messages.length : 1), 0)).toBeLessThanOrEqual(2);
  });

  it("chunks top-level steps to the budget, keeping a fragment within budget whole", () => {
    expect(S.sequenceParts(seq(), { nodes: 30, edges: 40 })).toBeNull();
    const parts = S.sequenceParts(seq(), { nodes: 30, edges: 3 });
    expect(parts.map((p: { id: string; messages: unknown[] }) => [p.id, p.messages.length])).toEqual([
      ["SEQ-x#1", 2],
      ["SEQ-x#2", 1],
      ["SEQ-x#3", 2],
    ]);
    expect(parts[1].participants).toEqual(["user", "SCR", "c_db"]);
    expect(parts[0].participants).toEqual(["user", "SCR"]);
  });
});

describe("ER chunks", () => {
  const clusters = [
    { name: "orders", entities: ["Order", "Line", "Item"] },
    { name: "plan", entities: ["Process", "Phase", "Order"] },
  ];
  it("returns the set unchanged within budget", () => {
    expect(S.erChunks(["Order", "Process"], clusters, 5)).toEqual([{ name: null, entities: ["Order", "Process"] }]);
  });
  it("splits by authored cluster in order, then budget-sized chunks of the rest", () => {
    const names = ["Order", "Line", "Item", "Process", "Phase", "A", "B", "C"];
    expect(S.erChunks(names, clusters, 2)).toEqual([
      { name: "orders", entities: ["Order", "Line"] },
      { name: "orders", entities: ["Item"] },
      { name: "plan", entities: ["Process", "Phase"] },
      { name: null, entities: ["A", "B"] },
      { name: null, entities: ["C"] },
    ]);
  });
  it("packs adjacent small cluster pieces into one diagram", () => {
    const names = ["Order", "Line", "Item", "Process", "Phase", "A", "B", "C"];
    expect(S.erChunks(names, clusters, 5)).toEqual([
      { name: "orders + plan", entities: ["Order", "Line", "Item", "Process", "Phase"] },
      { name: null, entities: ["A", "B", "C"] },
    ]);
  });
  it("is self-contained (injected into the catalog by source)", () => {
    const fresh = (0, eval)(`(${S.erChunks.toString()})`);
    expect(fresh(["A", "B", "C"], [], 2)).toEqual([{ name: null, entities: ["A", "B"] }, { name: null, entities: ["C"] }]);
  });
});

describe("CLI: check-size, build-site, behaviour export", () => {
  let dir: string;
  let pkg: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "split-"));
    pkg = join(dir, "pkg");
    mkdirSync(join(pkg, "ui", "screens"), { recursive: true });
    mkdirSync(join(pkg, "diagrams", "state-machines"), { recursive: true });
    mkdirSync(join(pkg, "diagrams", "sequences"), { recursive: true });
    mkdirSync(join(pkg, "capabilities", "x"), { recursive: true });
    writeFileSync(join(pkg, "model.md"), "# Domain model\n\n## Order\nCapabilities: x\nIdentity: id\nPersistence: row\n\n- `status` — string; required; allowed: 'a', 'b'.\n");
    writeFileSync(join(pkg, "capabilities", "x", "spec.md"), "# x Specification\n\n## Purpose\nX.\n\n## Requirements\n");
    for (const s of ui().screens) writeFileSync(join(pkg, "ui", "screens", `${s.id}.json`), JSON.stringify({ template: "t.htm", scope: [], ...s }));
    writeFileSync(
      join(pkg, "diagrams", "state-machines", "SM-x.json"),
      JSON.stringify({ id: "SM-x", entity: "Order", field: "status", states: [{ id: "a", value: "a", initial: true }, { id: "b", value: "b" }], transitions: [1, 2, 3, 4, 5].map((n) => ({ from: "a", to: "b", trigger: `t${n}`, cite: "x.js:1" })) }),
    );
    writeFileSync(
      join(pkg, "diagrams", "sequences", "SEQ-x.json"),
      JSON.stringify({ id: "SEQ-x", participants: [{ id: "user", kind: "actor" }, { id: "SCR-big", kind: "screen", ref: "SCR-big" }], messages: [1, 2, 3, 4, 5].map((n) => ({ from: "user", to: "SCR-big", label: `m${n}`, cite: "x.js:1" })) }),
    );
  });

  it("check-size reports every diagram; --strict fails only when a part stays over budget", () => {
    const r = run(dir, "check-size", pkg, "--max-nodes", "16", "--max-edges", "3");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ifml all: \d+ nodes, \d+ edges -> \d+ parts/m);
    expect(r.stdout).toMatch(/^ifml P-SCR-big-toolbar(-1)?: /m);
    expect(r.stdout).toContain("sm SM-x: 5 transitions -> 1 edges");
    expect(r.stdout).toContain("seq SEQ-x: 5 messages -> 2 parts");
    expect(run(dir, "check-size", pkg, "--max-nodes", "16", "--max-edges", "3", "--strict").code).toBe(0);
    const strict = run(dir, "check-size", pkg, "--max-nodes", "2", "--strict");
    expect(strict.code).toBe(1);
    expect(strict.stdout).toMatch(/OVER/);
  });

  it("build-site embeds the budget, IFML split, merged state edges and sequence parts", () => {
    const out = join(dir, "c.html");
    const r = run(dir, "build-site", pkg, out, "--max-nodes", "16", "--max-edges", "3");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const html = readFileSync(out, "utf8");
    const m = html.match(/<script type="application\/json" id="catalog-data">([\s\S]*?)<\/script>/);
    const D = JSON.parse(m?.[1] ?? "{}");
    expect(D.meta.budget).toEqual({ nodes: 16, edges: 3 });
    expect(D.ifmlSplit.parts.length).toBeGreaterThan(3);
    expect(D.ifmlSplit.overview.nodes.length).toBe(3);
    const s = D.behaviour.states[0];
    expect(s.mermaid).toContain("a --> b : 5 transitions");
    expect(s.scxml.match(/<transition /g)?.length).toBe(5);
    const q = D.behaviour.sequences[0];
    expect(q.parts.map((p: { id: string }) => p.id)).toEqual(["SEQ-x#1", "SEQ-x#2"]);
    expect(q.mermaid).toContain("Note over user,SCR_big: ref part 1");
    expect(html).toContain("function erChunks(");
    // deterministic
    const out2 = join(dir, "c2.html");
    run(dir, "build-site", pkg, out2, "--max-nodes", "16", "--max-edges", "3");
    expect(readFileSync(out2, "utf8")).toBe(html);
  });

  it("within the default budget nothing is split", () => {
    const out = join(dir, "d.html");
    expect(run(dir, "build-site", pkg, out).code).toBe(0);
    const D = JSON.parse(readFileSync(out, "utf8").match(/id="catalog-data">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    expect(D.behaviour.sequences[0].parts).toBeNull();
    expect(D.behaviour.states[0].mermaid).toContain("a --> b : t1");
  });

  it("behaviour and ifml-parts export the parts", () => {
    const out = join(dir, "beh");
    expect(run(dir, "behaviour", pkg, out, "--max-edges", "3").code).toBe(0);
    expect(readFileSync(join(out, "SEQ-x.part-1.mmd"), "utf8")).toMatch(/^sequenceDiagram/);
    const parts = join(dir, "parts");
    const r = run(dir, "ifml-parts", pkg, parts, "--max-nodes", "16");
    expect(r.stderr).toBe("");
    expect(readFileSync(join(parts, "overview.mmd"), "utf8")).toMatch(/^flowchart TB/);
    expect(readFileSync(join(parts, "P-SCR-big-toolbar.xmi"), "utf8")).toContain("ifml:Window");
  });
});
