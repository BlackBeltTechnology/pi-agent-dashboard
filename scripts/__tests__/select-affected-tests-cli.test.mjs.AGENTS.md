# __tests__/select-affected-tests-cli.test.mjs — index

Temp-git-repo + child-process CLI tests: rename both sides, deletion → package fallback, PR merge-base (E20/E21); all-zero / non-ancestor / missing base → full (X3–X5); forced throw → full, exit 0, `enumerated:false` (X2); summary audit (E32); `verify-executed` (X6/X7); `check-result` decision table (X8); `assigned.mjs`. See change: speed-up-ci-affected-tests.

Budget lane (E17, E18, E20–E22, X9, X10): strict `verify-executed … budget` (zero assertions / skipped / pending / todo / uncollected file fail, `unit-1` unaffected), empty lane green, `assigned.mjs budget` on a fallback selection, and a real selector run in a fixture workspace (`node_modules/.cache/budget-selector-fixtures`): repeat runs equal apart from `graphMs`, budget files in no PR list. See change: stabilize-blocking-test-lanes.
