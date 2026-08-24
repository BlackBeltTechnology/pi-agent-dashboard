/**
 * Delivery-mode layer: recompute the same scope under four delivery models.
 *
 *  human_only                  baseline, no AI in the loop
 *  human_with_ai               developers keep the keyboard, AI assists inline
 *  ai_steered_human_supervised agent writes the change, human specifies+reviews
 *  agentic_hitl                autonomous agents, human-in-the-loop oversight (ACEM)
 *
 * Two rules keep this honest:
 *  1. AI compresses BUILD effort only. PM, client iteration, compliance, manual
 *     QA and security sign-off do not shrink because a model writes the code.
 *  2. Every AI mode pays back review and rework. DORA 2025 found AI adoption
 *     raised instability even as throughput recovered — savings are never free.
 */

import {
  ACEM_DEFAULTS,
  AGENT_LEVERAGE,
  AI_SPEEDUP,
  CODEBASE_MODIFIER,
  DEFAULT_HOURS_PER_DAY,
  DEFAULT_SENIORITY_MIX,
  DEV_ROLES,
  NON_DEV_AGENTIC_RETENTION,
  REVIEW_OVERHEAD,
  REWORK_UPLIFT,
  SENIORITY_MODIFIER,
  DEFAULT_SUBSCRIPTION_PLAN,
  STEERING_OVERHEAD,
  SUBSCRIPTION_PLANS,
  USD_TO_CURRENCY,
  WORKING_DAYS_PER_MONTH,
} from "./defaults.js";
import { computeRoles } from "./roles.js";
import type { DeliveryMode, EstimateInput, ModeResult, WorkItem } from "./types.js";

/** Share of total effort that is compressible build work. */
export function devShare(roleRatios: Record<string, number>): number {
  return DEV_ROLES.reduce((sum, role) => sum + (roleRatios[role] ?? 0), 0);
}

/** Environment modifier: codebase maturity x seniority mix. */
export function environmentModifier(input: EstimateInput): number {
  const codebase = CODEBASE_MODIFIER[input.context?.codebase ?? 'brownfield'] ?? 1;
  const mix = input.team?.seniority_mix ?? DEFAULT_SENIORITY_MIX;
  const weight = Object.values(mix).reduce((s, v) => s + v, 0) || 1;
  const seniority =
    Object.entries(mix).reduce((sum, [level, share]) => sum + (SENIORITY_MODIFIER[level] ?? 1) * share, 0) / weight;
  return codebase * seniority;
}

/** Effort-weighted mean speedup across the work items, using the likely PERT value. */
export function weightedSpeedup(items: WorkItem[], modifier: number): number {
  const total = items.reduce((s, it) => s + it.hours, 0);
  if (total <= 0) return 1;
  const weighted = items.reduce((s, it) => s + it.hours * AI_SPEEDUP[it.aiClass][1], 0) / total;
  return weighted * modifier;
}

interface ModeContext {
  input: EstimateInput;
  items: WorkItem[];
  /** Human-only total hours, contingency included. */
  totalHours: number;
  ucp: number;
  roleRatios: Record<string, number>;
}

/** Compute every requested delivery mode. */
export function computeModes(ctx: ModeContext): ModeResult[] {
  const modes = ctx.input.delivery_modes ?? [
    'human_only',
    'human_with_ai',
    'ai_steered_human_supervised',
    'agentic_hitl',
  ];
  return modes.map((mode) => computeMode(mode, ctx));
}

