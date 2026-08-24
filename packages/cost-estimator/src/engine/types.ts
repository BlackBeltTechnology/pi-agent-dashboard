/**
 * Input contract and result types for the software cost estimator.
 *
 * Every numeric constant that is not supplied here comes from `defaults.ts`,
 * where each value carries a cited source or an explicit UNCALIBRATED marker.
 */

/** How a work item responds to AI assistance. Drives the delivery-mode speedups. */
export type AiClass =
  | 'boilerplate'   // scaffolding, CRUD screens, DTOs, config, migrations
  | 'crud'          // standard create/read/update/delete + validation
  | 'integration'   // third-party APIs, protocols, undocumented systems
  | 'algorithmic'   // non-trivial domain logic, optimisation, concurrency
  | 'legacy-change' // change inside a large mature codebase (METR regime)
  | 'ux-heavy'      // design-led interaction work, accessibility
  | 'docs'          // documentation, specs, runbooks
  | 'ops';          // infrastructure, CI/CD, observability wiring

/** Delivery modes compared side by side. */
export type DeliveryMode =
  | 'human_only'
  | 'human_with_ai'
  | 'ai_steered_human_supervised'
  | 'agentic_hitl';

export type ActorType = 'api' | 'protocol' | 'human';
export type RiskLevel = 'low' | 'medium' | 'high';
export type NfrPath = 'derived-scope' | 'multiplier';

/** Project phase, used to apply the cone-of-uncertainty band. */
export type Phase =
  | 'initial-concept'
  | 'approved-product-definition'
  | 'requirements-complete'
  | 'ui-design-complete'
  | 'detailed-design-complete';

export interface UseCaseInput {
  id: string;
  name: string;
  /** Number of transactions/steps in the success + alternate scenarios. Drives UUCW weight. */
  transactions: number;
  ai_class?: AiClass;
  risk?: RiskLevel;
  /** Optional direct override in hours; when set, UCP sizing is bypassed for this item. */
  hours_override?: number;
  notes?: string;
}

export interface ActorInput {
  name: string;
  type: ActorType;
}

export interface NfrInput {
  id: string;
  /** ISO/IEC 25010 quality attribute, e.g. availability, security, performance-efficiency. */
  attribute: string;
  target?: string;
  /** Routing decision: expand into extra scope, or apply as a residual multiplier. Never both. */
  path: NfrPath;
  /** For `derived-scope`: extra work items this NFR forces into existence. */
  derived_components?: Array<{
    name: string;
    transactions?: number;
    hours?: number;
    ai_class?: AiClass;
    risk?: RiskLevel;
  }>;
  /** For `multiplier`: effort multiplier applied to the whole estimate (1.0 = neutral). */
  multiplier?: number;
}

export interface FactorsInput {
  /** UCP technical factors T1..T13, each rated 0-5. */
  technical?: Record<string, number>;
  /** UCP environmental factors E1..E8, each rated 0-5. */
  environmental?: Record<string, number>;
  /** COCOMO II scale factors, each a rating name (very-low..extra-high). */
  cocomo_scale?: Record<string, string>;
}

export interface RateEntry {
  role: string;
  seniority?: string;
  /** Cost per day in the project currency. */
  day_rate: number;
}

export interface AiConfig {
  /** Price per 1M input tokens, project currency. */
  price_per_mtok_in?: number;
  /** Price per 1M output tokens, project currency. */
  price_per_mtok_out?: number;
  /** ACEM Revision Factor: token overhead from rejected output and retries (>= 1). */
  revision_factor?: number;
  /** ACEM Context Factor: token growth as context accumulates (>= 1). */
  context_factor?: number;
  /** ACEM HITL Intensity Score, level 1-4. Higher = more human oversight per agent action. */
  hitl_intensity?: 1 | 2 | 3 | 4;
  /** Tokens consumed per UCP of delivered scope (input+output combined). */
  tokens_per_ucp?: number;
  /** Monthly agent infrastructure + tooling + licence cost. */
  infra_monthly?: number;
  /** Per-seat AI tool licence per developer per month. */
  licence_per_dev_month?: number;
  /** Steering-hour overhead multiplier for ai_steered mode (calibrated locally). */
  steering_overhead?: number;
  /**
   * MEASURED billed agent cost per agent-running hour, in USD.
   * When set, this replaces the ACEM token reconstruction entirely, because a
   * measured rate already contains every revision, retry and context effect.
   * Produced by scripts/calibrate-sessions.ts.
   */
  cost_per_steering_hour?: number;

  /**
   * How agent capacity is actually PAID FOR.
   *   'subscription' — flat per-seat plans (the common reality). Cost scales with
   *                    seats x calendar months and is capped by quota.
   *   'metered'      — pay-as-you-go API billing. Cost scales with work volume.
   * Default: 'subscription'.
   */
  cost_basis?: 'subscription' | 'metered';

