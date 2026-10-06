/**
 * rebuild-package-diagrams: `diagrams.mjs` extract-model / render-er / check-trace + skill text.
 * See change: add-rebuild-package-diagrams.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** The catalog JSON embedded in a built site. */
function embedded(html: string) {
  const m = html.match(/<script type="application\/json" id="catalog-data">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  return JSON.parse((m as RegExpMatchArray)[1]);
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
    expect(data.viewers).toEqual({ bpmn: false, mermaid: false, ifml: false });
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

  it("render.sh: minimal package skips architecture + IFML and writes the catalog; a failing gate stops it", () => {
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    rmSync(join(pkg, "diagrams", "architecture.json"), { force: true });
    const cat = join(pkg, "diagrams", "catalog.html");
    rmSync(cat, { force: true });
    writeUc([uc()]);
    const sh = (...a: string[]) => spawnSync("bash", [join(DSKILL, "scripts", "render.sh"), ...a], { encoding: "utf8" });
    const ok = sh(pkg);
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("skip architecture");
    expect(ok.stdout).toContain("skip IFML");
    expect(existsSync(cat)).toBe(true);
    expect(embedded(read(cat)).viewers.ifml).toBe(true);
    rmSync(cat);
    writeUc([uc({ refs: ["BR-999"] })]);
    const bad = sh(pkg);
    writeUc([uc()]);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("BR-999");
    expect(existsSync(cat)).toBe(false);
    expect(sh().status).toBe(2);
  });

  it("build-site embeds screen plans and the style kit; refuses an orphan plan", () => {
    writeUc([uc()]);
    writeUi([screen()]);
    mkdirSync(join(pkg, "ui", "plans"), { recursive: true });
    writeFileSync(join(pkg, "ui", "plans", "SCR-order.html"), "<!doctype html><title>plan</title><script>x()</script>");
    const kit = { sources: ["css/main.css"], tokens: { color: [{ name: "--sk-c-3194ff", value: "#3194ff", uses: 4, cites: ["css/main.css:2"] }], font: [], fontSize: [], radius: [] }, components: { button: [{ selector: ".button", decls: [["color", "red"]], cite: "css/main.css:2" }] } };
    writeFileSync(join(pkg, "ui", "style-kit.json"), JSON.stringify(kit));
    const out = join(dir, "plans.html");
    const r = run(dir, "build-site", pkg, out);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const ui = embedded(read(out)).ui;
    expect(ui.plans["SCR-order"]).toContain("<title>plan</title>");
    expect(ui.styleKit.tokens.color[0].value).toBe("#3194ff");
    expect(ui.styleKit.components.button[0].cite).toBe("css/main.css:2");
    writeFileSync(join(pkg, "ui", "plans", "SCR-ghost.html"), "<p>x</p>");
    rmSync(out, { force: true });
    const bad = run(dir, "build-site", pkg, out);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("SCR-ghost");
    expect(existsSync(out)).toBe(false);
  });

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

  const ifmlUi = () =>
    writeUi(
      [
        screen({
          actions: [
            {
              id: "ACT-add",
              label: "Add",
              guards: ["BR-001"],
              effects: [
                { kind: "validate", step: "Check line", refs: ["BR-001"] },
                { kind: "write", step: "Store order" },
              ],
            },
            { id: "ACT-gone", label: 'Gone "quoted" & <tagged>', effects: [] },
          ],
          dialogs: [
            { id: "DLG-sure", kind: "confirm", message: "sure?", from: "ACT-add" },
            { id: "DLG-orphan", kind: "alert", message: "controller-level catch" },
          ],
          navigation: [{ to: "SCR-two", trigger: "open two" }],
        }),
        screen({ id: "SCR-two", kind: "modal", name: "Two", forms: [], actions: [], dialogs: [], fields: [{ key: "start", label: "Start", type: "date" }] }),
      ],
      {
        "FRM-line": {
          id: "FRM-line",
          fields: [
            { key: "qty", type: "number", conditions: [{ kind: "validation", when: "qty>0", message: "positive" }] },
            { key: "item", type: "select", conditions: [] },
          ],
        },
      },
    );

  it("ifml writes IFML 1.0 XMI that passes check-ifml", () => {
    writeUc([uc()]);
    ifmlUi();
    const out = join(dir, "model.xmi");
    const r = run(dir, "ifml", pkg, out);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const x = read(out);
    expect(x).toContain('xmlns:ifml="http://www.omg.org/spec/IFML/20140301"');
    for (const t of ["Window", "Form", "SimpleField", "SelectionField", "ValidationRule", "OnSubmitEvent", "ActivationExpression", "Action", "ActionEvent", "NavigationFlow"])
      expect(x).toContain(`xmi:type="ifml:${t}"`);
    // trace in ids, guard nested in its event, IFML-DI geometry for drawn elements
    expect(x).toContain('xmi:id="E.SCR-order.ACT-add"');
    expect(x).toMatch(/<activationExpression xmi:type="ifml:ActivationExpression" xmi:id="X\.SCR-order\.ACT-add"/);
    expect(x).toContain('xmlns:ifmldi="http://www.omg.org/spec/IFML/20130218/IFML-DI"');
    for (const id of ["W.SCR-order", "F.SCR-order.FRM-line", "P.SCR-order.FRM-line.qty", "E.SCR-order.ACT-add", "X.SCR-order.ACT-add", "A.SCR-order.ACT-add", "W.DLG-sure"])
      expect(x).toContain(`modelElement="${id}"`);
    expect(x).toMatch(/<ifmldi:IFMLConnection[^>]*modelElement="NF\.[^"]+"/);
    expect(x).toMatch(/xmi:type="ifml:Window"[^>]*name="Orders"/);
    expect(x).toMatch(/xmi:type="ifml:Window"[^>]*name="DLG-sure"[^>]*isModal="true"/);
    expect(x).toContain('body="qty&gt;0"');
    const c = run(dir, "check-ifml", out);
    expect(c.stderr).toBe("");
    expect(c.code).toBe(0);
  });

  it("ifml refuses ids that the XMI id sanitizer would alter (lossy or ambiguous trace)", () => {
    writeUc([uc()]);
    writeUi([screen({ actions: [{ id: "ACT x", label: "x", effects: [] }], dialogs: [], navigation: [], fields: [{ key: "order.date", label: "D", type: "date" }] })], {});
    const out = join(dir, "lossy.xmi");
    rmSync(out, { force: true });
    const r = run(dir, "ifml", pkg, out);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ACT x");
    expect(r.stderr).toContain("order.date");
    expect(existsSync(out)).toBe(false);
  });

  it("ifml exits 2 without a UI model; check-ifml refuses non-conforming XMI", () => {
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    const none = join(dir, "none.xmi");
    expect(run(dir, "ifml", pkg, none).code).toBe(2);
    expect(existsSync(none)).toBe(false);
    const bad = join(dir, "bad.xmi");
    writeFileSync(
      bad,
      `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20110701" xmlns:ifml="http://www.omg.org/spec/IFML/20140301">
<ifml:IFMLModel xmi:id="m" name="m"><interactionFlowModel xmi:id="f" name="f">
<interactionFlowModelElements xmi:type="ifml:Window" xmi:id="w" name="w" colour="red">
<viewElementEvents xmi:type="ifml:ViewElementEvent" xmi:id="e" name="e"><outInteractionFlows xmi:type="ifml:NavigationFlow" xmi:id="n" sourceInteractionFlowElement="e" targetInteractionFlowElement="nope"/></viewElementEvents>
<viewElements xmi:type="ifml:Frobnicator" xmi:id="x" name="x"/>
</interactionFlowModelElements></interactionFlowModel></ifml:IFMLModel></xmi:XMI>
`,
    );
    const c = run(dir, "check-ifml", bad);
    expect(c.code).toBe(1);
    for (const s of ["Frobnicator", "colour", "nope"]) expect(c.stderr).toContain(s);
    // DI elements are outside the IFML metamodel but their modelElement must resolve
    const di = join(dir, "bad-di.xmi");
    writeFileSync(
      di,
      `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:ifml="http://www.omg.org/spec/IFML/20140301" xmlns:ifmldi="http://www.omg.org/spec/IFML/20130218/IFML-DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
<ifml:IFMLModel xmi:id="m" name="m"><interactionFlowModel xmi:id="f" name="f"><interactionFlowModelElements xmi:type="ifml:Window" xmi:id="w" name="w"/></interactionFlowModel></ifml:IFMLModel>
<ifmldi:IFMLDiagram xmi:type="ifmldi:IFMLDiagram" xmi:id="d" modelElement="f"><ownedElement xmi:type="ifmldi:IFMLNode" xmi:id="w_di" modelElement="ghost"><bounds xmi:type="dc:Bounds" x="0" y="0" width="1" height="1"/></ownedElement></ifmldi:IFMLDiagram>
</xmi:XMI>
`,
    );
    const d = run(dir, "check-ifml", di);
    expect(d.code).toBe(1);
    expect(d.stderr).toContain("ghost");
    expect(d.stderr).not.toContain("IFMLNode");
  });

  it("export -> ifml-to-ui -> export preserves the IFML model", () => {
    writeUc([uc()]);
    ifmlUi();
    const first = join(dir, "rt1.xmi");
    expect(run(dir, "ifml", pkg, first).code).toBe(0);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    const r = run(dir, "ifml-to-ui", first, pkg);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const imported = JSON.parse(read(join(pkg, "ui", "screens", "SCR-order.json")));
    expect(imported).toMatchObject({ id: "SCR-order", source: "ifml" });
    expect(imported.actions.find((a: { id: string }) => a.id === "ACT-add")).toMatchObject({ label: "Add", guards: ["BR-001"] });
    expect(imported.actions.find((a: { id: string }) => a.id === "ACT-gone").label).toBe('Gone "quoted" & <tagged>');
    const d = run(dir, "ifml-diff", pkg, first);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(d.stdout).toContain("no differences");
    expect(d.code).toBe(0);
  });

  it("reads the dialect an IFML editor writes (ifml-js 0.3.0 modeler re-save: uml:name, element-valued body/isModal)", () => {
    // fixture = the ifml export of this fixture package, imported and saved unchanged by the ifml-js modeler (ifml.io engine)
    writeUc([uc()]);
    ifmlUi();
    const fx = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ifml-js-modeler-resave.xmi");
    const c = run(dir, "check-ifml", fx);
    const d = run(dir, "ifml-diff", pkg, fx);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(c.stderr).toBe("");
    expect(c.code).toBe(0);
    expect(d.stdout).toContain("no differences");
    expect(d.code).toBe(0);
  });

  it("ifml-diff reports an edited IFML file; --apply merges it and never deletes", () => {
    writeUc([uc()]);
    ifmlUi();
    const base = join(dir, "base.xmi");
    expect(run(dir, "ifml", pkg, base).code).toBe(0);
    let x = read(base);
    x = x.replace('xmi:id="E.SCR-order.ACT-add" name="Add"', 'xmi:id="E.SCR-order.ACT-add" name="Add line"');
    x = x.replace('xmi:id="A.SCR-order.ACT-add" name="Add"', 'xmi:id="A.SCR-order.ACT-add" name="Add line"');
    x = x.replace('body="BR-001"', 'body="BR-001 AND GAP-003"');
    x = x.replace(
      /(<interactionFlowModelElements xmi:type="ifml:Window" xmi:id="W\.SCR-two"[^>]*>)/,
      '$1\n<viewElementEvents xmi:type="ifml:ViewElementEvent" xmi:id="Event_new1" name="Print"/>\n<actions xmi:type="ifml:Action" xmi:id="Action_new1" name="Print sheet"><actionEvents xmi:type="ifml:ActionEvent" xmi:id="AE_new1" name="done"/></actions>',
    );
    x = x.replace("</interactionFlowModel>", '<interactionFlowModelElements xmi:type="ifml:NavigationFlow" xmi:id="NF_new1" sourceInteractionFlowElement="Event_new1" targetInteractionFlowElement="Action_new1"/>\n</interactionFlowModel>');
    x = x.replace(/<viewElementEvents xmi:type="ifml:ViewElementEvent" xmi:id="E\.SCR-order\.ACT-gone"[^>]*\/>/, "");
    x = x.replace(/<viewElementEvents xmi:type="ifml:ViewElementEvent" xmi:id="E\.SCR-order\.ACT-gone"[\s\S]*?<\/viewElementEvents>/, "");
    expect(x).not.toContain('xmi:id="E.SCR-order.ACT-gone"');
    const edited = join(dir, "edited.xmi");
    writeFileSync(edited, x);
    const d = run(dir, "ifml-diff", pkg, edited);
    expect(d.code).toBe(1);
    for (const s of ["A.SCR-order.ACT-add", "Add line", "GAP-003", "Event_new1", "Print sheet", "E.SCR-order.ACT-gone", "removed"]) expect(d.stdout).toContain(s);
    const a = run(dir, "ifml-diff", pkg, edited, "--apply");
    expect(a.stderr).toBe("");
    const order = JSON.parse(read(join(pkg, "ui", "screens", "s0.json")));
    const add = order.actions.find((q: { id: string }) => q.id === "ACT-add");
    expect(add).toMatchObject({ label: "Add line", guards: ["BR-001", "GAP-003"] });
    expect(add.effects.map((e: { step: string }) => e.step)).toEqual(["Check line", "Store order"]);
    expect(order.actions.some((q: { id: string }) => q.id === "ACT-gone")).toBe(true);
    const two = JSON.parse(read(join(pkg, "ui", "screens", "s1.json")));
    expect(two.actions[0]).toMatchObject({ label: "Print", source: "ifml" });
    const again = run(dir, "ifml-diff", pkg, edited);
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(again.stdout).toContain("E.SCR-order.ACT-gone");
    expect(again.stdout).not.toContain("Add line");
    expect(again.stdout).not.toContain("Print sheet");
  });

  it("ifml-diff --apply changes validation rules of screen template fields, not only form fields", () => {
    writeUc([uc()]);
    writeUi([screen({ forms: [], actions: [], dialogs: [], navigation: [], fields: [{ key: "start", label: "Start", type: "date", conditions: [{ kind: "validation", when: "start!=null" }] }] })], {});
    const base = join(dir, "tpl.xmi");
    expect(run(dir, "ifml", pkg, base).code).toBe(0);
    const x = read(base).replace('body="start!=null"', 'body="start&gt;today"');
    expect(x).toContain("start&gt;today");
    const edited = join(dir, "tpl-edited.xmi");
    writeFileSync(edited, x);
    const a = run(dir, "ifml-diff", pkg, edited, "--apply");
    const rec = JSON.parse(read(join(pkg, "ui", "screens", "s0.json")));
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(a.stderr).toBe("");
    expect(rec.fields[0].conditions).toEqual([{ kind: "validation", when: "start>today" }]);
  });

  it("build-site embeds the IFML model and XMI; use cases list actions from ui: lines of alternate flows", () => {
    ifmlUi();
    writeFileSync(
      join(pkg, "diagrams", "bpmn", "add", "code.bpmn"),
      "<bpmn:definitions><bpmn:userTask id='T' name='Add'><bpmn:documentation>BR-001\nui: SCR-order#ACT-add</bpmn:documentation></bpmn:userTask></bpmn:definitions>",
    );
    writeUc([uc({ screens: ["SCR-order"], altFlows: [{ label: "from code", bpmn: "bpmn/add/code.bpmn" }] })]);
    const out = join(dir, "site-ifml.html");
    const r = run(dir, "build-site", pkg, out);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const data = embedded(read(out));
    expect(data.ifml.elements.some((e: { type: string; trace: { screen?: string } }) => e.type === "Window" && e.trace.screen === "SCR-order")).toBe(true);
    expect(data.ifml.flows.length).toBeGreaterThan(0);
    expect(data.ifmlXmi.startsWith("<?xml")).toBe(true);
    expect(data.useCases[0].uiActions).toEqual(["SCR-order#ACT-add"]);
    writeFileSync(join(pkg, "diagrams", "bpmn", "add", "code.bpmn"), "<bpmn:definitions><bpmn:documentation>ui: SCR-order#ACT-nope</bpmn:documentation></bpmn:definitions>");
    const bad = run(dir, "build-site", pkg, join(dir, "site-ifml-bad.html"));
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("ACT-nope");
  });

  it("build-site inlines the IFML viewer", () => {
    writeUc([uc()]);
    ifmlUi();
    writeFileSync(join(dir, "fake-ifml.js"), "window.FAKE_IFML_LIB=1;");
    writeFileSync(join(dir, "fake-ifml.css"), ".fake-ifml-css{}");
    const out = join(dir, "site-ifmljs.html");
    const r = run(dir, "build-site", pkg, out, "--ifml-js", "fake-ifml.js", "--ifml-css", "fake-ifml.css");
    rmSync(join(pkg, "ui"), { recursive: true, force: true });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const html = read(out);
    for (const s of ["window.FAKE_IFML_LIB=1;", ".fake-ifml-css{}"]) expect(html).toContain(s);
    expect(embedded(html).viewers.ifml).toBe(true);
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
    expect(embedded(html).viewers).toEqual({ bpmn: true, mermaid: true, ifml: false });
  });

  // ---------- architecture (C4 / C5) ----------
  const archModel = (over: { elements?: unknown[]; relations?: unknown[] } = {}) => ({
    elements: [
      { id: "planner", kind: "person", name: "Planner", refs: ["UC-01"] },
      { id: "app", kind: "system", name: "Plantifier" },
      { id: "erp", kind: "system", name: "ERP", external: true },
      { id: "ui", kind: "container", name: "Desktop app", parent: "app", tech: "HTA + AngularJS", cites: ["js/order.js:1-9"] },
      { id: "db", kind: "container", name: "Database", parent: "app", tech: "MS SQL" },
      { id: "ordermod", kind: "component", name: "Order screen", parent: "ui", refs: ["BR-001", "cap:orders", "spec:orders#Add single and unique orders"], cites: ["js/order.js:3"] },
      { id: "erpcon", kind: "component", name: "ERP connector", parent: "ui" },
      { id: "ws", kind: "node", name: "Windows workstation", hosts: ["ui"] },
      { id: "srv", kind: "node", name: "DB server", hosts: ["db"] },
      ...(over.elements ?? []),
    ],
    relations: [
      { from: "planner", to: "ordermod", label: "adds orders" },
      { from: "ordermod", to: "db", label: "stores orders", tech: "ODBC" },
      { from: "erpcon", to: "erp", label: "imports orders" },
      { from: "ordermod", to: "erpcon", label: "asks for ERP orders" },
      ...(over.relations ?? []),
    ],
  });
  const writeArch = (m: unknown) => writeFileSync(join(pkg, "diagrams", "architecture.json"), JSON.stringify(m));
  const appDir = () => {
    const a = join(dir, "archapp");
    mkdirSync(join(a, "js"), { recursive: true });
    writeFileSync(join(a, "js", "order.js"), `${Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n")}\n`);
    return a;
  };

  it("check-architecture passes a valid model and refuses a broken one", () => {
    writeUc([uc()]);
    writeArch(archModel());
    const ok = run(dir, "check-architecture", pkg, "--app", appDir());
    expect(ok.stderr).toBe("");
    expect(ok.code).toBe(0);
    writeArch(
      archModel({
        elements: [
          { id: "badcomp", kind: "component", name: "Bad", parent: "app" },
          { id: "badnode", kind: "node", name: "N", hosts: ["ordermod"] },
          { id: "badref", kind: "container", name: "R", parent: "app", refs: ["BR-999"], cites: ["js/order.js:99"] },
          { id: "ui", kind: "container", name: "dup", parent: "app" },
          { id: "zeroline", kind: "container", name: "Z", parent: "app", cites: ["js/order.js:0"] },
          { id: "reversed", kind: "container", name: "Rv", parent: "app", cites: ["js/order.js:9-2"] },
          { id: "cyc1", kind: "node", name: "C1", parent: "cyc2" },
          { id: "cyc2", kind: "node", name: "C2", parent: "cyc1" },
          { id: "api-v1", kind: "container", name: "A1", parent: "app" },
          { id: "api_v1", kind: "container", name: "A2", parent: "app" },
        ],
        relations: [{ from: "planner", to: "ghost", label: "x" }],
      }),
    );
    const bad = run(dir, "check-architecture", pkg, "--app", appDir());
    expect(bad.code).toBe(1);
    for (const x of ["badcomp", "badnode", "ordermod", "BR-999", "js/order.js:99", "duplicate", "ghost"]) expect(bad.stderr).toContain(x);
    expect(bad.stderr).toMatch(/zeroline.*js\/order\.js:0/);
    expect(bad.stderr).toMatch(/reversed.*js\/order\.js:9-2/);
    expect(bad.stderr).toMatch(/cyc1.*cycle/);
    expect(bad.stderr).toMatch(/api_v1.*api-v1|api-v1.*api_v1/);
    const out = join(dir, "arch-bad.html");
    rmSync(out, { force: true });
    expect(run(dir, "build-site", pkg, out).code).toBe(1);
    expect(existsSync(out)).toBe(false);
    rmSync(join(pkg, "diagrams", "architecture.json"));
  });

  it("arch writes Structurizr DSL and Mermaid C4", () => {
    writeUc([uc()]);
    writeArch(archModel());
    const out = join(dir, "archout");
    const r = run(dir, "arch", pkg, out);
    rmSync(join(pkg, "diagrams", "architecture.json"));
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const dsl = read(join(out, "workspace.dsl"));
    for (const x of ["workspace", "person", "softwareSystem", "container", "component", "deploymentNode", "containerInstance", "systemContext", "views"]) expect(dsl).toContain(x);
    expect(dsl).not.toContain("theme default");
    const c4 = read(join(out, "c4.md"));
    expect(c4).toContain("C4Context");
    expect(c4).toContain("C4Container");
  });

  it("build-site embeds the architecture with lifted C4/C5 views, none without the file", () => {
    writeUc([uc()]);
    writeArch(archModel());
    const out = join(dir, "arch.html");
    const r = run(dir, "build-site", pkg, out);
    rmSync(join(pkg, "diagrams", "architecture.json"));
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const a = embedded(read(out)).arch;
    expect(a.model.elements).toHaveLength(9);
    expect(a.dsl).toContain("workspace");
    const view = (id: string) => a.views.find((v: { id: string }) => v.id === id);
    for (const id of ["c4-context", "c4-container", "c4-component:ui", "c4-deployment", "c5"]) expect(view(id)?.mermaid, id).toMatch(/^flowchart/);
    const pairs = (id: string) => view(id).edges.map((e: { from: string; to: string }) => `${e.from}>${e.to}`);
    // component -> external lifted to system -> external, once; no self-loop from component -> component
    expect(pairs("c4-context").filter((p: string) => p === "app>erp")).toHaveLength(1);
    expect(pairs("c4-context")).toContain("planner>app");
    expect(pairs("c4-context")).not.toContain("app>app");
    expect(pairs("c4-container")).toContain("ui>db");
    expect(pairs("c4-container")).not.toContain("ui>ui");
    expect(pairs("c4-component:ui")).toContain("erpcon>erp");
    expect(pairs("c4-component:ui")).toContain("ordermod>db");
    expect(pairs("c5")).toContain("ws>ui");
    // a container hosted on two nodes appears in both (one instance per node), both open the container
    writeArch(archModel({ elements: [{ id: "ws2", kind: "node", name: "Second PC", hosts: ["ui"] }] }));
    expect(run(dir, "build-site", pkg, out).code).toBe(0);
    rmSync(join(pkg, "diagrams", "architecture.json"));
    const dep = embedded(read(out)).arch.views.find((v: { id: string }) => v.id === "c4-deployment");
    expect(Object.values(dep.nodes).filter((x) => x === "ui")).toHaveLength(2);
    const none = join(dir, "noarch.html");
    expect(run(dir, "build-site", pkg, none).code).toBe(0);
    expect(embedded(read(none)).arch).toBeNull();
  });
});

