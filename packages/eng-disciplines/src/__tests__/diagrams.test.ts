/**
 * rebuild-package-diagrams: `diagrams.mjs` extract-model / render-er / check-trace + skill text.
 * See change: add-rebuild-package-diagrams.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PKG, read } from "./files";

const DSKILL = join(PKG, ".pi", "skills", "rebuild-package-diagrams");
const SCRIPT = join(DSKILL, "scripts", "diagrams.mjs");

function run(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const MODEL = `# Domain model

## Order
Capabilities: orders
Identity: order_id
Persistence: row of the table named by CONF.db.tables.order.name
<!-- cite: ref=js/order.js:1-9, confidence=inferred -->

- \`order_id\` — string; required (BR-001).
  <!-- cite: ref=js/order.js:3, confidence=confirmed -->
- \`note\` — string; optional, nullable.
  <!-- cite: ref=js/order.js:4, confidence=inferred -->

Relationships: has many OrderLine via OrderLine.order_id.

## OrderLine
Capabilities: orders
Identity: line_id
Persistence: row of the orderline table
<!-- cite: ref=js/order.js:10-20, confidence=inferred -->

- \`line_id\` — string; required.
  <!-- cite: ref=js/order.js:11, confidence=confirmed -->
- \`order_id\` — string; required.
  <!-- cite: ref=js/order.js:12, confidence=confirmed -->

Relationships: belongs to Order.

## OpBar
Capabilities: shell
Identity: singleton
Persistence: in-memory $rootScope object
<!-- cite: ref=js/app.js:1, confidence=inferred -->

- \`unique\` — function; optional.
  <!-- cite: ref=js/app.js:2, confidence=confirmed -->

Relationships: none.
`;

let dir: string;
let modelJson: string;

function writeEr(name: string, er: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(er));
  return p;
}

const goodEr = {
  entities: [
    { name: "Order", fields: [{ name: "order_id", key: "PK" }, { name: "note" }] },
    { name: "OrderLine", fields: [{ name: "line_id", key: "PK" }, { name: "order_id", key: "FK" }] },
  ],
  relations: [
    { from: "Order", to: "OrderLine", cardinality: "1:N", label: "has", confidence: "confirmed", evidence: "has many OrderLine" },
  ],
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rpd-"));
  writeFileSync(join(dir, "model.md"), MODEL);
  const r = run(dir, "extract-model", "model.md");
  modelJson = join(dir, "model.json");
  writeFileSync(modelJson, r.stdout);
});

describe("extract-model", () => {
  it("parses entities, fields, relationships and persistence flag", () => {
    const m = JSON.parse(read(modelJson));
    const names = m.entities.map((e: { name: string }) => e.name);
    expect(names).toEqual(["Order", "OrderLine", "OpBar"]);
    const order = m.entities[0];
    expect(order.fields.map((f: { name: string }) => f.name)).toEqual(["order_id", "note"]);
    expect(order.fields[0]).toMatchObject({ required: true, nullable: false, confidence: "confirmed" });
    expect(order.fields[1]).toMatchObject({ required: false, nullable: true });
    expect(order.relationships).toContain("has many OrderLine");
    expect(order.capabilities).toEqual(["orders"]);
    expect(m.entities.map((e: { persistent: boolean }) => e.persistent)).toEqual([true, true, false]);
  });

  it("writes complete JSON to a pipe beyond 64 KB", () => {
    const big = Array.from({ length: 600 }, (_, i) => `## E${i}\nPersistence: row of table t${i}\n\n- \`f\` — string; required.\n\nRelationships: ${"x".repeat(120)}.\n`).join("\n");
    writeFileSync(join(dir, "big.md"), big);
    const r = run(dir, "extract-model", "big.md");
    expect(r.stdout.length).toBeGreaterThan(65536);
    expect(JSON.parse(r.stdout).entities).toHaveLength(600);
  });

  it("exits 2 naming a missing file", () => {
    const r = run(dir, "extract-model", "nope.md");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("nope.md");
  });
});

describe("render-er", () => {
  it("renders a valid ER as Mermaid erDiagram", () => {
    const r = run(dir, "render-er", writeEr("good.json", goodEr), modelJson);
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith("erDiagram")).toBe(true);
    expect(r.stdout).toMatch(/Order \|\|--o\{ OrderLine : "has"/);
    expect(r.stdout).toMatch(/string order_id PK/);
  });

  it("refuses an entity absent from the model", () => {
    const er = { ...goodEr, entities: [...goodEr.entities, { name: "Invoice", fields: [] }] };
    const r = run(dir, "render-er", writeEr("hall.json", er), modelJson);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Invoice");
  });

  it("refuses a field absent from the entity", () => {
    const er = { ...goodEr, entities: [{ name: "Order", fields: [{ name: "total" }] }, goodEr.entities[1]] };
    const r = run(dir, "render-er", writeEr("field.json", er), modelJson);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Order.total");
  });

  it("refuses a relation whose evidence occurs in neither endpoint", () => {
    const er = { ...goodEr, relations: [{ ...goodEr.relations[0], evidence: "linked by invoice" }] };
    const r = run(dir, "render-er", writeEr("ev.json", er), modelJson);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Order -> OrderLine");
  });

  it("accepts evidence matching a field name of the target endpoint", () => {
    const er = { ...goodEr, relations: [{ ...goodEr.relations[0], evidence: "order_id" }] };
    expect(run(dir, "render-er", writeEr("fev.json", er), modelJson).code).toBe(0);
  });

  it("draws inferred relations dashed", () => {
    const er = { ...goodEr, relations: [{ ...goodEr.relations[0], confidence: "inferred" }] };
    const r = run(dir, "render-er", writeEr("inf.json", er), modelJson);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Order \|\|\.\.o\{ OrderLine/);
  });

  it("refuses an unknown cardinality", () => {
    const er = { ...goodEr, relations: [{ ...goodEr.relations[0], cardinality: "many" }] };
    const r = run(dir, "render-er", writeEr("card.json", er), modelJson);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cardinality");
  });
});

describe("check-trace", () => {
  let pkg: string;
  beforeAll(() => {
    pkg = join(dir, "pkg");
    mkdirSync(join(pkg, "capabilities", "orders"), { recursive: true });
    writeFileSync(join(pkg, "rules.md"), "# Rules\n\n## BR-001 — order id required\n");
    writeFileSync(join(pkg, "quirks.md"), "# Quirks\n\n## QUIRK-002 — x\n");
    writeFileSync(join(pkg, "gaps.md"), "# Gaps\n");
    writeFileSync(join(pkg, "capabilities", "orders", "spec.md"), "## Requirements\n### Requirement: Add single and unique orders\nThe screen SHALL.\n");
  });

  const bpmn = (taskDoc: string, gwDoc: string | null) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="x">
  <bpmn:process id="Process_add" isExecutable="false">
    <bpmn:startEvent id="Start_x" name="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_add" name="Add order">
      <bpmn:documentation>${taskDoc}</bpmn:documentation>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_valid" name="Valid?">${gwDoc === null ? "" : `<bpmn:documentation>${gwDoc}</bpmn:documentation>`}<bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="End_x" name="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_x" targetRef="Task_add" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_add" targetRef="Gateway_valid" />
    <bpmn:sequenceFlow id="F3" sourceRef="Gateway_valid" targetRef="End_x" />
  </bpmn:process>
</bpmn:definitions>
`;

  function check(name: string, xml: string) {
    const p = join(dir, name);
    writeFileSync(p, xml);
    return run(dir, "check-trace", p, pkg);
  }

  it("passes a fully traced process", () => {
    const r = check("ok.bpmn", bpmn("spec:orders#Add single and unique orders; BR-001", "QUIRK-002"));
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("refuses a dangling rule ref", () => {
    const r = check("dangle.bpmn", bpmn("BR-999", "BR-001"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Task_add");
    expect(r.stderr).toContain("BR-999");
  });

  it("refuses a dangling requirement ref", () => {
    const r = check("req.bpmn", bpmn("spec:orders#Delete everything", "BR-001"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("spec:orders#Delete everything");
  });

  it("refuses an undocumented node", () => {
    const r = check("undoc.bpmn", bpmn("BR-001", null));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Gateway_valid");
  });
});

describe("skill text", () => {
  it("frontmatter names the skill and ER/BPMN triggers", () => {
    const s = read(join(DSKILL, "SKILL.md"));
    expect(s).toMatch(/^---\nname: rebuild-package-diagrams\n/);
    expect(s).toMatch(/ER diagram/);
    expect(s).toMatch(/BPMN/);
  });

  it("every references/ or scripts/ path resolves inside the skill dir", () => {
    for (const f of ["SKILL.md", "references/er-mapping.md", "references/bpmn-mapping.md"]) {
      const text = read(join(DSKILL, f));
      expect(text).not.toContain("../");
      for (const m of text.matchAll(/\b((?:references|scripts)\/[A-Za-z0-9._-]+)/g)) {
        expect(existsSync(join(DSKILL, m[1])), `${f}: ${m[1]}`).toBe(true);
      }
    }
  });
});
