# vitest.config.ts — index

Vitest config for repo-root /scripts project. Includes scripts/__tests__/**/*.test.mjs, node env, forks pool, maxWorkers PARALLEL_MAX_WORKERS, `testTimeout` 30_000 — harness-scoping/spec-repair tests shell out and blew the 5s default under fork contention. See change: contention-harden-real-process-tests.
