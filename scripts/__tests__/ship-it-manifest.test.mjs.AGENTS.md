# __tests__/ship-it-manifest.test.mjs — index

Vitest unit tests for ship-it `manifest.ts` (`.pi/skills/ship-it/scripts/`). parseManifest (well-formed / malformed / no-disposition-column → skip), deferDecision (all-manual→defer, non-manual→stop, id-ref resolve, no-manifest→legacy keyword fallback), filesystemRealityCheck (automated missing file → unsatisfied; manual-only never gated). See change: add-openspec-pipeline-orchestrators.
