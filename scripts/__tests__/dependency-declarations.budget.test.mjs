/**
 * Publish-correctness checker runtime budget (P1, P2; test-plan #E30, #P5).
 *
 * Budget lane: this file is named `*.budget.test.*`, so `BUDGET_TEST_EXCLUDE`
 * (vitest.workers.ts) keeps it out of every blocking run; the nightly `budget`
 * job sets RUN_BUDGET_TESTS=1 and collects it. No env gate of its own, and no
 * RUN_CI_SCENARIOS read. The formula and its helpers live in
 * helpers/publish-budget.mjs and are asserted blocking by E26-E28 in
 * dependency-declarations.test.mjs.
 *
 * Split from dependency-declarations.test.mjs. See change: stabilize-blocking-test-lanes.
 */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { budgetedWorkspaceCount, budgetMessage, withinBudget } from './helpers/publish-budget.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// This is the suite's single full-repository invocation of the checker: it
// proves the budget AND the zero-findings exit code in one run. Duplicating it
// elsewhere spawns `npm pack` across every workspace twice, whose CPU spike
// starves unrelated 5s-timeout tests running in parallel.
//
describe('publish-correctness checker runtime budget (P1, P2)', () => {
  it('completes across all non-private workspaces within 30 + 3 * N seconds', () => {
    const n = budgetedWorkspaceCount();
    const started = Date.now();
    execFileSync('node', [join(REPO_ROOT, 'scripts', 'verify-published-imports.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const elapsed = (Date.now() - started) / 1000;
    expect(withinBudget(elapsed, n), budgetMessage(elapsed, n)).toBe(true);
  }, 400_000);
});
