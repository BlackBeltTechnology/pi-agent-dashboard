# select-affected-tests.mjs — index

Affected-test selector CLI (change: speed-up-ci-affected-tests). `--base <ref> [--merge-base] [--head]` or `--full [--reason]`, `--out selection.json`, `--cwd`. Resolves the diff (`test-selection/git-diff.mjs`), builds the test index (`test-selection/graph.mjs`), runs `decide()`, writes `selection.json` + `$GITHUB_STEP_SUMMARY` (`renderSummary`: mode, reason, per-layer counts, unmapped/leaf-error/open-edge/slow-tier lists, no-timing share) + `$GITHUB_OUTPUT` (`mode`, `has_real_process`, `ci_scenarios`). EVERY failure → `mode: full`, exit 0; enumeration failure → `enumerated: false` (`unenumeratedFull`; workflows fall back to `--shard`, gated files by source scan). Test hook `SELECT_AFFECTED_TEST_THROW=1`.

`loadData(dir)` throws on a missing/malformed `triggers.json` / `covered-elsewhere.json` / `slow-tier.json` → `mode: full` naming the file (review B1); only `timings.json` may be absent. Test hook `SELECT_AFFECTED_DATA_DIR`.
