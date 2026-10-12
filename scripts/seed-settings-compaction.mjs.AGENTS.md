# seed-settings-compaction.mjs — index

E2E-only seed: writes `compaction.keepRecentTokens` (default 1) into pi `settings.json` so a manual `/compact` finds a cut point after a few small turns — the shipped 20000 would force the replay-boundary specs to build ~80 KB transcripts. Exports pure `mergeE2ECompaction(cfg)→{cfg,changed}` (no-clobber, preserves sibling compaction keys) + `seedFile(path)` (missing→`{}`, unparseable→untouched, writes+logs only on change). Called by `docker/test-entrypoint.sh` under PI_E2E_SEED. See change: replay-compaction-boundary.
