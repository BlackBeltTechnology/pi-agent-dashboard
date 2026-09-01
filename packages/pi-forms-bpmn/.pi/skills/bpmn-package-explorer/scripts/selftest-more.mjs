// Extended self-tests (§4 identifiers, §5 manifest, §6 guard modes). Imported by
// scripts/selftest.mjs, which owns the runner and the final report.

import assert from 'node:assert/strict';
import { t } from './harness.mjs';
import { deburr, slug, deriveNamedId, deriveIdentifiers, unnamedOrdinalIds } from './identifiers.mjs';
import { parse } from './pipeline.mjs';
import { existingIdentifiers, ingestionWarnings, refuseRegeneration, identifiersPreserved, extractElements } from './ingest.mjs';

const D = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';

// ── §4 identifiers ──────────────────────────────────────────────────────
await t('4.2 named id is <Prefix>_<slug>', () => assert.equal(deriveNamedId('userTask', 'Approve order'), 'Task_approve_order'));
await t('4.3 Hungarian deburr → Task_rendeles_jovahagyasa', () => assert.equal(deriveNamedId('userTask', 'Rendelés jóváhagyása'), 'Task_rendeles_jovahagyasa'));
await t('4.3 ő and ű deburr to o and u', () => { assert.equal(deburr('őrizet'), 'orizet'); assert.equal(slug('Bűnügy'), 'bunugy'); });
await t('4.1 task→Activity and userTask→Task are distinct', () => assert.notEqual(deriveNamedId('task', 'Approve').split('_')[0], deriveNamedId('userTask', 'Approve').split('_')[0]));
await t('4.4 two unnamed tasks + unnamed gateway accepted with distinct ids', () => {
  const r = deriveIdentifiers([
    { key: 'a', type: 'task' }, { key: 'b', type: 'task' }, { key: 'g', type: 'exclusiveGateway' },
  ]);
  assert.equal(r.ok, true);
  assert.equal(new Set(r.ids.values()).size, 3);
});
await t('4.5 unnamed element ids are marked non-bindable', () => {
  const set = unnamedOrdinalIds([{ key: 'a', type: 'task' }, { key: 'b', type: 'task' }]);
  assert.ok(set.has('Activity_1') && set.has('Activity_2'));
});
await t('4.6 permutation leaves named ids byte-identical', () => {
  const els = [
    { key: 'x', type: 'userTask', name: 'Alpha' },
    { key: 'y', type: 'serviceTask', name: 'Beta' },
    { key: 'z', type: 'endEvent', name: 'Gamma' },
  ];
  const a = deriveIdentifiers(els).ids;
  const b = deriveIdentifiers([...els].reverse()).ids;
  for (const el of els) assert.equal(a.get(el.key), b.get(el.key));
});
await t('4.7 name with a digit → Task_approve_2', () => assert.equal(deriveNamedId('userTask', 'Approve 2'), 'Task_approve_2'));
await t('4.8 duplicate name on one prefix is rejected', () => {
  const r = deriveIdentifiers([{ key: 'a', type: 'userTask', name: 'Approve' }, { key: 'b', type: 'userTask', name: 'Approve' }]);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === 'DUP-NAME'));
});
await t('4.8 same name across different prefixes is accepted', () => {
  const r = deriveIdentifiers([{ key: 'a', type: 'userTask', name: 'Notify' }, { key: 'b', type: 'serviceTask', name: 'Notify' }]);
  assert.equal(r.ok, true);
});
await t('4.8 userTask + endEvent sharing a name accepted', () => {
  const r = deriveIdentifiers([{ key: 'a', type: 'userTask', name: 'Jóváhagyás' }, { key: 'b', type: 'endEvent', name: 'Jóváhagyás' }]);
  assert.equal(r.ok, true);
});
await t('4.9 post-deburr id collision (őrizet/orizet) is rejected with the id', () => {
  const r = deriveIdentifiers([{ key: 'a', type: 'task', name: 'őrizet' }, { key: 'b', type: 'task', name: 'orizet' }]);
  assert.equal(r.ok, false);
  const d = r.diagnostics.find((x) => x.code === 'DUP-ID');
  assert.ok(d && /Activity_orizet/.test(d.message));
});
await t('4.10 unnamed bindable (userTask/businessRuleTask/callActivity) rejected', () => {
  for (const type of ['userTask', 'businessRuleTask', 'callActivity']) {
    const r = deriveIdentifiers([{ key: 'a', type }]);
    assert.ok(r.diagnostics.some((d) => d.code === 'UNNAMED-BINDABLE'), `${type} should require a name`);
  }
});
await t('4.11 tool-generated id (Activity_1a2b3c) survives a round trip', async () => {
  const xml = `<bpmn:definitions ${D}><bpmn:process id="P"><bpmn:task id="Activity_1a2b3c" name="Charge"/></bpmn:process></bpmn:definitions>`;
  const { rootElement } = await parse(xml);
  assert.deepEqual(existingIdentifiers(rootElement), ['Activity_1a2b3c']);
});
await t('4.12 duplicate names in an existing file warn, never refuse', async () => {
  const xml = `<bpmn:definitions ${D}><bpmn:process id="P"><bpmn:userTask id="A" name="Approve"/><bpmn:userTask id="B" name="Approve"/></bpmn:process></bpmn:definitions>`;
  const { rootElement } = await parse(xml);
  const { warnings } = ingestionWarnings(rootElement);
  assert.ok(warnings.some((w) => /DUP-NAME/.test(w)));
});
await t('4.13 regeneration over an existing file is refused, listing bindings', () => {
  const manifest = { bindings: [{ kind: 'decision', ref: 'd.dmn', element: 'Rule_x', in: 'entry.bpmn' }], roles: [{ role: 'Sales', element: 'Task_q', in: 'entry.bpmn' }] };
  const r = refuseRegeneration('entry.bpmn', manifest, 'entry.bpmn');
  assert.equal(r.refuse, true);
  assert.equal(r.invalidatedBindings.length, 2);
});
await t('4.14 editing preserves every pre-existing identifier', async () => {
  const before = `<bpmn:definitions ${D}><bpmn:process id="P"><bpmn:startEvent id="Start_a"/><bpmn:userTask id="Task_x" name="X"/></bpmn:process></bpmn:definitions>`;
  const after = `<bpmn:definitions ${D}><bpmn:process id="P"><bpmn:startEvent id="Start_a"/><bpmn:userTask id="Task_x" name="X"/><bpmn:serviceTask id="Service_new" name="New"/></bpmn:process></bpmn:definitions>`;
  const b = existingIdentifiers((await parse(before)).rootElement);
  const a = existingIdentifiers((await parse(after)).rootElement);
  assert.ok(identifiersPreserved(b, a));
});
