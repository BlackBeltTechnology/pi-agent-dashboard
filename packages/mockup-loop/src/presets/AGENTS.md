# DOX — packages/mockup-loop/src/presets

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `contract.ts` | DTCG contract loader. `loadContract(id)` reads bundled presets-data/<id>/contract.tokens.json, asserts DTCG via `isDtcg`. `refreshContract(id)` re-fetches upstream (token systems only; rule-pack throws). `rubricPath`/`contractPath`/`PRESETS_DATA_DIR` resolvers. UPSTREAM_SOURCES map. See change: add-selectable-design-systems. |
| `registry.ts` | Design-system preset registry. `DesignSystemPreset` type (id,label,platform,substrate,contractSource,minTouchTarget,spacingScale,validators[]). 5 v1 presets: shadcn,mui,material-3,fluent-2,apple-hig. `listPresets`/`getPreset`/`resolvePreset` (rejects unknown id without throw). See change: add-selectable-design-systems. |
| `validators.ts` | Layered validators. `runL1` token-lint (built-in raw-hex scan, gate for bundled systems), `runL2` a11y floor (inline WCAG contrast scan + axe-if-present, hard gate), `runL3` named-system auditor (shell-out-if-present via `isToolAvailable`, advisory), `runL4` boolean rubric (score=pass/N in code, advisory), `validateMockup` orchestrator returns {gates,advisory,pass}; pass gate-only. Inline WCAG `contrastRatio`/`parseHex`. See change: add-selectable-design-systems. |
