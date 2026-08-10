/**
 * Manifest-level guarantees for the dependency declarations this change lands.
 *
 * These are set-based assertions over the whole workspace set, not a sampled
 * subset: planning sampled 6 workspaces while 32 exist, and a rule that holds
 * for a sample is not a rule. A newly-added workspace is therefore covered
 * automatically, with no edit here.
 *
 * See change: cleanup-undeclared-dependencies
 * (test-plan E19–E26, P1).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rangeIsSatisfiable, selectHostPeerRange, selectRange } from '../verify-published-imports.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * `ci`-level scenarios, per the test plan's own level column (E26, P1 are `ci`;
 * the rest are L1).
 *
 * They shell out to `npm publish --dry-run` and `npm pack` across 32
 * workspaces. Left in the default run they execute in parallel with every other
 * project, and the resulting CPU spike starves unrelated tests that carry a 5s
 * timeout — the suite then fails somewhere else entirely, which is a far worse
 * signal than the check is worth. `npm run test:ci-scenarios` runs them alone.
 */
const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === '1';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const rootManifest = readJson(join(REPO_ROOT, 'package.json'));

/** Every workspace under packages/, with its manifest. */
function allWorkspaces() {
  const base = join(REPO_ROOT, 'packages');
  return readdirSync(base)
    .filter((n) => statSync(join(base, n)).isDirectory() && existsSync(join(base, n, 'package.json')))
    .map((n) => ({ name: n, manifest: readJson(join(base, n, 'package.json')) }));
}

const nonPrivate = () => allWorkspaces().filter((w) => w.manifest.private !== true);

/**
 * Resolved version of `dep` AS THE DECLARING WORKSPACE SEES IT: its own nested
 * copy when one exists, else the hoisted root copy. Returns null when absent.
 *
 * `nodeLinker: hoisted` hoists ONE version of a package to the root and nests
 * the rest, and which version wins is a property of the whole tree — an
 * unrelated dependency bump can flip it. Resolving only from the root therefore
 * reports a PHANTOM violation whenever a workspace legitimately gets a
 * correctly-satisfying nested copy (observed with `extension`'s
 * `minimatch@^10.0.0`: nested 10.2.5, hoisted root 3.1.5).
 * See change: update-pi-core-0-84-adopt-apis.
 */
