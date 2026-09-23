/**
 * Tests for `scripts/check-vendor-specifiers.mjs` — test-plan E1, E2, X4.
 *
 * The guard exists because typecheck, vitest and the old X14 test were all
 * green while production was broken: each supplied its own alias for the
 * playwright-internal specifiers. A guard that a deleted alias layer cannot
 * satisfy is the point, so the fixture cases (E2 unknown namespace, X4 a
 * re-copy that skipped the patch) matter more than the green one.
 *
 * Fixtures are built in a temp directory rather than under `packages/`, so the
 * repo-wide run does not scan them (they are meant to fail).
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkVendorSpecifiers, isLocalRelative, packageNameOf, REPO_ROOT } from '../check-vendor-specifiers.mjs';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repo root with the plugin manifest and the given vendored files. */
function fixture(files = {}, manifest = { dependencies: { ws: '^8.18.0', debug: '^4.4.0' } }) {
  const root = mkdtempSync(join(tmpdir(), 'vendor-spec-'));
  tempDirs.push(root);
  const pkgPath = join(root, 'packages/browser-plugin/package.json');
  mkdirSync(dirname(pkgPath), { recursive: true });
  writeFileSync(pkgPath, JSON.stringify({ name: '@blackbelt-technology/pi-dashboard-browser-plugin', ...manifest }, null, 2));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, 'packages/browser-plugin/src/server/relay/vendor', rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

describe('vendored specifier guard', () => {
  it('passes on the patched tree: every bare specifier is a builtin or a declared dep (E1)', () => {
    const { ok, violations, checked } = checkVendorSpecifiers(REPO_ROOT);
    expect(violations).toEqual([]);
    expect(ok).toBe(true);
    // The tree really was scanned — a vacuous-green guard would report 0.
    expect(checked).toBeGreaterThan(10);
  });

  it('rejects an unknown internal namespace, naming file and specifier (E2)', () => {
    const root = fixture({
      'playwright-core/src/tools/mcp/fixture.ts': "import x from '@protocol/foo';\n",
    });
    const { ok, violations } = checkVendorSpecifiers(root);
    expect(ok).toBe(false);
    expect(violations).toEqual([
      { file: 'packages/browser-plugin/src/server/relay/vendor/playwright-core/src/tools/mcp/fixture.ts', specifier: '@protocol/foo' },
    ]);
  });

  it('rejects a shim that acquires an internal specifier (scope is all of relay/vendor) (E2)', () => {
    const root = fixture({ 'shims/whatever.ts': "import y from '@injected/thing';\n" });
    const { ok, violations } = checkVendorSpecifiers(root);
    expect(ok).toBe(false);
    expect(violations.map((v) => v.specifier)).toEqual(['@injected/thing']);
  });

  it('rejects a refresh that re-copied upstream and skipped the patch (X4)', () => {
    const root = fixture({
      'playwright-core/src/tools/mcp/cdpRelay.ts':
        "import { ManualPromise } from '@isomorphic/manualPromise';\nimport { WSServer } from '@utils/wsServer';\n",
      'playwright-core/src/tools/mcp/cdpRelayV2.ts': "import { ManualPromise } from '@isomorphic/manualPromise';\n",
    });
    const { ok, violations } = checkVendorSpecifiers(root);
    expect(ok).toBe(false);
    const files = new Set(violations.map((v) => v.file));
    expect(files).toEqual(
      new Set([
        'packages/browser-plugin/src/server/relay/vendor/playwright-core/src/tools/mcp/cdpRelay.ts',
        'packages/browser-plugin/src/server/relay/vendor/playwright-core/src/tools/mcp/cdpRelayV2.ts',
      ]),
    );
  });

  it('rejects absolute paths and non-node schemes, which the spec does not allow', () => {
    const root = fixture({
      'playwright-core/src/tools/mcp/abs.ts': ["import a from '/tmp/x.js';", "import b from 'file:./x.js';", "import c from 'https://evil.example/x.js';"].join('\n'),
    });
    const { ok, violations } = checkVendorSpecifiers(root);
    expect(ok).toBe(false);
    expect(violations.map((v) => v.specifier)).toEqual(['/tmp/x.js', 'file:./x.js', 'https://evil.example/x.js']);
  });

  it('rejects an unknown node: builtin, which the scheme must not wave through', () => {
    const root = fixture({ 'playwright-core/src/tools/mcp/bogus.ts': "import x from 'node:not-real';\n" });
    const { ok, violations } = checkVendorSpecifiers(root);
    expect(ok).toBe(false);
    expect(violations.map((v) => v.specifier)).toEqual(['node:not-real']);
  });

  it('accepts builtins, declared deps and relative paths; leaves prose alone', () => {
    const root = fixture({
      'playwright-core/src/tools/mcp/ok.ts': [
        "import fs from 'node:fs';",
        "import { join } from 'path';",
        "import debug from 'debug';",
        "import ws from 'ws';",
        "import './sibling.js';",
        "// prose: @isomorphic/manualPromise is named here but is not an import",
      ].join('\n'),
    });
    expect(checkVendorSpecifiers(root)).toMatchObject({ ok: true, violations: [] });
  });
});

describe('specifier classification helpers', () => {
  it('accepts only ./ and ../ as local relative specifiers', () => {
    expect(isLocalRelative('./x.js')).toBe(true);
    expect(isLocalRelative('../x.js')).toBe(true);
    expect(isLocalRelative('/abs')).toBe(false);
    expect(isLocalRelative('file:./x.js')).toBe(false);
    expect(isLocalRelative('@scope/pkg')).toBe(false);
  });

  it('extracts the package name from a subpath specifier', () => {
    expect(packageNameOf('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(packageNameOf('left-pad')).toBe('left-pad');
    expect(packageNameOf('left-pad/deep/path')).toBe('left-pad');
  });
});
