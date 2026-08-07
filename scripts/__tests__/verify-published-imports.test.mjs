/**
 * Tests for `scripts/verify-published-imports.mjs`.
 *
 * Every fixture is built in a temp directory and the checker is invoked as a
 * library against it. Fixtures are deliberately NOT committed workspaces under
 * `packages/`, because the repository-wide run would scan them and fail on them
 * by design (test-plan E14).
 *
 * A verification tool that has only ever seen passing input may be passing
 * vacuously, so the known-bad cases (E1, E3, E10, X1, X2) matter more than the
 * green ones.
 *
 * See change: cleanup-undeclared-dependencies
 * (test-plan E1–E14, X1–X3).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  analyzeRepository,
  analyzeWorkspace,
  extractSpecifiers,
  isBuiltin,
  listWorkspaces,
  packageNameOf,
  packWorkspace,
  parsePackOutput,
  REPO_ROOT,
  RUNTIME_FIELDS,
  validateAllowlist,
  verifyDeclaredRanges,
} from '../verify-published-imports.mjs';

/* ------------------------------------------------------------------ *
 * Fixture helpers
 * ------------------------------------------------------------------ */

const tempDirs = [];

/** Build a throwaway workspace. `files` maps relative path -> contents. */
function fixture(manifest, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vpi-fixture-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', ...manifest }, null, 2));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return { dir, rel: 'packages/fixture', name: manifest.name ?? 'fixture', manifest: { name: 'fixture', version: '1.0.0', ...manifest } };
}

/** Run the checker against a fixture without going near `npm pack`. */
const run = (ws, packed, opts) => analyzeWorkspace(ws, packed, opts);
const rulesOf = (findings) => findings.map((f) => f.rule).sort();

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * Acceptance rule
 * ------------------------------------------------------------------ */

describe('undeclared imports (E1)', () => {
  it('names the workspace, the file, and the specifier, and is an error', () => {
    const ws = fixture({}, { 'index.js': 'import lp from "left-pad";' });
    const findings = run(ws, ['index.js']);

    expect(rulesOf(findings)).toEqual(['undeclared-import']);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.workspace).toBe('packages/fixture');
    expect(f.file).toContain('index.js');
    expect(f.specifier).toBe('left-pad');
    expect(f.message).toContain('left-pad');
  });
});

describe('declared runtime dependencies (E2, E5)', () => {
  it.each(RUNTIME_FIELDS)('a specifier declared in %s is satisfied', (field) => {
    const ws = fixture({ [field]: { fastify: '^5.0.0' } }, { 'index.js': 'import "fastify";' });
    expect(run(ws, ['index.js'])).toEqual([]);
  });

  it('accepts an optional peer, the shape used for host-provided packages (E5)', () => {
    const ws = fixture(
      {
        peerDependencies: { '@earendil-works/pi-ai': '^0.75.5' },
        peerDependenciesMeta: { '@earendil-works/pi-ai': { optional: true } },
      },
      { 'index.js': 'const m = await import("@earendil-works/pi-ai");' },
    );
    expect(run(ws, ['index.js'])).toEqual([]);
  });
});

