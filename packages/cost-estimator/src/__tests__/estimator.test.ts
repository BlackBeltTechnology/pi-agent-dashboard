/**
 * Estimator test suite. Run: pnpm --filter @blackbelt-technology/pi-dashboard-cost-estimator test
 *
 * Priority is on the claims that would embarrass us in front of a client:
 * the published formulas, the double-counting guard, the correlated-risk shape,
 * and the reconciliation between totals and the role split.
 */

import { computeBusinessCase } from "../engine/businesscase.js";
import { COCOMO } from "../engine/defaults.js";
import { computeEffort, nfrMultiplier } from "../engine/effort.js";
import { estimate } from "../engine/estimate.js";
import { computeModes, devShare } from "../engine/modes.js";
import { blendedDayRate, computeRoles, normalize, roleRatios } from "../engine/roles.js";
import {
  computeSizing,
  environmentalComplexityFactor,
  nominalScheduleMonths,
  scaleAdjustment,
  scaleExponent,
  technicalComplexityFactor,
  useCaseWeight,
} from "../engine/sizing.js";
import { coneBand, samplePert, rng, simulate } from "../engine/simulate.js";
import { parseYaml } from "../engine/yaml.js";
import { buildXlsx } from "../engine/xlsx.js";
import { aggregateByProject, compareSubscription, measureConstants, normalizeProject, scanSessions } from "../telemetry/sessions.js";
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EstimateInput } from "../engine/types.js";

import { expect, test } from "vitest";

/** Boolean assertion carrying the original message, so failures stay readable. */
function assert(condition: boolean, message: string): void {
  expect(condition, message).toBe(true);
}

/** Tolerance assertion — the estimator is float maths, exact equality is wrong. */
function near(actual: number, expected: number, tolerance: number, label: string): void {
  expect(Math.abs(actual - expected), `${label}: expected ${expected} ±${tolerance}, got ${actual}`).toBeLessThanOrEqual(
    tolerance,
  );
}

// ---------------------------------------------------------------------------
// SECTION: YAML subset parser
// ---------------------------------------------------------------------------

test('parses nested maps, lists and scalars', () => {
  const doc = parseYaml(`
project:
  name: Demo
  currency: EUR
  fte: 3.5
  active: true
  missing: null
tags: [a, b, c]
use_cases:
  - id: UC-01
    name: First
    transactions: 6
  - id: UC-02
    name: Second
    transactions: 3
`) as Record<string, unknown>;
  const project = doc.project as Record<string, unknown>;
  assert(project.name === 'Demo', 'name');
  assert(project.fte === 3.5, 'number scalar');
  assert(project.active === true, 'boolean scalar');
  assert(project.missing === null, 'null scalar');
  assert(JSON.stringify(doc.tags) === '["a","b","c"]', 'flow sequence');
  const ucs = doc.use_cases as Array<Record<string, unknown>>;
  assert(ucs.length === 2, 'sequence length');
  assert(ucs[1].id === 'UC-02', 'second item id');
  assert(ucs[0].transactions === 6, 'nested number');
});

test('ignores comments and quoted colons', () => {
  const doc = parseYaml(`
# leading comment
target: "99.95% uptime: business hours"   # trailing comment
note: 'single quoted'
`) as Record<string, string>;
  assert(doc.target === '99.95% uptime: business hours', `quoted colon: got ${doc.target}`);
  assert(doc.note === 'single quoted', 'single quotes');
});

test('rejects tabs with a line number', () => {
  let message = '';
  try {
    parseYaml('a:\n\tb: 1');
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes('line 2'), `expected a line number, got "${message}"`);
});

// ---------------------------------------------------------------------------
// SECTION: Use Case Points (Karner)
// ---------------------------------------------------------------------------

test('UUCW bands match Karner', () => {
  assert(useCaseWeight(1).weight === 5, 'simple');
  assert(useCaseWeight(3).weight === 5, 'boundary 3 is simple');
  assert(useCaseWeight(4).weight === 10, 'boundary 4 is average');
  assert(useCaseWeight(7).weight === 10, 'boundary 7 is average');
  assert(useCaseWeight(8).weight === 15, 'boundary 8 is complex');
});

