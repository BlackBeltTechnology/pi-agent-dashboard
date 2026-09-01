#!/usr/bin/env node
// Emits the fixture .bpmn files into fixtures/. Run once; the emitted files are
// committed as the readable evidence. Re-run only to regenerate them.
//
//   node scripts/build-fixtures.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)));
const F = join(SKILL, 'fixtures');

const NS = `xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"`;

function defs(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${inner}
</bpmn:definitions>\n`;
}

// Build a semantics-only process from a compact node + flow spec.
// nodes: [ [type, id, name?] ]   flows: [ [id, src, tgt] ]
function process(id, nodes, flows, { boundary = [], extra = '' } = {}) {
  const incoming = {}, outgoing = {};
  for (const [fid, s, t] of flows) {
    (outgoing[s] ||= []).push(fid);
    (incoming[t] ||= []).push(fid);
  }
  const body = nodes.map(([type, nid, name]) => {
    const io = `${(incoming[nid] || []).map((f) => `<bpmn:incoming>${f}</bpmn:incoming>`).join('')}${(outgoing[nid] || []).map((f) => `<bpmn:outgoing>${f}</bpmn:outgoing>`).join('')}`;
    const nm = name ? ` name="${name}"` : '';
    return `    <bpmn:${type} id="${nid}"${nm}>${io}</bpmn:${type}>`;
  }).join('\n');
  const bnd = boundary.map(([bid, host, name]) =>
    `    <bpmn:boundaryEvent id="${bid}"${name ? ` name="${name}"` : ''} attachedToRef="${host}">${(outgoing[bid] || []).map((f) => `<bpmn:outgoing>${f}</bpmn:outgoing>`).join('')}</bpmn:boundaryEvent>`).join('\n');
  const seq = flows.map(([fid, s, t]) => `    <bpmn:sequenceFlow id="${fid}" sourceRef="${s}" targetRef="${t}"/>`).join('\n');
  return `  <bpmn:process id="${id}" isExecutable="false">
${body}
${bnd ? bnd + '\n' : ''}${seq}
${extra}  </bpmn:process>`;
}

const out = {};

// ── 8 measured fixtures (semantics-only) ────────────────────────────────
out['measured/1-linear.bpmn'] = defs(process('Process_linear', [
  ['startEvent', 'Start_begin', 'Begin'],
  ['userTask', 'Task_capture', 'Capture'],
  ['serviceTask', 'Service_store', 'Store'],
  ['endEvent', 'End_done', 'Done'],
], [
  ['Flow_1', 'Start_begin', 'Task_capture'],
  ['Flow_2', 'Task_capture', 'Service_store'],
  ['Flow_3', 'Service_store', 'End_done'],
]));

out['measured/2-gateway.bpmn'] = defs(process('Process_gateway', [
  ['startEvent', 'Start_in', 'In'],
  ['task', 'Activity_check', 'Check'],
  ['exclusiveGateway', 'Gateway_split', 'OK?'],
  ['task', 'Activity_accept', 'Accept'],
  ['task', 'Activity_reject', 'Reject'],
  ['exclusiveGateway', 'Gateway_join'],
  ['endEvent', 'End_out', 'Out'],
], [
  ['Flow_1', 'Start_in', 'Activity_check'],
  ['Flow_2', 'Activity_check', 'Gateway_split'],
  ['Flow_3', 'Gateway_split', 'Activity_accept'],
  ['Flow_4', 'Gateway_split', 'Activity_reject'],
  ['Flow_5', 'Activity_accept', 'Gateway_join'],
  ['Flow_6', 'Activity_reject', 'Gateway_join'],
  ['Flow_7', 'Gateway_join', 'End_out'],
]));

out['measured/3-boundary.bpmn'] = defs(process('Process_boundary', [
  ['startEvent', 'Start_go', 'Go'],
  ['userTask', 'Task_wait', 'Wait'],
  ['endEvent', 'End_ok', 'OK'],
  ['endEvent', 'End_timeout', 'Timeout'],
], [
  ['Flow_1', 'Start_go', 'Task_wait'],
  ['Flow_2', 'Task_wait', 'End_ok'],
  ['Flow_3', 'Boundary_timer', 'End_timeout'],
], { boundary: [['Boundary_timer', 'Task_wait', 'Timer']] }));

out['measured/7-loop.bpmn'] = defs(process('Process_loop', [
  ['startEvent', 'Start_s', 'Start'],
  ['userTask', 'Task_attempt', 'Attempt'],
  ['exclusiveGateway', 'Gateway_ok', 'Passed?'],
  ['endEvent', 'End_e', 'End'],
], [
  ['Flow_1', 'Start_s', 'Task_attempt'],
  ['Flow_2', 'Task_attempt', 'Gateway_ok'],
  ['Flow_3', 'Gateway_ok', 'End_e'],
  ['Flow_4', 'Gateway_ok', 'Task_attempt'], // loop-back
]));

{
  const nodes = [['startEvent', 'Start_c', 'Start']];
  const flows = [];
  let prev = 'Start_c';
  for (let i = 1; i <= 12; i++) {
    const id = `Task_step_${i}`;
    nodes.push(['task', id, `Step ${i}`]);
    flows.push([`Flow_${i}`, prev, id]);
    prev = id;
  }
  nodes.push(['endEvent', 'End_c', 'End']);
  flows.push(['Flow_end', prev, 'End_c']);
  out['measured/8-long-chain.bpmn'] = defs(process('Process_chain', nodes, flows));
}

// 4-subprocess — inline sub-process (measured CORRUPT: G1 + G3).
out['measured/4-subprocess.bpmn'] = defs(`  <bpmn:process id="Process_sub" isExecutable="false">
    <bpmn:startEvent id="Start_outer"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Activity_sub" name="Sub">
      <bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing>
      <bpmn:startEvent id="Start_inner"><bpmn:outgoing>Flow_i1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:task id="Activity_charge" name="Charge"><bpmn:incoming>Flow_i1</bpmn:incoming><bpmn:outgoing>Flow_i2</bpmn:outgoing></bpmn:task>
      <bpmn:endEvent id="End_inner"><bpmn:incoming>Flow_i2</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_i1" sourceRef="Start_inner" targetRef="Activity_charge"/>
      <bpmn:sequenceFlow id="Flow_i2" sourceRef="Activity_charge" targetRef="End_inner"/>
    </bpmn:subProcess>
    <bpmn:endEvent id="End_outer"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_outer" targetRef="Activity_sub"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Activity_sub" targetRef="End_outer"/>
  </bpmn:process>`);

// 5-pools — collaboration with two participants (measured DATA LOSS).
out['measured/5-pools.bpmn'] = defs(`  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_customer" name="Customer" processRef="Process_customer"/>
    <bpmn:participant id="Participant_shop" name="Shop" processRef="Process_shop"/>
  </bpmn:collaboration>
  <bpmn:process id="Process_customer" isExecutable="false">
    <bpmn:startEvent id="Start_order"><bpmn:outgoing>Flow_c1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_place" name="Place order"><bpmn:incoming>Flow_c1</bpmn:incoming><bpmn:outgoing>Flow_c2</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="End_c"><bpmn:incoming>Flow_c2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_c1" sourceRef="Start_order" targetRef="Task_place"/>
    <bpmn:sequenceFlow id="Flow_c2" sourceRef="Task_place" targetRef="End_c"/>
  </bpmn:process>
  <bpmn:process id="Process_shop" isExecutable="false">
    <bpmn:startEvent id="Start_recv"><bpmn:outgoing>Flow_s1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="Service_fulfil" name="Fulfil"><bpmn:incoming>Flow_s1</bpmn:incoming><bpmn:outgoing>Flow_s2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="End_s"><bpmn:incoming>Flow_s2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_s1" sourceRef="Start_recv" targetRef="Service_fulfil"/>
    <bpmn:sequenceFlow id="Flow_s2" sourceRef="Service_fulfil" targetRef="End_s"/>
  </bpmn:process>`);

// 6-lanes-only — laneSet without pools (measured DEGRADED: lane shapes absent).
out['measured/6-lanes-only.bpmn'] = defs(`  <bpmn:process id="Process_lanes" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_sales" name="Sales"><bpmn:flowNodeRef>Task_quote</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Lane_finance" name="Finance"><bpmn:flowNodeRef>Task_invoice</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_l"><bpmn:outgoing>Flow_l1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_quote" name="Quote"><bpmn:incoming>Flow_l1</bpmn:incoming><bpmn:outgoing>Flow_l2</bpmn:outgoing></bpmn:userTask>
    <bpmn:userTask id="Task_invoice" name="Invoice"><bpmn:incoming>Flow_l2</bpmn:incoming><bpmn:outgoing>Flow_l3</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="End_l"><bpmn:incoming>Flow_l3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_l1" sourceRef="Start_l" targetRef="Task_quote"/>
    <bpmn:sequenceFlow id="Flow_l2" sourceRef="Task_quote" targetRef="Task_invoice"/>
    <bpmn:sequenceFlow id="Flow_l3" sourceRef="Task_invoice" targetRef="End_l"/>
  </bpmn:process>`);

// ── Provisional-construct fixtures (semantics-only, expected pass) ───────
const prov = (file, type, prefix) => {
  out[`provisional/${file}.bpmn`] = defs(process(`Process_${file.replace(/-/g, '_')}`, [
    ['startEvent', 'Start_p', 'Start'],
    [type, `${prefix}_x`, 'X'],
    ['endEvent', 'End_p', 'End'],
  ], [
    ['Flow_1', 'Start_p', `${prefix}_x`],
    ['Flow_2', `${prefix}_x`, 'End_p'],
  ]));
};
prov('manual-task', 'manualTask', 'Manual');
prov('script-task', 'scriptTask', 'Script');
prov('send-task', 'sendTask', 'Send');
prov('receive-task', 'receiveTask', 'Receive');
prov('call-activity', 'callActivity', 'Call');
prov('parallel-gateway', 'parallelGateway', 'Fork');
prov('rule-task', 'businessRuleTask', 'Rule');

// intermediate catch + throw
out['provisional/intermediate-catch.bpmn'] = defs(process('Process_icatch', [
  ['startEvent', 'Start_ic', 'Start'],
  ['intermediateCatchEvent', 'CatchEvent_wait', 'Wait'],
  ['endEvent', 'End_ic', 'End'],
], [['Flow_1', 'Start_ic', 'CatchEvent_wait'], ['Flow_2', 'CatchEvent_wait', 'End_ic']]));

out['provisional/intermediate-throw.bpmn'] = defs(process('Process_ithrow', [
  ['startEvent', 'Start_it', 'Start'],
  ['intermediateThrowEvent', 'ThrowEvent_signal', 'Signal'],
  ['endEvent', 'End_it', 'End'],
], [['Flow_1', 'Start_it', 'ThrowEvent_signal'], ['Flow_2', 'ThrowEvent_signal', 'End_it']]));

// 2.3a — two boundary events on one activity
out['provisional/multi-boundary.bpmn'] = defs(process('Process_multibound', [
  ['startEvent', 'Start_mb', 'Start'],
  ['userTask', 'Task_run', 'Run'],
  ['endEvent', 'End_ok', 'OK'],
  ['endEvent', 'End_timer', 'Timeout'],
  ['endEvent', 'End_error', 'Error'],
], [
  ['Flow_1', 'Start_mb', 'Task_run'],
  ['Flow_2', 'Task_run', 'End_ok'],
  ['Flow_3', 'Boundary_timer', 'End_timer'],
  ['Flow_4', 'Boundary_error', 'End_error'],
], { boundary: [['Boundary_timer', 'Task_run', 'Timer'], ['Boundary_error', 'Task_run', 'Error']] }));

// ── Geometric-violation synthetic fixtures (WITH DI, strict-guarded) ─────
// Each carries DI violating exactly one invariant.
function withDI(procInner, planeId, shapes, edges = '') {
  return defs(`  <bpmn:process id="${planeId}" isExecutable="false">
${procInner}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Dia_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="${planeId}">
${shapes}
${edges}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`);
}
const shape = (el, x, y, w, h, extra = '') =>
  `    <bpmndi:BPMNShape id="${el}_di" bpmnElement="${el}"${extra}><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/></bpmndi:BPMNShape>`;
const edge = (el, pts) =>
  `    <bpmndi:BPMNEdge id="${el}_di" bpmnElement="${el}">${pts.map(([x, y]) => `<di:waypoint x="${x}" y="${y}"/>`).join('')}</bpmndi:BPMNEdge>`;

const twoTasks = `    <bpmn:startEvent id="Start_g"><bpmn:outgoing>Flow_g1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_a" name="A"><bpmn:incoming>Flow_g1</bpmn:incoming><bpmn:outgoing>Flow_g2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_b" name="B"><bpmn:incoming>Flow_g2</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_g1" sourceRef="Start_g" targetRef="Activity_a"/>
    <bpmn:sequenceFlow id="Flow_g2" sourceRef="Activity_a" targetRef="Activity_b"/>`;

// G1: identical bounds
out['geometry/g1-identical-bounds.bpmn'] = withDI(twoTasks, 'Process_g1',
  [shape('Start_g', 100, 100, 36, 36), shape('Activity_a', 200, 80, 100, 80), shape('Activity_b', 200, 80, 100, 80)].join('\n'),
  [edge('Flow_g1', [[136, 118], [200, 120]]), edge('Flow_g2', [[300, 120], [200, 120]])].join('\n'));

// G2: zero-size shape
out['geometry/g2-zero-size.bpmn'] = withDI(twoTasks, 'Process_g2',
  [shape('Start_g', 100, 100, 36, 36), shape('Activity_a', 200, 80, 0, 80), shape('Activity_b', 360, 80, 100, 80)].join('\n'),
  [edge('Flow_g1', [[136, 118], [200, 120]]), edge('Flow_g2', [[300, 120], [360, 120]])].join('\n'));

// G3: child outside expanded container
{
  const subInner = `    <bpmn:startEvent id="Start_g3"><bpmn:outgoing>Flow_x</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Activity_container" name="Container">
      <bpmn:task id="Activity_child" name="Child"/>
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Flow_x" sourceRef="Start_g3" targetRef="Activity_container"/>`;
  out['geometry/g3-child-outside.bpmn'] = withDI(subInner, 'Process_g3',
    [shape('Start_g3', 100, 300, 36, 36),
     shape('Activity_container', 200, 200, 100, 80, ' isExpanded="true"'),
     shape('Activity_child', 500, 500, 100, 80)].join('\n'),
    edge('Flow_x', [[136, 318], [200, 240]]));
}

