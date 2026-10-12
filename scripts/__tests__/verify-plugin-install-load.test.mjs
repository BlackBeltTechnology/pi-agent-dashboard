/**
 * Tests for `scripts/verify-plugin-install-load.mjs` — test-plan E8, X1, X2, X6.
 *
 * TWO LAYERS, deliberately:
 *
 *   - The scope filter (E8) is pure and always runs.
 *   - The install-load scenarios (X1, X2, X6) pack a real workspace, `npm
 *     install` it outside the repository and import it under the native loader. They need
 *     the network and take minutes, so they are opt-in via
 *     `RUN_INSTALL_LOAD=1` — the same shape as `RUN_CI_SCENARIOS` for
 *     repo-wide Biome runs. A skipped test is honest; a timeout that looks like
 *     a defect is not.
 *
 * E26 is always-on: its fixture plugin has no dependencies, so `npm pack` and
 * `npm install <tarball>` run offline in a couple of seconds.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution;
 *             strip-only-native-ts-loader (E26).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  firstPartyWorkspaceDeps,
  isLocalTarball,
  listAllWorkspaces,
  listPluginWorkspaces,
  resolveNativeRegisterUrl,
  selectInScope,
  verifyWorkspace,
} from '../verify-plugin-install-load.mjs';

const RUN_INSTALL_LOAD = process.env.RUN_INSTALL_LOAD === '1';

describe('install-load scope filter (E8)', () => {
  it('keeps workspaces with a server entry, skips fixture and server-less ones', () => {
    const { inScope, skipped } = selectInScope([
      { name: 'a', rel: 'packages/a', manifest: { server: './src/server/index.ts' } },
      { name: 'b', rel: 'packages/b', manifest: { fixture: true } },
      { name: 'c', rel: 'packages/c', manifest: { client: './src/client/index.tsx' } },
    ]);

    expect(inScope.map((w) => w.name)).toEqual(['a']);
    expect(skipped.map((w) => w.name)).toEqual(['b', 'c']);
    expect(skipped.map((w) => w.reason)).toEqual(['fixture (client-only)', 'no server entry']);
  });

  it('treats an empty server string as out of scope', () => {
    const { inScope, skipped } = selectInScope([{ name: 'a', rel: 'packages/a', manifest: { server: '' } }]);
    expect(inScope).toEqual([]);
    expect(skipped).toHaveLength(1);
  });
});

describe('workspace enumeration', () => {
  it('finds plugin workspaces and the non-plugin deps they rely on', () => {
    const all = listAllWorkspaces();
    const plugins = listPluginWorkspaces();
    const browser = plugins.find((w) => w.name === '@blackbelt-technology/pi-dashboard-browser-plugin');

    expect(browser).toBeDefined();
    expect(all.length).toBeGreaterThan(plugins.length);

    // The runtime and shared are NOT plugin workspaces, yet must be packable as
    // dependencies — scoping the dep lookup to plugin workspaces was the bug
    // that let a registry copy satisfy the install.
    const depNames = firstPartyWorkspaceDeps(browser.pkg, all).map((w) => w.name);
    expect(depNames).toContain('@blackbelt-technology/dashboard-plugin-runtime');
    expect(depNames).toContain('@blackbelt-technology/pi-dashboard-shared');
  });

  it('distinguishes a local tarball from a registry copy (X6)', () => {
    const tarball = '/abs/scratch/tarballs/dashboard-plugin-runtime-0.8.0.tgz';
    expect(isLocalTarball('file:../tarballs/dashboard-plugin-runtime-0.8.0.tgz', tarball)).toBe(true);
    expect(
      isLocalTarball(
        'https://registry.npmjs.org/@blackbelt-technology/dashboard-plugin-runtime/-/dashboard-plugin-runtime-0.8.0.tgz',
        tarball,
      ),
    ).toBe(false);
    expect(isLocalTarball(null, tarball)).toBe(false);
  });
});

describe.skipIf(!RUN_INSTALL_LOAD)('install-load integration (X1, X2, X6)', () => {
  it('loads the browser plugin server entry out of repo, and cdpRelay.js resolves (X1, X2)', () => {
    const all = listAllWorkspaces();
    const ws = listPluginWorkspaces().find((w) => w.name === '@blackbelt-technology/pi-dashboard-browser-plugin');

    const scratch = mkdtempSync(join(tmpdir(), 'install-load-test-'));
    try {
      const result = verifyWorkspace(ws, { allWorkspaces: all, scratch, registerUrl: resolveNativeRegisterUrl() });
      try {
      expect(result.error).toBeUndefined();
      expect(result.verdict.defaultType).toBe('function');
      expect(result.verdict.runtimeInsideInstall).toBe(true);
      // X6: the packed working-tree runtime, not the registry copy — proven by
      // npm's own `resolved` metadata, not by a version string both share.
      expect(result.notLocal).toEqual([]);
      expect(result.localRuntime).toBe(true);
      // X2: the 4 specifiers the runtime chain never reaches.
      expect(result.verdict.extraOk).toBe(true);
      expect(result.ok).toBe(true);
      } finally {
        if (result.installDir) rmSync(result.installDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 600_000);
});

/**
 * E26 — the install-load gate runs the native strip-only loader, so a plugin
 * whose server graph is not erasable fails it, naming plugin and file.
 */
describe('install-load gate rejects non-erasable plugins (E26)', () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    delete process.env.npm_config_offline;
  });

  /** A packable, dependency-free fixture plugin whose server graph is `files`. */
  function fixturePlugin(name, files) {
    const root = mkdtempSync(join(tmpdir(), 'e26-fixture-'));
    dirs.push(root);
    const dir = join(root, 'packages', name);
    const pkg = { name, version: '0.0.0', type: 'module', files: ['src'], 'pi-dashboard-plugin': { id: name, server: './src/server/index.ts' } };
    for (const [rel, body] of Object.entries({ 'package.json': JSON.stringify(pkg), ...files })) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    // Only its identity matters: the fixture declares no first-party dependencies.
    const runtime = { name: 'runtime-stub', rel: 'packages/dashboard-plugin-runtime', dir, pkg: {}, version: '0.0.0' };
    return { ws: { name, rel: `packages/${name}`, dir, pkg, manifest: pkg['pi-dashboard-plugin'], version: '0.0.0' }, runtime };
  }

  const run = ({ ws, runtime }) => {
    process.env.npm_config_offline = 'true';
    const scratch = mkdtempSync(join(tmpdir(), 'e26-scratch-'));
    dirs.push(scratch);
    const result = verifyWorkspace(ws, { allWorkspaces: [ws, runtime], scratch });
    if (result.installDir) dirs.push(result.installDir);
    return result;
  };

  it('fails naming the plugin and the file with a parameter property', () => {
    const result = run(
      fixturePlugin('e26-bad-plugin', {
        'src/server/index.ts': 'import { Thing } from "./thing.js";\nexport default function register(): Thing { return new Thing(1); }\n',
        'src/server/thing.ts': 'export class Thing {\n  constructor(public readonly n: number) {}\n}\n',
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.name).toBe('e26-bad-plugin');
    expect(result.error).toMatch(/import failed.*thing\.ts/s);
  }, 120_000);

  it('control: an erasable plugin imports and exposes a default function', () => {
    const result = run(
      fixturePlugin('e26-good-plugin', {
        'src/server/index.ts': 'export default function register(): number { return 1; }\n',
      }),
    );
    expect(result.error).toBeUndefined();
    expect(result.verdict.defaultType).toBe('function');
  }, 120_000);
});
