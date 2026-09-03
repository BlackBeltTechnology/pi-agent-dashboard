/**
 * Effort layer: turn UCP into human-only hours per work item, apply the
 * residual NFR multiplier, and expand NFR-derived scope into real work items.
 */

import {
  DEFAULT_CONTINGENCY,
  DEFAULT_HOURS_PER_UCP,
  DEFAULT_REFERENCE_UCP,
} from "./defaults.js";
import { scaleAdjustment, scaleExponent, useCaseWeight } from "./sizing.js";
import type { AiClass, EstimateInput, RiskLevel, SizingResult, WorkItem } from "./types.js";

export interface EffortResult {
  items: WorkItem[];
  nfrMultiplier: number;
  exponent: number;
  adjustment: number;
  baseHours: number;
  contingency: number;
  totalHours: number;
  warnings: string[];
}

/** Residual multiplier from NFRs routed to the `multiplier` path. */
export function nfrMultiplier(input: EstimateInput): { value: number; warnings: string[] } {
  const warnings: string[] = [];
  let value = 1;
  for (const nfr of input.nfrs ?? []) {
    if (nfr.path !== 'multiplier') continue;
    if (nfr.derived_components?.length) {
      warnings.push(
        `NFR ${nfr.id} is routed to "multiplier" but also declares derived_components — ` +
          `that is double counting. Pick one path.`,
      );
    }
    value *= nfr.multiplier ?? 1;
  }
  return { value, warnings };
}

/** Default AI class inference when the caller did not classify a use case. */
function inferAiClass(input: EstimateInput, transactions: number): AiClass {
  if (input.context?.codebase === 'legacy') return 'legacy-change';
  return transactions <= 3 ? 'crud' : 'algorithmic';
}

/** Build the full work-item list and the total human-only hour estimate. */
export function computeEffort(input: EstimateInput, sizing: SizingResult): EffortResult {
  const cal = input.calibration ?? {};
  const hoursPerUcp = cal.hours_per_ucp ?? DEFAULT_HOURS_PER_UCP;
  const referenceUcp = cal.reference_ucp ?? DEFAULT_REFERENCE_UCP;
  const contingencyRate = cal.contingency ?? DEFAULT_CONTINGENCY;

  const exponent = scaleExponent(input.factors?.cocomo_scale);
  const adjustment = scaleAdjustment(sizing.ucp, referenceUcp, exponent);
  const { value: multiplier, warnings } = nfrMultiplier(input);

  // Hours contributed per unit of UCP weight, after factor adjustment.
  const totalWeight = sizing.uucw + sizing.uaw;
  const ucpPerWeight = totalWeight > 0 ? sizing.ucp / totalWeight : 0;
  const hoursPerWeight = ucpPerWeight * hoursPerUcp * adjustment * multiplier;

  const items: WorkItem[] = [];

  for (const uc of input.use_cases) {
    const { weight } = useCaseWeight(uc.transactions ?? 4);
    const hours = uc.hours_override ?? weight * hoursPerWeight;
    items.push({
      id: uc.id,
      name: uc.name,
      aiClass: uc.ai_class ?? inferAiClass(input, uc.transactions ?? 4),
      risk: (uc.risk ?? 'medium') as RiskLevel,
      hours,
      source: 'use-case',
    });
  }

  for (const nfr of input.nfrs ?? []) {
    if (nfr.path !== 'derived-scope') continue;
    for (const [i, comp] of (nfr.derived_components ?? []).entries()) {
      const hours =
        comp.hours != null
          ? comp.hours
          : useCaseWeight(comp.transactions ?? 3).weight * hoursPerWeight;
      items.push({
        id: `${nfr.id}-D${i + 1}`,
        name: `${comp.name} (from ${nfr.id}: ${nfr.attribute})`,
        aiClass: comp.ai_class ?? 'ops',
        risk: (comp.risk ?? 'medium') as RiskLevel,
        hours,
        source: 'nfr-derived',
      });
    }
  }

  if (items.length === 0) warnings.push('No work items produced — check use_cases in the input.');

  // Actor weight is scope that belongs to no single use case; spread it proportionally.
  const actorHours = sizing.uaw * hoursPerWeight;
  const itemHours = items.reduce((s, it) => s + it.hours, 0);
  if (itemHours > 0 && actorHours > 0) {
    for (const item of items) item.hours += actorHours * (item.hours / itemHours);
  }

  const baseHours = items.reduce((s, it) => s + it.hours, 0);
  const contingency = baseHours * contingencyRate;

  return {
    items,
    nfrMultiplier: multiplier,
    exponent,
    adjustment,
    baseHours,
    contingency,
    totalHours: baseHours + contingency,
    warnings,
  };
}
