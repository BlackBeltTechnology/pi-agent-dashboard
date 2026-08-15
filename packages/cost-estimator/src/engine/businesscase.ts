/**
 * Business-case layer: NPV, ROI, payback, TCO, sensitivity and a scope ladder.
 *
 * The scope ladder is the answer to "what tasks are needed for a business case
 * and with how much effort" — must/should/could tiers with the cost of each,
 * so the sponsor can buy the tier they can afford instead of the whole thing.
 */

import type { BusinessCaseResult, EstimateInput, ModeResult, WorkItem } from "./types.js";

export interface BusinessCaseContext {
  input: EstimateInput;
  items: WorkItem[];
  chosenMode: ModeResult;
  currency: string;
}

/** Build the full business case for the chosen delivery mode. */
export function computeBusinessCase(ctx: BusinessCaseContext): BusinessCaseResult | null {
  const cfg = ctx.input.business;
  if (!cfg) return null;

  const discountRate = cfg.discount_rate ?? 0.12;
  const horizonYears = cfg.horizon_years ?? 3;
  const buildCost = ctx.chosenMode.totalCost;
  const annualRunCost = (cfg.run_costs ?? []).reduce((s, r) => s + r.annual_value, 0);
  const annualBenefit = (cfg.benefits ?? []).reduce(
    (s, b) => s + b.annual_value * (b.confidence ?? 1),
    0,
  );

  const yearly: BusinessCaseResult['yearly'] = [];
  let cumulative = 0;
  let npv = -buildCost;

  for (let year = 1; year <= horizonYears; year++) {
    const benefit = (cfg.benefits ?? [])
      .filter((b) => year >= (b.start_year ?? 1))
      .reduce((s, b) => s + b.annual_value * (b.confidence ?? 1), 0);
    const cost = annualRunCost + (year === 1 ? buildCost : 0);
    const net = benefit - annualRunCost;
    const discounted = net / Math.pow(1 + discountRate, year);
    npv += discounted;
    cumulative += net;
    yearly.push({ year, cost, benefit, net, discounted, cumulative });
  }

  const tco = buildCost + annualRunCost * horizonYears;
  const totalBenefit = yearly.reduce((s, y) => s + y.benefit, 0);
  const roi = tco > 0 ? (totalBenefit - tco) / tco : 0;

  return {
    currency: ctx.currency,
    buildCost,
    annualRunCost,
    annualBenefit,
    horizonYears,
    discountRate,
    npv,
    roi,
    paybackYears: paybackPeriod(buildCost, yearly),
    tco,
    yearly,
    sensitivity: sensitivity(buildCost, annualBenefit, annualRunCost, discountRate, horizonYears),
    scopeLadder: scopeLadder(ctx),
  };
}

/** Linear-interpolated payback period in years, or null when it never pays back. */
function paybackPeriod(buildCost: number, yearly: BusinessCaseResult['yearly']): number | null {
  let cumulative = 0;
  for (const row of yearly) {
    const previous = cumulative;
    cumulative += row.net;
    if (cumulative >= buildCost) {
      const needed = buildCost - previous;
      return row.year - 1 + (row.net > 0 ? needed / row.net : 0);
    }
  }
  return null;
}

/** One-at-a-time sensitivity on the three drivers that actually move NPV. */
function sensitivity(
  buildCost: number,
  annualBenefit: number,
  annualRunCost: number,
  discountRate: number,
  years: number,
): BusinessCaseResult['sensitivity'] {
  const npvOf = (cost: number, benefit: number, run: number, rate: number) => {
    let value = -cost;
    for (let y = 1; y <= years; y++) value += (benefit - run) / Math.pow(1 + rate, y);
    return value;
  };
  const base = npvOf(buildCost, annualBenefit, annualRunCost, discountRate);
  return [
    {
      driver: 'Build cost ±30%',
      low: npvOf(buildCost * 1.3, annualBenefit, annualRunCost, discountRate),
      base,
      high: npvOf(buildCost * 0.7, annualBenefit, annualRunCost, discountRate),
    },
    {
      driver: 'Annual benefit ±40%',
      low: npvOf(buildCost, annualBenefit * 0.6, annualRunCost, discountRate),
      base,
      high: npvOf(buildCost, annualBenefit * 1.4, annualRunCost, discountRate),
    },
    {
      driver: 'Run cost ±50%',
      low: npvOf(buildCost, annualBenefit, annualRunCost * 1.5, discountRate),
      base,
      high: npvOf(buildCost, annualBenefit, annualRunCost * 0.5, discountRate),
    },
  ];
}

/** Cost of each must/should/could tier, cumulative — the "what can we cut" table. */
function scopeLadder(ctx: BusinessCaseContext): BusinessCaseResult['scopeLadder'] {
  const tiers = ctx.input.business?.scope_tiers ?? [];
  if (tiers.length === 0) return [];

  const totalHours = ctx.items.reduce((s, it) => s + it.hours, 0);
  const costPerHour = totalHours > 0 ? ctx.chosenMode.totalCost / totalHours : 0;
  const byId = new Map(ctx.items.map((it) => [it.id, it]));

  const order = ['must', 'should', 'could'];
  let cumulativeCost = 0;
  return tiers
    .slice()
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))
    .map((tier) => {
      const hours = tier.use_cases.reduce((s, id) => s + (byId.get(id)?.hours ?? 0), 0);
      const cost = hours * costPerHour;
      cumulativeCost += cost;
      return { tier: tier.tier, hours, cost, cumulativeCost };
    });
}
