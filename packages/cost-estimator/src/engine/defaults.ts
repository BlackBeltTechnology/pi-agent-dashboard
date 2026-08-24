/**
 * Default constants for the estimator.
 *
 * RULE: every constant below carries a `src` note. Anything without published or
 * locally measured grounding is marked UNCALIBRATED and must be tuned per project
 * before an estimate leaves the building.
 */

import type { AiClass, DeliveryMode, Phase, RiskLevel } from "./types.js";

/** Use Case Points — unadjusted use case weights (Karner). */
export const UUCW_BANDS = [
  { max: 3, weight: 5, band: 'simple' },
  { max: 7, weight: 10, band: 'average' },
  { max: Infinity, weight: 15, band: 'complex' },
] as const;
export const UUCW_SRC = 'Karner UCP: <=3 tx simple=5, 4-7 average=10, >7 complex=15';

/** Use Case Points — unadjusted actor weights (Karner). */
export const UAW_WEIGHTS = { api: 1, protocol: 2, human: 3 } as const;
export const UAW_SRC = 'Karner UCP: API actor=1, protocol/DB actor=2, human GUI actor=3';

/** UCP technical factors T1..T13 with Karner weights. */
export const TECHNICAL_FACTORS: Record<string, { weight: number; label: string }> = {
  T1: { weight: 2.0, label: 'Distributed system' },
  T2: { weight: 1.0, label: 'Response time / throughput objectives' },
  T3: { weight: 1.0, label: 'End-user efficiency' },
  T4: { weight: 1.0, label: 'Complex internal processing' },
  T5: { weight: 1.0, label: 'Reusable code' },
  T6: { weight: 0.5, label: 'Easy to install' },
  T7: { weight: 0.5, label: 'Easy to use' },
  T8: { weight: 2.0, label: 'Portable' },
  T9: { weight: 1.0, label: 'Easy to change' },
  T10: { weight: 1.0, label: 'Concurrent' },
  T11: { weight: 1.0, label: 'Special security objectives' },
  T12: { weight: 1.0, label: 'Direct access for third parties' },
  T13: { weight: 1.0, label: 'Special user training facilities' },
};

/** UCP environmental factors E1..E8 with Karner weights. */
export const ENVIRONMENTAL_FACTORS: Record<string, { weight: number; label: string }> = {
  E1: { weight: 1.5, label: 'Familiarity with the development process' },
  E2: { weight: 0.5, label: 'Application experience' },
  E3: { weight: 1.0, label: 'Object-oriented / paradigm experience' },
  E4: { weight: 0.5, label: 'Lead analyst capability' },
  E5: { weight: 1.0, label: 'Motivation' },
  E6: { weight: 2.0, label: 'Stable requirements' },
  E7: { weight: -1.0, label: 'Part-time staff' },
  E8: { weight: -1.0, label: 'Difficult programming language' },
};

export const TCF_BASE = 0.6;
export const TCF_COEFF = 0.01;
export const ECF_BASE = 1.4;
export const ECF_COEFF = -0.03;
export const UCP_FACTOR_SRC = 'Karner: TCF = 0.6 + 0.01*TF ; ECF = 1.4 - 0.03*EF';

/** Hours per UCP. Karner 20; industry practice 15-30; local offers imply ~20-28. */
export const DEFAULT_HOURS_PER_UCP = 20;
export const HOURS_PER_UCP_SRC = 'Karner original 20 h/UCP; practice range 15-30. OVERRIDE with project actuals.';

/** Reference project size used to apply the COCOMO scale exponent to a UCP estimate. */
export const DEFAULT_REFERENCE_UCP = 100;
export const REFERENCE_UCP_SRC = 'UNCALIBRATED anchor: the size at which hours_per_ucp is assumed true.';

/** COCOMO II.2000 Post-Architecture constants (USC Model Definition Manual). */
export const COCOMO = {
  A: 2.94,
  B: 0.91,
  C: 3.67,
  D: 0.28,
} as const;
export const COCOMO_SRC = 'COCOMO II.2000 Model Definition Manual (USC): A=2.94, B=0.91, C=3.67, D=0.28';

