/**
 * Guard tests for the vitest worker consolidation.
 *
 * `vitest.workers.ts` is the single source of truth for the parallel worker
 * target. These tests keep it that way: no config restates the target as a
 * literal, the deliberately serial projects stay serial without importing the
 * module, adoption adds no dependency edge, and every config still resolves to
 * the worker count it declared before the consolidation (P1 — no effective
 * change).
 *
 * See change: make-test-suite-deterministic (test-plan E15-E17, P1).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARALLEL_MAX_WORKERS } from '../../vitest.workers';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

/** The 7 projects that run serial by design — pinned by the spec delta. */
const SERIAL_PROJECTS = [
  'electron',
  'image-fit-extension',
  'kb-extension',
  'mockup-loop',
  'nano-banana',
  'video-production',
  'video-transcription',
];

/** Every vitest.config.ts under packages/* (depth 1) plus scripts/. */
function* vitestConfigs() {
  const packagesDir = join(REPO_ROOT, 'packages');
  for (const entry of readdirSync(packagesDir)) {
    const candidate = join(packagesDir, entry, 'vitest.config.ts');
    if (existsSync(candidate) && statSync(candidate).isFile()) yield { pkg: entry, path: candidate };
  }
  const scriptsConfig = join(REPO_ROOT, 'scripts', 'vitest.config.ts');
  if (statSync(scriptsConfig).isFile()) yield { pkg: 'scripts', path: scriptsConfig };
}

const configs = [...vitestConfigs()];

function readConfig(pkg) {
  return readFileSync(configs.find((c) => c.pkg === pkg)?.path ?? join(REPO_ROOT, 'packages', pkg, 'vitest.config.ts'), 'utf8');
}

describe('worker target single source of truth (E15)', () => {
  it('no config restates the parallel target as a literal', () => {
    const offenders = [];
    for (const { pkg, path } of configs) {
      const m = readFileSync(path, 'utf8').match(/maxWorkers:\s*([^,\n}]+)/);
      if (!m) continue; // declares no worker setting at all — fine
      const value = m[1].trim().replace(/,$/, '');
      if (value !== '1' && value !== 'PARALLEL_MAX_WORKERS') {
        offenders.push(`${pkg}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('at least the parallel count the consolidation adopted still imports the module', () => {
    const importers = configs.filter(({ path }) => readFileSync(path, 'utf8').includes('vitest.workers'));
    // 27 parallel configs at adoption time; guard against silent de-adoption
    // while allowing the count to grow as packages are added.
    expect(importers.length).toBeGreaterThanOrEqual(27);
  });
});

describe('serial projects stay serial (E16)', () => {
  it.each(SERIAL_PROJECTS)('%s declares maxWorkers: 1 and does not import the module', (pkg) => {
    const text = readConfig(pkg);
    expect(text).toMatch(/maxWorkers:\s*1\b/);
    expect(text).not.toMatch(/vitest\.workers/);
  });
});

describe('no dependency edge added (E17)', () => {
  it('every importer uses a relative specifier', () => {
    const offenders = [];
    for (const { pkg, path } of configs) {
      const text = readFileSync(path, 'utf8');
      const m = text.match(/from\s+['"]([^'"]*vitest\.workers[^'"]*)['"]/);
      if (!m) continue;
      if (!m[1].startsWith('.')) offenders.push(`${pkg}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('no package.json references the worker module', () => {
    const offenders = [];
    for (const { pkg } of configs) {
      const pkgJsonPath = pkg === 'scripts' ? null : join(REPO_ROOT, 'packages', pkg, 'package.json');
      if (!pkgJsonPath) continue;
      const text = readFileSync(pkgJsonPath, 'utf8');
      if (text.includes('vitest.workers')) offenders.push(pkg);
    }
    expect(offenders).toEqual([]);
  });
});

describe('effective worker count unchanged (P1)', () => {
  it('every importing config resolves to the shared target; serial configs to 1', async () => {
    const wrong = [];
    for (const { pkg, path } of configs) {
      const mod = await import(`${path}?worker-census-${pkg}`);
      const config = typeof mod.default === 'function' ? await mod.default({}) : mod.default;
      const resolved = config?.test?.maxWorkers;
      // A config that IMPORTS the module must actually resolve to it (an
      // import whose resolution silently fails would pass a looser check);
      // serial projects must resolve to exactly 1; anything else (only
      // dashboard-plugin-skill today) declares no worker setting at all.
      const importsModule = readFileSync(path, 'utf8').includes('vitest.workers');
      const expected = importsModule
        ? PARALLEL_MAX_WORKERS
        : SERIAL_PROJECTS.includes(pkg)
          ? 1
          : undefined;
      if (resolved !== expected) {
        wrong.push(`${pkg}: resolved ${String(resolved)}, expected ${String(expected)}`);
      }
    }
    expect(wrong).toEqual([]);
    // The shared target must actually be in effect somewhere — a consolidation
    // that resolved everything to undefined would wrongly pass the check above.
    const resolvedValues = [];
    for (const { pkg, path } of configs) {
      const mod = await import(`${path}?worker-census-${pkg}`);
      const config = typeof mod.default === 'function' ? await mod.default({}) : mod.default;
      resolvedValues.push(config?.test?.maxWorkers);
    }
    expect(resolvedValues).toContain(PARALLEL_MAX_WORKERS);
  });
});
