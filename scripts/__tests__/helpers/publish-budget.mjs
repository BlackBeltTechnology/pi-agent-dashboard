/**
 * Publish-correctness checker runtime budget: formula, predicate, message and
 * workspace count. Shared by the blocking formula tests (E26-E28 in
 * dependency-declarations.test.mjs) and the budget-lane runtime check
 * (dependency-declarations.budget.test.mjs). Pure functions: no env gate.
 *
 * See change: stabilize-blocking-test-lanes.
 */
import { resolve } from 'node:path';
import { listWorkspaces, rootPackage } from '../../verify-published-imports.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

// ONE budget, stated in openspec/specs/publish-correctness-verification/spec.md
// and asserted here, scaled by the number of workspaces the checker walks:
//
//     budget_seconds = 30 + 3 * N,  N = listWorkspaces().length + (rootPackage() ? 1 : 0)
//
// Measured points (non-private `packages/*` workspaces): 72.9 s at 37 (the
// original flat-120 s note) and 122.2 s at 56 (CI nightly run 38504381607, job
// 115658811634). Slope (122.2 - 72.9) / (56 - 37) = 2.595 s per workspace,
// rounded UP to 3. The 30 s base is a CHOSEN shared-runner contention
// allowance, not a fit (a line through the two points has intercept ~ -23 s).
// At today's N = 57 (56 workspaces + the non-private root) the budget is 201 s,
// 1.64x the measured 122.2 s: a contended run passes, a 2x regression trips.
// N is imported from the checker itself (verify-published-imports.mjs:672), so a
// new workspace moves the ceiling by 3 s instead of breaching it.
// See change: triage-browser-e2e-offbox-poison (design D5).
export const budgetSeconds = (n) => 30 + 3 * n;
export const withinBudget = (measuredSeconds, n) => measuredSeconds <= budgetSeconds(n);
/** The failure message names the measurement, the budget and the N it came from. */
export const budgetMessage = (measuredSeconds, n) =>
  `measured ${Number(measuredSeconds.toFixed(3))}s vs budget ${budgetSeconds(n)}s (${n} workspaces)`;
export const budgetedWorkspaceCount = (root = REPO_ROOT) => listWorkspaces(root).length + (rootPackage(root) ? 1 : 0);