/** COCOMO II scale factor ratings. Sum feeds E = B + 0.01*sum(SF). */
export const SCALE_FACTORS: Record<string, Record<string, number>> = {
  PREC: { 'very-low': 6.2, low: 4.96, nominal: 3.72, high: 2.48, 'very-high': 1.24, 'extra-high': 0.0 },
  FLEX: { 'very-low': 5.07, low: 4.05, nominal: 3.04, high: 2.03, 'very-high': 1.01, 'extra-high': 0.0 },
  RESL: { 'very-low': 7.07, low: 5.65, nominal: 4.24, high: 2.83, 'very-high': 1.41, 'extra-high': 0.0 },
  TEAM: { 'very-low': 5.48, low: 4.38, nominal: 3.29, high: 2.19, 'very-high': 1.1, 'extra-high': 0.0 },
  PMAT: { 'very-low': 7.8, low: 6.24, nominal: 4.68, high: 3.12, 'very-high': 1.56, 'extra-high': 0.0 },
};
export const SCALE_FACTOR_SRC = 'COCOMO II.2000 scale factor values (PREC, FLEX, RESL, TEAM, PMAT)';

/**
 * Role effort ratios. Distribution of TOTAL project effort across roles.
 * Grounded in the local offer corpus (Huawei WMS module split, Sunbloom QA share)
 * and cross-checked against ISBSG role-effort-ratio guidance and McConnell ch.21.
 */
export const DEFAULT_ROLE_RATIOS: Record<string, number> = {
  'Product Owner / BA': 0.07,
  Architect: 0.06,
  'UX / UI Designer': 0.07,
  'Frontend Developer': 0.17,
  'Backend Developer': 0.22,
  'Data / Integration Engineer': 0.09,
  'QA / Test Automation': 0.16,
  'DevOps / SRE': 0.06,
  'Security Engineer': 0.02,
  'Tech Lead': 0.03,
  'Project Manager': 0.05,
};
export const ROLE_RATIO_SRC =
  'Local: Huawei WMS module split (QA 15.2%, PM 10%, deploy 11.9%), Sunbloom QA 17% of total. ' +
  'External: ISBSG Role Effort Ratios; McConnell Software Estimation ch.21.';

/** Ratios shift with size: bigger projects spend proportionally more on coordination and test. */
export const ROLE_RATIO_SIZE_TILT = {
  /** Above this many hours, tilt toward coordination roles. */
  largeThresholdHours: 4000,
  tilt: { 'Project Manager': 0.02, 'QA / Test Automation': 0.02, Architect: 0.01 },
  takeFrom: ['Backend Developer', 'Frontend Developer'],
} as const;

/**
 * AI speedup factors per work-item class, expressed as a multiplier on human-only hours.
 * < 1.0 means faster with AI. > 1.0 means slower (the METR regime).
 * [optimistic, likely, pessimistic] — fed into the PERT distribution.
 */
export const AI_SPEEDUP: Record<AiClass, [number, number, number]> = {
  boilerplate: [0.35, 0.50, 0.70],
  crud: [0.50, 0.65, 0.85],
  integration: [0.70, 0.85, 1.00],
  algorithmic: [0.75, 0.90, 1.05],
  'legacy-change': [0.90, 1.10, 1.30],
  'ux-heavy': [0.75, 0.90, 1.05],
  docs: [0.30, 0.45, 0.65],
  ops: [0.60, 0.80, 1.00],
};
export const AI_SPEEDUP_SRC = [
  'GenAI SLR + 65-dev survey (arXiv 2603.16975): >70% of devs at least halve boilerplate & documentation time.',
  'GitHub controlled lab study: up to 55% faster on a scoped task.',
  'Demirer et al. 3 field RCTs, n=4867: +26.08% completed tasks (SE 10.3%); juniors gain most.',
  'Jellyfish 146k Jira tickets: real-world effect ~8%.',
  'METR RCT 2025: experienced devs on their own mature repos were 19% SLOWER -> legacy-change > 1.0.',
].join(' | ');