  /** Seat plans held for this project. Used when cost_basis is 'subscription'. */
  subscriptions?: SubscriptionInput[];
}

export interface SubscriptionInput {
  /** Catalogue key, e.g. 'anthropic-max-20x'. See SUBSCRIPTION_PLANS. */
  plan?: string;
  /** Explicit USD per seat per month; overrides the catalogue price. */
  monthly?: number;
  /** Number of seats. Default 1. */
  seats?: number;
  /**
   * Share of each seat chargeable to THIS project (0–1). Default 1.
   * A seat shared across three projects should not bill fully to one of them.
   */
  utilisation?: number;
  /** Free-text label for the report. */
  label?: string;
}

export interface BusinessCaseInput {
  discount_rate?: number;
  horizon_years?: number;
  /** Recurring annual benefit lines. */
  benefits?: Array<{ name: string; annual_value: number; confidence?: number; start_year?: number }>;
  /** Recurring annual run cost lines (hosting, licences, support). */
  run_costs?: Array<{ name: string; annual_value: number }>;
  /** Scope ladder tiers used to answer "what can we cut". */
  scope_tiers?: Array<{ tier: 'must' | 'should' | 'could'; use_cases: string[] }>;
}

export interface EstimateInput {
  project: {
    name: string;
    client?: string;
    currency?: string;
    region?: string;
    phase?: Phase;
  };
  context?: {
    codebase?: 'greenfield' | 'brownfield' | 'legacy';
    domain?: string;
    compliance?: string[];
  };
  stack?: Record<string, unknown>;
  actors?: ActorInput[];
  use_cases: UseCaseInput[];
  nfrs?: NfrInput[];
  factors?: FactorsInput;
  delivery_modes?: DeliveryMode[];
  team?: {
    role_ratios?: Record<string, number>;
    seniority_mix?: Record<string, number>;
    hours_per_day?: number;
    fte?: number;
  };
  rates?: RateEntry[];
  ai?: AiConfig;
  business?: BusinessCaseInput;
  calibration?: {
    /** Hours per UCP. Karner's original is 20; project actuals should override. */
    hours_per_ucp?: number;
    /** Reference project size in UCP for the COCOMO scale adjustment. */
    reference_ucp?: number;
    /** Contingency applied on top of the base estimate. */
    contingency?: number;
    /** Monte Carlo iterations. */
    iterations?: number;
    /** Fixed RNG seed for reproducible runs. */
    seed?: number;
  };
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SizingResult {
  uucw: number;
  uaw: number;
  tcf: number;
  ecf: number;
  ucp: number;
  perUseCase: Array<{ id: string; name: string; weight: number; band: string }>;
  derivedItems: Array<{ id: string; name: string; weight: number; fromNfr: string }>;
}

export interface WorkItem {
  id: string;
  name: string;
  aiClass: AiClass;
  risk: RiskLevel;
  /** Baseline human-only hours, before contingency. */
  hours: number;
  source: 'use-case' | 'nfr-derived';
}

export interface RoleLine {
  role: string;
  hours: number;
  days: number;
  dayRate: number;
  cost: number;
}

export interface ModeResult {
  mode: DeliveryMode;
  /** Engineering hours after mode-specific speedups, review and rework. */
  hours: number;
  /** Hours added back for review of AI output. */
  reviewHours: number;
  /** Hours added back for AI-induced rework (DORA instability finding). */
  reworkHours: number;
  labourCost: number;
  aiCost: number;
  totalCost: number;
  calendarMonths: number;
  roles: RoleLine[];
  notes: string[];
}

export interface Percentiles {
  p10: number;
  p50: number;
  p85: number;
  p95: number;
  mean: number;
}

export interface BusinessCaseResult {
  currency: string;
  buildCost: number;
  annualRunCost: number;
  annualBenefit: number;
  horizonYears: number;
  discountRate: number;
  npv: number;
  roi: number;
  paybackYears: number | null;
  tco: number;
  yearly: Array<{ year: number; cost: number; benefit: number; net: number; discounted: number; cumulative: number }>;
  sensitivity: Array<{ driver: string; low: number; base: number; high: number }>;
  scopeLadder: Array<{ tier: string; hours: number; cost: number; cumulativeCost: number }>;
}

export interface EstimateResult {
  input: EstimateInput;
  currency: string;
  sizing: SizingResult;
  items: WorkItem[];
  nfrMultiplier: number;
  scaleExponent: number;
  scaleAdjustment: number;
  baseHours: number;
  contingency: number;
  totalHours: number;
  cone: { phase: Phase; low: number; high: number };
  percentiles: Percentiles;
  modes: ModeResult[];
  businessCase: BusinessCaseResult | null;
  assumptions: string[];
  warnings: string[];
}
