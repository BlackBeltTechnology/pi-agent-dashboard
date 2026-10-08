# bridge-default-model-gate.ts — index

Pure predicate `shouldApplyDefaultModel({reason, entryCount, hasModelRegistry, hasDefaultModel, hasExplicitModel})` + pure `hasExplicitModelArg(argv)` (exact-token `--model` match on pi's own argv). Explicit `--model` dominates — the default never overrides the spawner's resolved choice. → see `bridge-default-model-gate.ts.AGENTS.md`
