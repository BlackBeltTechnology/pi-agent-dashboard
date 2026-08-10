# openspec-poll-fs-helpers.ts — index

Pure FS helpers extracted from `directory-service.ts` so worker imports without pulling SessionManager / PreferencesStore coupling. Exports `statMtimeOr`, `effectiveMtimeOr`, `perChangeArtifactPaths`. `directory-service.ts` re-exports `effectiveMtimeOr` for back-compat. See change: offload-openspec-poll-to-worker.