// G4: negative coordinate (strict only)
out['geometry/g4-negative-coord.bpmn'] = withDI(twoTasks, 'Process_g4',
  [shape('Start_g', -50, 100, 36, 36), shape('Activity_a', 200, 80, 100, 80), shape('Activity_b', 360, 80, 100, 80)].join('\n'),
  [edge('Flow_g1', [[-14, 118], [200, 120]]), edge('Flow_g2', [[300, 120], [360, 120]])].join('\n'));

// G5: unrelated flow-node overlap
out['geometry/g5-overlap.bpmn'] = withDI(twoTasks, 'Process_g5',
  [shape('Start_g', 100, 100, 36, 36), shape('Activity_a', 200, 80, 100, 80), shape('Activity_b', 250, 100, 100, 80)].join('\n'),
  [edge('Flow_g1', [[136, 118], [200, 120]]), edge('Flow_g2', [[300, 120], [250, 140]])].join('\n'));

// ── Correct expanded sub-process WITH DI (guard must NOT fire) ───────────
{
  const subInner = `    <bpmn:startEvent id="Start_ok"><bpmn:outgoing>Flow_o1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Activity_expanded" name="Expanded">
      <bpmn:incoming>Flow_o1</bpmn:incoming><bpmn:outgoing>Flow_o2</bpmn:outgoing>
      <bpmn:startEvent id="Start_inner_ok"><bpmn:outgoing>Flow_in</bpmn:outgoing></bpmn:startEvent>
      <bpmn:task id="Activity_inner" name="Inner"><bpmn:incoming>Flow_in</bpmn:incoming></bpmn:task>
      <bpmn:sequenceFlow id="Flow_in" sourceRef="Start_inner_ok" targetRef="Activity_inner"/>
    </bpmn:subProcess>
    <bpmn:endEvent id="End_ok"><bpmn:incoming>Flow_o2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_o1" sourceRef="Start_ok" targetRef="Activity_expanded"/>
    <bpmn:sequenceFlow id="Flow_o2" sourceRef="Activity_expanded" targetRef="End_ok"/>`;
  out['nesting/expanded-subprocess-ok.bpmn'] = withDI(subInner, 'Process_ok',
    [shape('Start_ok', 100, 200, 36, 36),
     shape('Activity_expanded', 200, 120, 300, 200, ' isExpanded="true"'),
     shape('Start_inner_ok', 240, 200, 36, 36),
     shape('Activity_inner', 320, 180, 100, 80),
     shape('End_ok', 560, 200, 36, 36)].join('\n'),
    [edge('Flow_o1', [[136, 218], [200, 220]]),
     edge('Flow_o2', [[500, 220], [560, 218]]),
     edge('Flow_in', [[276, 218], [320, 220]])].join('\n'));
}

// ── write files ─────────────────────────────────────────────────────────
let n = 0;
for (const [rel, xml] of Object.entries(out)) {
  const p = join(F, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, xml);
  n++;
}
console.log(`wrote ${n} fixture files under ${F}`);
