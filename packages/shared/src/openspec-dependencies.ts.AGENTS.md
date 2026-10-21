# openspec-dependencies.ts — index

Pure change-dependency core.

`parseDependenciesFile` (yaml `failsafe`, `maxAliasCount: 0`, change-id grammar, reason ≤500, unknown key → invalid), `readDependenciesFile` (lstat regular-file, ≤64 KiB+1, O_NOFOLLOW; `fsImpl` seam), `serializeDependencies`, `scanProposal` (L1 labels, prose → mentions), `scanDelta` (section headers outside fences), `archivedChangeName`, `computeDependencyGraph` (merge declared>text>capability, `not_blocked_by`, resolve, Tarjan twice, Kahn waves, `overlaps`, issues).

Deterministic; never writes.

See change: add-openspec-change-dependencies.
