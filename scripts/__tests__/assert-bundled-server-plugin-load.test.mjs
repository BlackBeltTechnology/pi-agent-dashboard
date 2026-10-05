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
import {
  VERDICT_TIMEOUT_MS,
  bootArgv,
  bundleLayout,
  bundleRoot,
  expectedServerPluginIds,
  gateConfig,
  logTail,
  pluginLoadProblems,
  pluginVerdicts,
  waitForVerdicts,
} from '../../packages/electron/scripts/assert-bundled-server-plugin-load.mjs';
import { pathToFileURL } from 'node:url';

const tempDirs = [];

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * A minimal bundle-shaped tree: `<base>/resources/server` with a sibling
 * `<base>/resources/node`, so the `../node` lookup is per-test and cannot see a
 * sibling test's fixture (they all live under the shared tmpdir).
 */
function fixture({ jiti = true, cli = true, node = true, native = true } = {}) {
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
  if (native) write('node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs');
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
    const root = fixture({ native: false, cli: false, node: false });
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

describe('failure diagnostics: server.log tail', () => {
  it('returns the last N lines', () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    expect(logTail(text, 3)).toBe('line 8\nline 9\nline 10');
  });

  it('returns the whole log when shorter than N, ignoring the trailing newline', () => {
    expect(logTail('a\nb\n', 80)).toBe('a\nb');
  });

  it('says so when the log is empty or missing', () => {
    expect(logTail('', 80)).toBe('(server.log empty or missing)');
  });
});

/**
 * E31 — the gate boots the SELECTED loader, so it proves the shipped default:
 * native unless PI_DASHBOARD_TS_LOADER=jiti; a missing selected loader is
 * named instead of booting. The entry stays raw for both loaders on every OS
 * (mirrors `shouldUrlWrapEntry`, design D8 revised); the loader is a
 * percent-encoded `file://` URL.
 * See change: fix-appimage-cold-boot-latency (design D4).
 */
describe('selected TS loader (E31)', () => {
  const NATIVE_REL = ['node_modules', '@blackbelt-technology', 'pi-dashboard-shared', 'src', 'platform', 'native-ts-register.mjs'];

  it('env unset → boots with --import <native register URL>', () => {
    const root = fixture();
    const layout = bundleLayout(root, 'linux', {});
    expect(layout.missing).toEqual([]);
    expect(layout.loader).toBe(join(root, ...NATIVE_REL));
    const argv = bootArgv(layout, ['start', '--port', '1234'], 'linux');
    expect(argv.slice(0, 2)).toEqual(['--import', pathToFileURL(join(root, ...NATIVE_REL)).href]);
    expect(argv[2]).toBe(layout.cli);
    expect(argv.slice(3)).toEqual(['start', '--port', '1234']);
  });

  it('PI_DASHBOARD_TS_LOADER=jiti → boots with the jiti register', () => {
    const root = fixture();
    const layout = bundleLayout(root, 'linux', { PI_DASHBOARD_TS_LOADER: 'jiti' });
    expect(layout.loader).toBe(layout.jiti);
    expect(bootArgv(layout, ['stop'], 'linux')[1]).toBe(pathToFileURL(layout.jiti).href);
  });

  it('a bundle without the native register is reported missing by default', () => {
    const root = fixture({ native: false });
    expect(bundleLayout(root, 'linux', {}).missing).toEqual([join(root, ...NATIVE_REL)]);
  });

  it('the entry stays raw for both loaders on win32 (Node path.resolve()s the main entry)', () => {
    const layout = { native: 'C:\\b #1\\native-ts-register.mjs', jiti: 'C:\\b #1\\jiti-register.mjs', cli: 'B:\\b\\packages\\server\\src\\cli.ts' };
    for (const loaderKind of ['native', 'jiti']) {
      const argv = bootArgv({ ...layout, loader: layout[loaderKind], loaderKind }, [], 'win32');
      // `#` and the space are percent-encoded, so the loader URL is not cut at a fragment.
      expect(argv[1]).toBe(`file:///C:/b%20%231/${loaderKind === 'native' ? 'native' : 'jiti'}-register.mjs`.replace('native-register', 'native-ts-register'));
      expect(argv[2]).toBe(layout.cli);
    }
  });
});

