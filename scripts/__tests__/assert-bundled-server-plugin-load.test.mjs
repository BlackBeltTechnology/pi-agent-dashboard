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
import { bootArgv, bundleLayout, bundleRoot, logTail, pluginLoadProblems } from '../../packages/electron/scripts/assert-bundled-server-plugin-load.mjs';
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
