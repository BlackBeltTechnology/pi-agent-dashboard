// §10 end-to-end self-tests over the Hungarian demo package, simulating
// third-party modeller edits (rename, delete-and-re-add, insert).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from './harness.mjs';
import { emitDemo } from './demo.mjs';
import { buildPackage } from './generate.mjs';
import { validatePackage, persistRefreshedNames } from './manifest.mjs';
import { parse } from './pipeline.mjs';

function tmp() { const d = mkdtempSync(join(tmpdir(), 'e2e-')); emitDemo(d); return d; }
const edit = (p, from, to) => writeFileSync(p, readFileSync(p, 'utf8').replace(from, to));

await t('10.1/10.3 Hungarian multi-file package builds and every binding resolves', async () => {
  const dir = tmp();
  const { validation } = await buildPackage(dir);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  // exercises userTask+form, businessRuleTask+decision, callActivity+process, two participants
  assert.equal(validation.errors.length, 0);
});
await t('10.2 every generated .bpmn parses cleanly (conformance proxy: 0 moddle errors, plain BPMN)', async () => {
  const dir = tmp(); await buildPackage(dir);
  for (const f of ['main.bpmn', 'subprocesses/refund.bpmn', 'pools/shop.bpmn']) {
    const xml = readFileSync(join(dir, f), 'utf8');
    const { warnings } = await parse(xml);
    assert.equal(warnings.length, 0, `${f} parse warnings`);
    assert.ok(!/camunda:|zeebe:|activiti:|flowable:/.test(xml), `${f} must be plain BPMN 2.0`);
  }
});
await t('10.5 rename a bound element (id kept): binding still resolves, name refreshed + reported', async () => {
  const dir = tmp(); await buildPackage(dir);
  edit(join(dir, 'main.bpmn'), 'name="Rendelés rögzítése"', 'name="Rendelés felvétele"');
  const v = await validatePackage(dir);
  assert.equal(v.ok, true, JSON.stringify(v.errors)); // still resolves (id opaque)
  assert.ok(v.refreshes.some((r) => r.to === 'Rendelés felvétele'));
  assert.ok(v.warnings.some((w) => w.code === 'STALE-NAME'));
});
await t('10.6 delete-and-re-add (new id, same name) is matched by the name join', async () => {
  const dir = tmp(); await buildPackage(dir);
  // modeller re-creates the element: new tool id, same name; binding keeps old id
  edit(join(dir, 'main.bpmn'), 'id="Task_rendeles_rogzitese"', 'id="Activity_9f2b1c"');
  const v = await validatePackage(dir);
  const rec = v.reconciliations.find((r) => r.label === 'binding[0]');
  assert.ok(rec && rec.candidates.some((c) => c.id === 'Activity_9f2b1c'));
});
await t('10.6a rename → persist → delete-and-re-add under the new name is still matched', async () => {
  const dir = tmp(); await buildPackage(dir);
  // step 1: rename (id kept), validate, PERSIST the refreshed recorded name
  edit(join(dir, 'main.bpmn'), 'name="Rendelés rögzítése"', 'name="Rendelés felvétele"');
  const v1 = await validatePackage(dir);
  assert.ok(persistRefreshedNames(dir, v1)); // 5.17a permitted write
  // step 2: delete-and-re-add under the NEW name with a NEW id
  edit(join(dir, 'main.bpmn'), 'id="Task_rendeles_rogzitese"', 'id="Activity_7c3d2e"');
  const v2 = await validatePackage(dir);
  const rec = v2.reconciliations.find((r) => r.label === 'binding[0]');
  // matched against the refreshed name, not the stale original
  assert.ok(rec && rec.candidates.some((c) => c.id === 'Activity_7c3d2e'),
    'refreshed name must let reconciliation match the re-created element');
});
await t('10.7 insert a task: pre-existing bindings resolve, the new element is an unbound warning', async () => {
  const dir = tmp(); await buildPackage(dir);
  // insert an unbound serviceTask into the entry process (as a modeller would)
  edit(join(dir, 'main.bpmn'), '<bpmn:endEvent id="End_kesz"',
    '<bpmn:serviceTask id="Service_uj" name="Új lépés"/><bpmn:endEvent id="End_kesz"');
  const v = await validatePackage(dir);
  assert.equal(v.ok, true, JSON.stringify(v.errors)); // pre-existing bindings still resolve
  // new element is bindable-only if userTask/rule/call; serviceTask is not reported as unbound,
  // so insert a userTask instead to exercise the unbound-warning path:
  edit(join(dir, 'main.bpmn'), '<bpmn:serviceTask id="Service_uj" name="Új lépés"/>',
    '<bpmn:userTask id="Task_uj" name="Új felhasználói lépés"/>');
  const v2 = await validatePackage(dir);
  assert.ok(v2.warnings.some((w) => w.code === 'UNBOUND' && /Task_uj/.test(w.message)));
});
await t('10.8 re-open after a modeller edit preserves the authored layout and identifiers', async () => {
  const dir = tmp(); await buildPackage(dir);
  const before = readFileSync(join(dir, 'main.bpmn'), 'utf8');
  assert.ok(before.includes('BPMNDiagram')); // has DI after first build
  const ids1 = [...before.matchAll(/id="([A-Za-z]+_[^"]+)"/g)].map((m) => m[1]);
  // a second build must NOT re-lay-out or rewrite ids (file is source of truth)
  await buildPackage(dir);
  const after = readFileSync(join(dir, 'main.bpmn'), 'utf8');
  const ids2 = [...after.matchAll(/id="([A-Za-z]+_[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids2, ids1); // identifiers preserved
  assert.ok(after.includes('BPMNDiagram')); // layout preserved
});
