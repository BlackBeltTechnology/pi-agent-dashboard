/**
 * Tests for `scripts/verify-docker-plugin-load.mjs` — test-plan X12's pure core.
 *
 * The Docker boot itself is the CI job (and `node scripts/verify-docker-plugin-load.mjs`
 * locally); what is pinned here is the VERDICT: a log with the success line and
 * no failure passes, and each way of being wrong fails by name. A gate whose
 * predicate was never exercised on known-bad input is the vacuous-green trap
 * this whole change exists to close.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { crutchProblems, hasPluginVerdict, parseHarnessState, pluginLoadProblems, verifyDockerPluginLoad } from '../verify-docker-plugin-load.mjs';

const tempDirs = [];

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('harness state', () => {
  it('reads project + dashboardPort', () => {
    expect(parseHarnessState('{ "project": "pi-dash-test-ab12", "dashboardPort": 18123, "gatewayPort": 18124 }')).toEqual({
      project: 'pi-dash-test-ab12',
      dashboardPort: 18123,
    });
  });

  it('throws rather than booting against a half-written state file', () => {
    expect(() => parseHarnessState('{"gatewayPort":1}')).toThrow(/project\/dashboardPort/);
    expect(() => parseHarnessState('not json')).toThrow();
  });
});

describe('plugin-load verdict (X12)', () => {
  const healthy = [
    '[plugin-loader] discovered 18 plugin(s)',
    '[plugin-loader] Loaded plugin "browser"',
    '[plugin-loader] Loaded plugin "quota"',
  ].join('\n');

  it('passes a log with the browser plugin loaded and no failures', () => {
    expect(pluginLoadProblems(healthy)).toEqual([]);
  });

  it('fails when the browser plugin never loaded', () => {
    expect(pluginLoadProblems('[plugin-loader] Loaded plugin "quota"')).toEqual([
      expect.stringContaining('Loaded plugin "browser"'),
    ]);
  });

  it('fails on any unexpected Failed to load plugin line, naming it', () => {
    const log = `${healthy}\n[plugin-loader] Failed to load plugin "kb": Cannot find module '@isomorphic/manualPromise'`;
    const problems = pluginLoadProblems(log);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('@isomorphic/manualPromise');
  });

  it('ignores the harness broken fixtures and nothing else', () => {
    const log = `${healthy}\n[plugin-loader] Failed to load plugin "e2e-broken": Bridge path conflict`;
    expect(pluginLoadProblems(log)).toEqual([]);

    const withReal = `${log}\n[plugin-loader] Failed to load plugin "quota": real`;
    expect(pluginLoadProblems(withReal).join('\n')).toContain('quota');
  });

  it('does not treat the success line as a failure', () => {
    expect(pluginLoadProblems('Loaded plugin "browser"')).toEqual([]);
  });

  it('waits for a browser verdict, not for any other plugin to settle', () => {
    // Health 200 arrives before the registry finishes; sampling once would read
    // a log with the success line absent and report a false failure.
    expect(hasPluginVerdict('[plugin-loader] Loaded plugin "quota"')).toBe(false);
    expect(hasPluginVerdict('[plugin-loader] Loaded plugin "browser"')).toBe(true);
    expect(hasPluginVerdict('[plugin-loader] Failed to load plugin "browser": boom')).toBe(true);
  });
});

describe('no alias crutch is present', () => {
  it('passes when no JITI_* variable is set', () => {
    expect(crutchProblems('HOME=/home/pi\nPATH=/usr/bin\nPI_E2E_SEED=1\n')).toEqual([]);
  });

  it('fails when JITI_TSCONFIG_PATHS is set, so a green run cannot be for the wrong reason', () => {
    expect(crutchProblems('HOME=/home/pi\nJITI_TSCONFIG_PATHS=true\n')).toEqual([
      expect.stringContaining('JITI_TSCONFIG_PATHS=true'),
    ]);
  });
});

describe('docker gate reporting', () => {
  it('reports the failure instead of throwing, and always tears down', async () => {
    const root = mkdtempSync(join(tmpdir(), 'docker-gate-'));
    tempDirs.push(root);
    writeFileSync(join(root, '.pi-test-harness.json'), '{ "project": "pi-dash-test-x", "dashboardPort": 1, "gatewayPort": 2 }');

    const calls = [];
    const exec = (cmd, args) => {
      calls.push(args[0]);
      if (args[0] === 'compose') {
        return '[plugin-loader] Failed to load plugin "browser": Cannot find module \'@isomorphic/manualPromise\'\n';
      }
      return ''; // test-up.sh / test-down.sh
    };

    const result = await verifyDockerPluginLoad({ root, exec, log: () => {}, fetchImpl: async () => ({ ok: true, status: 200 }) });

    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('@isomorphic/manualPromise');
    // Teardown must run even on the failing path, or a leaked 4 GiB container
    // poisons the next job on a reused runner.
    expect(calls).toContain('docker/test-down.sh');
  });
});
