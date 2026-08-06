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
import { rangeIsSatisfiable, selectRange } from '../verify-published-imports.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

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

/** Resolved version of `dep` from the hoisted tree, or null. */
function resolvedVersion(dep) {
  const p = join(REPO_ROOT, 'node_modules', dep, 'package.json');
  return existsSync(p) ? readJson(p).version : null;
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
      const resolving = resolvedVersion(dep);
      if (resolving) expect(rangeIsSatisfiable(expectedRange, resolving), `${dep}@${resolving} vs ${expectedRange}`).toBe(true);
    }
  });

  it('introduces no NEW unsatisfiable range, and pins the pre-existing ones', () => {
    // The requirement governs declarations as they are ADDED; it does not
    // retroactively fix the tree. design.md records these as adjacent findings
    // ("recorded, not fixed"), so they are pinned here as a ratchet: they stay
    // visible, and any NEW unsatisfiable range fails this test.
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
          const resolving = resolvedVersion(dep);
          if (!resolving) continue; // absent => unverifiable, covered by X3
          if (!rangeIsSatisfiable(range, resolving)) violations.push(`${name} ${field}.${dep}`);
        }
      }
    }

    expect(violations.filter((v) => !KNOWN_PREEXISTING.includes(v)), 'new unsatisfiable range').toEqual([]);
    // Ratchet the other way too: a fixed entry must be removed from the list.
    expect(KNOWN_PREEXISTING.filter((v) => !violations.includes(v)), 'stale entry in KNOWN_PREEXISTING').toEqual([]);
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

describe('publish dry-run covers exactly the non-private set (E26)', () => {
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

describe('publish-correctness checker runtime budget (P1)', () => {
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