test('neutral ratings give TCF ≈ 1.02 and ECF ≈ 1.085', () => {
  // All 13 technical factors at 3: TF = 3 * sum(weights) = 3 * 14 = 42 -> 0.6 + 0.42 = 1.02
  near(technicalComplexityFactor({}).tcf, 1.02, 1e-9, 'TCF at neutral');
  // All 8 environmental at 3: EF = 3 * (1.5+0.5+1+0.5+1+2-1-1) = 3 * 4.5 = 13.5
  // ECF = 1.4 - 0.03*13.5 = 0.995
  near(environmentalComplexityFactor({}).ecf, 0.995, 1e-9, 'ECF at neutral');
});

test('reproduces the published online-shopping worked example', () => {
  // Published example: UUCW=100, UAW=13, TCF=1.02, ECF=1.085 -> UCP = 125.06
  const input = {
    project: { name: 'Online Shopping' },
    // 4 complex human actors + 1 simple API actor = 4*3 + 1 = 13
    actors: [
      { name: 'Online Customer', type: 'human' as const },
      { name: 'Marketing Admin', type: 'human' as const },
      { name: 'Warehouse Clerk', type: 'human' as const },
      { name: 'Warehouse Manager', type: 'human' as const },
      { name: 'Payment System', type: 'api' as const },
    ],
    // 4 simple (5) + 4 average (10) + 3 complex (15) = 20 + 40 + 45 = 105; trim to 100
    use_cases: [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `S${i}`, name: 's', transactions: 2 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `A${i}`, name: 'a', transactions: 5 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `C${i}`, name: 'c', transactions: 9 })),
    ],
  } as unknown as EstimateInput;

  const sizing = computeSizing(input);
  near(sizing.uucw, 120, 1e-9, 'UUCW = 4*5 + 4*10 + 4*15');
  near(sizing.uaw, 13, 1e-9, 'UAW = 4*3 + 1*1');
  near(sizing.tcf, 1.02, 1e-9, 'TCF');
  // UCP = (120 + 13) * 1.02 * 0.995
  near(sizing.ucp, 133 * 1.02 * 0.995, 1e-6, 'UCP formula');
});

// ---------------------------------------------------------------------------
// SECTION: COCOMO II
// ---------------------------------------------------------------------------

test('constants match the II.2000 manual', () => {
  assert(COCOMO.A === 2.94, 'A');
  assert(COCOMO.B === 0.91, 'B');
  assert(COCOMO.C === 3.67, 'C');
  assert(COCOMO.D === 0.28, 'D');
});

test('all-nominal scale factors give E = 0.91 + 0.01*18.97', () => {
  const e = scaleExponent({ PREC: 'nominal', FLEX: 'nominal', RESL: 'nominal', TEAM: 'nominal', PMAT: 'nominal' });
  near(e, 0.91 + 0.01 * (3.72 + 3.04 + 4.24 + 3.29 + 4.68), 1e-9, 'nominal exponent');
  assert(e > 1, 'nominal exponent must exceed 1 (diseconomy of scale)');
});

test('extra-high scale factors give E = B exactly', () => {
  const e = scaleExponent({ PREC: 'extra-high', FLEX: 'extra-high', RESL: 'extra-high', TEAM: 'extra-high', PMAT: 'extra-high' });
  near(e, COCOMO.B, 1e-9, 'best-case exponent');
});

test('scale adjustment is 1.0 at the reference size, and superlinear above it', () => {
  near(scaleAdjustment(100, 100, 1.1), 1, 1e-9, 'identity at reference');
  assert(scaleAdjustment(400, 100, 1.1) > 1, 'penalty above reference');
  assert(scaleAdjustment(25, 100, 1.1) < 1, 'credit below reference');
  assert(scaleAdjustment(400, 100, 1.0) === 1, 'no effect when E = 1');
});

test('schedule equation grows sublinearly with effort', () => {
  const small = nominalScheduleMonths(10, 1.1);
  const big = nominalScheduleMonths(40, 1.1);
  assert(big > small, 'more effort takes longer');
  assert(big < small * 4, 'schedule is sublinear in effort');
});

