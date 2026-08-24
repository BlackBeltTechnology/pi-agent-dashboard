#!/usr/bin/env node
/**
 * Calibrate the AI delivery modes from real pi session telemetry.
 *
 *   node scripts/calibrate-sessions.ts
 *   node scripts/calibrate-sessions.ts --project pi-agent-dashboard --actual-days 58
 *   node scripts/calibrate-sessions.ts --since 2026-01-01 --gap-cap 15 --json
 *
 * This is the strongest calibration available, because it measures rather than
 * assumes the two things the model otherwise guesses:
 *
 *   1. STEERING TIME  — active human hours, from per-record timestamps with long
 *                       gaps capped (a gap is a break, not work).
 *   2. AGENT COST     — real billed cost and token mix, from the session metadata.
 *
 * Supplying `--actual-days` for a project additionally solves the AI-steered
 * OVERHEAD MULTIPLIER directly: total delivered man-days ÷ measured steering days.
 * That single number is what turns an AI-assisted quote from a guess into a
 * measurement.
 */

import { writeFileSync } from 'node:fs';

import { aggregateByProject, compareSubscription, defaultSessionRoot, measureConstants, scanSessions } from "../telemetry/sessions.js";
import { ACEM_DEFAULTS, DEFAULT_HOURS_PER_DAY, STEERING_OVERHEAD, SUBSCRIPTION_PLANS } from "../engine/defaults.js";

interface Options {
  root: string;
  gapCap: number;
  project?: string;
  since?: string;
  actualDays?: number;
  hoursPerDay: number;
  json?: string;
  top: number;
  plan?: string;
  seatMonthly?: number;
  seats: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    root: defaultSessionRoot(),
    gapCap: 15,
    hoursPerDay: DEFAULT_HOURS_PER_DAY,
    top: 15,
    seats: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') opts.root = argv[++i];
    else if (arg === '--gap-cap') opts.gapCap = Number(argv[++i]);
    else if (arg === '--project') opts.project = argv[++i];
    else if (arg === '--since') opts.since = argv[++i];
    else if (arg === '--actual-days') opts.actualDays = Number(argv[++i]);
    else if (arg === '--hours-per-day') opts.hoursPerDay = Number(argv[++i]);
    else if (arg === '--top') opts.top = Number(argv[++i]);
    else if (arg === '--json') opts.json = argv[++i];
    else if (arg === '--plan') opts.plan = argv[++i];
    else if (arg === '--seat-monthly') opts.seatMonthly = Number(argv[++i]);
    else if (arg === '--seats') opts.seats = Number(argv[++i]);
    else if (arg === '--plans') {
      console.log('\nSubscription plans (USD per seat per month):');
      for (const [key, plan] of Object.entries(SUBSCRIPTION_PLANS)) {
        console.log(`  ${key.padEnd(20)} $${String(plan.monthly).padStart(4)}  ${plan.label}  (${plan.src})`);
      }
      console.log('');
      process.exit(0);
    }
    else if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
  }
  return opts;
}

function usage(): void {
  console.log(
    [
      'Usage: calibrate-sessions.ts [options]',
      '',
      '  --project SUBSTR    filter to projects whose path contains SUBSTR',
      '  --actual-days N     delivered man-days for that project; solves the overhead multiplier',
      '  --since ISO-DATE    ignore sessions started before this date',
      '  --gap-cap MIN       gap above which time counts as a break (default 15)',
      '  --hours-per-day N   productive hours per man-day (default 8)',
      '  --plan KEY          seat plan to compare against (see --plans)',
      '  --seat-monthly N    explicit USD per seat per month, overrides --plan',
      '  --seats N           number of seats (default 1)',
      '  --plans             list the seat-plan catalogue and exit',
      '  --top N             projects to list (default 15)',
      '  --root DIR          session store (default ~/.pi/agent/sessions)',
      '  --json FILE         also write the full result as JSON',
    ].join('\n'),
  );
}

