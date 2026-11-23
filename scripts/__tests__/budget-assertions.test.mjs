/**
 * Guard tests for `scripts/check-budget-assertions.mjs`.
 *
 * The guard lists budget assertions (upper bounds on a real-clock or memory
 * reading) still sitting in blocking test files. It is warn-only: nothing in
 * this change fails on a finding. These tests pin the classification rule
 * (design D4), the analysis and allow-list (D5) and the output/exit contract.
 *
 * Analyzer cases drive `analyzeBudgetAssertions` with fixture strings (it reads
 * no file system); CLI cases spawn the script over `mkdtemp` fixture trees with
 * `--root`, so nothing depends on the real tree's current content, except the
 * cases that cite the real tree on purpose (E27, E49, E50).
 *
 * See change: stabilize-blocking-test-lanes (test-plan E27, E35-E58, X3).
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeBudgetAssertions,
  LIVENESS_ALLOW,
  REPO_ROOT,
  runBudgetGuard,
  runCli,
} from '../check-budget-assertions.mjs';

const SCRIPT = join(REPO_ROOT, 'scripts', 'check-budget-assertions.mjs');
const SELF = 'scripts/__tests__/budget-assertions.test.mjs';

/** Track every fixture root this file creates so nothing leaks into /tmp. */
const fixtureRoots = [];

function makeFixtureTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'budget-guard-'));
  fixtureRoots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

