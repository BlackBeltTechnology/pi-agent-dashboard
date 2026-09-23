/**
 * Tests for `packages/electron/scripts/assert-bundled-server-plugin-load.mjs`
 * — test-plan X13's pure core. Follows the sibling convention set by
 * `assert-bundled-plugins-complete.test.mjs`: electron assert scripts are driven
 * from `scripts/__tests__/`, with paths overridable so no real Electron build is
 * needed for the predicate checks.
 *
 * The boot itself runs on the electron CI leg; what is pinned here is the
 * layout contract and the verdict, including the known-bad inputs — a gate whose
 * predicate was never exercised on a failing log is the vacuous-green trap this
 * change exists to close.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundleLayout, bundleRoot, pluginLoadProblems } from '../../packages/electron/scripts/assert-bundled-server-plugin-load.mjs';

const tempDirs = [];

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * A minimal bundle-shaped tree: `<base>/resources/server` with a sibling
 * `<base>/resources/node`, so the `../node` lookup is per-test and cannot see a
 * sibling test's fixture (they all live under the shared tmpdir).
 */
function fixture({ jiti = true, cli = true, node = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'electron-bundle-'));
  tempDirs.push(base);
  const root = join(base, 'resources', 'server');
  mkdirSync(root, { recursive: true });
  const write = (rel) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '');
  };
  if (jiti) write('node_modules/jiti/lib/jiti-register.mjs');
  if (cli) write('packages/server/src/cli.ts');
  if (node) {
    write('../node/bin/node');
    write('../node/node.exe');
  }
  return root;
}

describe('bundle layout', () => {
  it('honours the SERVER_BUNDLE_DIR override', () => {
    expect(bundleRoot({ SERVER_BUNDLE_DIR: '/tmp/whatever' })).toBe('/tmp/whatever');
  });

  it('resolves the bundled node + jiti loader + cli.ts', () => {
    const root = fixture();
    const layout = bundleLayout(root, 'linux');
    expect(layout.missing).toEqual([]);
    expect(layout.nodeBin).toBe(join(root, '..', 'node', 'bin', 'node'));
    expect(layout.jiti).toBe(join(root, 'node_modules', 'jiti', 'lib', 'jiti-register.mjs'));
    expect(layout.cli).toBe(join(root, 'packages', 'server', 'src', 'cli.ts'));
  });

  it('uses node.exe on win32', () => {
    const root = fixture();
    expect(bundleLayout(root, 'win32').nodeBin).toBe(join(root, '..', 'node', 'node.exe'));
  });

  it('names what is missing instead of booting a partial bundle', () => {
    const root = fixture({ jiti: false, cli: false, node: false });
    const layout = bundleLayout(root, 'linux');
    expect(layout.missing).toHaveLength(2);
    expect(layout.nodeBin).toBeNull();
  });
});

describe('plugin-load verdict (X13)', () => {
  const healthy = '[plugin-loader] Loaded plugin "browser"\n[plugin-loader] Loaded plugin "quota"';

  it('passes a log where the browser plugin loaded', () => {
    expect(pluginLoadProblems(healthy)).toEqual([]);
  });

  it('fails when the bundle shipped the plugin present-but-dead', () => {
    const log = [
      '[plugin-loader] discovered 18 plugin(s)',
      "Failed to load plugin \"browser\": Cannot find module '@isomorphic/manualPromise'",
    ].join('\n');
    const problems = pluginLoadProblems(log);
    expect(problems.join('\n')).toContain('@isomorphic/manualPromise');
    // The plugin never announced a successful load either, so that is reported
    // too — the two facts are independent.
    expect(problems.join('\n')).toContain('Loaded plugin "browser"');
  });

  it('fails when the plugin never loaded and never errored (vacuous green)', () => {
    expect(pluginLoadProblems('[plugin-loader] Loaded plugin "quota"')).toEqual([
      expect.stringContaining('Loaded plugin "browser"'),
    ]);
  });
});
