#!/usr/bin/env node
// Fixture regression suite. Runs every fixture through layout (when semantics-
// only) and the layout guard (strict mode), asserting the RECORDED outcome.
//
// Runs headless under Node: no browser, no network, no node_modules. If an
// outcome changes, an upstream `bpmn-auto-layout` version bump has drifted and
// the suite fails (layout-guard spec "Upstream behaviour change is detected").
//
//   node scripts/fixtures.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse, layout, xmlHasDI } from './pipeline.mjs';
import { runGuard } from './guard.mjs';
import { ALLOW_LIST } from './envelope.mjs';

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)));
const F = join(SKILL, 'fixtures');

// ── Recorded expected outcomes ──────────────────────────────────────────
// pass:true → strict guard reports no violation.
// pass:false → strict guard MUST report a violation including `codes`.
const EXPECTED = {
  // eight measured fixtures
  'measured/1-linear.bpmn': { pass: true },
  'measured/2-gateway.bpmn': { pass: true },
  'measured/3-boundary.bpmn': { pass: true },
  'measured/7-loop.bpmn': { pass: true },
  'measured/8-long-chain.bpmn': { pass: true },
  'measured/4-subprocess.bpmn': { pass: false, codes: ['G1', 'G3'] }, // identical bounds + non-containment
  'measured/5-pools.bpmn': { pass: false, codes: ['P1'] },           // missing shapes (2nd participant)
  'measured/6-lanes-only.bpmn': { pass: false, codes: ['P1'] },      // lane shapes absent
  // provisional constructs — each must lay out cleanly to stay in the allow-list
  'provisional/manual-task.bpmn': { pass: true },
  'provisional/script-task.bpmn': { pass: true },
  'provisional/send-task.bpmn': { pass: true },
  'provisional/receive-task.bpmn': { pass: true },
  'provisional/call-activity.bpmn': { pass: true },
  'provisional/parallel-gateway.bpmn': { pass: true },
  'provisional/rule-task.bpmn': { pass: true },
  'provisional/intermediate-catch.bpmn': { pass: true },
  'provisional/intermediate-throw.bpmn': { pass: true },
  // 2.3a/2.3b: measured evidence — two boundary events on one activity OVERLAP
  // (Boundary_timer 190.33–226.33 vs Boundary_error 223.66–259.66, both y=92).
  // The construct is therefore NOT in the safe envelope; authoring rejects it.
  'provisional/multi-boundary.bpmn': { pass: false, codes: ['G5'] },
  // synthetic geometric-violation fixtures (carry DI; strict-guarded, not laid out)
  'geometry/g1-identical-bounds.bpmn': { pass: false, codes: ['G1'] },
  'geometry/g2-zero-size.bpmn': { pass: false, codes: ['G2'] },
  'geometry/g3-child-outside.bpmn': { pass: false, codes: ['G3'] },
  'geometry/g4-negative-coord.bpmn': { pass: false, codes: ['G4'] },
  'geometry/g5-overlap.bpmn': { pass: false, codes: ['G5'] },
  // correct expanded sub-process (carries DI) — guard must NOT fire
  'nesting/expanded-subprocess-ok.bpmn': { pass: true },
};

// Which fixture establishes each allow-listed construct (2.8 agreement).
const CONSTRUCT_FIXTURE = {
  startEvent: 'measured/1-linear.bpmn',
  endEvent: 'measured/1-linear.bpmn',
  userTask: 'measured/1-linear.bpmn',
  serviceTask: 'measured/1-linear.bpmn',
  task: 'measured/2-gateway.bpmn',
  exclusiveGateway: 'measured/2-gateway.bpmn',
  boundaryEvent: 'measured/3-boundary.bpmn',
  sequenceFlow: 'measured/1-linear.bpmn',
  manualTask: 'provisional/manual-task.bpmn',
  scriptTask: 'provisional/script-task.bpmn',
  sendTask: 'provisional/send-task.bpmn',
  receiveTask: 'provisional/receive-task.bpmn',
  callActivity: 'provisional/call-activity.bpmn',
  parallelGateway: 'provisional/parallel-gateway.bpmn',
  businessRuleTask: 'provisional/rule-task.bpmn',
  intermediateCatchEvent: 'provisional/intermediate-catch.bpmn',
  intermediateThrowEvent: 'provisional/intermediate-throw.bpmn',
};

function listFixtures() {
  const out = [];
  for (const sub of ['measured', 'provisional', 'geometry', 'nesting']) {
    for (const f of readdirSync(join(F, sub))) {
      if (f.endsWith('.bpmn')) out.push(`${sub}/${f}`);
    }
  }
  return out.sort();
}

async function evaluate(rel) {
  const xml = readFileSync(join(F, rel), 'utf8');
  let toGuard = xml;
  if (!xmlHasDI(xml)) {
    // semantics-only → lay it out (this run's geometry → strict)
    toGuard = await layout(xml);
  }
  const { rootElement } = await parse(toGuard);
  return runGuard(rootElement, { mode: 'strict' });
}

async function main() {
  let failures = 0;
  const files = listFixtures();

  // 1) every fixture must have a recorded expectation
  for (const rel of files) {
    if (!(rel in EXPECTED)) { console.error(`NO EXPECTATION for ${rel}`); failures++; }
  }

  // 2) run each fixture and compare to recorded outcome
  for (const rel of files) {
    const exp = EXPECTED[rel];
    if (!exp) continue;
    let res;
    try { res = await evaluate(rel); }
    catch (e) { console.error(`ERROR ${rel}: ${e.message}`); failures++; continue; }
    const codes = res.violations.map((v) => v.code);
    if (exp.pass) {
      if (res.ok) console.log(`PASS  ${rel}`);
      else { console.error(`FAIL  ${rel} expected pass, got violations [${codes.join(',')}]`); failures++; }
    } else {
      const hasExpected = (exp.codes || []).some((c) => codes.includes(c));
      if (!res.ok && hasExpected) console.log(`PASS  ${rel} (correctly failed: [${codes.join(',')}])`);
      else { console.error(`FAIL  ${rel} expected failure with one of [${(exp.codes || []).join(',')}], got ok=${res.ok} [${codes.join(',')}]`); failures++; }
    }
  }

  // 3) allow-list ⊆ fixtures agreement (2.8)
  for (const construct of ALLOW_LIST) {
    const fx = CONSTRUCT_FIXTURE[construct];
    if (!fx) { console.error(`ALLOW-LIST construct '${construct}' has NO fixture`); failures++; continue; }
    const exp = EXPECTED[fx];
    if (!exp || !exp.pass) { console.error(`ALLOW-LIST construct '${construct}' fixture ${fx} does not pass`); failures++; }
  }
  console.log(`\nallow-list constructs: ${ALLOW_LIST.length}, all mapped to a passing fixture: ${ALLOW_LIST.every((c) => CONSTRUCT_FIXTURE[c] && EXPECTED[CONSTRUCT_FIXTURE[c]]?.pass)}`);

  if (failures) { console.error(`\n${failures} fixture check(s) failed`); process.exit(1); }
  console.log(`\nAll ${files.length} fixtures match their recorded outcomes.`);
}

main();