afterAll(() => {
  for (const root of fixtureRoots) {
    try {
      chmodSync(root, 0o700);
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

/** The spawned guard must not inherit the CI job's summary file. */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.GITHUB_STEP_SUMMARY;
  return { ...env, ...extra };
}

function cli(args, env = cleanEnv()) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, cwd: REPO_ROOT, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Analyze one fixture file (no allow-list unless given). */
function analyze(lines, { path = 'pkg/__tests__/x.test.ts', allow = [] } = {}) {
  return analyzeBudgetAssertions(path, `${lines.join('\n')}\n`, allow);
}
const budget = (res) => res.findings.filter((f) => f.kind === 'budget');

/** A fixture file with one budget case, used by the CLI cases. */
const ONE_BOUND = [
  'import { expect, it } from "vitest";',
  'it("is fast", () => {',
  '  const t0 = Date.now();',
  '  expect(Date.now() - t0).toBeLessThan(1000);',
  '});',
];
const TWO_BOUNDS = [
  ...ONE_BOUND,
  'it("is also fast", () => {',
  '  const s = performance.now();',
  '  expect(performance.now() - s).toBeLessThanOrEqual(50);',
  '});',
];

describe('classification: sources and forms', () => {
  it('E35: flags a process.memoryUsage() delta bound, with file and line', () => {
    const res = analyze([
      'import { expect, it } from "vitest";',
      'it("does not leak", () => {',
      '  const rss0 = process.memoryUsage().rss;',
      '  work();',
      '  expect(process.memoryUsage().rss - rss0).toBeLessThan(limit);',
      '});',
    ]);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]).toMatchObject({ kind: 'budget', file: 'pkg/__tests__/x.test.ts', line: 5, caseTitle: 'does not leak' });
    expect(res.findings[0].form).toContain('process.memoryUsage()');
  });

  it('E36: flags a relative bound between two medians of performance.now() diffs', () => {
    const res = analyze([
      'it("status is not slower", async () => {',
      '  const statusTimes = [];',
      '  const nonStatusTimes = [];',
      '  for (let i = 0; i < 20; i++) {',
      '    const a = performance.now();',
      '    await status();',
      '    statusTimes.push(performance.now() - a);',
      '    const b = performance.now();',
      '    await nonStatus();',
      '    nonStatusTimes.push(performance.now() - b);',
      '  }',
      '  const statusMs = median(statusTimes);',
      '  const nonStatusMs = median(nonStatusTimes);',
      '  expect(nonStatusMs).toBeLessThan(statusMs * 1.25);',
      '});',
    ]);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].line).toBe(14);
    expect(res.findings[0].form).toContain('relative');
  });

  it('E37: reads an assertion split over three lines as one statement, reported at the expect( line', () => {
    const res = analyze([
      'it("builds fast", () => {',
      '  const s = performance.now();',
      '  build();',
      '  const elapsed = performance.now() - s;',
      '  expect(',
      '    elapsed,',
      '  ).toBeLessThan(1000);',
      '});',
    ]);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].line).toBe(5);
  });

  it('E38: a same-file function returning performance.now() samples taints its call', () => {
    const res = analyze([
      'async function run() {',
      '  const times = [];',
      '  for (let i = 0; i < 5; i++) {',
      '    const s = performance.now();',
      '    await step();',
      '    times.push(performance.now() - s);',
      '  }',
      '  return { times };',
      '}',
      'it("reads while the worker writes", async () => {',
      '  expect(Math.max(...(await run()).times)).toBeLessThan(50);',
      '});',
    ]);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].line).toBe(11);
  });

  it('E38: an elapsed value set in a beforeAll of the enclosing describe taints the case that bounds it', () => {
    const res = analyze([
      'describe("scan", () => {',
      '  let elapsedMs;',
      '  beforeAll(() => {',
      '    const t0 = performance.now();',
      '    scan();',
      '    elapsedMs = performance.now() - t0;',
      '  });',
      '  it("scans fast", () => {',
      '    expect(elapsedMs).toBeLessThan(5000);',
      '  });',
      '  it("unrelated count", () => {',
      '    expect(rows.length).toBeLessThan(5000);',
      '  });',
      '});',
    ]);
    expect(res.findings.map((f) => f.line)).toEqual([9]);
  });

  it('E44: flags startLagMonitor and rssBytes helper bounds', () => {
    const res = analyze([
      'it("keeps the loop responsive", async () => {',
      '  const lag = startLagMonitor();',
      '  await work();',
      '  expect(lag.max).toBeLessThan(50);',
      '});',
      'it("stays under 2.5 GiB", async () => {',
      '  expect(await rssBytes(pid)).toBeLessThanOrEqual(2.5 * GiB);',
      '});',
    ]);
    expect(res.findings).toHaveLength(2);
    expect(res.findings.map((f) => f.line)).toEqual([4, 7]);
    expect(res.findings[0].form).toContain('startLagMonitor()');
    expect(res.findings[1].form).toContain('rssBytes()');
  });

  it('a function declaration named rssBytes is not a reading', () => {
    const res = analyze([
      'function rssBytes(pid) { return 1; }',
      'it("x", () => {',
      '  expect(limit).toBeLessThan(5);',
      '});',
    ]);
    expect(res.findings).toHaveLength(0);
  });

  it('E43: a Map.set(…, performance.now()) taints the map and its reads', () => {
    const res = analyze([
      'it("answers quickly", () => {',
      '  const m = new Map();',
      '  m.set(k, performance.now());',
      '  expect(performance.now() - m.get(k)).toBeLessThan(100);',
      '});',
    ]);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].line).toBe(4);
  });

  it('E43: a collection receiving a tainted identifier through push/set (arguments on later lines) taints it', () => {
    const res = analyze([
      'it("p95 of pushes", () => {',
      '  const t = [];',
      '  const s = performance.now();',
      '  const d = performance.now() - s;',
      '  t.push(',
      '    d,',
      '  );',
      '  expect(p95(t)).toBeLessThan(5);',
      '});',
    ]);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].line).toBe(8);
  });

  it('E35-form: assert(M < X) and expect(M <= X).toBe(true) are upper bounds', () => {
    const res = analyze([
      'it("a", () => {',
      '  const t0 = Date.now();',
      '  assert(Date.now() - t0 < 100);',
      '});',
      'it("b", () => {',
      '  const t0 = Date.now();',
      '  expect(Date.now() - t0 <= 100, "slow").toBe(true);',
      '});',
    ]);
    expect(res.findings.map((f) => f.line)).toEqual([3, 7]);
  });
});

