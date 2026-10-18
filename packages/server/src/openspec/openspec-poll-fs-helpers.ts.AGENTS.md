# openspec-poll-fs-helpers.ts — index

Pure FS helpers extracted from `directory-service.ts` so worker imports without pulling SessionManager / PreferencesStore coupling. Exports `statMtimeOr`, `effectiveMtimeOr`, `perChangeArtifactPaths`. `directory-service.ts` re-exports `effectiveMtimeOr` for back-compat. See change: offload-openspec-poll-to-worker.

`probeTrackedPaths({openspecDir, extras})` async bounded (`mapLimit` 64): cwd-level set (`openspec/`, `changes/`, `config.yaml`, all under `schemas/`) + per change legacy set (+`.openspec.yaml`) + `extras.files` + dirs beneath `globPrefixes`; enumerates `changes/*` (no `archive`/dot-dirs); missing paths skipped. Types `ProbeRequest`/`ProbeResponse`. Sync `perChangeArtifactPaths`/`effectiveMtimeOr` stay for the fallback path. See change: use-openspec-status-all.