/** Codebase maturity shifts every speedup: AI helps least where the human already has deep context. */
export const CODEBASE_MODIFIER: Record<string, number> = {
  greenfield: 0.92,
  brownfield: 1.0,
  legacy: 1.12,
};
export const CODEBASE_MODIFIER_SRC = 'Derived from METR (mature repo, expert dev => slowdown) vs greenfield lab results. UNCALIBRATED magnitude.';

/** Seniority tilts the effect: juniors gained more in the Demirer field experiments. */
export const SENIORITY_MODIFIER: Record<string, number> = {
  junior: 0.90,
  mid: 1.0,
  senior: 1.08,
};
export const SENIORITY_MODIFIER_SRC = 'Demirer et al.: less experienced developers had higher adoption and greater gains. UNCALIBRATED magnitude.';

/** Fraction of AI-produced work that must be reviewed by a human, as a share of AI-mode hours. */
export const REVIEW_OVERHEAD: Record<DeliveryMode, number> = {
  human_only: 0,
  human_with_ai: 0.08,
  ai_steered_human_supervised: 0.18,
  agentic_hitl: 0.28,
};
export const REVIEW_OVERHEAD_SRC = 'UNCALIBRATED. Shape from DORA 2025 (AI amplifies; review becomes the constraint) and ACEM HITL cost dimension.';

/** Rework uplift from AI-induced instability, as a share of AI-mode hours. */
export const REWORK_UPLIFT: Record<DeliveryMode, number> = {
  human_only: 0,
  human_with_ai: 0.05,
  ai_steered_human_supervised: 0.10,
  agentic_hitl: 0.15,
};
export const REWORK_UPLIFT_SRC = 'DORA 2025: AI adoption raised instability / rework even as throughput recovered. UNCALIBRATED magnitude.';

/**
 * ACEM (arXiv 2608.02582) agentic cost parameters.
 * ACEM ships its constants SYMBOLIC — these are placeholders pending local calibration.
 */
export const ACEM_DEFAULTS = {
  tokensPerUcp: 250_000,
  /**
   * MEASURED LOWER BOUND (1.05) from 542 local sessions: 0.9% tool-error rate +
   * 3.7% explicit human-correction rate. Held above the measured floor because
   * that proxy cannot see tokens the agent silently redid on its own.
   */
  revisionFactor: 1.25,
  /**
   * MEASURED (5.10) from 542 local sessions: cache-read per assistant turn is
   * 5.1x higher in long sessions (>=60 turns) than short ones (<=20).
   * Context accumulation is real and much larger than ACEM's illustrative 1.25.
   */
  contextFactor: 5.1,
  hitlIntensity: 2 as 1 | 2 | 3 | 4,
  /**
   * Human oversight effort as a SHARE OF THE HUMAN-ONLY BUILD HOURS, by HITL
   * Intensity Score level. Anchored on the local measurement that ~38% of a
   * pre-OSS build was active steering time (Digitalk: 16 steering days of ~42 md).
   */
  hitlShareOfBuild: { 1: 0.15, 2: 0.28, 3: 0.45, 4: 0.65 },
  pricePerMtokIn: 3,
  pricePerMtokOut: 15,
  /**
   * MEASURED (0.0038) from 542 local sessions. Output is a rounding error in the
   * token bill: cache-read is 95.5% of all tokens. Modelling agentic cost as a
   * 25/75 output/input split — as generic token-cost guidance does — overstates
   * the output line by ~66x and misses where the money actually goes.
   */
  outputShare: 0.004,
  infraMonthly: 400,
  licencePerDevMonth: 40,
  /**
   * MEASURED: $10.41 per active steering hour across 542 sessions / 737.5 h /
   * $7,676 billed. PREFERRED over reconstructing cost from RF x CF x price,
   * because it already contains every revision, retry and context effect.
   */
  costPerSteeringHour: 10.41,
};
export const ACEM_SRC =
  'ACEM: A Cost Estimation Model for Agentic Software Engineering (arXiv 2608.02582) — LLM + HITL + infra, ' +
  'with Revision Factor, Context Factor, HITL Intensity Score. The paper leaves its constants SYMBOLIC; ' +
  'the values here are MEASURED from 542 local pi sessions (737.5 active steering hours, $7,676 billed) ' +
  'via scripts/calibrate-sessions.ts.';