describe('classification: exclusions', () => {
  it('E39: a module-level beforeEach with vi.useFakeTimers() fakes every case of the file', () => {
    const res = analyze([
      'beforeEach(() => vi.useFakeTimers());',
      'it("glides", () => {',
      '  const t0 = performance.now();',
      '  vi.advanceTimersByTime(100);',
      '  expect(performance.now() - t0).toBeLessThan(500);',
      '});',
    ]);
    expect(res.findings).toHaveLength(0);
  });

  it('E39: a beforeEach of an enclosing describe fakes its cases but not a sibling describe', () => {
    const res = analyze([
      'describe("faked", () => {',
      '  beforeEach(() => {',
      '    vi.useFakeTimers();',
      '  });',
      '  it("a", () => {',
      '    const t0 = Date.now();',
      '    expect(Date.now() - t0).toBeLessThan(500);',
      '  });',
      '});',
      'describe("real", () => {',
      '  it("b", () => {',
      '    const t0 = Date.now();',
      '    expect(Date.now() - t0).toBeLessThan(500);',
      '  });',
      '});',
    ]);
    expect(res.findings.map((f) => f.line)).toEqual([13]);
  });

  it('E39: a no-argument vi.useFakeTimers() inside the case fakes that case', () => {
    const res = analyze([
      'it("a", () => {',
      '  vi.useFakeTimers();',
      '  const t0 = process.hrtime.bigint();',
      '  expect(process.hrtime.bigint() - t0).toBeLessThan(5n);',
      '});',
    ]);
    expect(res.findings).toHaveLength(0);
  });

  it('E40: a setTimeout-only fake in case A leaves case B on the real clock', () => {
    const res = analyze([
      'it("case A", () => {',
      '  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });',
      '  expect(true).toBe(true);',
      '});',
      'it("case B", () => {',
      '  const t0 = Date.now();',
      '  expect(Date.now() - t0).toBeLessThan(2000);',
      '});',
    ]);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].line).toBe(7);
  });

  it('E40: a toFake list naming the clock fakes it', () => {
    const res = analyze([
      'it("a", () => {',
      '  vi.useFakeTimers({ toFake: ["Date"] });',
      '  const t0 = Date.now();',
      '  expect(Date.now() - t0).toBeLessThan(2000);',
      '});',
    ]);
    expect(res.findings).toHaveLength(0);
  });

  it('E41: an ordering check with a bare reading on the bound side is not a bound', () => {
    const res = analyze([
      'it("stamps", () => {',
      '  expect(record.createdAt).toBeLessThanOrEqual(Date.now());',
      '});',
    ]);
    expect(res.findings).toHaveLength(0);
  });

  it('E42: vi.setSystemTime fakes Date only: the performance.now() bound is the one finding', () => {
    const res = analyze([
      'it("mixed", () => {',
      '  vi.setSystemTime(new Date(0));',
      '  const t0 = Date.now();',
      '  const p0 = performance.now();',
      '  expect(Date.now() - t0).toBeLessThan(10);',
      '  expect(performance.now() - p0).toBeLessThan(10);',
      '});',
    ]);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].line).toBe(6);
    expect(res.findings[0].form).toContain('performance.now()');
  });

  it('E45: a lower bound is not a finding; an upper bound written with toBeGreaterThan is', () => {
    const lower = analyze([
      'it("waits at least the delay", async () => {',
      '  const t0 = Date.now();',
      '  await wait(delayMs);',
      '  const elapsed = Date.now() - t0;',
      '  expect(elapsed).toBeGreaterThanOrEqual(delayMs);',
      '});',
    ]);
    expect(lower.findings).toHaveLength(0);
    const upper = analyze([
      'it("finishes under the limit", async () => {',
      '  const t0 = Date.now();',
      '  await work();',
      '  const elapsed = Date.now() - t0;',
      '  expect(limit).toBeGreaterThan(elapsed);',
      '});',
    ]);
    expect(upper.findings).toHaveLength(1);
    expect(upper.findings[0].line).toBe(5);
  });

  it('E46: byte sizes and call counts are not budgets', () => {
    const res = analyze([
      'it("stores compactly", () => {',
      '  const stored = store.get();',
      '  expect(JSON.stringify(stored).length).toBeLessThan(4096);',
      '  expect(spy).toHaveBeenCalledTimes(2);',
      '});',
    ]);
    expect(res.findings).toHaveLength(0);
  });

  it('no analysis of a *.budget.test.* file (task 2.7 governs them)', () => {
    const res = analyze(ONE_BOUND, { path: 'pkg/__tests__/x.budget.test.ts' });
    expect(res.findings).toHaveLength(0);
  });

  it('a reading inside a string or a comment is not a reading', () => {
    const res = analyze([
      'it("x", () => {',
      '  // const t0 = Date.now();',
      '  const msg = "Date.now() - t0";',
      '  expect(msg.length).toBeLessThan(10);',
      '});',
    ]);
    expect(res.findings).toHaveLength(0);
  });
});