function computeMode(mode: DeliveryMode, ctx: ModeContext): ModeResult {
  const { input, items, totalHours, ucp, roleRatios } = ctx;
  const share = devShare(roleRatios);
  const modifier = environmentModifier(input);
  const speedup = weightedSpeedup(items, modifier);
  const buildHours = totalHours * share;
  const otherHours = totalHours * (1 - share);
  const notes: string[] = [];

  let engineeringHours: number;
  let reviewHours = 0;
  let reworkHours = 0;
  let aiCost = 0;
  /** Share of build work executed by agents; drives ACEM token volume. */
  let agentShare = 0;
  /**
   * Hours the agent is actually running. Identical for both agent modes: the
   * agent does the same build work, and what differs between the modes is how
   * much of it a human watches.
   */
  const agentRunHours = buildHours * speedup * AGENT_LEVERAGE;

  switch (mode) {
    case 'human_only': {
      engineeringHours = totalHours;
      notes.push('Baseline. No AI tooling cost, no review or rework uplift.');
      break;
    }

    case 'human_with_ai': {
      const compressed = buildHours * speedup;
      engineeringHours = compressed + otherHours;
      reviewHours = engineeringHours * REVIEW_OVERHEAD.human_with_ai;
      reworkHours = engineeringHours * REWORK_UPLIFT.human_with_ai;
      engineeringHours += reviewHours + reworkHours;
      notes.push(`Build effort x${speedup.toFixed(2)} (class mix x codebase x seniority).`);
      notes.push('Non-build effort (PM, compliance, manual QA, client) unchanged.');
      break;
    }

    case 'ai_steered_human_supervised': {
      const steeringHours = agentRunHours;
      const overhead = input.ai?.steering_overhead ?? STEERING_OVERHEAD.base;
      engineeringHours = steeringHours * overhead;
      reviewHours = engineeringHours * REVIEW_OVERHEAD.ai_steered_human_supervised;
      reworkHours = engineeringHours * REWORK_UPLIFT.ai_steered_human_supervised;
      // The steering-overhead multiplier is measured end-to-end and already carries
      // review and non-build work, so it is reported but not added again.
      notes.push(
        `Steering hours = build x${(speedup * AGENT_LEVERAGE).toFixed(2)}; total = steering x${overhead} ` +
          `(locally measured overhead multiplier).`,
      );
      notes.push('Review and non-build effort are embedded in the overhead multiplier, not added twice.');
      agentShare = 0.5;
      break;
    }

    case 'agentic_hitl': {
      const hitlHours = buildHours * ACEM_DEFAULTS.hitlShareOfBuild[hitlLevel(input)];
      const retained = otherHours * NON_DEV_AGENTIC_RETENTION;
      engineeringHours = hitlHours + retained;
      reviewHours = hitlHours;
      reworkHours = engineeringHours * REWORK_UPLIFT.agentic_hitl;
      engineeringHours += reworkHours;
      agentShare = 1;
      notes.push(`HITL oversight = ${(ACEM_DEFAULTS.hitlShareOfBuild[hitlLevel(input)] * 100).toFixed(0)}% of human build hours (HIS level ${hitlLevel(input)}).`);
      notes.push('Human effort is HITL oversight plus retained PM/compliance/client work.');
      notes.push('ACEM constants are SYMBOLIC in the source paper — calibrate before quoting.');
      break;
    }
  }

  const hoursPerDay = input.team?.hours_per_day ?? DEFAULT_HOURS_PER_DAY;
  const { lines } = computeRoles(input, engineeringHours);
  const labourCost = lines.reduce((s, l) => s + l.cost, 0);
  const fte = input.team?.fte ?? 3;
  const calendarMonths = engineeringHours / (fte * hoursPerDay * WORKING_DAYS_PER_MONTH);

  // Agent cost. Three paths, in order of how much they are grounded in reality.
  const basis = input.ai?.cost_basis ?? 'subscription';
  let seatCostCharged = false;
  if (agentShare > 0) {
    const measuredRate = input.ai?.cost_per_steering_hour;

    if (basis === 'subscription') {
      // REALITY for most teams: flat seat plans. Cost is seats x months, NOT volume.
      const seats = subscriptionCost(input, calendarMonths);
      aiCost += seats.cost;
      seatCostCharged = true;
      notes.push(
        `Agent cost on SUBSCRIPTION basis: ${seats.description} over ${calendarMonths.toFixed(1)} mo = ` +
          `${Math.round(seats.cost)}. Scales with seats x duration, not work volume.`,
      );
      if (measuredRate != null && agentRunHours > 0) {
        // The meter is what the same work would have cost on demand. The gap is the
        // value the subscription captures, and it belongs in the business case.
        const meterEquivalent = agentRunHours * measuredRate * currencyFactor(input);
        const leverage = seats.cost > 0 ? meterEquivalent / seats.cost : 0;
        notes.push(
          `Metered equivalent would be ${Math.round(meterEquivalent)} ` +
            `(${leverage.toFixed(1)}x the subscription cost) — subscription leverage, not a saving already banked.`,
        );
        if (leverage < 1) {
          notes.push('! Subscription costs MORE than metering at this volume. Consider pay-as-you-go.');
        }
      }
    } else if (measuredRate != null) {
      // Metered, with a measured rate: already contains every revision, retry and
      // context-growth effect, so no reconstruction is needed.
      const rate = measuredRate * currencyFactor(input);
      aiCost += agentRunHours * rate;
      notes.push(
        `Agent cost from MEASURED metered rate: ${Math.round(agentRunHours)} agent-hours x ` +
          `${rate.toFixed(2)}/h = ${Math.round(agentRunHours * rate)}.`,
      );
    } else {
      const acem = acemCost(input, ucp, calendarMonths, agentShare);
      aiCost += acem.total;
      notes.push(
        `Agent cost reconstructed via ACEM: ${(acem.tokens / 1e6).toFixed(1)}M tokens ` +
          `(RF ${acem.rf} x CF ${acem.cf}). Prefer a measured rate — run scripts/calibrate-sessions.ts.`,
      );
    }
    const infra = (input.ai?.infra_monthly ?? ACEM_DEFAULTS.infraMonthly) * calendarMonths;
    aiCost += infra;
  }

  // Per-seat licence cost applies wherever humans use AI tooling.
  //
  // NOT when the subscription already paid for those seats. A Claude Max seat IS
  // the licence; charging both bills the same thing twice. This is the same
  // single-path discipline the NFR router enforces.
  if (mode !== 'human_only' && !seatCostCharged) {
    const licence = input.ai?.licence_per_dev_month ?? ACEM_DEFAULTS.licencePerDevMonth;
    aiCost += licence * fte * calendarMonths;
  } else if (seatCostCharged) {
    notes.push('Per-seat licence not charged separately: the subscription already covers those seats.');
  }

  return {
    mode,
    hours: engineeringHours,
    reviewHours,
    reworkHours,
    labourCost,
    aiCost,
    totalCost: labourCost + aiCost,
    calendarMonths,
    roles: lines,
    notes,
  };
}

