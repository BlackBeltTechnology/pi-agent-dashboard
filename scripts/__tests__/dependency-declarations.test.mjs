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
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rangeIsSatisfiable, selectHostPeerRange, selectRange } from '../verify-published-imports.mjs';
import { checkForbiddenPiPackages, checkPiRangeShapes, collectFailures, FORBIDDEN_PI_PACKAGES, piManifests } from '../verify-release-deps.mjs';
import { budgetedWorkspaceCount, budgetMessage, budgetSeconds, withinBudget } from './helpers/publish-budget.mjs';

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
          // Non-semver specifiers: workspace/file/link, and an https URL tarball (server `xlsx`
          // from the official SheetJS CDN — its version is pinned by office-preview E71 instead).
          if (/^(workspace|file|link|https):/.test(range)) continue;
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
    for (const dep of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui']) {
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

/**
 * Every `@earendil-works` pi range follows the lockstep floor: peers `>=<min>`,
 * optional, no upper bound; devDependencies `^<min>`. `@mariozechner/*` ranges
 * are governed elsewhere.
 * See change: update-pi-core-1-0-adopt-apis (test-plan #E2, #E3).
 */
describe('earendil pi ranges follow the floor (E2, E3)', () => {
  const floor = readJson(join(REPO_ROOT, 'packages', 'server', 'package.json')).piCompatibility.minimum;
  const fixture = (path, pkg) => ({ path, pkg });
  const peer = (range, optional = true) => ({
    peerDependencies: { '@earendil-works/pi-ai': range },
    peerDependenciesMeta: { '@earendil-works/pi-ai': { optional } },
  });

  it('the floor is 1.0.0 or later', () => {
    expect(floor.localeCompare('1.0.0', undefined, { numeric: true }) >= 0, `minimum=${floor}`).toBe(true);
  });

  it('root + every packages/* manifest obeys the floor (E2)', () => {
    expect(checkPiRangeShapes(piManifests(REPO_ROOT), floor)).toEqual([]);
  });

  it('a broad >=0.80.10 peer fails naming the manifest (E2)', () => {
    const out = checkPiRangeShapes([fixture('packages/old/package.json', peer('>=0.80.10'))], '1.0.0');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('packages/old/package.json');
    expect(out[0]).toContain('peerDependencies.@earendil-works/pi-ai');
  });

  it('an upper-bounded peer (<0.87.0) fails naming the manifest (E2)', () => {
    const out = checkPiRangeShapes([fixture('packages/cap/package.json', peer('>=1.0.0 <0.87.0'))], '1.0.0');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('packages/cap/package.json');
  });

  it('a non-optional pi peer fails (E2)', () => {
    const out = checkPiRangeShapes([fixture('packages/req/package.json', peer('>=1.0.0', false))], '1.0.0');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('optional');
  });

  it('a broad pi devDependency fails naming the manifest (E3)', () => {
    const pkg = { devDependencies: { '@earendil-works/pi-tui': '>=0.80.10' } };
    const out = checkPiRangeShapes([fixture('packages/dev/package.json', pkg)], '1.0.0');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('packages/dev/package.json devDependencies.@earendil-works/pi-tui');
  });

  it('a conforming fixture passes and @mariozechner ranges are ignored', () => {
    const pkg = {
      ...peer('>=1.0.0'),
      devDependencies: { '@earendil-works/pi-tui': '^1.0.0', '@mariozechner/pi-tui': '>=0.80.10' },
    };
    expect(checkPiRangeShapes([fixture('packages/ok/package.json', pkg)], '1.0.0')).toEqual([]);
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
    // `--force`: npm 11 (Node 26) checks the registry even under --dry-run and
    // aborts the whole run on an already-published version ("You cannot
    // publish over the previously published versions"); --force restores the
    // npm 10 preview-everything behaviour. Nothing is published under
    // --dry-run. See change: raise-node-floor-to-26.
    const r = spawnSync('npm', ['publish', '--workspaces', '--include-workspace-root', '--dry-run', '--force'], {
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

// The runtime budget (P1, P2) runs in the budget lane: dependency-declarations.budget.test.mjs.
// The formula, predicate and message it uses are tested here (E26-E28); they live in
// helpers/publish-budget.mjs.

describe('publish-correctness budget formula (E26-E28)', () => {
  it.each([
    [0, 30],
    [1, 33],
    [57, 201],
    [58, 204],
  ])('E26 budgetSeconds(%i) = %i', (n, expected) => {
    expect(budgetSeconds(n)).toBe(expected);
  });

  it('E27 the boundary is inclusive and a breach names measured, budget and N', () => {
    expect(withinBudget(201 - 0.001, 57)).toBe(true);
    expect(withinBudget(201, 57)).toBe(true);
    expect(withinBudget(201 + 0.001, 57)).toBe(false);
    expect(budgetMessage(201.001, 57)).toBe('measured 201.001s vs budget 201s (57 workspaces)');
  });

  it('E33 the formula comes from helpers/publish-budget.mjs: +3 s per workspace at the real N', () => {
    expect(budgetSeconds(57)).toBe(201);
    expect(budgetSeconds(58)).toBe(204);
    expect(budgetSeconds(58) - budgetSeconds(57)).toBe(3);
    const n = budgetedWorkspaceCount();
    expect(budgetSeconds(n)).toBe(30 + 3 * n);
  });

  it('E34 budgetMessage for a measured 250 s at N = 57 names the measurement, the budget and N', () => {
    const message = budgetMessage(250, 57);
    expect(message).toContain('250');
    expect(message).toContain('201');
    expect(message).toContain('57');
  });

  it("E28 N is the checker's own enumeration: non-private workspaces plus a non-private root", () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-budget-n-'));
    const write = (dir, manifest) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
    };
    write(join(root, 'packages', 'a'), { name: 'a' });
    write(join(root, 'packages', 'b'), { name: 'b' });
    write(join(root, 'packages', 'internal'), { name: 'internal', private: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root' }));
    expect(budgetedWorkspaceCount(root)).toBe(3);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    expect(budgetedWorkspaceCount(root)).toBe(2);
  });
});

/* ------------------------------------------------------------------
 * drop-mariozechner-pi-fork (test-plan #E1, #E2)
 * ------------------------------------------------------------------ */

describe('no legacy fork pi packages in any manifest (E1)', () => {
  it('the forbidden set is exactly the three legacy fork pi packages', () => {
    expect(FORBIDDEN_PI_PACKAGES).toEqual([
      '@mariozechner/pi-coding-agent',
      '@mariozechner/pi-ai',
      '@mariozechner/pi-tui',
    ]);
  });

  for (const dep of FORBIDDEN_PI_PACKAGES) {
    for (const field of ['peerDependencies', 'peerDependenciesMeta', 'devDependencies']) {
      it(`a fixture with ${dep} in ${field} fails, naming dep and file`, () => {
        const value = field === 'peerDependenciesMeta' ? { optional: true } : '>=0.73.1';
        const failures = checkForbiddenPiPackages([
          { path: 'packages/extension/package.json', pkg: { name: 'x', [field]: { [dep]: value } } },
        ]);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain(dep);
        expect(failures[0]).toContain('packages/extension/package.json');
        expect(failures[0]).toContain(field);
      });
    }
  }

  it('the clean tree declares no legacy fork pi package', () => {
    expect(checkForbiddenPiPackages(piManifests(REPO_ROOT))).toEqual([]);
  });

  it('verify-release-deps collectFailures reports no forbidden fork package', () => {
    expect(collectFailures({ repoRoot: REPO_ROOT }).filter((f) => f.includes('@mariozechner/pi-'))).toEqual([]);
  });
});

describe('tsconfig.base.json paths are earendil-only (E2)', () => {
  const paths = readJson(join(REPO_ROOT, 'tsconfig.base.json')).compilerOptions.paths;
  it('no path key names a legacy fork pi package', () => {
    expect(Object.keys(paths).filter((k) => /^@mariozechner\/pi-/.test(k))).toEqual([]);
  });
  it('earendil pi path keys are present', () => {
    for (const k of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', '@earendil-works/pi-tui']) {
      expect(Object.keys(paths)).toContain(k);
    }
  });
});
