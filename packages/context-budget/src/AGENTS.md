# DOX — packages/context-budget/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `analyze.ts` | Pure payload accounting — no pi, no network, no fs, so budget assertions run in CI against a stored capture. Exports `analyzePayload` (bytes split system/tools/messages, per-tool schema cost, per-skill catalogue cost), `comparePayloads` (added/removed tools+skills, byte deltas, `unmetExpectations`), `checkBudget` (limit violations), `formatReport`/`formatDelta`. `systemBlocks()` attributes `skills-catalogue`/`project-context`/`memory-policy` and absorbs the rest into `other` so parts ALWAYS sum to the whole — a matcher that silently stops matching shows up as `other` growing, never as bytes vanishing. `systemText()` handles `system` as string OR array-of-text-blocks. |
| `index.ts` | Public entry. Re-exports the `analyze.ts` surface (functions + types). Deliberately does NOT export `meter.ts` — that is a pi extension entry, loaded by pi, not imported by consumers. |
| `meter.ts` | pi extension. `before_provider_request` → capture payload once per session → write `{capturedAt, dropped, breakdown}` JSON. Observes only (returns undefined; returning a value would REPLACE the provider payload). `session_start` + `CONTEXT_BUDGET_DROP` optionally calls `setActiveTools()` to measure a trim without editing config — proven to remove schemas from the wire AND prune the system prompt's `Available tools` list. Structural `MeterApi` type instead of importing `ExtensionAPI`, since the pi SDK is an optional peer. Env: `CONTEXT_BUDGET_OUT`, `CONTEXT_BUDGET_DROP`. |
