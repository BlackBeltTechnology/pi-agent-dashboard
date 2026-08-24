/**
 * Role layer: distribute total effort across delivery roles and price it.
 *
 * Role split is a DISTRIBUTION of the single effort estimate, never a second
 * independent estimate — that is what keeps the totals reconcilable.
 */

import {
  DEFAULT_HOURS_PER_DAY,
  DEFAULT_ROLE_RATIOS,
  DEFAULT_SENIORITY_MIX,
  ROLE_RATIO_SIZE_TILT,
} from "./defaults.js";
import type { EstimateInput, RateEntry, RoleLine } from "./types.js";

/** Normalise a ratio map so the shares sum to exactly 1. */
export function normalize(ratios: Record<string, number>): Record<string, number> {
  const total = Object.values(ratios).reduce((s, v) => s + v, 0);
  if (total <= 0) throw new Error('Role ratios must sum to a positive number');
  return Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, v / total]));
}

/**
 * Size-aware role ratios. Larger projects spend proportionally more on
 * coordination and test — a fixed table is a prior, not a truth.
 */
export function roleRatios(input: EstimateInput, totalHours: number): Record<string, number> {
  const base = { ...(input.team?.role_ratios ?? DEFAULT_ROLE_RATIOS) };
  if (input.team?.role_ratios) return normalize(base);
  if (totalHours < ROLE_RATIO_SIZE_TILT.largeThresholdHours) return normalize(base);

  const tilt = ROLE_RATIO_SIZE_TILT.tilt as Record<string, number>;
  const moved = Object.values(tilt).reduce((s, v) => s + v, 0);
  for (const [role, delta] of Object.entries(tilt)) base[role] = (base[role] ?? 0) + delta;
  const donors = ROLE_RATIO_SIZE_TILT.takeFrom.filter((r) => base[r] != null);
  for (const donor of donors) base[donor] -= moved / donors.length;
  return normalize(base);
}

/** Blended day rate for a role, weighted by the seniority mix. */
export function blendedDayRate(role: string, rates: RateEntry[], mix: Record<string, number>): number {
  const forRole = rates.filter((r) => r.role === role);
  if (forRole.length === 0) return 0;

  const withSeniority = forRole.filter((r) => r.seniority);
  if (withSeniority.length === 0) return forRole[0].day_rate;

  let total = 0;
  let weight = 0;
  for (const entry of withSeniority) {
    const share = mix[entry.seniority!] ?? 0;
    total += entry.day_rate * share;
    weight += share;
  }
  return weight > 0 ? total / weight : withSeniority[0].day_rate;
}

/** Distribute hours across roles and price each line. */
export function computeRoles(input: EstimateInput, totalHours: number): { lines: RoleLine[]; missingRates: string[] } {
  const ratios = roleRatios(input, totalHours);
  const hoursPerDay = input.team?.hours_per_day ?? DEFAULT_HOURS_PER_DAY;
  const mix = input.team?.seniority_mix ?? DEFAULT_SENIORITY_MIX;
  const rates = input.rates ?? [];
  const missingRates: string[] = [];

  const lines = Object.entries(ratios).map(([role, share]) => {
    const hours = totalHours * share;
    const days = hours / hoursPerDay;
    const dayRate = blendedDayRate(role, rates, mix);
    if (dayRate === 0 && rates.length > 0) missingRates.push(role);
    return { role, hours, days, dayRate, cost: days * dayRate };
  });

  return { lines, missingRates };
}

/** Blended project day rate implied by the role split — the number a client asks for. */
export function blendedProjectDayRate(lines: RoleLine[]): number {
  const days = lines.reduce((s, l) => s + l.days, 0);
  const cost = lines.reduce((s, l) => s + l.cost, 0);
  return days > 0 ? cost / days : 0;
}
