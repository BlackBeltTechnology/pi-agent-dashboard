# bridge-default-model-gate.ts — index

Pure predicate `shouldApplyDefaultModel({reason, entryCount, hasModelRegistry, hasDefaultModel})`. Bridge applies `config.defaultModel` only when `reason==="startup"` AND `entryCount===0`. Resume/fork/reload keep existing model. Mirrors pi `!hasExistingSession` gate. See change: fix-resume-keeps-session-model.
