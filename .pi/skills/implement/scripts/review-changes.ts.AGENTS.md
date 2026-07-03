# implement/scripts/review-changes.ts — index

Implementation-phase advisory CodeRabbit review gate. Default `-t uncommitted`; passthrough passthrough flags (e.g. `-t committed --base main`). Skips on `SKIP_CR_REVIEW=1`/`--no-review`. Parses NDJSON via `parseFindings`/`splitFindings`, prints Critical/Warning count + summaries. Warn-and-continue: exits 0 on missing CLI/auth/rate-limit (defers). Worktree-safe, server-independent.
