# __tests__/select-affected-tests.test.mjs — index

Pure `decide()`/`assignShards()`/`extractLocations()` over a synthetic index — test-plan E1–E19, E22–E27: global inputs, graph, open edge (incl. the test file itself), always-run, path literal, package fallback, trigger map, covered-elsewhere, unmapped → full, slow tier applied last, packaging flag, gated/real-process routing, LPT balance + median for unknown timing, determinism. See change: speed-up-ci-affected-tests.

Budget routing (E13–E16): `isBudgetFile` name table, a budget file in the index never reaches shards/real-process/ci-scenarios in affected or full mode, `budgetFiles` sorted in every mode, `unenumeratedFull` budget list, `scanGatedFiles`/`scanBudgetFiles` on a temp git repo. See change: stabilize-blocking-test-lanes.
