# vitest.workers.ts — index

(repo root) Single source of truth for the vitest parallel worker target: exports `PARALLEL_MAX_WORKERS = "50%"`. Imported by RELATIVE path from every parallel `vitest.config.ts` (27 at adoption) — no `package.json` dependency edge. Deliberately serial projects (7, `maxWorkers: 1`) do not import it. Guard: `scripts/__tests__/vitest-workers.test.mjs`. See change: make-test-suite-deterministic.
