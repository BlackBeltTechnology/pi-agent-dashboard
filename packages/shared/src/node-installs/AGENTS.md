# DOX — packages/shared/src/node-installs

The Node runtime family selection module: enumerates candidate Node
installations (the "what you can pick"), writes the whole node/npm/npx
family from ONE selection atomically, and reports family coherence.
Structural exemplar: `pi-installs`.kb dox init scaffolded this file;
rows authored by the change.

| File | Purpose |
|------|---------|
| `candidates.ts` | Candidate enumeration. `enumerateNodeCandidates(deps)` → rows for EVERY location the node/npm/npx strategy chains probe (bundled `<resourcesPath>/node`, managed `<managedDir>/node`, PATH) PLUS additive version-manager roots (nvm/fnm/volta/asdf, scope decision 0.2). Per-member entry FILES (nodeEntry/npmEntry/npxEntry) probed independently — partial families surfaced, never discarded/fabricated. Version filesystem-only + optional (dir-name-encoded for vm roots); `spawn` dep is a test tripwire, never called. Module-level cache invalidated by `invalidateNodeCandidatesCache()` — wired into `ToolRegistry.rescan()`. See change: add-node-runtime-family-selection. |
| `vm-roots.ts` | THE single definition of version-manager install roots (nvm incl. nvm-windows, fnm ×2 parents, volta, asdf) + `versionFromDirName`. Design D3: consumers MUST import here so the root set cannot drift. See change: add-node-runtime-family-selection. |
| `select.ts` | Atomic family write. `planSelection` (pure — computes changes + hand-set deviations BEFORE any write; hand-set always outranks the absent-member clear, design D5) + `applySelection` (validates every entry = existing FILE inside the root, then ONE `registry.setOverrides()` — all-or-nothing). `isInsideRoot` = the containment predicate coherence reuses. See change: add-node-runtime-family-selection. |
| `coherence.ts` | Family-coherence report: `assessFamilyCoherence(registry, candidates)` — ownership by containment; mismatch names each deviating member + its root; a legitimately absent member alone is NOT a mismatch; hand-set deviations reported pre-write; `selectedCandidateKey` = migration adoption (coherent trio, display-only, D5). See change: add-node-runtime-family-selection. |
| `child-path.ts` | Selection-aware child-PATH (`prependSelectedNodeToPath`): dashboard-tooling spawns prepend the SELECTED bin dir; no selection / broken selection → byte-identical legacy managed prepend; never mutates `process.env`. pi-session spawns do NOT use this (ladder-governed); managed-tree mutations must NOT (keep managed-first). Design D7. See change: add-node-runtime-family-selection. |
| `index.ts` | Barrel: re-exports candidates/select/coherence/child-path/vm-roots surfaces. See change: add-node-runtime-family-selection. |