/**
 * Subscription (seat) plans — USD per seat per month.
 *
 * THIS IS THE REAL COST BASIS for most teams. Agent work is paid by flat
 * subscription, not by the token meter. That changes the SHAPE of the cost:
 *
 *   metered      cost is proportional to WORK VOLUME
 *   subscription cost is proportional to SEATS x CALENDAR MONTHS, capped by quota
 *
 * Consequences the estimator must respect:
 *   - A longer project on the same team costs MORE in subscription even when the
 *     work is identical. Schedule is a cost driver here; under metering it is not.
 *   - Agent usage is FREE AT THE MARGIN until the quota is hit, so the incentive
 *     inverts: push agent utilisation up, not down.
 *   - Exceeding quota is a SCHEDULE risk (throttling), not a cost overrun.
 *
 * Prices verified 2026-08 against the providers' own pricing pages.
 */
export const SUBSCRIPTION_PLANS: Record<string, { monthly: number; label: string; src: string }> = {
  'anthropic-pro': { monthly: 20, label: 'Claude Pro', src: 'claude.com/pricing' },
  'anthropic-max-5x': { monthly: 100, label: 'Claude Max 5x', src: 'claude.com/pricing' },
  'anthropic-max-20x': { monthly: 200, label: 'Claude Max 20x', src: 'claude.com/pricing' },
  'openai-plus': { monthly: 20, label: 'ChatGPT Plus', src: 'openai.com/chatgpt/pricing' },
  'openai-pro-5x': { monthly: 100, label: 'ChatGPT Pro 5x', src: 'openai.com/chatgpt/pricing' },
  'openai-pro-20x': { monthly: 200, label: 'ChatGPT Pro 20x', src: 'openai.com/chatgpt/pricing' },
  'glm-lite': { monthly: 18, label: 'GLM Coding Lite', src: 'z.ai/subscribe' },
  'glm-pro': { monthly: 72, label: 'GLM Coding Pro', src: 'z.ai/subscribe' },
  'glm-max': { monthly: 160, label: 'GLM Coding Max', src: 'z.ai/subscribe' },
};

export const SUBSCRIPTION_SRC =
  'Provider pricing pages, verified 2026-08. Monthly billing; no annual discount published for the Anthropic/OpenAI tiers.';

/** Default seat plan when a project declares subscription basis without naming one. */
export const DEFAULT_SUBSCRIPTION_PLAN = 'anthropic-max-20x';

/**
 * Currency conversion for the measured cost-per-steering-hour, which is billed in USD.
 * Override per project when quoting in another currency.
 */
export const USD_TO_CURRENCY: Record<string, number> = { EUR: 0.92, USD: 1, HUF: 360, GBP: 0.79 };
export const USD_RATE_SRC = 'Indicative rates. Set project rates explicitly for a contractual quote.';

/**
 * Steering-overhead multiplier for the ai_steered_human_supervised mode.
 * Locally measured: manday = steering-day x (1 + overhead), overhead 1.75-1.85x,
 * covering work that never happens inside the agent (manual QA, compliance, PM, client iteration).
 */
export const STEERING_OVERHEAD = { low: 1.5, base: 1.8, high: 2.25 };
export const STEERING_OVERHEAD_SRC =
  'LOCAL MEASURED: Digitalk estimation model — 465 h active pi steering time ~= 58 work-days built the pi-dashboard product; ' +
  'manday = steering-days x (1 + overhead), overhead 1.75-1.85x; 1.5x mature team/light client, 2.25x heavy compliance.';

