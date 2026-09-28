/**
 * Tests for `scripts/verify-plugin-install-load.mjs` — test-plan E8, X1, X2, X6.
 *
 * TWO LAYERS, deliberately:
 *
 *   - The scope filter (E8) is pure and always runs.
 *   - The install-load scenarios (X1, X2, X6) pack a real workspace, `npm
 *     install` it outside the repository and import it under jiti. They need
 *     the network and take minutes, so they are opt-in via
 *     `RUN_INSTALL_LOAD=1` — the same shape as `RUN_CI_SCENARIOS` for
 *     repo-wide Biome runs. A skipped test is honest; a timeout that looks like
 *     a defect is not.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  firstPartyWorkspaceDeps,
  isLocalTarball,
  listAllWorkspaces,
  listPluginWorkspaces,
  resolveJitiLib,
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
      const result = verifyWorkspace(ws, { allWorkspaces: all, scratch, jitiLib: resolveJitiLib() });
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