describe('teardown targets only its own server (stop-ownership caller fix)', () => {
  it('passes the booted --port/--pi-port to stop, guarded by Number.isInteger(port)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../packages/electron/scripts/assert-bundled-server-plugin-load.mjs', import.meta.url),
      'utf-8',
    );
    expect(src).toMatch(/"stop",\s*\.\.\.\(Number\.isInteger\(port\)\s*\?\s*\["--port", String\(port\), "--pi-port", String\(port \+ 1\)\]/);
  });
});

// Every bundled server-entry plugin is enabled and must load.
// See change: bundle-plugin-third-party-deps (design D5).
describe('every bundled server plugin loads', () => {
  it('expects manifest ids of non-fixture plugins that declare a server entry (test-plan #E19)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-plugins-'));
    tempDirs.push(dir);
    const plugin = (name, manifest) => {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(join(dir, name, 'package.json'), JSON.stringify({ name, 'pi-dashboard-plugin': manifest }));
    };
    plugin('gmail-plugin', { id: 'gmail', server: './src/server/index.ts' });
    plugin('ui-only', { id: 'ui-only', client: './src/client/index.tsx' });
    plugin('fx', { id: 'fx', server: './s.ts', fixture: true });
    expect(expectedServerPluginIds(dir)).toEqual(['gmail']);
  });

  it('enables every expected id, including defaultEnabled:false ones (test-plan #E20)', () => {
    expect(gateConfig(['browser', 'gmail'])).toEqual({
      plugins: { browser: { enabled: true }, gmail: { enabled: true } },
    });
  });

  it('reports failed and skipped plugins; sees a verdict for each (test-plan #E21)', () => {
    const log = [
      '[plugin-loader] Loaded plugin "a"',
      '[plugin-loader] Failed to load plugin "b": Cannot find module \'oauth4webapi\'',
      '[plugin-loader] Skipping plugin "c" — missing/disabled dep: b',
    ].join('\n');
    const problems = pluginLoadProblems(log, { plugins: ['a', 'b', 'c'] }).join('\n');
    expect(problems).toContain('"b"');
    expect(problems).toContain('"c"');
    expect(problems).not.toContain('"a"');
    expect(pluginVerdicts(log, ['a', 'b', 'c'])).toEqual({ a: 'loaded', b: 'failed', c: 'skipped' });
  });

  /** Fake clock + a log that gains one verdict line at each given second. */
  function fakeLog(ids, atSeconds) {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      readLog: () =>
        ids
          .filter((_, i) => atSeconds[i] !== undefined && atSeconds[i] * 1000 <= t)
          .map((id) => `[plugin-loader] Loaded plugin "${id}"`)
          .join('\n'),
      elapsed: () => t,
    };
  }

  it('the idle budget restarts on every new verdict (test-plan #P1)', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const clock = fakeLog(ids, ids.map((_, i) => (i + 1) * 100));
    const r = await waitForVerdicts({ ids, ...clock, pollMs: 2_000 });
    expect(r.missing).toEqual([]);
    expect(Object.keys(pluginVerdicts(r.text, ids))).toHaveLength(20);
  });

  it('times out an activation that hangs, idle-budget after the last verdict (test-plan #P2)', async () => {
    const ids = ['x', 'y', 'z'];
    const clock = fakeLog(ids, [10, 20]);
    const r = await waitForVerdicts({ ids, ...clock, pollMs: 2_000 });
    expect(r.missing).toEqual(['z']);
    expect(VERDICT_TIMEOUT_MS).toBe(120_000);
    expect(clock.elapsed()).toBeLessThanOrEqual(140_000 + 2_000);
  });
});
