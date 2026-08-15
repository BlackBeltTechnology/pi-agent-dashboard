/**
 * Assemble the estimate workbook: one sheet per model layer so a client can
 * change an assumption and see where it lands.
 */

import { AI_SPEEDUP, DEFAULT_HOURS_PER_DAY, ENVIRONMENTAL_FACTORS, TECHNICAL_FACTORS } from "./defaults.js";
import type { Sheet } from "./xlsx.js";
import type { EstimateResult } from "./types.js";

export function buildSheets(r: EstimateResult): Sheet[] {
  const hoursPerDay = r.input.team?.hours_per_day ?? DEFAULT_HOURS_PER_DAY;
  const baseline = r.modes.find((m) => m.mode === 'human_only') ?? r.modes[0];
  const sheets: Sheet[] = [];

  sheets.push({
    name: 'Summary',
    rows: [
      ['Metric', 'Value', 'Unit'],
      ['Project', r.input.project.name, ''],
      ['Currency', r.currency, ''],
      ['Phase', r.cone.phase, ''],
      ['UCP', round(r.sizing.ucp, 2), 'points'],
      ['COCOMO scale exponent E', round(r.scaleExponent, 3), ''],
      ['Scale adjustment', round(r.scaleAdjustment, 3), 'x'],
      ['NFR multiplier', round(r.nfrMultiplier, 3), 'x'],
      ['Base effort', round(r.baseHours), 'h'],
      ['Contingency', round(r.contingency), 'h'],
      ['Total point estimate', round(r.totalHours), 'h'],
      ['P50', round(r.percentiles.p50), 'h'],
      ['P85', round(r.percentiles.p85), 'h'],
      ['P95', round(r.percentiles.p95), 'h'],
      ['Cone low', round(r.cone.low), 'h'],
      ['Cone high', round(r.cone.high), 'h'],
      ['Baseline labour cost', round(baseline.labourCost), r.currency],
    ],
  });

  sheets.push({
    name: 'Work items',
    rows: [
      ['ID', 'Item', 'Source', 'AI class', 'Risk', 'Hours', 'Days', 'AI speedup (likely)'],
      ...r.items.map((it) => [
        it.id,
        it.name,
        it.source,
        it.aiClass,
        it.risk,
        round(it.hours, 2),
        round(it.hours / hoursPerDay, 2),
        AI_SPEEDUP[it.aiClass][1],
      ]),
    ],
  });

  sheets.push({
    name: 'Sizing',
    rows: [
      ['Use case', 'Band', 'UUCW weight'],
      ...r.sizing.perUseCase.map((uc) => [`${uc.id} ${uc.name}`, uc.band, uc.weight]),
      [],
      ['NFR-derived scope', 'From NFR', 'UUCW weight'],
      ...r.sizing.derivedItems.map((d) => [d.name, d.fromNfr, d.weight]),
      [],
      ['Technical factor', 'Weight', 'Rating', 'Contribution'],
      ...Object.entries(TECHNICAL_FACTORS).map(([key, meta]) => {
        const rating = r.input.factors?.technical?.[key] ?? 3;
        return [`${key} ${meta.label}`, meta.weight, rating, round(meta.weight * rating, 2)];
      }),
      [],
      ['Environmental factor', 'Weight', 'Rating', 'Contribution'],
      ...Object.entries(ENVIRONMENTAL_FACTORS).map(([key, meta]) => {
        const rating = r.input.factors?.environmental?.[key] ?? 3;
        return [`${key} ${meta.label}`, meta.weight, rating, round(meta.weight * rating, 2)];
      }),
    ],
  });

  sheets.push({
    name: 'Roles',
    rows: [
      ['Role', 'Hours', 'Days', 'Day rate', 'Cost'],
      ...baseline.roles.map((l) => [l.role, round(l.hours), round(l.days, 2), l.dayRate, round(l.cost)]),
    ],
  });

  sheets.push({
    name: 'Delivery modes',
    rows: [
      ['Mode', 'Hours', 'Days', 'Review h', 'Rework h', 'Labour', 'AI cost', 'Total', 'Calendar months'],
      ...r.modes.map((m) => [
        m.mode,
        round(m.hours),
        round(m.hours / hoursPerDay, 1),
        round(m.reviewHours),
        round(m.reworkHours),
        round(m.labourCost),
        round(m.aiCost),
        round(m.totalCost),
        round(m.calendarMonths, 1),
      ]),
    ],
  });

  if (r.businessCase) {
    const bc = r.businessCase;
    sheets.push({
      name: 'Business case',
      rows: [
        ['Metric', 'Value'],
        ['Build cost', round(bc.buildCost)],
        ['Annual run cost', round(bc.annualRunCost)],
        ['Annual benefit', round(bc.annualBenefit)],
        ['Discount rate', bc.discountRate],
        ['Horizon (years)', bc.horizonYears],
        ['NPV', round(bc.npv)],
        ['ROI', round(bc.roi, 4)],
        ['Payback (years)', bc.paybackYears == null ? 'never' : round(bc.paybackYears, 2)],
        ['TCO', round(bc.tco)],
        [],
        ['Year', 'Cost', 'Benefit', 'Net', 'Discounted', 'Cumulative'],
        ...bc.yearly.map((y) => [y.year, round(y.cost), round(y.benefit), round(y.net), round(y.discounted), round(y.cumulative)]),
        [],
        ['Sensitivity driver', 'Downside NPV', 'Base NPV', 'Upside NPV'],
        ...bc.sensitivity.map((s) => [s.driver, round(s.low), round(s.base), round(s.high)]),
        [],
        ['Scope tier', 'Hours', 'Tier cost', 'Cumulative cost'],
        ...bc.scopeLadder.map((t) => [t.tier, round(t.hours), round(t.cost), round(t.cumulativeCost)]),
      ],
    });
  }

  sheets.push({
    name: 'Assumptions',
    rows: [['#', 'Assumption'], ...r.assumptions.map((a, i) => [i + 1, a]), [], ['#', 'Warning'], ...r.warnings.map((w, i) => [i + 1, w])],
  });

  return sheets;
}

function round(value: number, digits = 0): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}