function resolvedVersion(dep, workspace) {
  const candidates = workspace
    ? [join(REPO_ROOT, 'packages', workspace, 'node_modules', dep, 'package.json')]
    : [];
  candidates.push(join(REPO_ROOT, 'node_modules', dep, 'package.json'));
  for (const p of candidates) {
    if (existsSync(p)) return readJson(p).version;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The range-selection rule
 * ------------------------------------------------------------------ */

describe('range selection (E19, E20, E21)', () => {
  it('reuses an existing range when the resolving version satisfies it (E19)', () => {
    expect(selectRange(['^5.0.0'], '5.10.0')).toBe('^5.0.0');
    expect(selectRange(['^7.4.47'], '7.4.47')).toBe('^7.4.47');
  });

  it('does NOT propagate an unsatisfiable existing range (E20)', () => {
    // typebox: `^1.3.7` declared, 1.3.6 resolving.
    expect(rangeIsSatisfiable('^1.3.7', '1.3.6')).toBe(false);
    expect(selectRange(['^1.3.7'], '1.3.6')).toBe('^1.3.6');

    // vitest: `^2.1.8` declared, 4.1.10 resolving.
    expect(rangeIsSatisfiable('^2.1.8', '4.1.10')).toBe(false);
    expect(selectRange(['^2.1.8'], '4.1.10')).toBe('^4.1.10');
  });

  it('picks the highest lower bound among disagreeing siblings (E21)', () => {
    // The spec's worked example, verbatim.
    expect(selectRange(['>=3.0.0', '^3.0.0', '^3.9.0'], '3.10.0')).toBe('^3.9.0');
  });

  it('ignores a wildcard when choosing, since "*" carries no lower bound', () => {
    expect(selectRange(['*'], '1.2.3')).toBe('^1.2.3');
  });

  it('the landed declarations obey the rule against the resolving tree', () => {
    const cases = [
      ['automation-plugin', 'peerDependencies', 'wouter', '^3.9.0'],
      ['kb-extension', 'devDependencies', 'typebox', '^1.3.6'],
      ['flows-plugin', 'dependencies', 'dagre-d3-es', '^7.0.14'],
      ['flows-plugin', 'dependencies', '@mdi/js', '^7.4.47'],
    ];
    for (const [ws, field, dep, expectedRange] of cases) {
      const manifest = readJson(join(REPO_ROOT, 'packages', ws, 'package.json'));
      expect(manifest[field]?.[dep], `${ws} ${field}.${dep}`).toBe(expectedRange);
      const resolving = resolvedVersion(dep, ws);
      if (resolving) expect(rangeIsSatisfiable(expectedRange, resolving), `${dep}@${resolving} vs ${expectedRange}`).toBe(true);
    }
  });

  it('introduces no NEW unsatisfiable range, and pins the pre-existing ones', () => {
    // The requirement governs declarations as they are ADDED; it does not
    // retroactively fix the tree. design.md records these as adjacent findings
    // ("recorded, not fixed"), so they are pinned here as an UPPER BOUND: any
    // range outside this set fails the test.
    //
    // Deliberately a one-way ratchet. The set may legitimately shrink when the
    // tree updates and a stale range starts resolving again, so a shrink must
    // not fail — only a NEW violation may.
    //
    // As of update-pi-core-0-84-adopt-apis this set is fully shrunk: once
    // `resolvedVersion` resolves nested-then-hoisted (as the declaring
    // workspace actually does), every entry below resolves correctly. They were
    // artifacts of root-only resolution, not real unsatisfiable ranges. Kept as
    // the upper bound the ratchet is defined against.
    const KNOWN_PREEXISTING = [
      'client devDependencies.jsdom',
      'dashboard-plugin-skill devDependencies.vitest',
      'extension devDependencies.typebox',
      'nano-banana devDependencies.vitest',
      'server dependencies.@earendil-works/pi-coding-agent',
      'server optionalDependencies.koffi',
      'video-production devDependencies.vitest',
      'video-transcription devDependencies.vitest',
    ];

    const violations = [];
    for (const { name, manifest } of nonPrivate()) {
      for (const field of DEP_FIELDS) {
        for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
          if (/^(workspace|file|link):/.test(range)) continue;
          const resolving = resolvedVersion(dep, name);
          if (!resolving) continue; // absent => unverifiable, covered by X3
          if (!rangeIsSatisfiable(range, resolving)) violations.push(`${name} ${field}.${dep}`);
        }
      }
    }

    expect(violations.filter((v) => !KNOWN_PREEXISTING.includes(v)), 'new unsatisfiable range').toEqual([]);
    // None of this change's own declarations may appear, shrinkage or not.
    for (const v of violations) expect(v).not.toMatch(/\.(wouter|dagre-d3-es|@mdi\/|fastify|ajv|jiti|yaml|semver)/);
  });
});

/* ------------------------------------------------------------------ *
 * Declaration shape
 * ------------------------------------------------------------------ */

describe('no wildcard ranges (E22)', () => {
  it('no non-private workspace declares "*" in any dependency field', () => {
    const found = [];
    for (const { name, manifest } of nonPrivate())
      for (const field of DEP_FIELDS)
        for (const [dep, range] of Object.entries(manifest[field] ?? {})) if (range === '*') found.push(`${name} ${field}.${dep}`);
    expect(found).toEqual([]);
  });

  it('the root metapackage declares no "*" either', () => {
    const found = [];
    for (const field of DEP_FIELDS)
      for (const [dep, range] of Object.entries(rootManifest[field] ?? {})) if (range === '*') found.push(`${field}.${dep}`);
    expect(found).toEqual([]);
  });

  it('de-wildcarded optional peers use a lower bound, not a caret', () => {
    // A caret would exclude older hosts that the previous "*" admitted, breaking
    // already-published consumers. Concreteness is the requirement; tightening is not.
    for (const dep of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', '@mariozechner/pi-coding-agent']) {
      const range = rootManifest.peerDependencies?.[dep];
      if (!range) continue;
      expect(range, `root peerDependencies.${dep}`).toMatch(/^>=/);
    }
  });

  it('selectHostPeerRange returns a lower bound, never a caret', () => {
    // A caret on a 0.x version pins the minor: `^0.75.5` admits only
    // `>=0.75.5 <0.76.0`, rejecting the hosts a `"*"` previously accepted.
    expect(selectHostPeerRange('0.75.5')).toBe('>=0.75.5');
    expect(selectRange([], '0.75.5')).toBe('^0.75.5'); // the ordinary rule still carets
  });

  it('EVERY optional peer across the repo is a lower bound, not a caret', () => {
    // Set-based, so a newly-added optional peer cannot regress to a caret.
    const offenders = [];
    for (const { name, manifest } of [{ name: '<ROOT>', manifest: rootManifest }, ...nonPrivate()]) {
      for (const dep of Object.keys(manifest.peerDependenciesMeta ?? {})) {
        if (manifest.peerDependenciesMeta[dep]?.optional !== true) continue;
        const range = manifest.peerDependencies?.[dep];
        if (range && range.startsWith('^')) offenders.push(`${name} peerDependencies.${dep}="${range}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a caret host peer would exclude newer hosts — the reason for the rule', () => {
    for (const host of ['0.76.0', '0.80.10']) {
      expect(rangeIsSatisfiable('^0.75.5', host), `^0.75.5 vs ${host}`).toBe(false);
      expect(rangeIsSatisfiable('>=0.75.5', host), `>=0.75.5 vs ${host}`).toBe(true);
    }
  });
});

describe('optional host-provided peers (E23)', () => {
  it('packages/extension declares @earendil-works/pi-ai as a concrete optional peer', () => {
    const m = readJson(join(REPO_ROOT, 'packages', 'extension', 'package.json'));
    const range = m.peerDependencies?.['@earendil-works/pi-ai'];

    expect(range).toBeDefined();
    expect(range).not.toBe('*');
    expect(m.peerDependenciesMeta?.['@earendil-works/pi-ai']?.optional).toBe(true);
  });

  it('every optional peer marked in meta is declared with a concrete range', () => {
    for (const { name, manifest } of nonPrivate()) {
      for (const dep of Object.keys(manifest.peerDependenciesMeta ?? {})) {
        const range = manifest.peerDependencies?.[dep];
        expect(range, `${name} peerDependencies.${dep}`).toBeDefined();
        expect(range, `${name} peerDependencies.${dep}`).not.toBe('*');
      }
    }
  });
});

describe('root tooling dependencies (E25)', () => {
  it.each(['jiti', 'yaml', 'semver'])('%s is a root devDependency, never a runtime dependency', (dep) => {
    // The root is a published metapackage whose `files` array excludes the
    // importing scripts, so a runtime declaration would ship it to consumers
    // that never receive the code.
    expect(rootManifest.devDependencies?.[dep], `devDependencies.${dep}`).toBeDefined();
    expect(rootManifest.dependencies?.[dep], `dependencies.${dep}`).toBeUndefined();
  });

  it('the root files array really does exclude the importing scripts', () => {
    const shipped = rootManifest.files ?? [];
    for (const script of ['scripts/generate-plugin-registry.mjs', 'scripts/check-skill-frontmatter.mjs']) {
      expect(shipped).not.toContain(script);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Publish surface
 * ------------------------------------------------------------------ */

describe('public access (E24)', () => {
  it('every non-private workspace declares publishConfig.access public', () => {
    const missing = nonPrivate()
      .filter((w) => w.manifest.publishConfig?.access !== 'public')
      .map((w) => w.name);
    expect(missing).toEqual([]);
  });

  it('the root metapackage declares public access', () => {
    expect(rootManifest.publishConfig?.access).toBe('public');
  });
});

describe.runIf(CI_SCENARIOS)('publish dry-run covers exactly the non-private set (E26)', () => {
  it('publishes every non-private workspace and skips every private one', () => {
    // npm writes its notices to stderr, so both streams are needed.
    const r = spawnSync('npm', ['publish', '--workspaces', '--include-workspace-root', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    // npm prints a tarball preview for private workspaces too, then explicitly
    // skips them — so "entry" means "would actually publish", not "was previewed".
    const previewed = new Set([...out.matchAll(/npm notice name:\s*(\S+)/g)].map((m) => m[1]));
    const skipped = new Set([...out.matchAll(/Skipping workspace (\S+?),\s*marked as private/g)].map((m) => m[1]));
    const willPublish = new Set([...previewed].filter((n) => !skipped.has(n)));

    const expected = new Set([rootManifest.name, ...nonPrivate().map((w) => w.manifest.name)]);
    const privateNames = allWorkspaces().filter((w) => w.manifest.private === true).map((w) => w.manifest.name);

    expect([...expected].filter((n) => !willPublish.has(n)), 'non-private workspaces missing from the dry-run').toEqual([]);
    expect([...willPublish].filter((n) => !expected.has(n)), 'unexpected extra entries in the dry-run').toEqual([]);
    for (const p of privateNames) expect(skipped.has(p), `${p} must be skipped as private`).toBe(true);
  }, 600_000);
});

/* ------------------------------------------------------------------ *
 * Budget
 * ------------------------------------------------------------------ */

// This is the suite's single full-repository invocation of the checker: it
// proves the budget AND the zero-findings exit code in one run. Duplicating it
// elsewhere spawns `npm pack` across 32 workspaces twice, whose CPU spike
// starves unrelated 5s-timeout tests running in parallel.
describe.runIf(CI_SCENARIOS)('publish-correctness checker runtime budget (P1)', () => {
  it('completes across all non-private workspaces in under 60 seconds', () => {
    const started = Date.now();
    execFileSync('node', [join(REPO_ROOT, 'scripts', 'verify-published-imports.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const elapsed = (Date.now() - started) / 1000;
    expect(elapsed, `checker took ${elapsed.toFixed(1)}s`).toBeLessThan(60);
  }, 180_000);
});