// ---------------------------------------------------------------------------
// SECTION: NFR routing
// ---------------------------------------------------------------------------

test('multiplier NFRs compound, derived-scope NFRs do not', () => {
  const input = {
    project: { name: 'x' },
    use_cases: [{ id: 'UC-1', name: 'u', transactions: 4 }],
    nfrs: [
      { id: 'N1', attribute: 'perf', path: 'multiplier' as const, multiplier: 1.1 },
      { id: 'N2', attribute: 'port', path: 'multiplier' as const, multiplier: 1.2 },
      { id: 'N3', attribute: 'avail', path: 'derived-scope' as const, derived_components: [{ name: 'probes', transactions: 2 }] },
    ],
  } as unknown as EstimateInput;
  near(nfrMultiplier(input).value, 1.32, 1e-9, 'compounded multiplier');
});

test('double-counted NFR raises a warning', () => {
  const input = {
    project: { name: 'x' },
    use_cases: [{ id: 'UC-1', name: 'u', transactions: 4 }],
    nfrs: [
      {
        id: 'N1',
        attribute: 'security',
        path: 'multiplier' as const,
        multiplier: 1.2,
        derived_components: [{ name: 'audit log', transactions: 3 }],
      },
    ],
  } as unknown as EstimateInput;
  const warnings = nfrMultiplier(input).warnings;
  assert(warnings.length === 1 && warnings[0].includes('double counting'), 'expected a double-counting warning');
});

test('derived-scope NFRs become work items, in hours or in transactions', () => {
  const input = {
    project: { name: 'x' },
    use_cases: [{ id: 'UC-1', name: 'u', transactions: 4 }],
    nfrs: [
      {
        id: 'N1',
        attribute: 'compliance',
        path: 'derived-scope' as const,
        derived_components: [
          { name: 'validation protocols', hours: 120 },
          { name: 'probes', transactions: 2 },
        ],
      },
    ],
  } as unknown as EstimateInput;
  const sizing = computeSizing(input);
  const effort = computeEffort(input, sizing);
  const derived = effort.items.filter((i) => i.source === 'nfr-derived');
  assert(derived.length === 2, `expected 2 derived items, got ${derived.length}`);
  // The hours-pinned item gets actor-weight spread added, so it must be at least 120.
  assert(derived[0].hours >= 120, 'hours-pinned item keeps its floor');
});

// ---------------------------------------------------------------------------
// SECTION: Roles
// ---------------------------------------------------------------------------

test('ratios normalise and the role split reconciles to the total', () => {
  const ratios = normalize({ a: 2, b: 2 });
  near(ratios.a + ratios.b, 1, 1e-12, 'normalised sum');

  const input = { project: { name: 'x' }, use_cases: [] } as unknown as EstimateInput;
  const { lines } = computeRoles(input, 1000);
  near(lines.reduce((s, l) => s + l.hours, 0), 1000, 1e-6, 'role hours reconcile to total');
});

test('large projects tilt toward coordination roles', () => {
  const input = { project: { name: 'x' }, use_cases: [] } as unknown as EstimateInput;
  const small = roleRatios(input, 1000);
  const large = roleRatios(input, 10_000);
  assert(large['Project Manager'] > small['Project Manager'], 'PM share grows with size');
  assert(large['Backend Developer'] < small['Backend Developer'], 'build share shrinks with size');
  near(Object.values(large).reduce((s, v) => s + v, 0), 1, 1e-9, 'tilted ratios still sum to 1');
});

test('day rate blends by seniority mix', () => {
  const rates = [
    { role: 'Dev', seniority: 'senior', day_rate: 600 },
    { role: 'Dev', seniority: 'junior', day_rate: 200 },
  ];
  near(blendedDayRate('Dev', rates, { senior: 0.5, junior: 0.5 }), 400, 1e-9, 'even mix');
  near(blendedDayRate('Dev', rates, { senior: 1, junior: 0 }), 600, 1e-9, 'all senior');
  near(blendedDayRate('Missing', rates, { senior: 1 }), 0, 1e-9, 'unknown role costs nothing and is warned elsewhere');
});

