/**
 * Sizing layer: Use Case Points (Karner) plus the COCOMO II scale exponent.
 *
 * UCP is linear in scope. Real projects are not: COCOMO II's exponent E > 1
 * encodes diseconomy of scale. We therefore size with UCP and then apply the
 * COCOMO exponent relative to a reference size, so a 4x bigger project costs
 * more than 4x. Both steps are reported separately so the arithmetic is auditable.
 */

import {
  COCOMO,
  ECF_BASE,
  ECF_COEFF,
  ENVIRONMENTAL_FACTORS,
  SCALE_FACTORS,
  TCF_BASE,
  TCF_COEFF,
  TECHNICAL_FACTORS,
  UAW_WEIGHTS,
  UUCW_BANDS,
} from "./defaults.js";
import type { EstimateInput, SizingResult } from "./types.js";

/** Map a transaction count to its Karner UUCW weight and band name. */
export function useCaseWeight(transactions: number): { weight: number; band: string } {
  const band = UUCW_BANDS.find((b) => transactions <= b.max)!;
  return { weight: band.weight, band: band.band };
}

/** Compute the Technical Complexity Factor from T1..T13 ratings (0-5 each). */
export function technicalComplexityFactor(ratings: Record<string, number> = {}): { tcf: number; tf: number } {
  let tf = 0;
  for (const [key, meta] of Object.entries(TECHNICAL_FACTORS)) {
    const rating = clampRating(ratings[key] ?? 3);
    tf += meta.weight * rating;
  }
  return { tcf: TCF_BASE + TCF_COEFF * tf, tf };
}

/** Compute the Environmental Complexity Factor from E1..E8 ratings (0-5 each). */
export function environmentalComplexityFactor(ratings: Record<string, number> = {}): { ecf: number; ef: number } {
  let ef = 0;
  for (const [key, meta] of Object.entries(ENVIRONMENTAL_FACTORS)) {
    const rating = clampRating(ratings[key] ?? 3);
    ef += meta.weight * rating;
  }
  return { ecf: ECF_BASE + ECF_COEFF * ef, ef };
}

function clampRating(value: number): number {
  if (Number.isNaN(value)) return 3;
  return Math.min(5, Math.max(0, value));
}

/** Full UCP sizing including NFR-derived scope items. */
export function computeSizing(input: EstimateInput): SizingResult {
  const perUseCase = input.use_cases.map((uc) => {
    const { weight, band } = useCaseWeight(uc.transactions ?? 4);
    return { id: uc.id, name: uc.name, weight, band };
  });

  const derivedItems: SizingResult['derivedItems'] = [];
  for (const nfr of input.nfrs ?? []) {
    if (nfr.path !== 'derived-scope') continue;
    for (const [i, comp] of (nfr.derived_components ?? []).entries()) {
      // A derived component sized in hours contributes no UCP weight; it is added
      // directly as a work item later. Only transaction-sized components add UCP.
      if (comp.hours != null) continue;
      const { weight } = useCaseWeight(comp.transactions ?? 3);
      derivedItems.push({ id: `${nfr.id}-D${i + 1}`, name: comp.name, weight, fromNfr: nfr.id });
    }
  }

  const uucw = [...perUseCase, ...derivedItems].reduce((sum, item) => sum + item.weight, 0);
  const uaw = (input.actors ?? []).reduce((sum, a) => sum + (UAW_WEIGHTS[a.type] ?? 2), 0);
  const { tcf } = technicalComplexityFactor(input.factors?.technical);
  const { ecf } = environmentalComplexityFactor(input.factors?.environmental);

  return { uucw, uaw, tcf, ecf, ucp: (uucw + uaw) * tcf * ecf, perUseCase, derivedItems };
}

/** COCOMO II exponent E = B + 0.01 * sum(scale factors). */
export function scaleExponent(ratings: Record<string, string> = {}): number {
  let sum = 0;
  for (const [name, table] of Object.entries(SCALE_FACTORS)) {
    const rating = ratings[name] ?? 'nominal';
    const value = table[rating];
    if (value == null) throw new Error(`Unknown COCOMO scale rating "${rating}" for ${name}`);
    sum += value;
  }
  return COCOMO.B + 0.01 * sum;
}

/**
 * Diseconomy-of-scale adjustment applied to a linear UCP effort.
 * At ucp === referenceUcp the adjustment is exactly 1.0, so calibration of
 * hours-per-UCP stays meaningful.
 */
export function scaleAdjustment(ucp: number, referenceUcp: number, exponent: number): number {
  if (ucp <= 0 || referenceUcp <= 0) return 1;
  return Math.pow(ucp / referenceUcp, exponent - 1);
}

/** COCOMO II schedule equation, used for a sanity check on calendar time. */
export function nominalScheduleMonths(personMonths: number, exponent: number): number {
  if (personMonths <= 0) return 0;
  return COCOMO.C * Math.pow(personMonths, COCOMO.D + 0.2 * (exponent - COCOMO.B));
}
