# __tests__/vitest-workers.test.mjs — index

Guard over the vitest worker consolidation (test-plan E15-E17, P1): no config restates the parallel target as a literal (allowed values: `1`, `PARALLEL_MAX_WORKERS`), ≥27 configs import the shared module, serial projects declare `maxWorkers: 1` and do NOT import it, all importers use relative specifiers and no `package.json` references the module, and every config still resolves to its pre-consolidation worker count via a live config-import census. See change: make-test-suite-deterministic.