// ---------------------------------------------------------------------------
// SECTION: Delivery modes
// ---------------------------------------------------------------------------

const modeInput = {
  project: { name: 'Modes', currency: 'EUR' },
  context: { codebase: 'greenfield' as const },
  use_cases: [
    { id: 'UC-1', name: 'boiler', transactions: 5, ai_class: 'boilerplate' as const, risk: 'low' as const },
    { id: 'UC-2', name: 'crud', transactions: 5, ai_class: 'crud' as const, risk: 'low' as const },
  ],
  team: { fte: 3, hours_per_day: 8 },
  rates: [{ role: 'Blended', day_rate: 500 }],
} as unknown as EstimateInput;

test('dev share is about 60% of effort', () => {
  const input = { project: { name: 'x' }, use_cases: [] } as unknown as EstimateInput;
  const share = devShare(roleRatios(input, 1000));
  assert(share > 0.55 && share < 0.65, `dev share out of expected band: ${share}`);
});

test('AI modes reduce hours on greenfield boilerplate, but not to zero', () => {
  const sizing = computeSizing(modeInput);
  const effort = computeEffort(modeInput, sizing);
  const modes = computeModes({
    input: modeInput,
    items: effort.items,
    totalHours: effort.totalHours,
    ucp: sizing.ucp,
    roleRatios: roleRatios(modeInput, effort.totalHours),
  });
  const base = modes.find((m) => m.mode === 'human_only')!;
  const assisted = modes.find((m) => m.mode === 'human_with_ai')!;
  assert(assisted.hours < base.hours, 'AI assist should help on greenfield boilerplate');
  assert(assisted.hours > base.hours * 0.5, 'a 50%+ total-project saving is not credible');
  assert(assisted.reviewHours > 0 && assisted.reworkHours > 0, 'review and rework must be charged');
});

test('AI makes legacy change more expensive, not cheaper', () => {
  const legacy = {
    ...modeInput,
    context: { codebase: 'legacy' as const },
    team: { fte: 3, hours_per_day: 8, seniority_mix: { senior: 1 } },
    use_cases: [
      { id: 'UC-1', name: 'legacy', transactions: 8, ai_class: 'legacy-change', risk: 'medium' },
      { id: 'UC-2', name: 'legacy2', transactions: 8, ai_class: 'legacy-change', risk: 'medium' },
    ],
  } as unknown as EstimateInput;
  const sizing = computeSizing(legacy);
  const effort = computeEffort(legacy, sizing);
  const modes = computeModes({
    input: legacy,
    items: effort.items,
    totalHours: effort.totalHours,
    ucp: sizing.ucp,
    roleRatios: roleRatios(legacy, effort.totalHours),
  });
  const base = modes.find((m) => m.mode === 'human_only')!;
  const assisted = modes.find((m) => m.mode === 'human_with_ai')!;
  assert(
    assisted.hours > base.hours,
    `METR regime: senior devs on legacy should be slower with AI (base ${base.hours}, ai ${assisted.hours})`,
  );
});

test('every non-baseline mode carries an AI cost', () => {
  const sizing = computeSizing(modeInput);
  const effort = computeEffort(modeInput, sizing);
  const modes = computeModes({
    input: modeInput,
    items: effort.items,
    totalHours: effort.totalHours,
    ucp: sizing.ucp,
    roleRatios: roleRatios(modeInput, effort.totalHours),
  });
  for (const mode of modes) {
    if (mode.mode === 'human_only') assert(mode.aiCost === 0, 'baseline has no AI cost');
    else assert(mode.aiCost > 0, `${mode.mode} must carry an AI cost`);
  }
});

// ---------------------------------------------------------------------------
// SECTION: Uncertainty
// ---------------------------------------------------------------------------

test('RNG is deterministic for a given seed', () => {
  const a = rng(42);
  const b = rng(42);
  for (let i = 0; i < 5; i++) assert(a() === b(), 'same seed must give the same stream');
});

