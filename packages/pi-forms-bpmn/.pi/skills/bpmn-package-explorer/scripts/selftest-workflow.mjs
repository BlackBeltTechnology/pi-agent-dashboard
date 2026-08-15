// §8 workflow self-tests.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from './harness.mjs';
import { emitDemo } from './demo.mjs';
import { buildPackage, prepareStandalone, WorkflowError } from './generate.mjs';
import { assembleStandalone } from './render.mjs';

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
function tmp() { return mkdtempSync(join(tmpdir(), 'wf-')); }

await t('8.1 buildPackage lays out and validates the demo package', async () => {
  const dir = tmp(); emitDemo(dir);
  const { validation, laidOut } = await buildPackage(dir);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.ok(laidOut.some((x) => x.laidOut)); // at least one file laid out
  assert.ok(readFileSync(join(dir, 'main.bpmn'), 'utf8').includes('BPMNDiagram'));
});
await t('8.2 an envelope violation aborts the pipeline loudly', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'package.yaml'), 'name: A\nentry: main.bpmn\n');
  writeFileSync(join(dir, 'main.bpmn'), `<bpmn:definitions ${NS}><bpmn:process id="P"><bpmn:subProcess id="S"><bpmn:task id="T"/></bpmn:subProcess></bpmn:process></bpmn:definitions>`);
  await assert.rejects(() => buildPackage(dir), (e) => e instanceof WorkflowError && e.stage === 'envelope');
});
await t('8.2 manifest validation failure stops before serving', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'package.yaml'), 'name: A\nentry: main.bpmn\nbindings:\n  - kind: decision\n    ref: missing.dmn\n    element: Rule_x\n');
  writeFileSync(join(dir, 'main.bpmn'), `<bpmn:definitions ${NS}><bpmn:process id="P"><bpmn:businessRuleTask id="Rule_x" name="X"/></bpmn:process></bpmn:definitions>`);
  const { validation } = await buildPackage(dir);
  assert.equal(validation.ok, false);
});
await t('8.4 standalone .bpmn with DI renders as authored (no layout call)', async () => {
  const dir = tmp();
  const p = join(dir, 'diagram.bpmn');
  writeFileSync(p, `<bpmn:definitions ${NS} xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"><bpmn:process id="P"><bpmn:task id="Activity_a" name="A"/></bpmn:process><bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane id="pl" bpmnElement="P"><bpmndi:BPMNShape id="s" bpmnElement="Activity_a"><dc:Bounds x="10" y="10" width="100" height="80"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`);
  const before = readFileSync(p, 'utf8');
  const prep = await prepareStandalone(p);
  assert.equal(prep.mode, 'advisory');
  assert.equal(readFileSync(p, 'utf8'), before); // 8.6 source unchanged
});
await t('8.5/8.6 standalone semantics-only .bpmn is laid out to a separate artifact, source untouched', async () => {
  const dir = tmp();
  const p = join(dir, 'semantics.bpmn');
  writeFileSync(p, `<bpmn:definitions ${NS}><bpmn:process id="P"><bpmn:startEvent id="Start_a"/><bpmn:task id="Activity_a" name="A"/><bpmn:sequenceFlow id="Flow_1" sourceRef="Start_a" targetRef="Activity_a"/></bpmn:process></bpmn:definitions>`);
  const before = readFileSync(p, 'utf8');
  const { renderRoot } = await assembleStandalone(p);
  assert.equal(readFileSync(p, 'utf8'), before); // source NOT overwritten
  assert.ok(readFileSync(join(renderRoot, 'entry.bpmn'), 'utf8').includes('BPMNDiagram')); // laid out in render artifact
});
await t('8.7 operator file WITH DI containing lanes renders with a warning, not refusal', async () => {
  const dir = tmp();
  const p = join(dir, 'lanes.bpmn');
  writeFileSync(p, `<bpmn:definitions ${NS} xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"><bpmn:process id="P"><bpmn:laneSet id="L"><bpmn:lane id="La" name="X"><bpmn:flowNodeRef>Activity_a</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet><bpmn:task id="Activity_a" name="A"/></bpmn:process><bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane id="pl" bpmnElement="P"><bpmndi:BPMNShape id="s" bpmnElement="Activity_a"><dc:Bounds x="10" y="10" width="100" height="80"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`);
  const prep = await prepareStandalone(p);
  assert.ok(!prep.refused); // has DI → rendered, not refused
});
await t('8.7-refuse operator file WITHOUT DI containing a subProcess is refused', async () => {
  const dir = tmp();
  const p = join(dir, 'sub.bpmn');
  writeFileSync(p, `<bpmn:definitions ${NS}><bpmn:process id="P"><bpmn:subProcess id="S"><bpmn:task id="T"/></bpmn:subProcess></bpmn:process></bpmn:definitions>`);
  const prep = await prepareStandalone(p);
  assert.equal(prep.refused, true);
  assert.ok(prep.diagnostics.some((d) => d.code === 'SUBPROCESS'));
});
await t('8.8 sendTask yields an unlinked-counterpart warning', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'package.yaml'), 'name: A\nentry: main.bpmn\n');
  writeFileSync(join(dir, 'main.bpmn'), `<bpmn:definitions ${NS}><bpmn:process id="P"><bpmn:startEvent id="Start_a"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent><bpmn:sendTask id="Send_x" name="Notify"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:sendTask><bpmn:endEvent id="End_a"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent><bpmn:sequenceFlow id="Flow_1" sourceRef="Start_a" targetRef="Send_x"/><bpmn:sequenceFlow id="Flow_2" sourceRef="Send_x" targetRef="End_a"/></bpmn:process></bpmn:definitions>`);
  const { validation } = await buildPackage(dir);
  assert.ok(validation.warnings.some((w) => w.code === 'UNLINKED-MESSAGE-TASK'));
});