describe('scope (E47, E48) and the --list CLI', () => {
  it('E47: only the file under a plain __tests__ directory is reported', () => {
    const body = `${ONE_BOUND.join('\n')}\n`;
    const root = makeFixtureTree({
      'a.budget.test.ts': body,
      'tests/e2e/x.spec.ts': body,
      'tests/e2e/y.test.ts': body,
      'qa/x.test.ts': body,
      'pkg/fixtures/x.test.ts': body,
      'pkg/__tests__/x.test.ts': body,
    });
    const r = cli(['--root', root, '--list']);
    expect(r.status).toBe(0);
    const hits = r.stdout.split('\n').filter((l) => l.startsWith('FINDING'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('pkg/__tests__/x.test.ts:4');
  });

  it('E48: a path-prefix argument narrows the listing to that prefix', () => {
    const body = `${ONE_BOUND.join('\n')}\n`;
    const root = makeFixtureTree({
      'packages/server/src/__tests__/a.test.ts': body,
      'packages/kb/src/__tests__/b.test.ts': body,
    });
    const all = cli(['--root', root, '--list']).stdout.split('\n').filter((l) => l.startsWith('FINDING'));
    expect(all).toHaveLength(2);
    const r = cli(['--root', root, '--list', 'packages/server/']);
    const hits = r.stdout.split('\n').filter((l) => l.startsWith('FINDING'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('packages/server/src/__tests__/a.test.ts');
    expect(r.stdout).not.toContain('packages/kb/');
  });
});

describe('liveness allow-list (D5, A6)', () => {
  const KEEPER = 'packages/server/src/rpc-keeper/__tests__/keeper.test.ts';
  const keeperFixture = [
    'it("P1: rotation never stalls the RPC path", async () => {',
    '  let maxLatencyMs = 0;',
    '  const t0 = performance.now();',
    '  maxLatencyMs = Math.max(maxLatencyMs, performance.now() - t0);',
    '  expect(maxLatencyMs).toBeLessThan(1050);',
    '});',
  ];

  it('seeds the four D5 entries, each with a written reason', () => {
    expect(LIVENESS_ALLOW.map((e) => e.file.split('/').pop())).toEqual([
      'cli-stop-real.test.ts',
      'cli-foreground-real.test.ts',
      'shutdown-terminates-any-strategy.test.ts',
      'keeper.test.ts',
    ]);
    for (const e of LIVENESS_ALLOW) expect(e.reason.trim().length).toBeGreaterThan(0);
  });

  it('E49: an entry exempts its one assertion and is reported as allowed with the entry', () => {
    const entry = { file: KEEPER, assertion: 'expect(maxLatencyMs).toBeLessThan(1050)', reason: 'WRITE_RPC_ATTEMPT_TIMEOUT_MS 350 x 3' };
    const res = analyze(keeperFixture, { path: KEEPER, allow: [entry] });
    expect(res.findings).toHaveLength(0);
    expect(res.allowed).toHaveLength(1);
    expect(res.allowed[0].entry).toBe(entry);
    expect(res.allowed[0].line).toBe(5);
  });

  describe('on the real tree', () => {
    let list;
    beforeAll(() => {
      list = cli(['--list']);
    });

    it('E49: --list shows the keeper occurrence as allow-listed, not as a finding', () => {
      expect(list.status).toBe(0);
      const lines = list.stdout.split('\n');
      const allowed = lines.filter((l) => l.startsWith('ALLOWED') && l.includes('rpc-keeper/__tests__/keeper.test.ts'));
      expect(allowed).toHaveLength(1);
      expect(allowed[0]).toContain('expect(maxLatencyMs).toBeLessThan(1050)');
      expect(lines.filter((l) => l.startsWith('FINDING') && l.includes('keeper.test.ts:1085'))).toHaveLength(0);
    });

    it('E50: cli-foreground-real.test.ts:80, trailing comment included, matches its entry exactly once', () => {
      const src = readFileSync(join(REPO_ROOT, 'packages/server/src/__tests__/cli-foreground-real.test.ts'), 'utf8').split('\n');
      expect(src[79]).toMatch(/toBeLessThan\(10_000 \+ 20_000\); \/\/ classify budget \+ boot slack$/);
      const lines = list.stdout.split('\n');
      const allowed = lines.filter((l) => l.startsWith('ALLOWED') && l.includes('cli-foreground-real.test.ts'));
      expect(allowed).toHaveLength(1);
      expect(allowed[0]).toContain('cli-foreground-real.test.ts:80');
      // each seed entry is allow-listed against exactly one assertion, none reported as a bad entry
      expect(lines.filter((l) => l.startsWith('ALLOWED'))).toHaveLength(LIVENESS_ALLOW.length);
      expect(lines.filter((l) => l.startsWith('FINDING') && /allow-list entry/.test(l))).toHaveLength(0);
    });

    it('4.1 verify: the cited split-line, Map.set, startLagMonitor and real-clock hits are listed; fake-clock and byte-size lines are not', () => {
      const out = list.stdout;
      for (const hit of [
        'packages/server/src/__tests__/auth-redirect-base.test.ts:562',
        'packages/server/src/__tests__/sudo-credential-load.test.ts:50',
        'packages/server/src/attachments/__tests__/display-fit-perf.test.ts:81',
        'packages/server/src/access/__tests__/ladder-perf.test.ts:45',
        'packages/server/src/__tests__/sudo-credential-wiring.test.ts:41',
      ]) {
        expect(out, hit).toContain(`FINDING  ${hit}  `);
      }
      expect(out).not.toContain('packages/client/src/lib/chat/__tests__/follow-glide.test.ts');
      expect(out).not.toContain('packages/server/src/__tests__/memory-event-store.test.ts:609');
    });
  });

  it('E50: an entry written without `;` or comment matches a line that carries both', () => {
    const path = 'packages/server/src/__tests__/cli-foreground-real.test.ts';
    const entry = { file: path, assertion: 'expect(Date.now() - t0).toBeLessThan(10_000 + 20_000)', reason: 'classify budget + boot slack' };
    const res = analyze(
      [
        'it("second foreground", () => {',
        '  const t0 = Date.now();',
        '  expect(Date.now() - t0).toBeLessThan(10_000 + 20_000); // classify budget + boot slack',
        '});',
      ],
      { path, allow: [entry] },
    );
    expect(res.findings).toHaveLength(0);
    expect(res.allowed).toHaveLength(1);
  });

  it('E51: an entry with an empty or whitespace reason is itself a finding', () => {
    const lines = [
      'it("a", () => {',
      '  const t0 = Date.now();',
      '  expect(Date.now() - t0).toBeLessThan(111);',
      '});',
      'it("b", () => {',
      '  const t0 = Date.now();',
      '  expect(Date.now() - t0).toBeLessThan(222);',
      '});',
    ];
    const allow = [
      { file: 'pkg/__tests__/x.test.ts', assertion: 'expect(Date.now() - t0).toBeLessThan(111)', reason: '' },
      { file: 'pkg/__tests__/x.test.ts', assertion: 'expect(Date.now() - t0).toBeLessThan(222)', reason: '   ' },
    ];
    const res = analyze(lines, { allow });
    const bad = res.findings.filter((f) => f.kind === 'allow-entry');
    expect(bad).toHaveLength(2);
    expect(bad.every((f) => /empty reason/.test(f.form))).toBe(true);
    expect(bad.map((f) => f.entry)).toEqual(allow);
  });

  it('E52: an entry matching no assertion in its file is stale', () => {
    const allow = [{ file: 'pkg/__tests__/x.test.ts', assertion: 'expect(gone).toBeLessThan(1)', reason: 'process event' }];
    const res = analyze(ONE_BOUND, { allow });
    const bad = res.findings.filter((f) => f.kind === 'allow-entry');
    expect(bad).toHaveLength(1);
    expect(bad[0].form).toMatch(/stale/);
    expect(budget(res)).toHaveLength(1); // nothing exempted
  });

  it('E52: an entry whose file no longer exists is stale (runner)', () => {
    const root = makeFixtureTree({ 'pkg/__tests__/other.test.ts': 'it("x", () => {});\n' });
    const allow = [{ file: 'pkg/__tests__/gone.test.ts', assertion: 'expect(a).toBeLessThan(1)', reason: 'process event' }];
    const res = runBudgetGuard({ root, allow });
    const bad = res.findings.filter((f) => f.kind === 'allow-entry');
    expect(bad).toHaveLength(1);
    expect(bad[0].file).toBe('pkg/__tests__/gone.test.ts');
    expect(bad[0].form).toMatch(/stale/);
  });

  it('E53: an entry equal to the first line of two flagged assertions is ambiguous and exempts neither', () => {
    const line = 'expect(Date.now() - t0).toBeLessThan(500)';
    const lines = [
      'it("a", () => {',
      '  const t0 = Date.now();',
      `  ${line};`,
      '});',
      'it("b", () => {',
      '  const t0 = Date.now();',
      `  ${line}; // same text`,
      '});',
    ];
    const res = analyze(lines, { allow: [{ file: 'pkg/__tests__/x.test.ts', assertion: line, reason: 'process event' }] });
    const bad = res.findings.filter((f) => f.kind === 'allow-entry');
    expect(bad).toHaveLength(1);
    expect(bad[0].form).toMatch(/ambiguous/);
    expect(budget(res).map((f) => f.line)).toEqual([3, 7]);
    expect(res.allowed).toHaveLength(0);
  });

  it('E54: an entry for a mockup-loop file exempts its assertion; the file is not checked against the server real-process list (C4)', () => {
    const path = 'packages/mockup-loop/src/__tests__/mock-site-serve.test.ts';
    const entry = {
      file: path,
      assertion: 'expect(Date.now() - t0).toBeLessThan(30_000)',
      reason: 'serve_mock_site returns once the spawned site answers; bound equals the tool start timeout',
    };
    const res = analyze(
      [
        'it("serves", async () => {',
        '  const t0 = Date.now();',
        '  const a = await t.execute("t", { dir: root, port });',
        '  expect(Date.now() - t0).toBeLessThan(30_000);',
        '});',
      ],
      { path, allow: [entry] },
    );
    expect(res.findings).toHaveLength(0);
    expect(res.allowed).toHaveLength(1);
    expect(readFileSync(SCRIPT, 'utf8')).not.toContain('real-process-files');
  });
});

describe('output contract: --warn, --list, no flag', () => {
  it('E55: --warn prints one annotation per finding and appends the summary, exit 0', () => {
    const root = makeFixtureTree({ 'pkg/__tests__/a.test.ts': `${TWO_BOUNDS.join('\n')}\n` });
    const summary = join(root, 'summary.md');
    const r = cli(['--root', root, '--warn'], cleanEnv({ GITHUB_STEP_SUMMARY: summary }));
    expect(r.status).toBe(0);
    const warnings = r.stdout.split('\n').filter((l) => l.startsWith('::warning'));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^::warning file=pkg\/__tests__\/a\.test\.ts,line=4::budget assertion in a blocking lane: .+/);
    expect(warnings[1]).toMatch(/^::warning file=pkg\/__tests__\/a\.test\.ts,line=8::budget assertion in a blocking lane: .+/);
    const md = readFileSync(summary, 'utf8');
    expect(md).toContain('### Budget assertions in blocking lanes: 2');
    const rows = md.split('\n').filter((l) => /^\| pkg\//.test(l));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('pkg/__tests__/a.test.ts:4');
    expect(rows[0]).toContain('is fast');
    expect(rows[1]).toContain('pkg/__tests__/a.test.ts:8');
    expect(rows[1]).toContain('is also fast');
  });

  it('E56: with GITHUB_STEP_SUMMARY unset, --warn prints the annotations, writes no summary file, exit 0', () => {
    const root = makeFixtureTree({ 'pkg/__tests__/a.test.ts': `${TWO_BOUNDS.join('\n')}\n` });
    const r = cli(['--root', root, '--warn'], cleanEnv());
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('::warning'))).toHaveLength(2);
    expect(r.stdout).not.toContain('###');
    // the guard writes only to GITHUB_STEP_SUMMARY: nothing appeared in the fixture tree
    expect(runBudgetGuard({ root }).files).toBe(1);
  });

  it('E57: no flag exits 1 on a finding and 0 on none; --list exits 0 either way', () => {
    const dirty = makeFixtureTree({ 'pkg/__tests__/a.test.ts': `${ONE_BOUND.join('\n')}\n` });
    const clean = makeFixtureTree({ 'pkg/__tests__/a.test.ts': 'it("x", () => {});\n' });
    expect(cli(['--root', dirty]).status).toBe(1);
    expect(cli(['--root', clean]).status).toBe(0);
    expect(cli(['--root', dirty, '--list']).status).toBe(0);
    expect(cli(['--root', clean, '--list']).status).toBe(0);
  });

  it('E58: the guard is wired into no blocking command: absent from ship-it, npm scripts and the vitest config; no other test references it', () => {
    for (const rel of ['.pi/skills/ship-it/SKILL.md', 'package.json', 'vitest.config.ts']) {
      expect(readFileSync(join(REPO_ROOT, rel), 'utf8'), rel).not.toContain('check-budget-assertions');
    }
    // no other test asserts anything about the guard's findings on the tree
    const list = spawnSync('git', ['ls-files', '-z', '--', '*.test.ts', '*.test.tsx', '*.test.mts', '*.test.mjs', '*.test.js'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const referencing = list.stdout
      .split('\0')
      .filter(Boolean)
      .filter((f) => f !== SELF)
      // The ci.yml contract (E11) legitimately names the warn-only step's command; it runs nothing.
      .filter((f) => f !== 'packages/shared/src/__tests__/ci-affected-selection-contract.test.ts')
      .filter((f) => /check-budget-assertions|analyzeBudgetAssertions|runBudgetGuard/.test(readFileSync(join(REPO_ROOT, f), 'utf8')));
    expect(referencing).toEqual([]);
  });
});

describe('fault injection (X3): the guard cannot fail a job', () => {
  it('X3(a): an unreadable test file becomes a warning; other findings are still printed; exit 0', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root reads chmod 000 files
    const root = makeFixtureTree({
      'pkg/__tests__/a.test.ts': `${ONE_BOUND.join('\n')}\n`,
      'pkg/__tests__/locked.test.ts': `${ONE_BOUND.join('\n')}\n`,
    });
    chmodSync(join(root, 'pkg/__tests__/locked.test.ts'), 0o000);
    const r = cli(['--root', root, '--warn']);
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines.some((l) => l.startsWith('::warning::budget guard error: ') && l.includes('locked.test.ts'))).toBe(true);
    expect(lines.some((l) => l.startsWith('::warning file=pkg/__tests__/a.test.ts,line=4::'))).toBe(true);
  });

  it('X3(b): an analyzer that throws on one file becomes a warning; other findings are still printed; exit 0', () => {
    const root = makeFixtureTree({
      'pkg/__tests__/a.test.ts': `${ONE_BOUND.join('\n')}\n`,
      'pkg/__tests__/boom.test.ts': `${ONE_BOUND.join('\n')}\n`,
    });
    const out = [];
    const throwing = (path, text, allow) => {
      if (path.endsWith('boom.test.ts')) throw new Error('analyzer exploded');
      return analyzeBudgetAssertions(path, text, allow);
    };
    const code = runCli({ argv: ['--root', root, '--warn'], env: {}, out: (l) => out.push(l), analyze: throwing });
    expect(code).toBe(0);
    expect(out.some((l) => l.startsWith('::warning::budget guard error: ') && l.includes('analyzer exploded'))).toBe(true);
    expect(out.some((l) => l.startsWith('::warning file=pkg/__tests__/a.test.ts,line=4::'))).toBe(true);
  });

  it('X3(b): the runner collects the throw in errors and keeps analysing the other files', () => {
    const root = makeFixtureTree({
      'pkg/__tests__/a.test.ts': `${ONE_BOUND.join('\n')}\n`,
      'pkg/__tests__/boom.test.ts': `${ONE_BOUND.join('\n')}\n`,
    });
    const res = runBudgetGuard({
      root,
      analyze: (path, text, allow) => {
        if (path.endsWith('boom.test.ts')) throw new Error('analyzer exploded');
        return analyzeBudgetAssertions(path, text, allow);
      },
    });
    expect(res.errors).toEqual([{ file: 'pkg/__tests__/boom.test.ts', message: 'analyzer exploded' }]);
    expect(res.findings).toHaveLength(1);
  });
});

describe('real tree', () => {
  it('E27: real-binary.test.ts has no budget bound left on the PR legs (0 hits)', () => {
    const r = cli(['--list', 'packages/blender/src/__tests__/real-binary.test.ts']);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('FINDING'))).toEqual([]);
    expect(r.stdout).toMatch(/\b0 finding\(s\)/);
  });

  it('runs on the real tree in reasonable time and never crashes (--warn exits 0)', () => {
    // bounded by the case timeout (a runner limit), not by a measured budget
    const r = cli(['--warn']);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('budget guard error');
  }, 90_000);
});
