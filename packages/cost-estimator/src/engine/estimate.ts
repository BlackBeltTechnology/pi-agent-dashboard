/**
 * Orchestrator: input -> sizing -> effort -> roles -> modes -> uncertainty -> business case.
 */

import { computeBusinessCase } from "./businesscase.js";
import {
  ACEM_SRC,
  AI_SPEEDUP_SRC,
  COCOMO_SRC,
  CONE_SRC,
  CONTINGENCY_SRC,
  DEFAULT_CONTINGENCY,
  DEFAULT_CURRENCY,
  DEFAULT_HOURS_PER_DAY,
  DEFAULT_HOURS_PER_UCP,
  DEFAULT_REFERENCE_UCP,
  HOURS_PER_UCP_SRC,
  PERT_SRC,
  REWORK_UPLIFT_SRC,
  ROLE_RATIO_SRC,
  STEERING_OVERHEAD_SRC,
  UCP_FACTOR_SRC,
} from "./defaults.js";
import { computeEffort } from "./effort.js";
import { computeModes } from "./modes.js";
import { roleRatios } from "./roles.js";
import { computeSizing, nominalScheduleMonths } from "./sizing.js";
import { coneBand, simulate } from "./simulate.js";
import type { EstimateInput, EstimateResult } from "./types.js";

/** Run the full estimation pipeline. */
export function estimate(input: EstimateInput): EstimateResult {
  validate(input);

  const currency = input.project.currency ?? DEFAULT_CURRENCY;
  const sizing = computeSizing(input);
  const effort = computeEffort(input, sizing);
  const ratios = roleRatios(input, effort.totalHours);

  const modes = computeModes({
    input,
    items: effort.items,
    totalHours: effort.totalHours,
    ucp: sizing.ucp,
    roleRatios: ratios,
  });

  // Uncertainty is simulated on the human-only baseline and reported on the
  // contingency-inclusive total, so the scale factor carries the buffer through.
  const scale = effort.baseHours > 0 ? effort.totalHours / effort.baseHours : 1;
  const percentiles = simulate(effort.items, {
    iterations: input.calibration?.iterations,
    seed: input.calibration?.seed,
    scale,
  });

  const cone = coneBand(input.project.phase, effort.totalHours);
  const chosenMode = modes.find((m) => m.mode === 'human_with_ai') ?? modes[0];
  const businessCase = computeBusinessCase({ input, items: effort.items, chosenMode, currency });

  const warnings = [...effort.warnings];
  const hoursPerDay = input.team?.hours_per_day ?? DEFAULT_HOURS_PER_DAY;
  const personMonths = effort.totalHours / (hoursPerDay * 20);
  const nominalMonths = nominalScheduleMonths(personMonths, effort.exponent);
  const humanMode = modes.find((m) => m.mode === 'human_only');
  if (humanMode && nominalMonths > 0 && humanMode.calendarMonths < nominalMonths * 0.75) {
    warnings.push(
      `Schedule risk: planned ${humanMode.calendarMonths.toFixed(1)} months is below the COCOMO II nominal ` +
        `${nominalMonths.toFixed(1)} months for this effort. Compressing schedule below ~75% of nominal is where ` +
        `projects historically break.`,
    );
  }
  if (!input.rates?.length) warnings.push('No rate card supplied — costs are zero. Load rates.yaml or set project rates.');
  if (!input.factors?.technical) warnings.push('No UCP technical factors given; all 13 defaulted to 3 (neutral).');
  if (!input.factors?.environmental) warnings.push('No UCP environmental factors given; all 8 defaulted to 3 (neutral).');
  if (!input.project.phase) warnings.push('No project phase set; cone of uncertainty defaulted to approved-product-definition (0.5x-2x).');

  return {
    input,
    currency,
    sizing,
    items: effort.items,
    nfrMultiplier: effort.nfrMultiplier,
    scaleExponent: effort.exponent,
    scaleAdjustment: effort.adjustment,
    baseHours: effort.baseHours,
    contingency: effort.contingency,
    totalHours: effort.totalHours,
    cone,
    percentiles,
    modes,
    businessCase,
    assumptions: assumptions(input, nominalMonths),
    warnings,
  };
}

function validate(input: EstimateInput): void {
  if (!input.project?.name) throw new Error('input.project.name is required');
  if (!Array.isArray(input.use_cases) || input.use_cases.length === 0) {
    throw new Error('input.use_cases must be a non-empty list');
  }
  const ids = new Set<string>();
  for (const uc of input.use_cases) {
    if (!uc.id) throw new Error('every use case needs an id');
    if (ids.has(uc.id)) throw new Error(`duplicate use case id: ${uc.id}`);
    ids.add(uc.id);
  }
  for (const nfr of input.nfrs ?? []) {
    if (nfr.path !== 'derived-scope' && nfr.path !== 'multiplier') {
      throw new Error(`NFR ${nfr.id}: path must be "derived-scope" or "multiplier"`);
    }
  }
}

/** The assumption register that must travel with every estimate. */
function assumptions(input: EstimateInput, nominalMonths: number): string[] {
  const cal = input.calibration ?? {};
  return [
    `Sizing: Use Case Points (Karner). ${UCP_FACTOR_SRC}`,
    `Effort: ${cal.hours_per_ucp ?? DEFAULT_HOURS_PER_UCP} h/UCP at a reference size of ${cal.reference_ucp ?? DEFAULT_REFERENCE_UCP} UCP. ${HOURS_PER_UCP_SRC}`,
    `Scale: ${COCOMO_SRC}. Diseconomy of scale applied relative to the reference size.`,
    `Contingency: ${((cal.contingency ?? DEFAULT_CONTINGENCY) * 100).toFixed(0)}%. ${CONTINGENCY_SRC}`,
    `Man-day: ${input.team?.hours_per_day ?? DEFAULT_HOURS_PER_DAY} productive hours; 20 working days per month.`,
    `Roles: ${ROLE_RATIO_SRC}`,
    `AI speedups: ${AI_SPEEDUP_SRC}`,
    `AI rework: ${REWORK_UPLIFT_SRC}`,
    `AI-steered mode: ${STEERING_OVERHEAD_SRC}`,
    `Agentic mode: ${ACEM_SRC}`,
    `Uncertainty: ${PERT_SRC}`,
    `Cone: ${CONE_SRC}`,
    `COCOMO II nominal schedule for this effort: ${nominalMonths.toFixed(1)} months.`,
    'This is an ESTIMATE, not a target and not a commitment (McConnell).',
  ];
}