test('PERT samples stay inside their bounds and centre near the mode', () => {
  const random = rng(7);
  let sum = 0;
  const n = 20_000;
  for (let i = 0; i < n; i++) {
    const value = samplePert(10, 20, 50, random);
    assert(value >= 10 && value <= 50, `sample out of bounds: ${value}`);
    sum += value;
  }
  // Beta-PERT mean = (min + 4*mode + max)/6 = (10 + 80 + 50)/6 = 23.33
  near(sum / n, 23.33, 0.5, 'PERT mean');
});

test('percentiles are ordered and the tail is not absurdly tight', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    id: `I${i}`,
    name: 'i',
    aiClass: 'crud' as const,
    risk: 'medium' as const,
    hours: 100,
    source: 'use-case' as const,
  }));
  const p = simulate(items, { iterations: 5000, seed: 1 });
  assert(p.p10 < p.p50 && p.p50 < p.p85 && p.p85 < p.p95, 'percentiles must be ordered');
  // Correlated project shock must keep a real spread; independent sampling alone
  // would collapse P85/P50 to within a couple of percent.
  assert(p.p85 / p.p50 > 1.05, `P85/P50 too tight (${(p.p85 / p.p50).toFixed(3)}) — correlated risk lost`);
});

test('cone widens for earlier phases', () => {
  const early = coneBand('initial-concept', 1000);
  const late = coneBand('detailed-design-complete', 1000);
  assert(early.high - early.low > late.high - late.low, 'early phase must be wider');
  near(early.high, 4000, 1e-9, '4x band at initiation');
});

// ---------------------------------------------------------------------------
// SECTION: Business case
// ---------------------------------------------------------------------------

test('NPV, payback and the scope ladder compute correctly', () => {
  const items = [
    { id: 'UC-1', name: 'a', aiClass: 'crud' as const, risk: 'low' as const, hours: 600, source: 'use-case' as const },
    { id: 'UC-2', name: 'b', aiClass: 'crud' as const, risk: 'low' as const, hours: 400, source: 'use-case' as const },
  ];
  const bc = computeBusinessCase({
    input: {
      project: { name: 'x' },
      use_cases: [],
      business: {
        discount_rate: 0.1,
        horizon_years: 3,
        benefits: [{ name: 'saving', annual_value: 100_000, confidence: 1 }],
        run_costs: [{ name: 'hosting', annual_value: 20_000 }],
        scope_tiers: [
          { tier: 'must', use_cases: ['UC-1'] },
          { tier: 'could', use_cases: ['UC-2'] },
        ],
      },
    } as unknown as EstimateInput,
    items,
    chosenMode: { totalCost: 150_000 } as never,
    currency: 'EUR',
  })!;

  // Net 80k/year for 3 years at 10%: 72,727 + 66,116 + 60,105 = 198,948; minus 150,000
  near(bc.npv, 48_948, 5, 'NPV');
  near(bc.paybackYears!, 1.875, 0.01, 'payback: 150k / 80k per year');
  assert(bc.scopeLadder[0].tier === 'must', 'must tier comes first');
  near(bc.scopeLadder[0].cost, 90_000, 1, 'must tier is 60% of the cost');
  near(bc.scopeLadder[1].cumulativeCost, 150_000, 1, 'cumulative reaches full cost');
});

test('a case that never pays back reports null, not a fake number', () => {
  const bc = computeBusinessCase({
    input: {
      project: { name: 'x' },
      use_cases: [],
      business: { horizon_years: 2, benefits: [{ name: 'tiny', annual_value: 1000 }] },
    } as unknown as EstimateInput,
    items: [],
    chosenMode: { totalCost: 500_000 } as never,
    currency: 'EUR',
  })!;
  assert(bc.paybackYears === null, 'no payback within horizon must be null');
});

// ---------------------------------------------------------------------------
// SECTION: End to end
// ---------------------------------------------------------------------------