/** Risk-driven PERT spread multipliers around the most-likely value. */
export const PERT_SPREAD: Record<RiskLevel, { optimistic: number; pessimistic: number }> = {
  low: { optimistic: 0.9, pessimistic: 1.25 },
  medium: { optimistic: 0.85, pessimistic: 1.5 },
  high: { optimistic: 0.75, pessimistic: 2.0 },
};
export const PERT_SRC =
  'Local: Huawei WMS confidence bands (+/-10% standard CRUD, +/-20% integrations, +/-30% novel) widened ' +
  'to a right-skewed PERT shape, matching the MFCS becslo tabla PERT_O/P_MULT structure.';

/** Beta-PERT shape parameter (lambda). 4 is the classical PERT weighting. */
export const PERT_LAMBDA = 4;

/**
 * Project-level correlated shock, sampled once per Monte Carlo iteration and
 * applied to every work item.
 *
 * Without this, summing many independently-sampled items collapses the variance
 * (central limit) and produces an absurdly tight P85 — the classic way a
 * simulation lies. Real overruns are correlated: scope creep, a wrong
 * architectural bet, an absent client, an unstable environment hit everything
 * at once.
 */
export const CORRELATED_SHOCK = { optimistic: 0.95, likely: 1.0, pessimistic: 1.45 };
export const CORRELATED_SHOCK_SRC =
  'UNCALIBRATED shape. Rationale: Boehm/McConnell cone + reference-class forecasting both show project-level, ' +
  'not item-level, variance dominates overruns.';

/** Cone of uncertainty multipliers by project phase (Boehm / McConnell). */
export const CONE_OF_UNCERTAINTY: Record<Phase, [number, number]> = {
  'initial-concept': [0.25, 4.0],
  'approved-product-definition': [0.5, 2.0],
  'requirements-complete': [0.67, 1.5],
  'ui-design-complete': [0.8, 1.25],
  'detailed-design-complete': [0.9, 1.1],
};
export const CONE_SRC = 'Boehm/McConnell cone of uncertainty: 4x band at initiation, narrowing as decisions are made.';

/** Default contingency buffer. */
export const DEFAULT_CONTINGENCY = 0.15;
export const CONTINGENCY_SRC = 'LOCAL: 15% contingency used in Huawei WMS and Digitalk offers.';

export const DEFAULT_HOURS_PER_DAY = 8;
export const HOURS_PER_DAY_SRC = 'LOCAL: 1 man-day = 8 productive hours (Huawei WMS assumption).';

export const DEFAULT_ITERATIONS = 20_000;
export const DEFAULT_SEED = 20260101;
export const DEFAULT_CURRENCY = 'EUR';

export const DEFAULT_SENIORITY_MIX: Record<string, number> = { senior: 0.4, mid: 0.4, junior: 0.2 };

/**
 * Roles whose effort is "build work" — the portion AI can compress.
 * Everything outside this set (PM, client iteration, manual QA, compliance,
 * security sign-off) is the overhead that AI does NOT shrink.
 */
export const DEV_ROLES = [
  'Frontend Developer',
  'Backend Developer',
  'Data / Integration Engineer',
  'Architect',
  'DevOps / SRE',
] as const;
export const DEV_ROLES_SRC =
  'LOCAL: Digitalk model — "overhead covers work that never happens inside the agent: manual WCAG testing, ' +
  'security validation, hosting/DPA/DR/SLA, client iteration, PM, content authoring, deployment".';

/**
 * Extra leverage of an agentic loop over inline completion, applied on top of
 * the per-class speedup in ai_steered mode. < 1 means agents beat autocomplete.
 */
export const AGENT_LEVERAGE = 0.75;
export const AGENT_LEVERAGE_SRC = 'UNCALIBRATED. Separates "AI autocomplete" from "agent writes the change, human steers".';

/** Share of non-build effort that survives in a fully agentic delivery. */
export const NON_DEV_AGENTIC_RETENTION = 0.8;
export const NON_DEV_AGENTIC_RETENTION_SRC = 'UNCALIBRATED. PM, compliance and client iteration barely shrink with agents.';

/** Working days per calendar month. */
export const WORKING_DAYS_PER_MONTH = 20;
export const WORKING_DAYS_SRC = 'LOCAL: Huawei WMS timeline assumption — 5 days/week, 20 days/month.';
