# Latency (task 6.7, test-plan #P1–#P6, design D6)

Bench: `packages/server/src/__tests__/route-admission.bench.test.ts`, describe "file-route cwd admission latency" (opt-in `PI_BENCH=1`; numbers go to stderr as `[bench]` lines). Host: macOS arm64 dev machine, real git, `fastify.inject`. The always-on P6 test (`file-cwd-admission-routes.test.ts`) asserts a session cwd spawns no git.

Two clean runs (the second line of each pair is the second run):

| Case | Result | Gate |
|---|---|---|
| P1 `GET /api/file` direct match, known=1 vs 100 | p50 0.17 → 0.58 ms (Δ +0.41), p99 0.31 → 1.09 ms (Δ +0.78); run 2: 0.17 → 0.53 (Δ +0.36), p99 0.49 → 1.04 (Δ +0.55) | Δp50 ≤ +2 ms, Δp99 ≤ +15 ms — **pass** |
| P2 `GET /api/file` on a sessionless worktree of a pinned repo, 200 sequential | p50 76–85 ms, p99 204–239 ms, 200×200, 0 × 503 | 0 indeterminate — **pass** |
| P3 per-asset re-check, direct-match target, 200 | p50 0.04 ms, p95 0.05–0.08 ms | p95 ≤ 10 ms — **pass** |
| P4a baseline: 20 concurrent `GET /api/git/status` on distinct sessionless worktrees, no preview | p50 855–868 ms, p99 1378–1406 ms, 0 × 503 | recorded |
| P4 same 20 routes while a 50-asset derived-worktree preview loads (6 concurrent workers) | git p50 827–925 ms, p99 1385–1468 ms, 0 × 503; per-asset p50 75–82 ms, p99 1173–1236 ms, 0 × 503 | 0 indeterminate, p99 ≤ 3000 ms — **pass** |
| P5 per-asset re-check on a derived worktree | p50 79 ms, p95 146–174 ms, first serve 76 ms | recorded; first ≤ 3000 ms — pass |
| P5 16 concurrent `GET /api/file/raw`, direct match | p50 ~1 ms, p99 3.4–3.6 ms | recorded |

The preview adds no measurable load to the 20 concurrent git routes (P4 vs P4a: p50 within noise).

**One miss on a cold first run.** The first execution of the file-route group (right after the CodeQL analysis and a full server test run) measured P4 at p99 3067 ms with 1 × 503 of 20, and P1 known=1 p99 13.6 ms. Re-running P4 alone twice (p99 1330–1450 ms, 0 × 503) and the whole group twice more (table above) did not reproduce it, and P4a (no preview) sits at the same level as P4, so the miss is machine contention, not preview load. No cache was added.