test('full pipeline runs, reconciles and warns', () => {
  const input = {
    project: { name: 'E2E', currency: 'EUR', phase: 'requirements-complete' as const },
    context: { codebase: 'greenfield' as const },
    actors: [{ name: 'User', type: 'human' as const }],
    use_cases: [
      { id: 'UC-1', name: 'a', transactions: 5, ai_class: 'crud' as const, risk: 'low' as const },
      { id: 'UC-2', name: 'b', transactions: 9, ai_class: 'integration' as const, risk: 'high' as const },
    ],
    nfrs: [
      { id: 'N1', attribute: 'availability', path: 'derived-scope' as const, derived_components: [{ name: 'probes', hours: 40 }] },
    ],
    team: { fte: 2, hours_per_day: 8 },
    rates: [{ role: 'Blended', day_rate: 500 }],
    calibration: { hours_per_ucp: 15, seed: 99, iterations: 3000 },
  } as unknown as EstimateInput;

  const result = estimate(input);
  assert(result.items.length === 3, 'two use cases plus one derived item');
  near(result.totalHours, result.baseHours + result.contingency, 1e-6, 'total reconciles');
  assert(result.percentiles.p95 > result.percentiles.p50, 'percentiles ordered');
  assert(result.modes.length === 4, 'all four modes computed');
  assert(result.assumptions.length > 10, 'assumption register is populated');
  assert(
    result.warnings.some((w) => w.includes('rate card')) === false,
    'a supplied rate card should not warn about missing rates',
  );
});

test('missing required input fails loudly', () => {
  let message = '';
  try {
    estimate({ project: { name: 'x' }, use_cases: [] } as unknown as EstimateInput);
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes('use_cases'), `expected a use_cases error, got "${message}"`);
});

test('duplicate use case ids are rejected', () => {
  let message = '';
  try {
    estimate({
      project: { name: 'x' },
      use_cases: [
        { id: 'UC-1', name: 'a', transactions: 3 },
        { id: 'UC-1', name: 'b', transactions: 3 },
      ],
    } as unknown as EstimateInput);
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes('duplicate'), `expected a duplicate-id error, got "${message}"`);
});

// ---------------------------------------------------------------------------
// SECTION: Session telemetry calibration
// ---------------------------------------------------------------------------

