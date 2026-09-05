/**
 * Single source of truth for the vitest worker target.
 *
 * Every parallel vitest project imports this value instead of restating
 * `"50%"` inline, so the suite's concurrency policy has one grep point and a
 * future tuning change is one edit instead of ~27. Deliberately serial
 * projects (`maxWorkers: 1`) do NOT import this module — it carries the
 * parallel default only, it is not a mandate.
 *
 * Imported by RELATIVE path from each `vitest.config.ts` on purpose: hosting
 * it in a workspace package would force a new dependency edge onto every
 * importing package (including leaf publishable ones) purely to read a
 * number. A path import adds no edge and cannot create a cycle.
 *
 * See change: make-test-suite-deterministic (design D3).
 */
export const PARALLEL_MAX_WORKERS = "50%" as const;
