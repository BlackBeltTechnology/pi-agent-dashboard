// §5 manifest self-tests. Builds throwaway packages on disk and validates them.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from './harness.mjs';
import { validatePackage, checkDmn, checkForm, similarity, reconcile } from './manifest.mjs';

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
function proc(elements) {
  // elements: [ [type, id, name?] ]
  const body = elements.map(([ty, id, name]) => `<bpmn:${ty} id="${id}"${name ? ` name="${name}"` : ''}/>`).join('');
  return `<bpmn:definitions ${NS}><bpmn:process id="P">${body}</bpmn:process></bpmn:definitions>`;
}
function pkg(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bpmnpkg-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}
const DMN1 = `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"><decision id="d1" name="Price"><decisionTable/></decision></definitions>`;
const DMN2_NODI = `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"><decision id="d1"/><decision id="d2"/></definitions>`;
const DMN2_DI = `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/"><decision id="d1"/><decision id="d2"/><dmndi:DMNDI/></definitions>`;

await t('5.1 minimal manifest (name+entry) is valid', async () => {
  const dir = pkg({ 'package.yaml': 'name: Min\nentry: main.bpmn\n', 'main.bpmn': proc([['startEvent', 'Start_a']]) });
  const r = await validatePackage(dir);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});
await t('5.4 duplicate manifest key is rejected', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nname: B\nentry: main.bpmn\n', 'main.bpmn': proc([['startEvent', 'S']]) });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'DUP-KEY'));
});
await t('5.5 absolute path is rejected', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: /etc/passwd\n    element: Task_x\n', 'main.bpmn': proc([['userTask', 'Task_x', 'X']]) });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'REF-PATH'));
});
await t('5.5 ../ escape is rejected', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: ../../etc/passwd\n    element: Task_x\n', 'main.bpmn': proc([['userTask', 'Task_x', 'X']]) });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'REF-PATH'));
});
await t('5.5 symlink escaping the root is rejected', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outside, 'secret.form'), '{}');
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: forms/link.form\n    element: Task_x\n', 'main.bpmn': proc([['userTask', 'Task_x', 'X']]) });
  mkdirSync(join(dir, 'forms'), { recursive: true });
  symlinkSync(join(outside, 'secret.form'), join(dir, 'forms', 'link.form'));
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'REF-PATH'));
  rmSync(outside, { recursive: true, force: true });
});
await t('5.7 unknown kind lists the four kinds', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: subscription\n    ref: x\n    element: Task_x\n', 'main.bpmn': proc([['userTask', 'Task_x', 'X']]) });
  const r = await validatePackage(dir);
  const e = r.errors.find((x) => x.code === 'BAD-KIND');
  assert.ok(e && /decision/.test(e.message) && /participant/.test(e.message));
});
await t('5.8 kind/element-type mismatch is named', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: f.form\n    element: Service_x\n', 'main.bpmn': proc([['serviceTask', 'Service_x', 'X']]), 'f.form': '{}' });
  const r = await validatePackage(dir);
  const e = r.errors.find((x) => x.code === 'TYPE-MISMATCH');
  assert.ok(e && /userTask/.test(e.message) && /serviceTask/.test(e.message));
});
await t('5.9 participant carrying an element is rejected', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: participant\n    ref: pools/shop.bpmn\n    name: Shop\n    element: Task_x\n', 'main.bpmn': proc([['startEvent', 'S']]), 'pools/shop.bpmn': proc([['startEvent', 'S2']]) });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'PARTICIPANT-SCOPE'));
});
await t('5.10 decisions.xlsx fails as not-DMN before serving', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: decision\n    ref: decisions.xlsx\n    element: Rule_x\n', 'main.bpmn': proc([['businessRuleTask', 'Rule_x', 'X']]), 'decisions.xlsx': 'PK\x03\x04 not dmn' });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'REF-CONTENT' && /DMN/.test(e.message)));
});
await t('5.10a multi-decision DRD without DI fails at validation', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: decision\n    ref: d.dmn\n    element: Rule_x\n', 'main.bpmn': proc([['businessRuleTask', 'Rule_x', 'X']]), 'd.dmn': DMN2_NODI });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'REF-CONTENT' && /DRD DI/.test(e.message)));
});
await t('5.10 multi-decision DRD WITH DI passes', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: decision\n    ref: d.dmn\n    element: Rule_x\n', 'main.bpmn': proc([['businessRuleTask', 'Rule_x', 'X']]), 'd.dmn': DMN2_DI });
  const r = await validatePackage(dir);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});
