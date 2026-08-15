#!/usr/bin/env node
/**
 * Calibrate `hours_per_ucp` against a completed project.
 *
 *   node scripts/calibrate.ts <input.yaml> --actual-hours 3832
 *   node scripts/calibrate.ts <input.yaml> --actual-days 479
 *
 * Reference-class forecasting is the single largest accuracy win available in
 * software estimation. This solves for the hours-per-UCP that reproduces a known
 * outcome, so the next estimate is anchored on your own delivery history rather
 * than on Karner's 1993 constant.
 *
 * Effort is linear in hours_per_ucp for a fixed scope, so the solve is a ratio —
 * but the scale adjustment depends on it only through the reference size, which
 * is held fixed, so no iteration is needed.
 */

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { DEFAULT_HOURS_PER_DAY, DEFAULT_HOURS_PER_UCP } from "../engine/defaults.js";
import { estimate } from "../engine/estimate.js";
import { parseDataFile } from "../engine/yaml.js";
import type { EstimateInput, RateEntry } from "../engine/types.js";

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log('Usage: calibrate.ts <input.yaml> (--actual-hours N | --actual-days N) [--exclude-contingency]');
    process.exit(1);
  }

  const inputPath = resolve(argv[0]);
  let actualHours: number | null = null;
  let excludeContingency = false;

  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--actual-hours') actualHours = Number(argv[++i]);
    else if (argv[i] === '--actual-days') actualHours = Number(argv[++i]) * DEFAULT_HOURS_PER_DAY;
    else if (argv[i] === '--exclude-contingency') excludeContingency = true;
  }
  if (!actualHours || !Number.isFinite(actualHours)) throw new Error('Provide --actual-hours or --actual-days');

  const input = parseDataFile(inputPath, readFileSync(inputPath, 'utf8')) as unknown as EstimateInput;
  const ratesFile = (input as unknown as { rates_file?: string }).rates_file;
  if (ratesFile) {
    const full = isAbsolute(ratesFile) ? ratesFile : resolve(dirname(inputPath), ratesFile);
    const parsed = parseDataFile(full, readFileSync(full, 'utf8')) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { rates?: unknown }).rates;
    if (Array.isArray(list)) input.rates = list as RateEntry[];
  }

  const assumed = input.calibration?.hours_per_ucp ?? DEFAULT_HOURS_PER_UCP;
  const result = estimate(input);
  const modelled = excludeContingency ? result.baseHours : result.totalHours;
  const implied = (assumed * actualHours) / modelled;
  const error = (modelled - actualHours) / actualHours;

  const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d });

  console.log(`\nCalibration — ${input.project.name}`);
  console.log(`  UCP                        ${fmt(result.sizing.ucp)}`);
  console.log(`  Assumed hours/UCP          ${fmt(assumed, 2)}`);
  console.log(`  Modelled effort            ${fmt(modelled, 0)} h (${fmt(modelled / DEFAULT_HOURS_PER_DAY)} md)${excludeContingency ? ' [excl. contingency]' : ''}`);
  console.log(`  Actual effort              ${fmt(actualHours, 0)} h (${fmt(actualHours / DEFAULT_HOURS_PER_DAY)} md)`);
  console.log(`  Model error                ${(error * 100).toFixed(1)}%`);
  console.log(`\n  => IMPLIED hours/UCP       ${fmt(implied, 2)}`);
  console.log(`     Write this into calibration.hours_per_ucp for the next estimate of this class of work.\n`);

  if (implied < 10 || implied > 45) {
    console.log('  ! Implied value is outside the 10-45 h/UCP band seen in practice.');
    console.log('    Check that the scope in this file really matches what the actual hours cover');
    console.log('    (roles included, contingency, support, PM) before adopting it.\n');
  }
}

main();
