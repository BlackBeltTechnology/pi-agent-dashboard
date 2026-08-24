# automation-fanout.spec.ts — index

L3 fan-out E2E (test-plan F5/F6). Creates an `actions:` fan-out automation via `page.request`, fires it, and asserts the runs store + board show ONE parent occurrence expanding to TWO child rows with distinct action labels (F5); then stops the parent and asserts the whole occurrence converges to terminal (F6). Harness port via the fixtures' `baseURL` from `.pi-test-harness.json#dashboardPort` (never `:18000`). Exemplars: `session-spawn.spec.ts`, `bus-client-goal-plugin-action.spec.ts`. See change: add-automation-concurrent-spawn.
