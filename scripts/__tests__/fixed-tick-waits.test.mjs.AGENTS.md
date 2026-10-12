# __tests__/fixed-tick-waits.test.mjs — index

Guard tests + vitest wrapper for `check-fixed-tick-waits.mjs` (test-plan E10-E14, P3, X5): barrier detection incl. resolve/reject param names and helper scope, test-file-only scope, per-occurrence opt-out (E11) that never waives a later barrier (E12), real client census = 0 violations (E13), spawn exit-code contract with the file named on stderr (E14), < 2 s census wall-clock (P3), standalone-step/wrapper agreement (X5). Fixtures in `mkdtemp` outside the repo, cleaned in `afterAll`. See change: make-test-suite-deterministic.
