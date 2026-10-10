/**
 * rebuild-package-diagrams use-case UI links: draft candidates, gate, merge into the catalog.
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

const MODEL = "# Domain model\n\n## Order\nCapabilities: x\nIdentity: id\nPersistence: table orders\n\n- `id` — string; required.\n";
const RULES = "# Rules\n\n## BR-1\nStatement: one.\n\n## BR-2\nStatement: two.\n\n## BR-3\nStatement: three.\n";
const BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><bpmn:process id="P">
<bpmn:startEvent id="Start_open" name="Open"/>
<bpmn:userTask id="Task_add" name="Add order"><bpmn:documentation>BR-3</bpmn:documentation></bpmn:userTask>
<bpmn:exclusiveGateway id="Gw_ok" name="ok?"/>
<bpmn:endEvent id="End_done" name="Done"/>
</bpmn:process></bpmn:definitions>`;
const SCREENS = [
  {
    id: "SCR-a", kind: "route", name: "A", template: "a.htm", scope: [],
    actions: [
      { id: "ACT-add", label: "Add", guards: ["BR-1"], handler: { name: "add", cite: "js/a.js:10-20" }, effects: [{ kind: "write", step: "w", target: "orders", cite: "js/a.js:30", refs: ["BR-3"] }] },
      { id: "ACT-other", label: "Other", effects: [{ kind: "state", step: "s", target: "x", cite: "js/a.js:50" }] },
    ],
  },
  { id: "SCR-b", kind: "route", name: "B", template: "b.htm", scope: [], actions: [{ id: "ACT-x", label: "X", refs: ["BR-2"], effects: [] }] },
];
const UCS = [
  { id: "UC-01", name: "Add order", actor: "P", trigger: "t", requirements: [], refs: ["BR-1"], entities: ["Order"], bpmn: "bpmn/uc1.bpmn" },
  { id: "UC-02", name: "Timer job", actor: "System", trigger: "timer", requirements: [], refs: [], entities: ["Order"] },
];

let dir: string;
let pkg: string;
const put = (rel: string, v: unknown) => {
  mkdirSync(join(pkg, rel, ".."), { recursive: true });
  writeFileSync(join(pkg, rel), typeof v === "string" ? v : JSON.stringify(v));
};
const link = (action: string, step: string, evidence: unknown) => ({ action, step, evidence });
const good = () => ({ useCase: "UC-01", links: [link("SCR-a#ACT-add", "Task_add", { refs: ["BR-1"] })], noUi: null });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "links-"));
  pkg = join(dir, "pkg");
  put("model.md", MODEL);
  put("rules.md", RULES);
  put("capabilities/x/spec.md", "# x Specification\n\n## Purpose\nX.\n\n## Requirements\n");
  for (const s of SCREENS) put(`ui/screens/${s.id}.json`, s);
  put("diagrams/use-cases.json", UCS);
  put("diagrams/bpmn/uc1.bpmn", BPMN);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("use-case UI links", () => {
  it("uc-link-draft: steps from the BPMN (no gateways), actions ranked by shared refs (incl. BPMN doc refs)", () => {
    const out = join(dir, "d.json");
    const r = run("uc-link-draft", pkg, "UC-01", out);
    expect(r.stderr).toBe("");
    const d = JSON.parse(readFileSync(out, "utf8"));
    expect(d.useCase).toBe("UC-01");
    expect(d.steps.map((s: { id: string }) => s.id)).toEqual(["Start_open", "Task_add", "End_done"]);
    expect(d.candidates[0]).toMatchObject({ action: "SCR-a#ACT-add", shared: ["BR-1", "BR-3"] });
    expect(d.candidates.map((c: { action: string }) => c.action)).not.toContain("SCR-a#ACT-other");
    expect(run("uc-link-draft", pkg, "UC-99", out).code).toBe(1);
  });

  it("check-uc-links refuses bad records and passes a good one", () => {
    const bad = (rec: unknown, msg: RegExp) => {
      put("diagrams/uc-links/UC-01.json", rec);
      const r = run("check-uc-links", pkg);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(msg);
    };
    bad({ ...good(), links: [link("SCR-z#ACT-add", "Task_add", { refs: ["BR-1"] })] }, /unknown screen action SCR-z#ACT-add/);
    bad({ ...good(), links: [link("SCR-a#ACT-zz", "Task_add", { refs: ["BR-1"] })] }, /unknown screen action SCR-a#ACT-zz/);
    bad({ ...good(), links: [link("SCR-a#ACT-add", "Gw_ok", { refs: ["BR-1"] })] }, /step Gw_ok is not a BPMN task or event of UC-01/);
    bad({ ...good(), links: [link("SCR-b#ACT-x", "Task_add", { refs: ["BR-2"] })] }, /SCR-b#ACT-x: ref BR-2 not shared/);
    bad({ ...good(), links: [link("SCR-a#ACT-other", "Task_add", {})] }, /SCR-a#ACT-other: evidence needs refs or a cite/);
    bad({ ...good(), links: [link("SCR-a#ACT-add", "Task_add", { cite: "js/a.js:25" })] }, /cite js\/a\.js:25 is outside the action's handler\/effect cites/);
    bad({ ...good(), links: [good().links[0], good().links[0]] }, /duplicate link SCR-a#ACT-add @ Task_add/);
    bad({ useCase: "UC-01", links: [], noUi: null }, /UC-01: no links and no noUi reason/);
    bad({ ...good(), noUi: "timer" }, /UC-01: links and noUi together/);
    bad({ ...good(), useCase: "UC-77" }, /unknown use case UC-77/);
    put("diagrams/uc-links/UC-01.json", { ...good(), links: [link("SCR-a#ACT-add", "Start_open", { cite: "js/a.js:12" })] });
    expect(run("check-uc-links", pkg).code).toBe(0);
    put("diagrams/uc-links/UC-01.json", good());
    const r = run("check-uc-links", pkg);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("--complete needs a record per use case; noUi records pass", () => {
    put("diagrams/uc-links/UC-01.json", good());
    const r = run("check-uc-links", pkg, "--complete");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/UC-02: no uc-links record/);
    put("diagrams/uc-links/UC-02.json", { useCase: "UC-02", links: [], noUi: "timer-driven, no screen" });
    expect(run("check-uc-links", pkg, "--complete").code).toBe(0);
  });

  it("build-site merges links into screens/uiActions and embeds uiLinks; refuses a failing record", () => {
    const out = join(dir, "site.html");
    expect(run("build-site", pkg, out).code).toBe(0);
    const d = catalogData(readFileSync(out, "utf8"));
    const uc1 = d.useCases.find((u: { id: string }) => u.id === "UC-01");
    expect(uc1.screens).toEqual(["SCR-a"]);
    expect(uc1.uiActions).toEqual(["SCR-a#ACT-add"]);
    expect(uc1.uiLinks).toEqual([{ action: "SCR-a#ACT-add", step: "Task_add", stepName: "Add order", evidence: { refs: ["BR-1"] } }]);
    expect(d.useCases.find((u: { id: string }) => u.id === "UC-02").noUi).toBe("timer-driven, no screen");
    put("diagrams/uc-links/UC-02.json", { useCase: "UC-02", links: [], noUi: null });
    const bad = run("build-site", pkg, join(dir, "site2.html"));
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/UC-02: no links and no noUi reason/);
    rmSync(join(pkg, "diagrams", "uc-links"), { recursive: true });
    expect(run("build-site", pkg, join(dir, "site3.html")).code).toBe(0);
    const d3 = catalogData(readFileSync(join(dir, "site3.html"), "utf8"));
    expect(d3.useCases.find((u: { id: string }) => u.id === "UC-01").uiLinks).toEqual([]);
  });

  it("refuses two records for the same use case", () => {
    put("diagrams/uc-links/UC-01.json", good());
    put("diagrams/uc-links/zz-UC-01.json", good());
    const r = run("check-uc-links", pkg);
    rmSync(join(pkg, "diagrams/uc-links/zz-UC-01.json"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("UC-01: duplicate record (UC-01.json, zz-UC-01.json)");
  });
});
