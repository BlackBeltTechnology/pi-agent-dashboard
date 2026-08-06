/**
 * Guardrails for the `noUndeclaredDependencies` configuration in `biome.json`.
 *
 * Two facts drive the shape of these tests:
 *
 *   1. Verifying that an override reduces a rule's finding count to zero proves
 *      coverage but CANNOT detect an over-broad glob — a wrongly-matched source
 *      file also reports zero. So the override is asserted from both sides: it
 *      must cover the known build entry points AND match nothing under `src/`.
 *
 *   2. Biome's `--only=<rule>` flag force-enables the named rule and bypasses
 *      `overrides` severity entirely. A rule resolved by override can therefore
 *      never reach zero under `--only`. The oracle is a plain `biome lint .`
 *      filtered to the rule's category, with the rule enabled in the base
 *      config. The `--only` asymmetry is pinned below so a future reader does
 *      not "simplify" the oracle back into a broken one.
 *
 * See change: cleanup-undeclared-dependencies
 * (test-plan E15, E16, E17, E18, X4).
 */
import { execFileSync } from 'node:child_process';
import { globSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const RULE = 'lint/correctness/noUndeclaredDependencies';

/**
 * E15 is a `ci`-level scenario per the test plan. A repo-root Biome run over
 * ~2800 files, executed in parallel with every other project, starves unrelated
 * 5s-timeout tests. `npm run test:ci-scenarios` runs it alone.
 *
 * It is additionally enforced in CI by the existing `biome lint .` gate:
 * `noUndeclaredDependencies` is now `error` in the base config, so any finding
 * fails that step independently of this test.
 */
const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === '1';

const biome = JSON.parse(readFileSync(join(REPO_ROOT, 'biome.json'), 'utf8'));

/** The override block that turns the rule off for build/config entry points. */
const buildConfigOverride = biome.overrides.find(
  (o) =>
    o.linter?.rules?.correctness?.noUndeclaredDependencies === 'off' &&
    o.includes.some((g) => g.includes('vitest.config') || g.includes('forge.config')),
);

/** The override block covering test files. */
const testOverride = biome.overrides.find(
  (o) => o.includes.includes('**/__tests__/**') && o.linter?.rules?.correctness?.noUndeclaredDependencies === 'off',
);

/** The override block covering never-published trees. */
const nonPublishedOverride = biome.overrides.find(
  (o) =>
    o.includes.includes('tests/e2e/**') && o.linter?.rules?.correctness?.noUndeclaredDependencies === 'off',
);

/** Run biome and return only this rule's diagnostics. */
function lintDiagnostics(args) {
  let stdout = '';
  try {
    stdout = execFileSync('npx', ['biome', ...args, '--reporter=json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    stdout = err.stdout ?? ''; // biome exits non-zero when it reports findings
  }
  const start = stdout.indexOf('{');
  if (start === -1) throw new Error('no JSON payload from biome');
  return JSON.parse(stdout.slice(start)).diagnostics.filter((d) => d.category === RULE);
}

/* ------------------------------------------------------------------ *
 * The oracle
 * ------------------------------------------------------------------ */

describe.runIf(CI_SCENARIOS)('repo-root findings reach zero (E15)', () => {
  it('reports no undeclared-dependency diagnostics across the repository', () => {
    expect(lintDiagnostics(['lint', '.', '--max-diagnostics=20000'])).toEqual([]);
  }, 180_000);
});

describe('the oracle actually runs the rule (X4)', () => {
  it('enables the rule at error severity in the base config', () => {
    // If the rule were absent from the base config, a plain `biome lint .` would
    // report zero because it ran nothing — a vacuous pass.
    expect(biome.linter.rules.correctness.noUndeclaredDependencies).toBe('error');
  });

  it('rejects an unknown rule name, so a typo cannot masquerade as a clean run', () => {
    expect(() =>
      execFileSync('npx', ['biome', 'lint', '--only=correctness/noSuchRule', '.'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: 'ignore',
      }),
    ).toThrow();
  }, 120_000);

  it('positive control: a genuinely undeclared import IS reported', () => {
    // The strongest anti-vacuity guard — prove the configured rule can still fail.
    const probe = join(REPO_ROOT, 'packages', 'shared', 'src', '__oracle_probe__.ts');
    try {
      writeFileSync(probe, 'import "definitely-not-a-real-package-xyz";\nexport const a = 1;\n');
      const found = lintDiagnostics(['lint', 'packages/shared/src/__oracle_probe__.ts']);
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].message).toContain('definitely-not-a-real-package-xyz');
    } finally {
      rmSync(probe, { force: true });
    }
  }, 120_000);

  it('pins the --only asymmetry that makes it an invalid oracle here', () => {
    // A build/config file the override silences must still report under --only.
    const target = 'packages/flows-plugin/vitest.config.ts';
    const withOnly = lintDiagnostics(['lint', `--only=correctness/${'noUndeclaredDependencies'}`, target]);
    const plain = lintDiagnostics(['lint', target]);

    expect(withOnly.length).toBeGreaterThan(0); // --only bypasses the override
    expect(plain).toEqual([]); // the override does apply to a normal run
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 * Override shape
 * ------------------------------------------------------------------ */

describe('the build/config override (E16, E17)', () => {
  it('exists and disables the rule', () => {
    expect(buildConfigOverride).toBeDefined();
  });

  it('matches no file under any src/ directory (E16)', () => {
    // An over-broad glob would silence real shipped source while still reporting zero.
    const matched = globSync(buildConfigOverride.includes, {
      cwd: REPO_ROOT,
      exclude: (p) => p.includes('node_modules') || p.includes('/dist/'),
    });
    expect(matched.length).toBeGreaterThan(0); // the glob set must match something
    expect(matched.filter((p) => /(^|\/)src\//.test(p.split('\\').join('/')))).toEqual([]);
  });

  it.each([
    'packages/electron/vite.main.config.ts',
    'packages/electron/vite.preload.config.ts',
    'packages/client/scripts/vite-build.mjs',
    'packages/electron/scripts/download-git-windows.mjs',
  ])('covers the non-obvious build entry point %s (E17)', (file) => {
    // These are exactly the files a naive
    // {vitest,vite,forge}.config.ts glob set would miss.
    expect(lintDiagnostics(['lint', file])).toEqual([]);
  }, 120_000);
});

describe('specification matches configuration (E18)', () => {
  it('every override this change asserts exists in biome.json', () => {
    expect(testOverride, 'the __tests__ override must disable the rule').toBeDefined();
    expect(buildConfigOverride, 'the build/config override must exist').toBeDefined();
    expect(nonPublishedOverride, 'the never-published-trees override must exist').toBeDefined();
  });

  it('does NOT assert the packages/server/** or scripts/** overrides the old spec claimed', () => {
    // Those were a long-standing spec-vs-config divergence; the spec delta drops
    // them rather than inventing config to match stale prose.
    const globs = biome.overrides.flatMap((o) => o.includes);
    expect(globs).not.toContain('packages/server/**');
    expect(globs).not.toContain('scripts/**');
  });

  it('covers every never-published tree named by the spec', () => {
    for (const tree of [
      'examples/**',
      'openspec/changes/**/spike/**',
      '.pi/flows/**',
      'tests/e2e/**',
      'qa/scripts/**',
      '.pi/skills/**/scripts/**',
    ]) {
      expect(nonPublishedOverride.includes).toContain(tree);
    }
  });
});

afterEach(() => {
  rmSync(join(REPO_ROOT, 'packages', 'shared', 'src', '__oracle_probe__.ts'), { force: true });
});