const n = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const records = scanSessions({
    root: opts.root,
    gapCapMinutes: opts.gapCap,
    project: opts.project,
    since: opts.since,
  });

  if (records.length === 0) {
    console.log(`\nNo usable sessions found under ${opts.root}`);
    console.log('Check --root, or relax --project / --since.\n');
    process.exit(1);
  }

  const measured = measureConstants(records, opts.hoursPerDay);
  const projects = aggregateByProject(records, opts.hoursPerDay);

  console.log(`\nSession calibration — ${records.length} sessions${opts.project ? ` matching "${opts.project}"` : ''}`);
  console.log(`  gap cap ${opts.gapCap} min · ${opts.hoursPerDay} h/man-day · root ${opts.root}`);

  console.log('\n--- MEASURED EFFORT ---');
  console.log(`  active steering time      ${n(measured.activeHours, 1)} h  (${n(measured.steeringDays, 1)} steering-days)`);
  console.log(`  human turns per hour      ${n(measured.assistantPerHumanTurn, 1)} assistant turns per human turn`);
  console.log(`  tool calls per hour       ${n(measured.toolCallsPerHour, 1)}`);

  console.log('\n--- METER-EQUIVALENT COST (theoretical pay-as-you-go) ---');
  console.log(`  total meter-equivalent    $${n(measured.totalCost, 2)}`);
  console.log(`  per steering hour         $${n(measured.costPerSteeringHour, 2)}`);
  console.log(`  per steering day          $${n(measured.costPerSteeringDay, 2)}`);
  console.log(`  per active month          $${n(measured.meterPerMonth, 2)}  over ${measured.activeMonths} active months`);
  console.log(`  output tokens per hour    ${n(measured.outputTokensPerHour)}`);
  console.log('  NOTE: this is what the meter WOULD have charged. It is not cash out when');
  console.log('        capacity is bought on a flat subscription.');
  if (measured.unmeteredHourShare > 0.01) {
    console.log(
      `  ! ${(measured.unmeteredHourShare * 100).toFixed(1)}% of hours ran on models the meter priced at $0 ` +
        '(routed/subscription-billed). The $/h above is understated by that much.',
    );
  }

  // --- what it actually costs on a seat plan ---
  const catalogue = opts.plan ? SUBSCRIPTION_PLANS[opts.plan] : undefined;
  if (opts.plan && !catalogue && opts.seatMonthly == null) {
    console.log(`\n  ! Unknown plan "${opts.plan}". Run with --plans to list the catalogue.`);
  }
  const seatMonthly = opts.seatMonthly ?? catalogue?.monthly;
  if (seatMonthly != null) {
    const monthlyTotal = seatMonthly * opts.seats;
    const cmp = compareSubscription(measured, monthlyTotal);
    const label = catalogue ? catalogue.label : 'custom plan';
    console.log('\n--- ACTUAL COST ON A SUBSCRIPTION ---');
    console.log(`  plan                      ${opts.seats}x ${label} @ $${n(seatMonthly, 0)}/seat/mo = $${n(monthlyTotal, 0)}/mo`);
    console.log(`  over ${cmp.months} active months     $${n(cmp.subscriptionCost, 2)}  <-- CASH OUT`);
    console.log(`  effective per steering h  $${n(cmp.effectiveCostPerHour, 2)}  (vs $${n(cmp.meteredCostPerHour, 2)} metered)`);
    console.log(`  SUBSCRIPTION LEVERAGE     ${cmp.leverage.toFixed(1)}x`);
    if (cmp.leverage >= 1) {
      console.log(`  => the plan captured $${n(cmp.meterEquivalent - cmp.subscriptionCost, 0)} of on-demand value.`);
      console.log('     This is leverage, NOT a saving to show a client as a discount.');
    } else {
      console.log('  ! The plan costs MORE than metering at this volume. Pay-as-you-go is cheaper.');
    }
    console.log(`  utilisation               ${n(measured.hoursPerMonth, 1)} steering h/month per seat`);
    console.log('  Quota risk: exceeding a plan quota throttles delivery. That is a SCHEDULE');
    console.log('              risk, not a cost overrun — subscription cost is capped by design.');
  } else {
    console.log('\n--- ACTUAL COST ON A SUBSCRIPTION ---');
    console.log('  Not computed. Pass --plan <key> (see --plans) or --seat-monthly N.');
    console.log('  Without it the figures above remain THEORETICAL meter-equivalents.');
  }

  console.log('\n--- ACEM PARAMETERS: measured vs default ---');
  row('Context Factor', ACEM_DEFAULTS.contextFactor, measured.contextFactor);
  row('Revision Factor', ACEM_DEFAULTS.revisionFactor, measured.revisionFactorLowerBound, 'lower bound');
  row('Output share', ACEM_DEFAULTS.outputShare, measured.outputShare);
  console.log(`  cache-read share of all tokens        ${(measured.cacheReadShare * 100).toFixed(1)}%`);
  console.log(`  tool error rate                       ${(measured.toolErrorRate * 100).toFixed(1)}%`);
  console.log(`  human correction rate                 ${(measured.correctionRate * 100).toFixed(1)}%`);

  console.log(`\n--- TOP ${Math.min(opts.top, projects.length)} PROJECTS BY STEERING TIME ---`);
  console.log(`  ${'project'.padEnd(46)}${'sess'.padStart(6)}${'active h'.padStart(10)}${'days'.padStart(8)}${'cost $'.padStart(10)}${'$/h'.padStart(8)}`);
  for (const p of projects.slice(0, opts.top)) {
    console.log(
      `  ${p.project.slice(0, 45).padEnd(46)}${String(p.sessions).padStart(6)}` +
        `${n(p.activeHours, 1).padStart(10)}${n(p.steeringDays, 1).padStart(8)}` +
        `${n(p.cost, 0).padStart(10)}${n(p.costPerHour, 2).padStart(8)}`,
    );
  }

  if (opts.actualDays != null && Number.isFinite(opts.actualDays)) {
    const steeringDays = measured.steeringDays;
    const overhead = steeringDays > 0 ? opts.actualDays / steeringDays : 0;
    console.log('\n--- SOLVED: AI-STEERED OVERHEAD MULTIPLIER ---');
    console.log(`  delivered man-days        ${n(opts.actualDays, 1)}`);
    console.log(`  measured steering-days    ${n(steeringDays, 1)}`);
    console.log(`  => OVERHEAD MULTIPLIER    ${overhead.toFixed(2)}x`);
    console.log(`     (skill defaults: ${STEERING_OVERHEAD.low} light / ${STEERING_OVERHEAD.base} base / ${STEERING_OVERHEAD.high} heavy)`);
    if (overhead < 1.2) {
      console.log('  ! Below 1.2x is implausible — it implies almost no work happened outside the agent.');
      console.log('    Check that the delivered man-days cover the same roles (PM, QA, compliance, client).');
    }
    console.log('\n  Put this in the estimate input:');
    console.log(`    ai:\n      steering_overhead: ${overhead.toFixed(2)}`);
  }

  console.log('\n--- READY TO PASTE INTO AN ESTIMATE INPUT ---');
  console.log('  ai:');
  console.log(`    cost_basis: ${seatMonthly != null ? 'subscription' : 'metered'}`);
  if (seatMonthly != null) {
    console.log('    subscriptions:');
    console.log(`      - plan: ${opts.plan ?? 'custom'}`);
    console.log(`        seats: ${opts.seats}`);
    if (opts.seatMonthly != null) console.log(`        monthly: ${opts.seatMonthly}`);
  }
  console.log(`    context_factor: ${measured.contextFactor.toFixed(2)}          # measured`);
  console.log(`    revision_factor: ${Math.max(measured.revisionFactorLowerBound, 1).toFixed(2)}         # measured lower bound`);
  console.log(`    cost_per_steering_hour: ${measured.costPerSteeringHour.toFixed(2)}  # meter-equivalent, for the leverage line`);
  if (opts.actualDays == null) {
    console.log('    # run again with --actual-days N to solve steering_overhead');
  }

  console.log('\n  Caveats:');
  console.log('   - Revision Factor here is a LOWER BOUND: it counts tool errors and explicit human');
  console.log('     corrections, not tokens the agent silently redid on its own.');
  console.log('   - Cost per steering hour already contains all revision and context effects, so');
  console.log('     prefer it over reconstructing cost from RF x CF.');
  console.log('   - Active time counts hours where a human was engaged; it is not billable-hours truth.');
  console.log('   - The meter figure is THEORETICAL when capacity is bought on a subscription.');
  console.log('     Quote the subscription cost; use the meter only for the leverage argument.');
  console.log('');

  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify({ measured, projects, sessions: records.length }, null, 2));
    console.log(`  JSON written to ${opts.json}\n`);
  }
}

function row(label: string, defaultValue: number, measuredValue: number, note = ''): void {
  const ratio = defaultValue > 0 ? measuredValue / defaultValue : 0;
  const verdict =
    ratio > 1.5 ? `default UNDERSTATES by ${ratio.toFixed(1)}x` : ratio < 0.67 ? `default OVERSTATES by ${(1 / ratio).toFixed(1)}x` : 'default is close';
  console.log(
    `  ${label.padEnd(20)} default ${defaultValue.toString().padStart(6)}   measured ${measuredValue.toFixed(3).padStart(8)}   ${verdict}${note ? ` (${note})` : ''}`,
  );
}

main();
