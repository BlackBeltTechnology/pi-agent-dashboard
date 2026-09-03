#!/usr/bin/env node
/**
 * CLI entry point for the software cost estimator.
 *
 *   node scripts/estimate.ts <input.yaml> [--out DIR] [--rates FILE] [--json] [--quiet]
 *   bun  scripts/estimate.ts <input.yaml> --out ./out
 *
 * Writes estimate-report.md, delivery-mode-comparison.md, business-case.md and
 * estimate.xlsx into the output directory, and prints a short console summary.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { estimate } from "../engine/estimate.js";
import { parseDataFile } from "../engine/yaml.js";
import { renderBusinessCase, renderEstimateReport, renderModeComparison } from "../engine/report.js";
import { buildSheets } from "../engine/workbook.js";
import { buildXlsx } from "../engine/xlsx.js";
import type { EstimateInput, RateEntry } from "../engine/types.js";

interface Options {
  input: string;
  out: string;
  rates?: string;
  json: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const opts: Partial<Options> = { json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--rates') opts.rates = argv[++i];
    else if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '-h' || arg === '--help') { usage(); process.exit(0); }
    else positional.push(arg);
  }
  if (positional.length === 0) { usage(); process.exit(1); }
  const input = resolve(positional[0]);
  return {
    input,
    out: resolve(opts.out ?? dirname(input)),
    rates: opts.rates,
    json: opts.json ?? false,
    quiet: opts.quiet ?? false,
  };
}

function usage(): void {
  console.log(
    [
      'Usage: estimate.ts <input.yaml|input.json> [options]',
      '',
      '  --out DIR      output directory (default: next to the input file)',
      '  --rates FILE   rate card file; merged into input.rates',
      '  --json         also write estimate.json with the full result object',
      '  --quiet        suppress the console summary',
    ].join('\n'),
  );
}

/** Load a rate card file that is either a bare list or `{ rates: [...] }`. */
function loadRates(path: string, relativeTo: string): RateEntry[] {
  const full = isAbsolute(path) ? path : resolve(relativeTo, path);
  const parsed = parseDataFile(full, readFileSync(full, 'utf8')) as unknown;
  const list = Array.isArray(parsed) ? parsed : (parsed as { rates?: unknown }).rates;
  if (!Array.isArray(list)) throw new Error(`Rate file ${full} must be a list, or an object with a "rates" list`);
  return list as RateEntry[];
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const raw = readFileSync(opts.input, 'utf8');
  const input = parseDataFile(opts.input, raw) as unknown as EstimateInput;

  // Rates may come from the CLI, or from a `rates_file:` pointer inside the input.
  const inline = (input as unknown as { rates_file?: string }).rates_file;
  const ratePath = opts.rates ?? inline;
  if (ratePath) input.rates = loadRates(ratePath, dirname(opts.input));

  const result = estimate(input);

  mkdirSync(opts.out, { recursive: true });
  const write = (name: string, body: string | Uint8Array) => {
    writeFileSync(join(opts.out, name), body as never);
    return join(opts.out, name);
  };

  write('estimate-report.md', renderEstimateReport(result));
  write('delivery-mode-comparison.md', renderModeComparison(result));
  write('business-case.md', renderBusinessCase(result));
  write('estimate.xlsx', buildXlsx(buildSheets(result)));
  if (opts.json) write('estimate.json', JSON.stringify(result, null, 2));

  if (opts.quiet) return;

  const hoursPerDay = input.team?.hours_per_day ?? 8;
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  console.log(`\n${input.project.name} — ${basename(opts.input)}`);
  console.log(`  UCP ${result.sizing.ucp.toFixed(1)}  |  scale E ${result.scaleExponent.toFixed(3)} (x${result.scaleAdjustment.toFixed(3)})`);
  console.log(`  Point estimate ${fmt(result.totalHours)} h  =  ${fmt(result.totalHours / hoursPerDay)} md`);
  console.log(`  P50 ${fmt(result.percentiles.p50)} h  |  P85 ${fmt(result.percentiles.p85)} h  |  P95 ${fmt(result.percentiles.p95)} h`);
  console.log(`  Cone (${result.cone.phase}): ${fmt(result.cone.low)} – ${fmt(result.cone.high)} h`);
  console.log('\n  Delivery modes:');
  for (const mode of result.modes) {
    console.log(
      `    ${mode.mode.padEnd(28)} ${fmt(mode.hours).padStart(8)} h  ` +
        `${fmt(mode.totalCost).padStart(10)} ${result.currency}  ${mode.calendarMonths.toFixed(1)} mo`,
    );
  }
  if (result.businessCase) {
    const bc = result.businessCase;
    console.log(
      `\n  Business case: NPV ${fmt(bc.npv)} ${bc.currency}, ROI ${(bc.roi * 100).toFixed(1)}%, ` +
        `payback ${bc.paybackYears == null ? 'never' : `${bc.paybackYears.toFixed(1)} y`}`,
    );
  }
  if (result.warnings.length) {
    console.log('\n  Warnings:');
    for (const w of result.warnings) console.log(`    ! ${w}`);
  }
  console.log(`\n  Written to ${opts.out}\n`);
}

main();
