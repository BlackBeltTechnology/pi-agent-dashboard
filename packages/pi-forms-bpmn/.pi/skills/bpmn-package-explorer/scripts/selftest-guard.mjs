// §6 layout-guard self-tests: modes, precedence, exemptions, diagnostics.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from './harness.mjs';
import { parse, layout, xmlHasDI, hasDI } from './pipeline.mjs';
import { runGuard } from './guard.mjs';
import { guardXml } from './runguard.mjs';
import { writeDiagnostics, readDiagnostics } from './diagnostics.mjs';

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)));
const fx = (rel) => readFileSync(join(SKILL, 'fixtures', rel), 'utf8');
const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';

await t('6.1/6.2 a DI-bearing file is not laid out (advisory)', async () => {
  const g = await guardXml(fx('nesting/expanded-subprocess-ok.bpmn'), { provenance: 'ingested' });
  assert.equal(g.mode, 'advisory');
  assert.equal(g.laidOut, fx('nesting/expanded-subprocess-ok.bpmn')); // unchanged
});
await t('6.1 layout() refuses to run on a DI-bearing document', async () => {
  await assert.rejects(() => layout(fx('nesting/expanded-subprocess-ok.bpmn')));
});
await t('6.3 partial DI is not re-laid out; shapeless elements warn', async () => {
  // one shape, one missing → advisory P1 warning
  const xml = `<bpmn:definitions ${NS}><bpmn:process id="P"><bpmn:startEvent id="Start_a"/><bpmn:task id="Activity_b" name="B"/></bpmn:process><bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane id="pl" bpmnElement="P"><bpmndi:BPMNShape id="s1" bpmnElement="Start_a"><dc:Bounds x="10" y="10" width="36" height="36"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
  const g = await guardXml(xml, { provenance: 'ingested' });
  assert.equal(g.mode, 'advisory');
  assert.ok(g.result.warnings.some((w) => w.code === 'P1' && w.elements.includes('Activity_b')));
});
await t('6.3a strict on generated, advisory on ingested DI', async () => {
  const gen = await guardXml(fx('measured/1-linear.bpmn'), { provenance: 'generated' });
  assert.equal(gen.mode, 'strict');
  assert.equal(gen.result.ok, true);
});
await t('6.3b ingested DI-less file with a rejected construct is refused', async () => {
  // strip DI from the subprocess measured fixture is already DI-less
  const g = await guardXml(fx('measured/4-subprocess.bpmn'), { provenance: 'ingested' });
  assert.equal(g.refused, true);
  assert.ok(g.diagnostics.some((x) => x.code === 'SUBPROCESS'));
});
await t('6.3b ingested DI-less file inside the envelope is laid out strictly', async () => {
  const g = await guardXml(fx('measured/1-linear.bpmn'), { provenance: 'ingested' });
  assert.equal(g.refused, false);
  assert.equal(g.mode, 'strict');
  assert.equal(g.result.ok, true);
});
await t('6.4/6.12 an annotation overlapping a task does not fire G5', async () => {
  const xml = `<bpmn:definitions ${NS}><bpmn:process id="P"><bpmn:task id="Activity_a" name="A"/><bpmn:textAnnotation id="TextAnnotation_1"><bpmn:text>note</bpmn:text></bpmn:textAnnotation></bpmn:process><bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane id="pl" bpmnElement="P"><bpmndi:BPMNShape id="s1" bpmnElement="Activity_a"><dc:Bounds x="100" y="100" width="100" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="s2" bpmnElement="TextAnnotation_1"><dc:Bounds x="120" y="110" width="100" height="40"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
  const { rootElement } = await parse(xml);
  const r = runGuard(rootElement, { mode: 'strict' });
  assert.ok(!r.violations.some((v) => v.code === 'G5'));
});
await t('6.5 P1 fires on a participant/lane missing a shape (strict)', async () => {
  const laidOut = await layout(fx('measured/5-pools.bpmn'));
  const { rootElement } = await parse(laidOut);
  const r = runGuard(rootElement, { mode: 'strict' });
  assert.ok(r.violations.some((v) => v.code === 'P1'));
});
await t('6.8/6.10 sub-process fixture fires G1 and G3 with bounds in the detail', async () => {
  const laidOut = await layout(fx('measured/4-subprocess.bpmn'));
  const { rootElement } = await parse(laidOut);
  const r = runGuard(rootElement, { mode: 'strict' });
  assert.ok(r.violations.some((v) => v.code === 'G1'));
  assert.ok(r.violations.some((v) => v.code === 'G3'));
  const g3 = r.violations.find((v) => v.code === 'G3');
  assert.ok(/container/.test(g3.detail) && /\d/.test(g3.detail));
});
await t('6.11 G4 is strict-only: advisory does not report a negative coord', async () => {
  const { rootElement } = await parse(fx('geometry/g4-negative-coord.bpmn'));
  const strict = runGuard(rootElement, { mode: 'strict' });
  const advisory = runGuard(rootElement, { mode: 'advisory' });
  assert.ok(strict.violations.some((v) => v.code === 'G4'));
  assert.ok(!advisory.warnings.some((v) => v.code === 'G4'));
});
await t('6.13 verification runs even when moddle parses cleanly', async () => {
  const laidOut = await layout(fx('measured/4-subprocess.bpmn'));
  const { warnings } = await parse(laidOut);
  assert.equal(warnings.length, 0); // clean parse
  const { rootElement } = await parse(laidOut);
  assert.equal(runGuard(rootElement, { mode: 'strict' }).ok, false); // still caught
});
await t('6.16 every diagnostic names invariant, elements, and corrective action', async () => {
  const laidOut = await layout(fx('measured/4-subprocess.bpmn'));
  const { rootElement } = await parse(laidOut);
  const r = runGuard(rootElement, { mode: 'strict' });
  for (const v of r.violations) { assert.ok(v.code); assert.ok(v.elements.length); assert.ok(v.corrective && v.corrective.length > 10); }
});
await t('6.17 diagnostics file is written and read back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'diag-'));
  writeDiagnostics(dir, { warnings: [{ code: 'ORPHAN', message: 'x' }], diagnostics: [] });
  const back = readDiagnostics(dir);
  assert.equal(back.warnings[0].code, 'ORPHAN');
});
await t('6.18 wide 12-task layout is accepted', async () => {
  const g = await guardXml(fx('measured/8-long-chain.bpmn'), { provenance: 'generated' });
  assert.equal(g.result.ok, true);
});