describe("behaviour diagrams (sequence, collaboration, state machine, object)", () => {
  let pkg: string;
  let app: string;
  const BMODEL = MODEL.replace(
    "- `note` — string; optional, nullable.\n  <!-- cite: ref=js/order.js:4, confidence=inferred -->",
    "- `note` — string; optional, nullable.\n  <!-- cite: ref=js/order.js:4, confidence=inferred -->\n- `status` — string; required; allowed: 'open', 'closed', 'cancelled'; default: 'open' (BR-001).\n  <!-- cite: ref=js/order.js:5, confidence=confirmed -->",
  );
  const put = (rel: string, v: unknown) => {
    mkdirSync(dirname(join(pkg, rel)), { recursive: true });
    writeFileSync(join(pkg, rel), typeof v === "string" ? v : JSON.stringify(v));
  };
  const clear = (rel: string) => rmSync(join(pkg, rel), { recursive: true, force: true });
  const sm = (over: Record<string, unknown> = {}) => ({
    id: "SM-order-status",
    entity: "Order",
    field: "status",
    title: "Order status",
    states: [
      { id: "open", value: "open", initial: true },
      { id: "closed", value: "closed", final: true },
      { id: "cancelled", value: "cancelled", final: true },
    ],
    transitions: [
      { from: "open", to: "closed", trigger: "ship", guard: "all lines shipped", refs: ["BR-001"], cite: "js/order.js:5" },
      { from: "open", to: "cancelled", trigger: "cancel", refs: ["QUIRK-002"], cite: "js/order.js:6-7" },
    ],
    ...over,
  });

  beforeAll(() => {
    pkg = join(dir, "behpkg");
    app = join(dir, "behapp");
    mkdirSync(join(app, "js"), { recursive: true });
    writeFileSync(join(app, "js", "order.js"), "x\n".repeat(30));
    writeFileSync(join(app, "js", "data.js"), "x\n".repeat(30));
    put("model.md", BMODEL);
    put("rules.md", "# Business rules\n\n## BR-001\n- Class: explicit\n- Statement: Order id is required.\n- Capabilities: orders\n");
    put("quirks.md", "# Quirks\n\n## QUIRK-002 Odd\n- Observed: x\n");
    put("gaps.md", "# Gaps\n\n## GAP-003 Unknown\n- Unknown: y\n");
    put("capabilities/orders/spec.md", "# orders\n\n## Requirements\n### Requirement: Add single and unique orders\nThe screen SHALL add (BR-001).\n");
    put("diagrams/er/orders.json", goodEr);
    put("diagrams/use-cases.json", []);
    put("diagrams/architecture.json", {
      elements: [
        { id: "planner", kind: "person", name: "Planner", cites: ["js/order.js:1"] },
        { id: "app", kind: "system", name: "App", cites: ["js/order.js:1"] },
        { id: "client", kind: "container", parent: "app", name: "Client", cites: ["js/order.js:1"] },
        { id: "c_order", kind: "component", parent: "client", name: "Order screen", cites: ["js/order.js:1-30"] },
        { id: "c_data", kind: "component", parent: "client", name: "Data service", cites: ["js/data.js:1"] },
      ],
      relations: [{ from: "c_order", to: "c_data", label: "stores via" }],
    });
    put("ui/screens/s0.json", {
      id: "SCR-order",
      kind: "route",
      name: "Orders",
      template: "html/order.htm",
      scope: [],
      forms: [],
      actions: [
        {
          id: "ACT-add",
          label: "Add",
          trigger: { kind: "ng-click", cite: "js/order.js:2" },
          handler: { name: "add", cite: "js/order.js:3-9" },
          guards: ["BR-001"],
          effects: [
            { kind: "validate", step: "Check line", target: "line.correct()", cite: "js/order.js:4", refs: ["BR-001"] },
            { kind: "write", step: "Store order", target: "data.add (data layer boundary)", cite: "js/data.js:10-12; js/order.js:6", refs: ["QUIRK-002"] },
            { kind: "notify", step: "Report error", target: "alertE", cite: "js/order.js:8" },
          ],
        },
      ],
      dialogs: [],
    });
  });

  it("sequence-from-ui drafts a gated sequence: guard alt, lifelines by cite file; collaboration numbers messages", () => {
    const out = join(pkg, "diagrams", "sequences", "SEQ-add.json");
    const r = run(dir, "sequence-from-ui", pkg, "SCR-order#ACT-add", out);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const seq = JSON.parse(read(out));
    expect(seq.action).toBe("SCR-order#ACT-add");
    expect(seq.participants.map((p: { id: string }) => p.id)).toEqual(["user", "SCR-order", "c_data"]);
    expect(seq.participants[2]).toMatchObject({ kind: "element", ref: "c_data" });
    expect(seq.messages[0]).toMatchObject({ from: "user", to: "SCR-order", label: "Add", cite: "js/order.js:2" });
    const alt = seq.messages[1];
    expect(alt).toMatchObject({ fragment: "alt", refs: ["BR-001"] });
    expect(alt.messages.map((m: { to: string; label: string }) => `${m.to}:${m.label}`)).toEqual(["SCR-order:Check line", "c_data:Store order", "user:Report error"]);
    expect(alt.else.messages[0]).toMatchObject({ from: "SCR-order", to: "user", refs: ["BR-001"] });
    expect(alt.messages[1].cite).toBe("js/data.js:10-12");
    expect(run(dir, "check-sequences", pkg, "--app", app).code).toBe(0);
    const site = join(dir, "beh.html");
    const b = run(dir, "build-site", pkg, site);
    expect(b.stderr).toBe("");
    const beh = embedded(read(site)).behaviour;
    expect(beh.sequences[0].mermaid).toMatch(/^sequenceDiagram/);
    expect(beh.sequences[0].mermaid).toContain("alt ");
    expect(beh.sequences[0].mermaid).toContain("else ");
    expect(beh.sequences[0].collab.mermaid).toMatch(/^flowchart/);
    expect(beh.sequences[0].collab.mermaid).toContain("3: Store order");
  });

  it("check-sequences refuses unknown participants, refs, actions and bad cites", () => {
    put("diagrams/sequences/SEQ-bad.json", {
      id: "SEQ-bad",
      title: "bad",
      useCase: "UC-77",
      action: "SCR-order#ACT-nope",
      participants: [{ id: "user", kind: "actor" }, { id: "x", kind: "element", ref: "c_ghost" }],
      messages: [
        { from: "user", to: "ghost", label: "hi", cite: "js/order.js:2" },
        { fragment: "loop", label: "each", messages: [{ from: "user", to: "x", label: "go", refs: ["BR-999"], cite: "js/order.js:99" }] },
      ],
    });
    const r = run(dir, "check-sequences", pkg, "--app", app);
    clear("diagrams/sequences/SEQ-bad.json");
    expect(r.code).toBe(1);
    for (const s of ["SEQ-bad", "ghost", "c_ghost", "UC-77", "ACT-nope", "BR-999", "past end"]) expect(r.stderr).toContain(s);
  });

  it("check-states passes a valid machine (Mermaid + SCXML) and refuses each defect", () => {
    put("diagrams/state-machines/SM-order-status.json", sm());
    expect(run(dir, "check-states", pkg, "--app", app).stderr).toBe("");
    const outDir = join(dir, "behout");
    const x = run(dir, "behaviour", pkg, outDir);
    expect(x.code).toBe(0);
    const mmd = read(join(outDir, "SM-order-status.mmd"));
    expect(mmd).toMatch(/^stateDiagram-v2/);
    expect(mmd).toContain("[*] --> open");
    expect(mmd).toContain("open --> closed : ship [all lines shipped]");
    expect(mmd).toContain("closed --> [*]");
    const long = "x".repeat(80);
    const states = sm().states.map((x, i) => (i === 1 ? { ...x, label: long } : x));
    put("diagrams/state-machines/SM-order-status.json", sm({ states, transitions: [...sm().transitions, { from: "closed", to: "open", trigger: long, guard: long, cite: "js/order.js:5" }] }));
    run(dir, "behaviour", pkg, outDir);
    const clipped = read(join(outDir, "SM-order-status.mmd"));
    expect(clipped).toContain(`closed --> open : ${"x".repeat(39)}… [${"x".repeat(39)}…]`);
    expect(read(join(outDir, "SM-order-status.scxml"))).toContain(`cond="${long}"`);
    expect(clipped).toContain(`state "${"x".repeat(39)}…" as closed`);
    put("diagrams/state-machines/SM-order-status.json", sm({ transitions: [...sm().transitions, { from: "closed", to: "open", trigger: "reload (data.js:1024)", cite: "js/order.js:5" }] }));
    run(dir, "behaviour", pkg, outDir);
    expect(read(join(outDir, "SM-order-status.mmd"))).toContain("closed --> open : reload (data.js꞉1024)");
    put("diagrams/state-machines/SM-order-status.json", sm());
    const scxml = read(join(outDir, "SM-order-status.scxml"));
    expect(scxml).toContain('<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="open"');
    expect(scxml).toContain('<transition event="ship" target="closed" cond="all lines shipped"/>');
    expect(scxml).toContain('<final id="cancelled"');
    expect(existsSync(join(outDir, "SEQ-add.mmd"))).toBe(true);
    const bad = sm({
      id: "SM-bad",
      field: "colour",
      states: [
        { id: "open", value: "open", initial: true },
        { id: "gone", value: "vanished", initial: true },
        { id: "lost", value: "closed" },
      ],
      transitions: [
        { from: "open", to: "nowhere", trigger: "x", cite: "js/order.js:5" },
        { from: "open", to: "open", trigger: "y", refs: ["GAP-404"] },
      ],
    });
    put("diagrams/state-machines/SM-bad.json", bad);
    put("diagrams/state-machines/SM-bad2.json", sm({ id: "SM-bad2", states: [{ id: "open", value: "open", initial: true }, { id: "odd", value: "vanished" }], transitions: [] }));
    const r = run(dir, "check-states", pkg);
    clear("diagrams/state-machines/SM-bad.json");
    clear("diagrams/state-machines/SM-bad2.json");
    expect(r.code).toBe(1);
    for (const s of ["SM-bad: unknown field Order.colour", "2 initial states", "unknown state nowhere", "no cite", "GAP-404", "lost: unreachable", "SM-bad2: state odd: value vanished not among allowed values of Order.status"])
      expect(r.stderr).toContain(s);
  });

  it("objects-synth generates a gated object diagram; check-objects refuses bad attrs, links and multiplicity", () => {
    const out = join(pkg, "diagrams", "objects", "OBJ-order.json");
    const r = run(dir, "objects-synth", pkg, "Order", out);
    expect(r.stderr).toBe("");
    const o = JSON.parse(read(out));
    expect(o.source).toBe("synthetic");
    const order = o.objects.find((x: { entity: string }) => x.entity === "Order");
    expect(order.attrs.status).toBe("open");
    const lines = o.objects.filter((x: { entity: string }) => x.entity === "OrderLine");
    expect(lines).toHaveLength(2);
    expect(lines[0].attrs.order_id).toBe(order.attrs.order_id);
    expect(o.links).toHaveLength(2);
    expect(run(dir, "check-objects", pkg).code).toBe(0);
    put("diagrams/er/one.json", { entities: [{ name: "OpBar", fields: [{ name: "unique" }] }], relations: [{ from: "Order", to: "OpBar", cardinality: "1:1", label: "has", confidence: "inferred", evidence: "none" }] });
    const one = join(dir, "OBJ-one.json");
    expect(run(dir, "objects-synth", pkg, "Order", one).stderr).toBe("");
    clear("diagrams/er/one.json");
    const oo = JSON.parse(read(one)).objects;
    expect(oo.filter((x: { entity: string }) => x.entity === "OpBar")).toHaveLength(1);
    expect(oo.filter((x: { entity: string }) => x.entity === "OrderLine")).toHaveLength(2);
    put("diagrams/objects/OBJ-bad.json", {
      id: "OBJ-bad",
      title: "bad",
      source: "synthetic",
      objects: [
        { id: "o1", entity: "Order", attrs: { colour: "red" } },
        { id: "o2", entity: "Order", attrs: {} },
        { id: "l1", entity: "OrderLine", attrs: {} },
        { id: "x", entity: "Invoice", attrs: {} },
      ],
      links: [
        { from: "o1", to: "l1" },
        { from: "o2", to: "l1" },
        { from: "o1", to: "o2" },
      ],
    });
    const bad = run(dir, "check-objects", pkg);
    clear("diagrams/objects/OBJ-bad.json");
    expect(bad.code).toBe(1);
    for (const s of ["OBJ-bad: o1: Order has no field colour", "x: unknown entity Invoice", "link o1-o2: no ER relation Order-Order", "l1: more than one Order"])
      expect(bad.stderr).toContain(s);
  });

  it("objects-from-db masks every non-kept value, gates joins, and stays local unless --local", () => {
    const db = join(dir, "snap_db.json");
    writeFileSync(db, JSON.stringify({
      ord: [{ ID: "A-17", NOTE: "ACME secret", ST: "open" }, { ID: "B-2", NOTE: "other", ST: "closed" }],
      lin: [{ LID: "L1", OID: "A-17" }, { LID: "L2", OID: "A-17" }, { LID: "L3", OID: "B-2" }],
    }));
    const job = join(dir, "objjob.json");
    const jobBody = {
      title: "Order A from snapshot",
      source: db,
      tables: { Order: "ord", OrderLine: "lin" },
      columns: { Order: { order_id: "ID", note: "NOTE", status: "ST" }, OrderLine: { line_id: "LID", order_id: "OID" } },
      joins: [{ from: "Order", fk: "ID", to: "OrderLine", key: "OID" }],
      seed: { entity: "Order", index: 0 },
      depth: 2,
      keep: ["status"],
    };
    writeFileSync(job, JSON.stringify(jobBody));
    const out = join(pkg, "_local", "objects", "OBJ-real.json");
    const r = run(dir, "objects-from-db", pkg, job, out);
    expect(r.stderr).toBe("");
    const text = read(out);
    for (const secret of ["A-17", "ACME", "L1", "L2", "B-2"]) expect(text).not.toContain(secret);
    const o = JSON.parse(text);
    expect(o.masked).toBe(true);
    const order = o.objects.find((x: { entity: string }) => x.entity === "Order");
    expect(order.attrs.status).toBe("open");
    const lines = o.objects.filter((x: { entity: string }) => x.entity === "OrderLine");
    expect(lines).toHaveLength(2);
    expect(lines[0].attrs.order_id).toBe(order.attrs.order_id);
    const site = join(dir, "beh2.html");
    run(dir, "build-site", pkg, site);
    expect(embedded(read(site)).behaviour.objects.map((x: { id: string }) => x.id)).not.toContain("OBJ-real");
    expect(run(dir, "build-site", pkg, site, "--local").stderr).toBe("");
    const local = embedded(read(site)).behaviour.objects.find((x: { id: string }) => x.id === "OBJ-real");
    expect(local.local).toBe(true);
    writeFileSync(job, JSON.stringify({ ...jobBody, joins: [{ from: "Order", fk: "ID", to: "Order", key: "ID" }] }));
    const bad = run(dir, "objects-from-db", pkg, job, join(dir, "x.json"));
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("join Order.ID -> Order.ID: no ER relation Order-Order");
    expect(bad.stderr).not.toContain("A-17");
  });

  it("build-site embeds behaviour backlink data: refs, entities, use cases and actions", () => {
    put("diagrams/state-machines/SM-order-status.json", sm());
    const site = join(dir, "beh3.html");
    const b = run(dir, "build-site", pkg, site);
    expect(b.stderr).toBe("");
    const beh = embedded(read(site)).behaviour;
    const m = beh.states.find((x: { id: string }) => x.id === "SM-order-status");
    expect(m.refs).toEqual(["BR-001", "QUIRK-002"]);
    expect(m.scxml).toContain("<scxml");
    const seq = beh.sequences.find((x: { id: string }) => x.id === "SEQ-add");
    expect(seq.refs).toEqual(["BR-001", "QUIRK-002"]);
    expect(seq.entities).toEqual([]);
    put("diagrams/state-machines/SM-bad.json", sm({ id: "SM-bad", refs: undefined, transitions: [{ from: "open", to: "closed", trigger: "x", refs: ["BR-999"], cite: "js/order.js:5" }] }));
    rmSync(site);
    const bad = run(dir, "build-site", pkg, site);
    clear("diagrams/state-machines/SM-bad.json");
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("BR-999");
    expect(existsSync(site)).toBe(false);
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

describe("catalog.js screen plans stay sandboxed", () => {
  it("openPlan wraps the plan in a sandboxed srcdoc frame instead of opening it with the catalog origin", () => {
    const js = read(join(DSKILL, "templates", "catalog.js"));
    const body = js.slice(js.indexOf("function openPlan("), js.indexOf("\n  }\n", js.indexOf("function openPlan(")));
    expect(body).not.toMatch(/new Blob\(\[UI\.plans\[sid\]\]/);
    expect(body).toMatch(/<iframe sandbox="allow-scripts" srcdoc="\$\{esc\(UI\.plans\[sid\]/);
    expect(body).not.toContain("allow-same-origin");
  });
});
