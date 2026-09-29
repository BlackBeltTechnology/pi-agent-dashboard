# __tests__/e2e-fixme-guard.test.ts — index

Repo-lint (change: stabilize-browser-e2e, task 4.1; design D5): every CONDITIONAL `test.fixme(<cond>, "<reason>")` under `tests/e2e/` must link `/issues/<n>` — quarantine hides regressions. The unconditional `test.fixme("title", body)` form is allowed. Exports `unlinkedFixmes(source)`; unit fixtures cover reject/accept/unconditional, plus a whole-tree scan.
