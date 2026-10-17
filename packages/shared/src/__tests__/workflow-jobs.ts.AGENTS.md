# __tests__/workflow-jobs.ts — index

Test helper: line-based GitHub Actions job slicing. Exports `jobIds(yaml)` (2-space keys under column-0 `jobs:`), `jobBlock(yaml, id)` (key line → next job or column-0 line; `""` when absent). No YAML dep. Used by `e2e-browser-workflow-contract.test.ts`, `e2e-fixme-guard.test.ts`. See change: close-e2e-tooling-followups.