await t('5.10 malformed form JSON rejected; 5.10b structural-only diagnostic on valid', async () => {
  const bad = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: f.form\n    element: Task_x\n', 'main.bpmn': proc([['userTask', 'Task_x', 'X']]), 'f.form': '{ not json' });
  assert.ok((await validatePackage(bad)).errors.some((e) => e.code === 'REF-CONTENT'));
  const good = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: f.form\n    element: Task_x\n', 'main.bpmn': proc([['userTask', 'Task_x', 'X']]), 'f.form': '{"components":[]}' });
  const r = await validatePackage(good);
  assert.ok(r.diagnostics.some((d) => d.code === 'FORM-STRUCTURAL-ONLY'));
});
await t('5.11 vendor attr in a generated file is rejected', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: decision\n    ref: d.dmn\n    element: Rule_x\n', 'main.bpmn': `<bpmn:definitions ${NS} xmlns:camunda="x"><bpmn:process id="P"><bpmn:businessRuleTask id="Rule_x" name="X" camunda:decisionRef="d"/></bpmn:process></bpmn:definitions>`, 'd.dmn': DMN1 });
  const r = await validatePackage(dir, { generatedFiles: new Set(['main.bpmn']) });
  assert.ok(r.errors.some((e) => e.code === 'VENDOR-ATTR'));
});
await t('5.11 vendor attr in an ingested file only warns', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: decision\n    ref: d.dmn\n    element: Rule_x\n', 'main.bpmn': `<bpmn:definitions ${NS} xmlns:camunda="x"><bpmn:process id="P"><bpmn:businessRuleTask id="Rule_x" name="X" camunda:decisionRef="d"/></bpmn:process></bpmn:definitions>`, 'd.dmn': DMN1 });
  const r = await validatePackage(dir); // not generated
  assert.ok(r.warnings.some((e) => e.code === 'VENDOR-ATTR-INGESTED'));
});
await t('5.12 one element with two roles is rejected', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nroles:\n  - element: Task_x\n    role: Sales\n  - element: Task_x\n    role: Finance\n', 'main.bpmn': proc([['userTask', 'Task_x', 'X']]) });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'ROLE-DOUBLE'));
});
await t('5.13 dangling element ref is reported', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: f.form\n    element: Task_missing\n', 'main.bpmn': proc([['userTask', 'Task_x', 'Totally Different']]), 'f.form': '{}' });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'DANGLING' || e.code === 'DANGLING-RECONCILE'));
});
await t('5.14 orphan artifact + unbound element warn, still ok', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\n', 'main.bpmn': proc([['userTask', 'Task_x', 'X']]), 'forms/unused.form': '{}' });
  const r = await validatePackage(dir);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === 'ORPHAN'));
  assert.ok(r.warnings.some((w) => w.code === 'UNBOUND'));
});
await t('5.15 nested package is rejected', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: process\n    ref: sub/child.bpmn\n    element: Call_x\n', 'main.bpmn': proc([['callActivity', 'Call_x', 'X']]), 'sub/child.bpmn': proc([['startEvent', 'S']]), 'sub/package.yaml': 'name: Nested\nentry: child.bpmn\n' });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'NESTED-PACKAGE'));
});
await t('5.16 recursive callActivity is a warning, still served', async () => {
  const dir = pkg({
    'package.yaml': 'name: A\nentry: a.bpmn\nbindings:\n  - kind: process\n    ref: b.bpmn\n    element: Call_b\n  - kind: process\n    ref: a.bpmn\n    element: Call_a\n    in: b.bpmn\n',
    'a.bpmn': proc([['callActivity', 'Call_b', 'To B']]),
    'b.bpmn': proc([['callActivity', 'Call_a', 'To A']]),
  });
  const r = await validatePackage(dir);
  assert.ok(r.warnings.some((w) => w.code === 'CYCLE'));
});
await t('5.17/5.17a recorded name is refreshed and reported', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: f.form\n    element: Task_x\n    name: Old Name\n', 'main.bpmn': proc([['userTask', 'Task_x', 'New Name']]), 'f.form': '{}' });
  const r = await validatePackage(dir);
  assert.ok(r.refreshes.some((x) => x.to === 'New Name'));
  assert.ok(r.warnings.some((w) => w.code === 'STALE-NAME'));
  assert.equal(r.updatedManifest.bindings[0].name, 'New Name');
});
await t('5.18 delete-and-re-add (new id, same name) is reconciled', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: f.form\n    element: Task_x\n    name: Review order\n', 'main.bpmn': proc([['userTask', 'Activity_1a2b3c', 'Review order']]), 'f.form': '{}' });
  const r = await validatePackage(dir);
  const rec = r.reconciliations.find((x) => x.label === 'binding[0]');
  assert.ok(rec && rec.candidates.some((c) => c.id === 'Activity_1a2b3c'));
});
await t('5.18a role entry reconciles like a binding', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nroles:\n  - element: Task_old\n    role: Sales\n    name: Quote\n', 'main.bpmn': proc([['userTask', 'Activity_new', 'Quote']]) });
  const r = await validatePackage(dir);
  assert.ok(r.reconciliations.some((x) => x.label === 'roles[0]' && x.candidates.length));
});
await t('5.20 non-interactive validation never applies a reconciliation', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: form\n    ref: f.form\n    element: Task_x\n    name: Review\n', 'main.bpmn': proc([['userTask', 'Activity_new', 'Review']]), 'f.form': '{}' });
  const r = await validatePackage(dir, { interactive: false });
  assert.ok(r.reconciliations.every((x) => x.applied === false));
  assert.ok(r.errors.some((e) => /RECONCILE/.test(e.code)));
});
await t('reconcile tie is ambiguous', () => {
  const rec = reconcile('Review', 'userTask', [{ id: 'A', type: 'userTask', name: 'Review' }, { id: 'B', type: 'userTask', name: 'Review' }]);
  assert.equal(rec.kind, 'ambiguous');
});
await t('viewer 7.15 participant referencing entry is a duplicate', async () => {
  const dir = pkg({ 'package.yaml': 'name: A\nentry: main.bpmn\nbindings:\n  - kind: participant\n    ref: main.bpmn\n    name: Self\n', 'main.bpmn': proc([['startEvent', 'S']]) });
  const r = await validatePackage(dir);
  assert.ok(r.errors.some((e) => e.code === 'PARTICIPANT-DUP-ENTRY'));
});
