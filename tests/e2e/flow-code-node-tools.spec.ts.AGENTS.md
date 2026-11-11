# flow-code-node-tools.spec.ts — index

L3 F1 (real pi-flows engine, `PI_E2E_SEED=1 PI_TEST_PEERS=both`): runs baked `e2e:tools` flow whose code node calls `git --version` via flows-plugin facade `Symbol.for("pi-dashboard.flow-tools")` (throws when absent); asserts summary `probe` node `data-status=complete` + step text `git version`. See change: add-flow-code-node-tools.
