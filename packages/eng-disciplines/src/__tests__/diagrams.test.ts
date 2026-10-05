/**
 * rebuild-package-diagrams: `diagrams.mjs` extract-model / render-er / check-trace + skill text.
 * See change: add-rebuild-package-diagrams.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("use-case catalog and site", () => {
  let pkg: string;
  const uc = (over: Record<string, unknown> = {}) => ({
    id: "UC-01",
    name: "Add order",
    actor: "Planner",
    trigger: "button",
    requirements: ["spec:orders#Add single and unique orders"],
    refs: ["BR-001"],
    entities: ["Order"],
    bpmn: "bpmn/add/add.bpmn",
    ...over,
  });
  const writeUc = (list: unknown[]) => writeFileSync(join(pkg, "diagrams", "use-cases.json"), JSON.stringify(list));

  beforeAll(() => {
    pkg = join(dir, "sitepkg");
    mkdirSync(join(pkg, "capabilities", "orders"), { recursive: true });
    mkdirSync(join(pkg, "diagrams", "bpmn", "add"), { recursive: true });
    mkdirSync(join(pkg, "diagrams", "er"), { recursive: true });
    writeFileSync(join(pkg, "model.md"), MODEL);
    writeFileSync(
      join(pkg, "rules.md"),
      "# Business rules\n\n## BR-001\n- Class: explicit\n- Statement: Order id is required </script><b>x</b>.\n- Capabilities: orders\n<!-- cite: ref=js/order.js:3, confidence=confirmed -->\n",
    );
    writeFileSync(join(pkg, "quirks.md"), "# Quirks\n\n## QUIRK-002 Odd thing\n- Observed: x\n- Spec: capabilities/orders/spec.md, Requirement \"Add\"\n");
    writeFileSync(join(pkg, "gaps.md"), "# Gaps\n\n## GAP-003 Unknown\n- Unknown: y\n- Affects: orders (BR-001)\n");
    writeFileSync(
      join(pkg, "capabilities", "orders", "spec.md"),
      "# orders Specification\n\n## Purpose\nOrders.\n\n## Requirements\n### Requirement: Add single and unique orders\nThe screen SHALL add (BR-001).\n<!-- cite: ref=js/order.js:10-34, confidence=inferred -->\n\n#### Scenario: Valid line added\n- **WHEN** the line is valid\n- **THEN** the order is stored\n",
    );
    writeFileSync(join(pkg, "diagrams", "bpmn", "add", "add.bpmn"), "<bpmn:definitions/>");
    writeFileSync(join(pkg, "diagrams", "er", "orders.json"), JSON.stringify(goodEr));
  });

  it("check-use-cases passes a valid catalog", () => {
    writeUc([uc()]);
    const r = run(dir, "check-use-cases", pkg);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("check-use-cases refuses unknown entity, dangling refs, missing bpmn and duplicate id", () => {
    writeUc([
      uc({ entities: ["Invoice"] }),
      uc({ id: "UC-02", requirements: ["spec:orders#Nope"], refs: ["BR-404"], bpmn: "bpmn/x.bpmn" }),
      uc({ id: "UC-02" }),
    ]);
    const r = run(dir, "check-use-cases", pkg);
    expect(r.code).toBe(1);
    for (const s of ["UC-01", "Invoice", "spec:orders#Nope", "BR-404", "bpmn/x.bpmn", "duplicate", "UC-02"]) expect(r.stderr).toContain(s);
  });

  const embedded = (html: string) => {
    const m = html.match(/<script type="application\/json" id="catalog-data">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    return JSON.parse((m as RegExpMatchArray)[1]);
  };

  it("build-site embeds the package as JSON and escapes </script", () => {
    writeUc([uc()]);
    const out = join(dir, "site.html");
    const r = run(dir, "build-site", pkg, out);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const html = read(out);
    const data = embedded(html);
    expect(data.useCases[0].id).toBe("UC-01");
    const req = data.capabilities.orders.requirements[0];
    expect(req.name).toBe("Add single and unique orders");
    expect(req.scenarios[0].name).toBe("Valid line added");
    expect(data.items["BR-001"].statement).toContain("Order id is required");
    // capabilities derived from `Capabilities:` / `Spec:` / `Affects:` so every item links to its capability
    expect(data.items["BR-001"].capabilities).toEqual(["orders"]);
    expect(data.items["QUIRK-002"].capabilities).toEqual(["orders"]);
    expect(data.items["GAP-003"].capabilities).toEqual(["orders"]);
    expect(data.useCases[0].bpmnXml).toBe("<bpmn:definitions/>");
    expect(data.viewers).toEqual({ bpmn: false, mermaid: false });
  });

  it("build-site embeds questions.json with refs; empty register without the file", () => {
    writeUc([uc()]);
    const qPath = join(pkg, "diagrams", "questions.json");
    if (existsSync(qPath)) rmSync(qPath);
    const out0 = join(dir, "site-noq.html");
    expect(run(dir, "build-site", pkg, out0).code).toBe(0);
    expect(embedded(read(out0)).questions).toEqual([]);
    writeFileSync(qPath, JSON.stringify([{ id: "Q-001", text: "Is the id required?", severity: "high", refs: ["BR-001"] }]));
    const out = join(dir, "site-q.html");
    const r = run(dir, "build-site", pkg, out);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(embedded(read(out)).questions[0]).toMatchObject({ id: "Q-001", refs: ["BR-001"] });
  });

  it("build-site refuses dangling question refs and duplicate ids", () => {
    writeUc([uc()]);
    const qPath = join(pkg, "diagrams", "questions.json");
    writeFileSync(
      qPath,
      JSON.stringify([
        { id: "Q-001", text: "a", severity: "high", refs: ["BR-999"] },
        { id: "Q-002", text: "b", severity: "low", refs: [] },
        { id: "Q-002", text: "c", severity: "low", refs: [] },
      ]),
    );
    const out = join(dir, "site-bad-q.html");
    const r = run(dir, "build-site", pkg, out);
    rmSync(qPath);
    expect(r.code).toBe(1);
    for (const s of ["Q-001", "BR-999", "Q-002", "duplicate"]) expect(r.stderr).toContain(s);
    expect(existsSync(out)).toBe(false);
  });

  const screen = (over: Record<string, unknown> = {}) => ({
    id: "SCR-order",
    kind: "route",
    name: "Orders",
    template: "html/order.htm",
    scope: [],
    forms: [{ form: "FRM-line", region: "new lines" }],
    actions: [
      {
        id: "ACT-add",
        label: "Add",
        guards: ["BR-001"],
        refs: ["spec:orders#Add single and unique orders"],
        effects: [{ kind: "write", step: "Store order", target: "data.add", refs: ["QUIRK-002"] }],
      },
    ],
    dialogs: [{ id: "DLG-sure", kind: "confirm", message: "sure?" }],
    ...over,
  });
  const writeUi = (screens: unknown[], forms: Record<string, unknown> = { "FRM-line": { id: "FRM-line", fields: [{ key: "qty" }] } }) => {
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    mkdirSync(join(pkg, "ui", "screens"), { recursive: true });
    mkdirSync(join(pkg, "ui", "forms"), { recursive: true });
    screens.forEach((s, i) => writeFileSync(join(pkg, "ui", "screens", `s${i}.json`), JSON.stringify(s)));
    for (const [id, f] of Object.entries(forms)) writeFileSync(join(pkg, "ui", "forms", `${id}.json`), JSON.stringify(f));
  };

  it("build-site embeds the UI model and alternate flows; empty UI model without ui/", () => {
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    writeUc([uc()]);
    const out0 = join(dir, "site-noui.html");
    expect(run(dir, "build-site", pkg, out0).code).toBe(0);
    expect(embedded(read(out0)).ui).toEqual({ screens: [], forms: {} });
    writeUi([screen()]);
    writeFileSync(join(pkg, "diagrams", "bpmn", "add", "code.bpmn"), "<bpmn:definitions id='code'/>");
    writeUc([uc({ screens: ["SCR-order"], altFlows: [{ label: "from code", bpmn: "bpmn/add/code.bpmn" }] })]);
    const out = join(dir, "site-ui.html");
    const r = run(dir, "build-site", pkg, out);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const data = embedded(read(out));
    expect(data.ui.screens[0]).toMatchObject({ id: "SCR-order", actions: [{ id: "ACT-add", guards: ["BR-001"] }] });
    expect(data.ui.forms["FRM-line"].fields[0].key).toBe("qty");
    expect(data.useCases[0].screens).toEqual(["SCR-order"]);
    expect(data.useCases[0].altFlows[0]).toMatchObject({ label: "from code", bpmnXml: "<bpmn:definitions id='code'/>" });
  });

  it("build-site refuses dangling UI refs, a missing form record and duplicate ids", () => {
    writeUc([uc()]);
    writeUi([
      screen({ forms: [{ form: "FRM-nope" }], actions: [{ id: "ACT-x", label: "x", guards: ["BR-999"], effects: [{ kind: "call", refs: ["spec:orders#Nope"] }] }] }),
      screen({ id: "SCR-two", forms: [], actions: [{ id: "ACT-x", label: "y" }] }),
    ]);
    const out = join(dir, "site-bad-ui.html");
    const r = run(dir, "build-site", pkg, out);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(r.code).toBe(1);
    for (const s of ["SCR-order", "BR-999", "FRM-nope", "spec:orders#Nope", "duplicate", "ACT-x"]) expect(r.stderr).toContain(s);
    expect(existsSync(out)).toBe(false);
  });

  it("check-use-cases refuses an unknown screen and a missing alternate flow", () => {
    writeUi([screen()]);
    writeUc([uc({ screens: ["SCR-nope"], altFlows: [{ label: "from code", bpmn: "bpmn/missing.bpmn" }] })]);
    const r = run(dir, "check-use-cases", pkg);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(r.code).toBe(1);
    for (const s of ["UC-01", "SCR-nope", "bpmn/missing.bpmn"]) expect(r.stderr).toContain(s);
  });

  it("build-site inlines viewer libraries", () => {
    writeUc([uc()]);
    writeFileSync(join(dir, "fake-bpmn.js"), "window.FAKE_BPMN_LIB=1;");
    writeFileSync(join(dir, "fake.css"), ".fake-bpmn-css{}");
    writeFileSync(join(dir, "fake-mermaid.js"), "window.FAKE_MERMAID_LIB=1;");
    const out = join(dir, "site2.html");
    const r = run(dir, "build-site", pkg, out, "--bpmn-js", "fake-bpmn.js", "--bpmn-css", "fake.css", "--mermaid", "fake-mermaid.js");
    expect(r.code).toBe(0);
    const html = read(out);
    for (const s of ["window.FAKE_BPMN_LIB=1;", ".fake-bpmn-css{}", "window.FAKE_MERMAID_LIB=1;"]) expect(html).toContain(s);
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/);
    expect(embedded(html).viewers).toEqual({ bpmn: true, mermaid: true });
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
