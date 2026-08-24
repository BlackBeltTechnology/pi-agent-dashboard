/**
 * Markdown renderers for the four deliverables.
 * Every table restates its inputs so a reader can re-derive the numbers by hand.
 */

import { AI_SPEEDUP, DEFAULT_HOURS_PER_DAY } from "./defaults.js";
import type { DeliveryMode, EstimateResult, ModeResult } from "./types.js";

const MODE_LABEL: Record<DeliveryMode, string> = {
  human_only: 'Human only',
  human_with_ai: 'Human + AI assist',
  ai_steered_human_supervised: 'AI-steered, human-supervised',
  agentic_hitl: 'Agentic (HITL)',
};

function num(value: number, digits = 0): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function money(value: number, currency: string): string {
  return `${num(Math.round(value))} ${currency}`;
}

/** The main estimate report: sizing workings, work items, roles, percentiles. */
export function renderEstimateReport(r: EstimateResult): string {
  const hoursPerDay = r.input.team?.hours_per_day ?? DEFAULT_HOURS_PER_DAY;
  const baseline = r.modes.find((m) => m.mode === 'human_only') ?? r.modes[0];
  const out: string[] = [];

  out.push(`# Effort & Cost Estimate — ${r.input.project.name}`, '');
  if (r.input.project.client) out.push(`**Client:** ${r.input.project.client}  `);
  out.push(
    `**Currency:** ${r.currency}  `,
    `**Phase:** ${r.cone.phase}  `,
    `**Codebase:** ${r.input.context?.codebase ?? 'brownfield'}  `,
    `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
    '',
    '> This is an **estimate** — a probabilistic assessment. It is not a target and not a commitment.',
    '',
  );

  out.push('## 1. Headline', '');
  out.push('| Measure | Hours | Days | Cost |', '|---|---:|---:|---:|');
  out.push(
    `| P50 (even odds) | ${num(r.percentiles.p50)} | ${num(r.percentiles.p50 / hoursPerDay, 1)} | ${money(costAt(baseline, r.percentiles.p50, r.totalHours), r.currency)} |`,
  );
  out.push(
    `| P85 (plan to this) | ${num(r.percentiles.p85)} | ${num(r.percentiles.p85 / hoursPerDay, 1)} | ${money(costAt(baseline, r.percentiles.p85, r.totalHours), r.currency)} |`,
  );
  out.push(
    `| P95 (commit to this) | ${num(r.percentiles.p95)} | ${num(r.percentiles.p95 / hoursPerDay, 1)} | ${money(costAt(baseline, r.percentiles.p95, r.totalHours), r.currency)} |`,
  );
  out.push('');
  out.push(
    `**Cone of uncertainty at phase _${r.cone.phase}_:** ${num(r.cone.low)}–${num(r.cone.high)} h. ` +
      'The cone narrows when decisions are made, not when time passes.',
    '',
    `The point estimate is ${num(r.totalHours)} h. P50 sits above it because the risk distribution is ` +
      'right-skewed: work overruns more often, and by more, than it underruns.',
    '',
  );

  out.push('## 2. Sizing workings (Use Case Points)', '');
  out.push('| Element | Value |', '|---|---:|');
  out.push(`| UUCW (unadjusted use case weight) | ${num(r.sizing.uucw, 1)} |`);
  out.push(`| UAW (unadjusted actor weight) | ${num(r.sizing.uaw, 1)} |`);
  out.push(`| TCF (technical complexity factor) | ${r.sizing.tcf.toFixed(3)} |`);
  out.push(`| ECF (environmental complexity factor) | ${r.sizing.ecf.toFixed(3)} |`);
  out.push(`| **UCP = (UUCW + UAW) × TCF × ECF** | **${num(r.sizing.ucp, 1)}** |`);
  out.push(`| COCOMO II scale exponent E | ${r.scaleExponent.toFixed(3)} |`);
  out.push(`| Diseconomy-of-scale adjustment | ×${r.scaleAdjustment.toFixed(3)} |`);
  out.push(`| Residual NFR multiplier | ×${r.nfrMultiplier.toFixed(3)} |`);
  out.push(`| Base effort | ${num(r.baseHours)} h |`);
  out.push(`| Contingency | ${num(r.contingency)} h |`);
  out.push(`| **Total (point estimate)** | **${num(r.totalHours)} h** |`);
  out.push('');

  out.push('## 3. Work items', '');
  out.push('| ID | Item | Source | AI class | Risk | Hours | Days |', '|---|---|---|---|---|---:|---:|');
  for (const item of r.items) {
    out.push(
      `| ${item.id} | ${item.name} | ${item.source} | ${item.aiClass} | ${item.risk} | ` +
        `${num(item.hours, 1)} | ${num(item.hours / hoursPerDay, 1)} |`,
    );
  }
  out.push('');

  out.push('## 4. Effort by role', '');
  out.push('| Role | Share | Hours | Days | Day rate | Cost |', '|---|---:|---:|---:|---:|---:|');
  const totalRoleHours = baseline.roles.reduce((s, l) => s + l.hours, 0);
  for (const line of baseline.roles) {
    const share = totalRoleHours > 0 ? (line.hours / totalRoleHours) * 100 : 0;
    out.push(
      `| ${line.role} | ${share.toFixed(1)}% | ${num(line.hours)} | ${num(line.days, 1)} | ` +
        `${money(line.dayRate, r.currency)} | ${money(line.cost, r.currency)} |`,
    );
  }
  out.push(
    `| **Total** | **100%** | **${num(totalRoleHours)}** | **${num(totalRoleHours / hoursPerDay, 1)}** | | ` +
      `**${money(baseline.labourCost, r.currency)}** |`,
    '',
  );

  if (r.warnings.length) {
    out.push('## 5. Warnings', '');
    for (const w of r.warnings) out.push(`- ⚠️ ${w}`);
    out.push('');
  }

  out.push('## 6. Assumption register', '');
  for (const a of r.assumptions) out.push(`- ${a}`);
  out.push('');

  return out.join('\n');
}

function costAt(mode: ModeResult, hours: number, totalHours: number): number {
  return totalHours > 0 ? mode.totalCost * (hours / totalHours) : 0;
}

/** Side-by-side comparison of the delivery modes. */
export function renderModeComparison(r: EstimateResult): string {
  const hoursPerDay = r.input.team?.hours_per_day ?? DEFAULT_HOURS_PER_DAY;
  const baseline = r.modes.find((m) => m.mode === 'human_only');
  const out: string[] = [];

  out.push(`# Delivery-Mode Comparison — ${r.input.project.name}`, '');
  out.push(
    'Same scope, four ways of building it. AI compresses **build** effort only; project management, ' +
      'client iteration, compliance and manual QA do not shrink because a model writes the code.',
    '',
  );

  out.push('| Mode | Hours | Days | Labour | AI cost | Total | Calendar | vs human-only |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const mode of r.modes) {
    const delta = baseline && baseline.totalCost > 0 ? ((mode.totalCost - baseline.totalCost) / baseline.totalCost) * 100 : 0;
    out.push(
      `| ${MODE_LABEL[mode.mode]} | ${num(mode.hours)} | ${num(mode.hours / hoursPerDay, 1)} | ` +
        `${money(mode.labourCost, r.currency)} | ${money(mode.aiCost, r.currency)} | ` +
        `**${money(mode.totalCost, r.currency)}** | ${mode.calendarMonths.toFixed(1)} mo | ` +
        `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% |`,
    );
  }
  out.push('');

  out.push('## Review and rework carried by each mode', '');
  out.push('| Mode | Review hours | Rework hours | Share of mode effort |', '|---|---:|---:|---:|');
  for (const mode of r.modes) {
    const share = mode.hours > 0 ? ((mode.reviewHours + mode.reworkHours) / mode.hours) * 100 : 0;
    out.push(
      `| ${MODE_LABEL[mode.mode]} | ${num(mode.reviewHours)} | ${num(mode.reworkHours)} | ${share.toFixed(1)}% |`,
    );
  }
  out.push(
    '',
    '> DORA 2025 found AI adoption raised instability and rework even as throughput recovered. ' +
      'A comparison that omits these lines is a sales document, not an estimate.',
    '',
  );

  out.push('## Per-class AI speedup applied', '');
  out.push('| AI class | Optimistic | Likely | Pessimistic | Hours in scope |', '|---|---:|---:|---:|---:|');
  const byClass = new Map<string, number>();
  for (const item of r.items) byClass.set(item.aiClass, (byClass.get(item.aiClass) ?? 0) + item.hours);
  for (const [cls, hours] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
    const [o, m, p] = AI_SPEEDUP[cls as keyof typeof AI_SPEEDUP];
    out.push(`| ${cls} | ×${o.toFixed(2)} | ×${m.toFixed(2)} | ×${p.toFixed(2)} | ${num(hours)} |`);
  }
  out.push(
    '',
    '> ×1.00 = no change. Above 1.00 means AI makes it **slower** — the METR regime for experienced ' +
      'developers changing mature code they already know well.',
    '',
  );

  out.push('## Mode notes', '');
  for (const mode of r.modes) {
    out.push(`### ${MODE_LABEL[mode.mode]}`, '');
    for (const note of mode.notes) out.push(`- ${note}`);
    out.push('');
  }

  return out.join('\n');
}

/** The business case. */
export function renderBusinessCase(r: EstimateResult): string {
  const bc = r.businessCase;
  if (!bc) return `# Business Case — ${r.input.project.name}\n\nNo \`business:\` block in the input; nothing to compute.\n`;

  const out: string[] = [];
  out.push(`# Business Case — ${r.input.project.name}`, '');
  out.push('## Headline', '');
  out.push('| Metric | Value |', '|---|---:|');
  out.push(`| Build cost | ${money(bc.buildCost, bc.currency)} |`);
  out.push(`| Annual run cost | ${money(bc.annualRunCost, bc.currency)} |`);
  out.push(`| Annual benefit (confidence-weighted) | ${money(bc.annualBenefit, bc.currency)} |`);
  out.push(`| TCO over ${bc.horizonYears} years | ${money(bc.tco, bc.currency)} |`);
  out.push(`| NPV @ ${(bc.discountRate * 100).toFixed(0)}% | **${money(bc.npv, bc.currency)}** |`);
  out.push(`| ROI | ${(bc.roi * 100).toFixed(1)}% |`);
  out.push(`| Payback | ${bc.paybackYears == null ? 'never within horizon' : `${bc.paybackYears.toFixed(1)} years`} |`);
  out.push('');

  out.push('## Cash flow', '');
  out.push('| Year | Cost | Benefit | Net | Discounted | Cumulative |', '|---:|---:|---:|---:|---:|---:|');
  for (const y of bc.yearly) {
    out.push(
      `| ${y.year} | ${money(y.cost, bc.currency)} | ${money(y.benefit, bc.currency)} | ${money(y.net, bc.currency)} | ` +
        `${money(y.discounted, bc.currency)} | ${money(y.cumulative, bc.currency)} |`,
    );
  }
  out.push('');

  out.push('## Sensitivity', '');
  out.push('| Driver | Downside NPV | Base NPV | Upside NPV |', '|---|---:|---:|---:|');
  for (const s of bc.sensitivity) {
    out.push(`| ${s.driver} | ${money(s.low, bc.currency)} | ${money(s.base, bc.currency)} | ${money(s.high, bc.currency)} |`);
  }
  out.push('');

  if (bc.scopeLadder.length) {
    out.push('## Scope ladder — what you get for what you spend', '');
    out.push('| Tier | Hours | Tier cost | Cumulative |', '|---|---:|---:|---:|');
    for (const tier of bc.scopeLadder) {
      out.push(
        `| ${tier.tier} | ${num(tier.hours)} | ${money(tier.cost, bc.currency)} | ${money(tier.cumulativeCost, bc.currency)} |`,
      );
    }
    out.push('');
  }

  out.push('## Caveats', '');
  out.push('- Benefits are confidence-weighted; unweighted benefit claims are the usual failure mode of a business case.');
  out.push('- Build cost is the point estimate for the chosen delivery mode. Fund to P85, not P50.');
  out.push('- Agentic run costs are variable and retry-driven; treat the AI cost line as a range, not a price.');
  out.push('');
  return out.join('\n');
}
