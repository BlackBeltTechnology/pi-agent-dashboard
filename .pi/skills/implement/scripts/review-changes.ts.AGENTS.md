# implement/scripts/review-changes.ts — index

PR-time CodeRabbit ship gate (advisory, OPT-IN). Skips by default → points to `review-code` discipline (dev inner loop, unlimited engine). Opt in via `RUN_CR_REVIEW=1` or `--ship`. Passthrough flags (e.g. `-t committed --base main`); default `-t uncommitted`. Parses NDJSON via `parseFindings`/`splitFindings`, prints Critical/Warning count + summaries. Warn-and-continue: exits 0 on missing CLI/auth/rate-limit (defers). Worktree-safe, server-independent.