describe('devDependencies do not satisfy a shipped import (E3, E4)', () => {
  it('a shipped file importing a dev-only package fails, and says why (E3)', () => {
    const ws = fixture({ devDependencies: { vitest: '^4.0.0' } }, { 'index.js': 'import { vi } from "vitest";' });
    const findings = run(ws, ['index.js']);

    expect(rulesOf(findings)).toEqual(['dev-only-import']);
    expect(findings[0].severity).toBe('error');
    // The message must explain the consumer consequence, not just the rule name.
    expect(findings[0].message).toMatch(/devDependencies/);
    expect(findings[0].message).toMatch(/consumer/);
  });

  it('the same import is fine when the importing file is NOT packed (E4)', () => {
    // Mirrors packages/client: ships `dist/`, uses vitest from `src/test-support/**`.
    const ws = fixture(
      { devDependencies: { vitest: '^4.0.0' } },
      { 'dist/index.js': 'export const a = 1;', 'src/test-support/h.ts': 'import { vi } from "vitest";' },
    );
    expect(run(ws, ['dist/index.js'])).toEqual([]);
  });

  it('a package in BOTH dev and runtime fields is satisfied, not reported dev-only', () => {
    const ws = fixture(
      { devDependencies: { vite: '^6.0.0' }, peerDependencies: { vite: '^6.0.0' } },
      { 'index.js': 'import "vite";' },
    );
    expect(run(ws, ['index.js'])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Specifier normalisation
 * ------------------------------------------------------------------ */

describe('specifier normalisation (E6, E7, E8, E9)', () => {
  it.each([
    ['fastify', 'fastify'],
    ['dagre-d3-es/src/dagre/index.js', 'dagre-d3-es'],
    ['@mdi/react', '@mdi/react'],
    ['@scope/pkg/sub/path.js', '@scope/pkg'],
    ['@mdi/js/mdiAccount', '@mdi/js'],
  ])('%s resolves to package %s', (spec, expected) => {
    expect(packageNameOf(spec)).toBe(expected);
  });

  it.each([['./foo.js'], ['../bar'], ['.'], ['..']])('%s is relative, not a package name', (spec) => {
    expect(packageNameOf(spec)).toBeNull();
  });

  it('a deep subpath is satisfied by the package declaration alone (E6)', () => {
    const ws = fixture(
      { dependencies: { 'dagre-d3-es': '^7.0.14' } },
      { 'index.js': 'import g from "dagre-d3-es/src/dagre/index.js";' },
    );
    const findings = run(ws, ['index.js']);
    expect(findings).toEqual([]);
    // Guard the specific regression: never demand a declaration named for the subpath.
    expect(findings.map((f) => f.specifier)).not.toContain('dagre-d3-es/src/dagre/index.js');
  });

  it('a scoped deep subpath resolves to two segments (E8)', () => {
    const ws = fixture({ dependencies: { '@scope/pkg': '^1.0.0' } }, { 'index.js': 'import "@scope/pkg/sub/path.js";' });
    expect(run(ws, ['index.js'])).toEqual([]);
  });

  it.each(['node:path', 'path', 'node:fs', 'fs/promises', 'node:crypto'])(
    'builtin %s is never reported (E9)',
    (spec) => {
      const ws = fixture({}, { 'index.js': `import "${spec}";` });
      expect(run(ws, ['index.js'])).toEqual([]);
    },
  );

  it('recognises builtins with and without the node: prefix', () => {
    expect(isBuiltin('path')).toBe(true);
    expect(isBuiltin('node:path')).toBe(true);
    expect(isBuiltin('left-pad')).toBe(false);
  });

  it.each(['node:sqlite', 'node:test', 'node:some-future-builtin'])(
    'treats %s as builtin regardless of the running Node version',
    (spec) => {
      // `node:` is a reserved scheme — npm cannot host a package under it, so a
      // prefixed specifier is a builtin reference by definition. Consulting the
      // interpreter's `builtinModules` instead made the verdict Node-dependent:
      // `node:sqlite` resolves on Node 24 but not Node 22, so the same tree
      // passed locally and failed CI.
      expect(isBuiltin(spec)).toBe(true);
      const ws = fixture({}, { 'index.js': `import ${JSON.stringify(spec)};` });
      expect(run(ws, ['index.js'])).toEqual([]);
    },
  );
});

/* ------------------------------------------------------------------ *
 * Relative imports
 * ------------------------------------------------------------------ */

describe('relative specifiers (E10)', () => {
  it('a dangling relative import fails and is named', () => {
    const ws = fixture({}, { 'index.js': 'import "./missing.js";' });
    const findings = run(ws, ['index.js']);

    expect(rulesOf(findings)).toEqual(['dangling-relative-import']);
    expect(findings[0].specifier).toBe('./missing.js');
    expect(findings[0].severity).toBe('error');
  });

  it('a relative import present in the packed set passes', () => {
    const ws = fixture({}, { 'index.js': 'import "./helper.js";', 'helper.js': 'export const a = 1;' });
    expect(run(ws, ['index.js', 'helper.js'])).toEqual([]);
  });

  it('accepts the TS-ESM form: source ships as .ts but imports ./x.js', () => {
    const ws = fixture({}, { 'index.ts': 'import "./helper.js";', 'helper.ts': 'export const a = 1;' });
    expect(run(ws, ['index.ts', 'helper.ts'])).toEqual([]);
  });

  it('resolves a directory import through its index file', () => {
    const ws = fixture({}, { 'index.js': 'import "./lib";', 'lib/index.js': 'export const a = 1;' });
    expect(run(ws, ['index.js', 'lib/index.js'])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Workspace selection + allowlist
 * ------------------------------------------------------------------ */

describe('private workspaces (E11)', () => {
  it('are skipped by discovery, so their undeclared imports never fail the run', () => {
    const names = listWorkspaces(REPO_ROOT).map((w) => w.rel);
    expect(names.length).toBeGreaterThan(0);
    // demo-plugin, electron and shell are `private: true` in this repo.
    expect(names).not.toContain('packages/demo-plugin');
    expect(names).not.toContain('packages/electron');
    expect(names).not.toContain('packages/shell');
  });

  it('every discovered workspace is genuinely non-private', () => {
    for (const ws of listWorkspaces(REPO_ROOT)) expect(ws.manifest.private).not.toBe(true);
  });
});

describe('allowlist (E12, E13)', () => {
  it('an allowlisted specifier is not reported (E12)', () => {
    const ws = fixture({}, { 'index.js': 'await import("@pi/anthropic-messages");' });
    const allowlist = [{ workspace: 'packages/fixture', specifier: '@pi/anthropic-messages', reason: 'E404 on the registry' }];

    expect(run(ws, ['index.js'], { allowlist })).toEqual([]);
    // Without the allowlist the very same input must fail — otherwise the test proves nothing.
    expect(rulesOf(run(ws, ['index.js'], { allowlist: [] }))).toEqual(['undeclared-import']);
  });

  it.each([
    ['missing reason', { workspace: 'w', specifier: 's' }],
    ['empty reason', { workspace: 'w', specifier: 's', reason: '   ' }],
    ['non-string reason', { workspace: 'w', specifier: 's', reason: 42 }],
  ])('an entry with a %s is rejected (E13)', (_label, entry) => {
    const findings = validateAllowlist([entry]);
    expect(rulesOf(findings)).toEqual(['allowlist-missing-reason']);
    expect(findings[0].severity).toBe('error');
  });

  it('the shipped allowlist is itself valid and carries the E404 rationale', () => {
    expect(validateAllowlist(ALLOWLIST)).toEqual([]);
    const entry = ALLOWLIST.find((e) => e.specifier === '@pi/anthropic-messages');
    expect(entry).toBeDefined();
    expect(entry.reason).toMatch(/E404/);
  });
});

/* ------------------------------------------------------------------ *
 * Fault handling — the vacuous-pass guards
 * ------------------------------------------------------------------ */

describe('pack failure is an error, never a silent skip (X1)', () => {
  it('reports a workspace whose npm pack fails', async () => {
    const ws = fixture({});
    writeFileSync(join(ws.dir, 'package.json'), '{ this is not valid json');

    const { files, error } = await packWorkspace(ws.dir);
    expect(error).toBeTruthy();
    expect(files).toEqual([]);
  });

  it('parsePackOutput ignores lifecycle-script noise preceding the payload', () => {
    // packages/client has a prepack step that prints build output on stdout.
    const noisy = 'vite v6.4.3 building for production...\n[plugin] discovered 9 plugins\n[{"files":[{"path":"a.js"}]}]';
    expect(parsePackOutput(noisy)?.[0]?.files?.[0]?.path).toBe('a.js');
  });

  it('parsePackOutput returns null when there is no payload, rather than guessing', () => {
    expect(parsePackOutput('vite building...\nno json here')).toBeNull();
  });
});

describe('a vacuous configuration is rejected up front', () => {
  it.each([0, -1, 1.5, Number.NaN, '8'])('rejects concurrency %p', async (concurrency) => {
    // Zero runners would check nothing and return an empty finding list, which
    // reads as a clean pass — the precise failure mode this checker exists to
    // prevent, so it must throw rather than silently succeed.
    await expect(analyzeRepository(REPO_ROOT, { concurrency })).rejects.toThrow(TypeError);
  });
});

describe('unparseable source is an error, never zero specifiers (X2)', () => {
  it('reports a syntax error instead of treating the file as import-free', () => {
    const ws = fixture({}, { 'broken.ts': 'export function ( { { unclosed' });
    const findings = run(ws, ['broken.ts']);

    expect(rulesOf(findings)).toEqual(['unparseable-source']);
    expect(findings[0].severity).toBe('error');
  });

  it('extractSpecifiers surfaces a parseError rather than an empty list', () => {
    const { specifiers, parseError } = extractSpecifiers('import { a from "x"', 'b.ts');
    expect(parseError).toBeTruthy();
    expect(specifiers).toEqual([]);
  });

  it('a clean file yields specifiers and no parseError', () => {
    const src = [
      'import a from "alpha";',
      'export * from "beta";',
      'const c = await import("gamma");',
      'const d = require("delta");',
      'import type { E } from "epsilon";',
    ].join('\n');
    const { specifiers, parseError } = extractSpecifiers(src, 'x.ts');

    expect(parseError).toBeNull();
    expect(specifiers.map((s) => s.value).sort()).toEqual(['alpha', 'beta', 'delta', 'epsilon', 'gamma']);
  });
});

describe('uninstalled declared dependency (X3)', () => {
  it('is reported as unverifiable, and only as a warning', () => {
    const ws = fixture({ peerDependencies: { 'totally-absent-package-xyz': '>=1.0.0' } });
    const findings = verifyDeclaredRanges(ws, REPO_ROOT);

    expect(rulesOf(findings)).toEqual(['unverifiable-range']);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/cannot be verified/);
  });

  it('an installed dependency produces no finding', () => {
    const ws = fixture({ dependencies: { typescript: '^5.7.0' } });
    expect(verifyDeclaredRanges(ws, REPO_ROOT)).toEqual([]);
  });

  it('does not crash on the real repo, and never escalates past a warning', () => {
    for (const ws of listWorkspaces(REPO_ROOT)) {
      for (const f of verifyDeclaredRanges(ws, REPO_ROOT)) expect(f.severity).toBe('warning');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Fixture hygiene
 * ------------------------------------------------------------------ */

describe('fixture cleanliness (E14)', () => {
  it('leaves no fixture directory under packages/', () => {
    const stray = listWorkspaces(REPO_ROOT).filter((w) => /fixture|vpi-/.test(w.rel));
    expect(stray).toEqual([]);
    expect(existsSync(join(REPO_ROOT, 'packages', 'fixture'))).toBe(false);
  });

  it('builds fixtures outside the repository entirely', () => {
    const ws = fixture({}, { 'index.js': '' });
    expect(ws.dir.startsWith(REPO_ROOT)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The repository itself
 * ------------------------------------------------------------------ */

describe('the real repository passes the check', () => {
  it('enumerates every non-private workspace, not a sample', () => {
    // Guards the planning-time gap: 6 workspaces were sampled, 32 exist.
    expect(listWorkspaces(REPO_ROOT).length).toBeGreaterThanOrEqual(30);
  });

  // The full-repository CLI run lives in `dependency-declarations.test.mjs`
  // (P1), which asserts the exit code and the runtime budget together. Running
  // it here too would pack 32 workspaces a second time, and the resulting CPU
  // spike starves unrelated 5s-timeout tests sharing the run.
});