/** Resolved ACEM HITL Intensity Score level. */
function hitlLevel(input: EstimateInput): 1 | 2 | 3 | 4 {
  return (input.ai?.hitl_intensity ?? ACEM_DEFAULTS.hitlIntensity) as 1 | 2 | 3 | 4;
}

interface AcemCost {
  tokens: number;
  llmCost: number;
  infraCost: number;
  total: number;
  rf: number;
  cf: number;
  his: 1 | 2 | 3 | 4;
}

/**
 * ACEM monetary dimensions: LLM tokens + infrastructure.
 * `agentShare` scales token volume: 1 = agents do all build work, 0.5 = half.
 * `months` is the calendar duration the agent platform must be paid for.
 * HITL effort is handled as human hours by the caller, not priced here.
 */
export function acemCost(input: EstimateInput, ucp: number, months: number, agentShare: number): AcemCost {
  const ai = input.ai ?? {};
  const rf = ai.revision_factor ?? ACEM_DEFAULTS.revisionFactor;
  const cf = ai.context_factor ?? ACEM_DEFAULTS.contextFactor;
  const his = hitlLevel(input);
  const perUcp = ai.tokens_per_ucp ?? ACEM_DEFAULTS.tokensPerUcp;

  const tokens = ucp * perUcp * rf * cf * agentShare;
  const outTokens = tokens * ACEM_DEFAULTS.outputShare;
  const inTokens = tokens - outTokens;
  const llmCost =
    (inTokens / 1e6) * (ai.price_per_mtok_in ?? ACEM_DEFAULTS.pricePerMtokIn) +
    (outTokens / 1e6) * (ai.price_per_mtok_out ?? ACEM_DEFAULTS.pricePerMtokOut);

  // Infrastructure is added by the caller so both cost paths charge it once.
  return { tokens, llmCost, infraCost: 0, total: llmCost, rf, cf, his };
}

/** Convert a USD figure into the project currency. */
function currencyFactor(input: EstimateInput): number {
  const currency = input.project.currency ?? 'EUR';
  return USD_TO_CURRENCY[currency] ?? 1;
}

/**
 * Cost of the seat plans held for this project, over the project duration.
 *
 * Seats are charged per calendar month regardless of how hard they are used, so
 * a schedule extension is a real cost increase under this basis. `utilisation`
 * apportions a seat shared across several projects.
 */
function subscriptionCost(
  input: EstimateInput,
  months: number,
): { cost: number; description: string; monthlyTotal: number } {
  const factor = currencyFactor(input);
  const declared = input.ai?.subscriptions;
  const plans =
    declared && declared.length > 0 ? declared : [{ plan: DEFAULT_SUBSCRIPTION_PLAN, seats: 1, utilisation: 1 }];

  let monthlyTotal = 0;
  const parts: string[] = [];
  for (const entry of plans) {
    const catalogue = entry.plan ? SUBSCRIPTION_PLANS[entry.plan] : undefined;
    const monthly = entry.monthly ?? catalogue?.monthly ?? 0;
    const seats = entry.seats ?? 1;
    const utilisation = entry.utilisation ?? 1;
    const line = monthly * seats * utilisation * factor;
    monthlyTotal += line;
    const label = entry.label ?? catalogue?.label ?? entry.plan ?? 'seat';
    parts.push(`${seats}x ${label}${utilisation < 1 ? ` @${Math.round(utilisation * 100)}%` : ''}`);
  }

  return {
    cost: monthlyTotal * Math.max(months, 0),
    monthlyTotal,
    description: `${parts.join(' + ')} = ${Math.round(monthlyTotal)}/mo`,
  };
}
