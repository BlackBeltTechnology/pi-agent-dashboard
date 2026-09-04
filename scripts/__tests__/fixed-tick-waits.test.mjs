/**
 * Guard tests for `scripts/check-fixed-tick-waits.mjs`.
 *
 * The fixed-tick guard bans the "await a bare-resolve setTimeout as a barrier,
 * then assert one-shot" pattern in client tests — the race that made the suite
 * rotate red on loaded machines while CI stayed green. The shipped
 * `parallel-test-execution` requirement says async assertions poll (`waitFor`)
 * rather than guess a fixed number of macrotask ticks; these tests are the
 * machine enforcement of that requirement.
 *
 * Deliberate timer yields (mock-internal macrotask, gating no assertion) opt
 * out PER OCCURRENCE with a marker comment on the line directly above the
 * awaited timer — never per file, which would silently excuse future barriers.
 *
 * See change: make-test-suite-deterministic (test-plan E10-E14, P3, X5).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeFixedTickWaits, REPO_ROOT } from '../check-fixed-tick-waits.mjs';

const CLIENT_SRC = join(REPO_ROOT, 'packages', 'client', 'src');

/** Track every fixture root this file creates so nothing leaks into /tmp. */
const fixtureRoots = [];

function makeFixtureTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'fixed-tick-guard-'));
  fixtureRoots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    writeFileSync(path, text);
  }
  return root;
}

afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

const OPT_OUT = '// fixed-tick-waits: opt-out — mock-internal macrotask yield, gates no assertion';

describe('barrier detection (E10)', () => {
  it('rejects a bare-resolve awaited setTimeout followed by an assertion', () => {
    const root = makeFixtureTree({
      'barrier.test.ts': [
        'import { expect, it } from "vitest";',
        'it("loads", async () => {',
        '  await new Promise((r) => setTimeout(r, 0));',
        '  expect(loaded).toBe(true);',
        '});',
      ].join('\n'),
    });
    const { violations } = analyzeFixedTickWaits(root);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('barrier.test.ts');
    expect(violations[0].line).toBe(3);
  });

  it('matches resolve/reject parameter names, not just `r`', () => {
    const root = makeFixtureTree({
      'named.test.ts': 'it("x", async () => {\n  await new Promise((resolve) => setTimeout(resolve, 50));\n});\n',
    });
    const { violations } = analyzeFixedTickWaits(root);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  it('flags the pattern inside helpers too, not only test bodies', () => {
    const root = makeFixtureTree({
      'helper.test.ts': [
        'async function flushTimers() {',
        '  await new Promise((r) => setTimeout(r, 10));',
        '}',
      ].join('\n'),
    });
    const { violations } = analyzeFixedTickWaits(root);
    expect(violations).toHaveLength(1);
  });

  it('scans only client test files, not other sources in the tree', () => {
    const root = makeFixtureTree({
      'component.tsx': 'export const tick = async () => { await new Promise((r) => setTimeout(r, 0)); };',
      'helpers.test.ts': 'it("ok", () => {});\n',
    });
    const { violations } = analyzeFixedTickWaits(root);
    expect(violations).toEqual([]);
  });
});

describe('per-occurrence opt-out (E11, E12)', () => {
  it('an annotated occurrence produces no violation (E11)', () => {
    const root = makeFixtureTree({
      'yield.test.tsx': [
        'it("polls mock", async () => {',
        `  ${OPT_OUT}`,
        '  await new Promise((r) => setTimeout(r, 0));',
        '  return { status: "approved" };',
        '});',
      ].join('\n'),
    });
    const { violations } = analyzeFixedTickWaits(root);
    expect(violations).toEqual([]);
  });

  it('an opt-out never waives a later un-annotated barrier in the same file (E12)', () => {
    const root = makeFixtureTree({
      'mixed.test.tsx': [
        'it("yield", async () => {',
        `  ${OPT_OUT}`,
        '  await new Promise((r) => setTimeout(r, 0));',
        '});',
        '',
        'it("barrier", async () => {',
        '  await new Promise((r) => setTimeout(r, 0));',
        '  expect(done).toBe(true);',
        '});',
      ].join('\n'),
    });
    const { violations } = analyzeFixedTickWaits(root);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(7);
  });
});

describe('client suite compliance (E13, P3)', () => {
  const analyzed = analyzeFixedTickWaits(CLIENT_SRC);

  it('reports zero fixed-tick barriers in the real client suite (E13)', () => {
    expect(analyzed.violations.map((v) => `${v.file}:${v.line}`)).toEqual([]);
  });

  it('scans a non-trivial number of client test files', () => {
    expect(analyzed.files).toBeGreaterThan(50);
  });

  it('analyze wall-clock stays negligible (P3, < 2 s)', () => {
    const start = performance.now();
    analyzeFixedTickWaits(CLIENT_SRC);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});

describe('exit-code contract (E14)', () => {
  const script = join(REPO_ROOT, 'scripts', 'check-fixed-tick-waits.mjs');

  it('hard-fails with the file named on stderr for a violating tree', () => {
    const root = makeFixtureTree({
      'loud.test.ts': 'it("x", async () => {\n  await new Promise((r) => setTimeout(r, 0));\n});\n',
    });
    let stderr = '';
    let code = 0;
    try {
      execFileSync('node', [script, root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      code = err.status ?? 1;
      stderr = err.stderr;
    }
    expect(code).not.toBe(0);
    expect(stderr).toContain('loud.test.ts');
  });

  it('exits 0 for a clean tree', () => {
    const root = makeFixtureTree({ 'clean.test.ts': 'it("x", () => {});\n' });
    const out = execFileSync('node', [script, root], { encoding: 'utf8' });
    expect(out).toMatch(/0 fixed-tick barrier violation/);
  });
});

describe('standalone step and vitest wrapper agree (X5)', () => {
  it('the spawned script reports the same violations the analyze fn finds', () => {
    const standalone = analyzeFixedTickWaits(CLIENT_SRC);
    let stdout = '';
    let stderr = '';
    try {
      execFileSync('node', [join(REPO_ROOT, 'scripts', 'check-fixed-tick-waits.mjs')], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      stdout = err.stdout;
      stderr = err.stderr;
    }
    // The standalone verdict must match the in-process verdict: either both
    // clean, or the script's stderr names exactly the analyze violations.
    if (standalone.violations.length === 0) {
      expect(stderr).toBe('');
    } else {
      for (const v of standalone.violations) {
        expect(stderr).toContain(v.file);
      }
    }
  });
});
