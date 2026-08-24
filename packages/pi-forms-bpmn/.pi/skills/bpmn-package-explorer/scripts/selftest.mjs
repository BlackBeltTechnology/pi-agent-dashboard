#!/usr/bin/env node
// Unit self-test for the skill's pure logic (envelope, identifiers, manifest,
// guard modes). Runs headless, no network. Complements scripts/fixtures.mjs
// (which is the layout regression suite).
//
//   node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { t, report } from './harness.mjs';
import { checkAuthored } from './envelope.mjs';

const D = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const codes = (xml) => checkAuthored(xml).diagnostics.map((d) => d.code);

// ── §3 authoring envelope ───────────────────────────────────────────────
await t('3.0 clean allow-listed process passes', () => {
  const xml = `<bpmn:definitions ${D}><bpmn:process id="P"><bpmn:startEvent id="Start_a"/><bpmn:userTask id="Task_a" name="A"/><bpmn:sequenceFlow id="Flow_1" sourceRef="Start_a" targetRef="Task_a"/></bpmn:process></bpmn:definitions>`;
  assert.equal(checkAuthored(xml).ok, true);
});
await t('3.1 rejects bpmndi geometry', () => assert.ok(codes(`<bpmn:definitions ${D} xmlns:bpmndi="x"><bpmn:process id="P"/><bpmndi:BPMNDiagram id="d"/></bpmn:definitions>`).includes('DI-PRESENT')));
await t('3.1 rejects dc:Bounds', () => assert.ok(codes(`<bpmn:definitions ${D} xmlns:dc="x"><bpmn:process id="P"><dc:Bounds x="0" y="0" width="1" height="1"/></bpmn:process></bpmn:definitions>`).includes('DC-BOUNDS')));
await t('3.1 rejects di:waypoint', () => assert.ok(codes(`<bpmn:definitions ${D} xmlns:di="x"><bpmn:process id="P"><di:waypoint x="0" y="0"/></bpmn:process></bpmn:definitions>`).includes('DI-WAYPOINT')));
await t('3.2 rejects vendor namespace', () => assert.ok(codes(`<bpmn:definitions ${D} xmlns:zeebe="x"><bpmn:process id="P"><bpmn:userTask id="Task_a" zeebe:formKey="f"/></bpmn:process></bpmn:definitions>`).includes('VENDOR-NS')));
await t('3.3 rejects a non-allow-listed construct', () => assert.ok(codes(`<bpmn:definitions ${D}><bpmn:process id="P"><bpmn:adHocSubProcess id="X"/></bpmn:process></bpmn:definitions>`).includes('NOT-ALLOWED')));
await t('3.4 rejects inline subProcess with substitution', () => {
  const d = checkAuthored(`<bpmn:definitions ${D}><bpmn:process id="P"><bpmn:subProcess id="S"><bpmn:task id="T"/></bpmn:subProcess></bpmn:process></bpmn:definitions>`).diagnostics;
  const sp = d.find((x) => x.code === 'SUBPROCESS');
  assert.ok(sp && /callActivity/.test(sp.message) && /kind: process/.test(sp.message));
});
await t('3.5 rejects collaboration with substitution', () => {
  const d = checkAuthored(`<bpmn:definitions ${D}><bpmn:collaboration id="C"><bpmn:participant id="Pa"/></bpmn:collaboration></bpmn:definitions>`).diagnostics;
  assert.ok(d.find((x) => x.code === 'COLLABORATION' && /per participant/.test(x.message)));
});
await t('3.6 rejects laneSet with substitution', () => {
  const d = checkAuthored(`<bpmn:definitions ${D}><bpmn:process id="P"><bpmn:laneSet id="L"><bpmn:lane id="La"/></bpmn:laneSet></bpmn:process></bpmn:definitions>`).diagnostics;
  assert.ok(d.find((x) => x.code === 'LANESET' && /roles/.test(x.message)));
});
await t('3.7 rejects messageFlow with limitation note', () => {
  const d = checkAuthored(`<bpmn:definitions ${D}><bpmn:collaboration id="C"><bpmn:messageFlow id="M"/></bpmn:collaboration></bpmn:definitions>`).diagnostics;
  assert.ok(d.find((x) => x.code === 'MESSAGEFLOW' && /unrepresentable/.test(x.message)));
});
await t('3.8 no rejection path is silent (every diagnostic has a message)', () => {
  const xml = `<bpmn:definitions ${D} xmlns:camunda="x"><bpmn:collaboration id="C"><bpmn:messageFlow id="M"/></bpmn:collaboration><bpmn:process id="P"><bpmn:subProcess id="S"/><bpmn:laneSet id="L"/></bpmn:process></bpmn:definitions>`;
  const r = checkAuthored(xml);
  assert.equal(r.ok, false);
  for (const d of r.diagnostics) { assert.ok(d.code); assert.ok(d.message && d.message.length > 10); }
});
await t('rejects ≥2 boundary events on one activity', () => assert.ok(codes(`<bpmn:definitions ${D}><bpmn:process id="P"><bpmn:userTask id="Task_a" name="A"/><bpmn:boundaryEvent id="B1" attachedToRef="Task_a"/><bpmn:boundaryEvent id="B2" attachedToRef="Task_a"/></bpmn:process></bpmn:definitions>`).includes('MULTI-BOUNDARY')));

// Extended suites (§4 identifiers, §5 manifest, §6 guard modes) live in
// selftest-more.mjs; load them, then report once.
await import('./selftest-more.mjs');
await import('./selftest-manifest.mjs');
await import('./selftest-guard.mjs');
await import('./selftest-workflow.mjs');
await import('./selftest-e2e.mjs');
report();