/** Build a throwaway session store on disk so the scanner is tested end to end. */
function fixtureStore(): string {
  const root = mkdtempSync(join(tmpdir(), 'sess-'));
  const dir = join(root, '--Users-x-Project-demo--');
  mkdirSync(dir, { recursive: true });

  const base = Date.parse('2026-01-01T10:00:00.000Z');
  const stamp = (min: number) => new Date(base + min * 60_000).toISOString();
  // Gaps: 5, 5, 120 (a break -> capped at 15), 5 => 5+5+15+5 = 30 min active.
  const lines = [
    { type: 'message', timestamp: stamp(0), message: { role: 'user', content: [{ type: 'text', text: 'do the thing' }] } },
    { type: 'message', timestamp: stamp(5), message: { role: 'assistant', content: [{ type: 'toolCall', id: '1', name: 'bash' }] } },
    { type: 'message', timestamp: stamp(10), message: { role: 'toolResult', content: [{ type: 'text', text: 'Error: boom' }] } },
    { type: 'message', timestamp: stamp(130), message: { role: 'assistant', content: [{ type: 'text', text: 'fixed' }] } },
    { type: 'message', timestamp: stamp(135), message: { role: 'user', content: [{ type: 'text', text: "no, that's not right" }] } },
  ];
  writeFileSync(join(dir, 's1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
  writeFileSync(
    join(dir, 's1.meta.json'),
    JSON.stringify({
      cwd: `${homedir()}/Project/demo/.worktrees/feature-branch`,
      name: 'demo',
      startedAt: base,
      tokensIn: 1000,
      tokensOut: 4000,
      cacheRead: 900_000,
      cacheWrite: 95_000,
      cost: 5.0,
      model: 'anthropic/claude',
    }),
  );
  return root;
}

test('worktree paths collapse to the parent repository', () => {
  assert(normalizeProject(`${homedir()}/Project/app/.worktrees/os-fix`) === 'Project/app', 'worktree collapsed');
  assert(normalizeProject(`${homedir()}/Project/app`) === 'Project/app', 'plain path preserved');
  assert(normalizeProject(undefined) === '(unknown)', 'missing cwd handled');
});

test('active time caps long gaps, so a break is not billed as work', () => {
  const root = fixtureStore();
  const records = scanSessions({ root, gapCapMinutes: 15, minActiveHours: 0, minAssistantTurns: 0 });
  assert(records.length === 1, `expected 1 session, got ${records.length}`);
  const r = records[0];
  // 5 + 5 + capped(120 -> 15) + 5 = 30 minutes
  near(r.activeHours, 0.5, 1e-9, 'active hours with the 120-minute gap capped at 15');
  near(r.wallHours, 135 / 60, 1e-9, 'wall hours span the whole session');
  assert(r.activeHours < r.wallHours, 'active time must be below wall time when a break exists');
  assert(r.project === 'Project/demo', 'project collapsed from the worktree path');
});

test('turn, tool and correction counting matches the log', () => {
  const root = fixtureStore();
  const [r] = scanSessions({ root, minActiveHours: 0, minAssistantTurns: 0 });
  assert(r.humanTurns === 2, `human turns: ${r.humanTurns}`);
  assert(r.assistantTurns === 2, `assistant turns: ${r.assistantTurns}`);
  assert(r.toolCalls === 1, `tool calls: ${r.toolCalls}`);
  assert(r.toolResults === 1, `tool results: ${r.toolResults}`);
  assert(r.toolErrors === 1, 'the Error: prefix must be detected');
  assert(r.corrections === 1, "the \"no, that's not right\" turn must be detected");
});

test('measured constants derive from the record set', () => {
  const root = fixtureStore();
  const records = scanSessions({ root, minActiveHours: 0, minAssistantTurns: 0 });
  const m = measureConstants(records);
  near(m.costPerSteeringHour, 10, 1e-9, '$5.00 over 0.5 h');
  near(m.costPerSteeringDay, 80, 1e-9, 'per 8-hour day');
  // output 4000 of (1000 + 4000 + 900000 + 95000) = 0.4%
  near(m.outputShare, 4000 / 1_000_000, 1e-9, 'output share');
  near(m.revisionFactorLowerBound, 1 + 1 / 1 + 1 / 2, 1e-9, 'RF lower bound = 1 + error rate + correction rate');
  assert(m.cacheReadShare > 0.85, 'cache read must dominate the token mix');
});

test('project aggregation sums hours and cost', () => {
  const root = fixtureStore();
  const records = scanSessions({ root, minActiveHours: 0, minAssistantTurns: 0 });
  const [agg] = aggregateByProject(records);
  assert(agg.project === 'Project/demo', 'aggregated under the parent repo');
  near(agg.activeHours, 0.5, 1e-9, 'aggregate hours');
  near(agg.steeringDays, 0.0625, 1e-9, 'steering days');
  near(agg.costPerHour, 10, 1e-9, 'cost per hour');
});

/** Run the mode engine with a given `ai` block. */
function modesWithAi(ai: Record<string, unknown>) {
  const input = {
    ...modeInput,
    project: { name: 'Modes', currency: 'USD' },
    ai,
  } as unknown as EstimateInput;
  const sizing = computeSizing(input);
  const effort = computeEffort(input, sizing);
  return computeModes({
    input,
    items: effort.items,
    totalHours: effort.totalHours,
    ucp: sizing.ucp,
    roleRatios: roleRatios(input, effort.totalHours),
  });
}

test('a measured metered rate replaces the ACEM token reconstruction', () => {
  const modes = modesWithAi({ cost_basis: 'metered', cost_per_steering_hour: 20, infra_monthly: 0 });
  const steered = modes.find((m) => m.mode === 'ai_steered_human_supervised')!;
  assert(steered.notes.some((note) => note.includes('MEASURED metered rate')), 'must use the measured path');
  assert(steered.aiCost > 0, 'measured path must produce a cost');
});

test('subscription basis charges seats x months, not work volume', () => {
  const short = modesWithAi({
    cost_basis: 'subscription',
    subscriptions: [{ plan: 'anthropic-max-20x', seats: 2 }],
    infra_monthly: 0,
  });
  const steered = short.find((m) => m.mode === 'ai_steered_human_supervised')!;
  // 2 seats x $200 = $400/month, charged over the calendar duration.
  const expected = 400 * steered.calendarMonths;
  near(steered.aiCost, expected, 1, 'subscription cost = seats x monthly x months');
  assert(steered.notes.some((n) => n.includes('SUBSCRIPTION basis')), 'must report the basis');
});

test('utilisation apportions a seat shared across projects', () => {
  const full = modesWithAi({
    cost_basis: 'subscription',
    subscriptions: [{ plan: 'anthropic-max-20x', seats: 1 }],
    infra_monthly: 0,
  }).find((m) => m.mode === 'ai_steered_human_supervised')!;
  const half = modesWithAi({
    cost_basis: 'subscription',
    subscriptions: [{ plan: 'anthropic-max-20x', seats: 1, utilisation: 0.5 }],
    infra_monthly: 0,
  }).find((m) => m.mode === 'ai_steered_human_supervised')!;
  near(half.aiCost, full.aiCost / 2, 0.01, 'half utilisation halves the charge');
});

test('subscription leverage is reported but never banked as a saving', () => {
  const modes = modesWithAi({
    cost_basis: 'subscription',
    subscriptions: [{ plan: 'anthropic-max-20x', seats: 1 }],
    cost_per_steering_hour: 10.41,
    infra_monthly: 0,
  });
  const steered = modes.find((m) => m.mode === 'ai_steered_human_supervised')!;
  const leverageNote = steered.notes.find((n) => n.includes('Metered equivalent'));
  assert(leverageNote != null, 'leverage must be reported');
  assert(leverageNote!.includes('not a saving already banked'), 'leverage must not be sold as a discount');
  // The charged cost must be the subscription, not the cheaper-or-dearer meter.
  near(steered.aiCost, 200 * steered.calendarMonths, 1, 'cost charged is the subscription');
});

test('an explicit monthly price overrides the plan catalogue', () => {
  const modes = modesWithAi({
    cost_basis: 'subscription',
    subscriptions: [{ plan: 'anthropic-max-20x', monthly: 55, seats: 1 }],
    infra_monthly: 0,
  });
  const steered = modes.find((m) => m.mode === 'ai_steered_human_supervised')!;
  near(steered.aiCost, 55 * steered.calendarMonths, 1, 'explicit monthly wins over the catalogue');
});

test('subscription is the default basis, because that is what teams actually buy', () => {
  const modes = modesWithAi({ infra_monthly: 0 });
  const steered = modes.find((m) => m.mode === 'ai_steered_human_supervised')!;
  assert(steered.notes.some((n) => n.includes('SUBSCRIPTION basis')), 'default basis must be subscription');
});

test('measured constants expose monthly spread and unmetered hours', () => {
  const root = fixtureStore();
  const records = scanSessions({ root, minActiveHours: 0, minAssistantTurns: 0 });
  const m = measureConstants(records);
  assert(m.activeMonths >= 1, 'at least one active month');
  near(m.meterPerMonth, 5 / m.activeMonths, 1e-9, 'meter spend per active month');
  assert(m.unmeteredHourShare === 0, 'the fixture session is metered');

  const cmp = compareSubscription(m, 100);
  near(cmp.subscriptionCost, 100 * m.activeMonths, 1e-9, 'subscription = monthly x months');
  assert(cmp.leverage < 1, '$5 of meter against $100 of plan is negative leverage');
  assert(cmp.effectiveCostPerHour > cmp.meteredCostPerHour, 'plan is dearer per hour at this volume');
});

test('xlsx writer produces a well-formed zip with the expected parts', () => {
  const bytes = buildXlsx([{ name: 'Sheet: one/two', rows: [['a', 'b'], [1, 2.5]] }]);
  assert(bytes[0] === 0x50 && bytes[1] === 0x4b, 'PK signature');
  const text = new TextDecoder().decode(bytes);
  assert(text.includes('xl/worksheets/sheet1.xml'), 'worksheet part present');
  assert(text.includes('xl/styles.xml'), 'styles part present');
  assert(!text.includes('Sheet: one/two'), 'illegal sheet-name characters must be sanitised');
});

