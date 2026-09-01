#!/usr/bin/env node
// Emits a Hungarian multi-file demo package (a worked example and the §10
// end-to-end fixture): a user task + form, a business-rule task + decision, a
// call activity + sub-process, and a second participant pool, plus a role.
//
//   node scripts/demo.mjs [targetDir]
// Then: node scripts/generate-cli.mjs <targetDir>   (layout + validate)

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
function defs(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions ${NS} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">\n${inner}\n</bpmn:definitions>\n`;
}
function proc(id, nodes, flows) {
  const inc = {}, out = {};
  for (const [f, s, tg] of flows) { (out[s] ||= []).push(f); (inc[tg] ||= []).push(f); }
  const body = nodes.map(([type, nid, name]) => {
    const io = `${(inc[nid] || []).map((f) => `<bpmn:incoming>${f}</bpmn:incoming>`).join('')}${(out[nid] || []).map((f) => `<bpmn:outgoing>${f}</bpmn:outgoing>`).join('')}`;
    return `    <bpmn:${type} id="${nid}"${name ? ` name="${name}"` : ''}>${io}</bpmn:${type}>`;
  }).join('\n');
  const seq = flows.map(([f, s, tg]) => `    <bpmn:sequenceFlow id="${f}" sourceRef="${s}" targetRef="${tg}"/>`).join('\n');
  return `  <bpmn:process id="${id}" isExecutable="false">\n${body}\n${seq}\n  </bpmn:process>`;
}

export function emitDemo(dir) {
  mkdirSync(join(dir, 'decisions'), { recursive: true });
  mkdirSync(join(dir, 'forms'), { recursive: true });
  mkdirSync(join(dir, 'subprocesses'), { recursive: true });
  mkdirSync(join(dir, 'pools'), { recursive: true });

  // entry: Rendelés kezelése
  writeFileSync(join(dir, 'main.bpmn'), defs(proc('Process_rendeles', [
    ['startEvent', 'Start_beerkezes', 'Beérkezés'],
    ['userTask', 'Task_rendeles_rogzitese', 'Rendelés rögzítése'],
    ['businessRuleTask', 'Rule_arazas', 'Árazás'],
    ['callActivity', 'Call_visszaterites', 'Visszatérítés'],
    ['exclusiveGateway', 'Gateway_dontes', 'Elfogadva?'],
    ['endEvent', 'End_kesz', 'Kész'],
    ['endEvent', 'End_elutasitva', 'Elutasítva'],
  ], [
    ['Flow_1', 'Start_beerkezes', 'Task_rendeles_rogzitese'],
    ['Flow_2', 'Task_rendeles_rogzitese', 'Rule_arazas'],
    ['Flow_3', 'Rule_arazas', 'Gateway_dontes'],
    ['Flow_4', 'Gateway_dontes', 'Call_visszaterites'],
    ['Flow_5', 'Call_visszaterites', 'End_elutasitva'],
    ['Flow_6', 'Gateway_dontes', 'End_kesz'],
  ])));

  // sub-process reached by the call activity
  writeFileSync(join(dir, 'subprocesses', 'refund.bpmn'), defs(proc('Process_visszaterites', [
    ['startEvent', 'Start_v', 'Kezdés'],
    ['serviceTask', 'Service_utalas', 'Utalás indítása'],
    ['endEvent', 'End_v', 'Vége'],
  ], [
    ['Flow_v1', 'Start_v', 'Service_utalas'],
    ['Flow_v2', 'Service_utalas', 'End_v'],
  ])));

  // second participant pool: Raktár
  writeFileSync(join(dir, 'pools', 'shop.bpmn'), defs(proc('Process_raktar', [
    ['startEvent', 'Start_r', 'Rendelés'],
    ['userTask', 'Task_osszekeszites', 'Összekészítés'],
    ['endEvent', 'End_r', 'Kiszállítva'],
  ], [
    ['Flow_r1', 'Start_r', 'Task_osszekeszites'],
    ['Flow_r2', 'Task_osszekeszites', 'End_r'],
  ])));

  // single-decision DMN (needs no DI to render in the decision-table view)
  writeFileSync(join(dir, 'decisions', 'arazas.dmn'), `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="Def_arazas" name="Árazás" namespace="http://camunda.org/dmn">
  <decision id="Decision_arazas" name="Árazás">
    <decisionTable id="DT_arazas" hitPolicy="UNIQUE">
      <input id="in1" label="Összeg"><inputExpression id="ie1" typeRef="number"><text>osszeg</text></inputExpression></input>
      <output id="out1" label="Kedvezmény" typeRef="number"/>
      <rule id="r1"><inputEntry id="i1"><text>&lt; 10000</text></inputEntry><outputEntry id="o1"><text>0</text></outputEntry></rule>
      <rule id="r2"><inputEntry id="i2"><text>&gt;= 10000</text></inputEntry><outputEntry id="o2"><text>5</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>
`);

  // form schema (structural JSON object)
  writeFileSync(join(dir, 'forms', 'rendeles.form'), JSON.stringify({
    type: 'object',
    title: 'Rendelés rögzítése',
    components: [
      { key: 'nev', type: 'textfield', label: 'Név' },
      { key: 'osszeg', type: 'number', label: 'Összeg' },
    ],
  }, null, 2));

  // manifest
  writeFileSync(join(dir, 'package.yaml'), `name: Rendelés kezelése
entry: main.bpmn
bindings:
  - kind: form
    ref: forms/rendeles.form
    element: Task_rendeles_rogzitese
    name: Rendelés rögzítése
  - kind: decision
    ref: decisions/arazas.dmn
    element: Rule_arazas
    name: Árazás
  - kind: process
    ref: subprocesses/refund.bpmn
    element: Call_visszaterites
    name: Visszatérítés
  - kind: participant
    ref: pools/shop.bpmn
    name: Raktár
roles:
  - element: Task_rendeles_rogzitese
    role: Ügyfélszolgálat
    name: Rendelés rögzítése
`);

  return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || mkdtempSync(join(tmpdir(), 'bpmn-demo-'));
  emitDemo(dir);
  console.log(dir);
}
