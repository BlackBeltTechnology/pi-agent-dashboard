# Latency evidence (test-plan P1–P3, design D5)

Bench: `packages/server/src/__tests__/route-admission.bench.test.ts`, `PI_BENCH=1 PI_BENCH_LIST_ALL=84` (live `listAll()` = 84 on the operator instance, so the known set = max(30, 84) = 84). Apple-silicon macOS, Node 24, Fastify `inject`, warm-up 20, 200 sequential requests (P1/P2), real git.

| Case | Workload | p50 | p99 | 503s | Gate |
|---|---|---|---|---|---|
| P1 git status, known=1 | direct match | 26.08 ms | 82.03 ms | 0 | — |
| P1 git status, known=84 | direct match | 26.74 ms | 83.51 ms | 0 | Δp50 +0.66 ms ≤ 2 · Δp99 +1.48 ms ≤ 15 — PASS |
| P1 openspec tasks, known=1 | direct match | 0.10 ms | 0.40 ms | 0 | — |
| P1 openspec tasks, known=84 | direct match | 0.40 ms | 0.76 ms | 0 | Δp50 +0.30 ms ≤ 2 · Δp99 +0.36 ms ≤ 15 — PASS |
| P2 derivation path | sessionless worktree of a pinned repo | 92.73 ms | 283.66 ms | 0 / 200 (all 200) | 0 indeterminate — PASS |
| P3 8 concurrent derivation path | 25 rounds × 8 | 201.03 ms | 480.63 ms | 0 / 200 | recorded |
| P3 EACCES known entry, unknown cwd | 50 requests | 19.33 ms | 73.69 ms | 50 / 50 | 503 — as designed |
| P3 EACCES known entry, session cwd | 50 requests | 25.67 ms | 29.56 ms | 0 / 50 (all 200) | still admitted — as designed |

Derivation-path cost is bounded by the 3000 ms deadline; observed p99 < 0.5 s. No cache was needed (D5: a cache would have to stay request-scoped).
