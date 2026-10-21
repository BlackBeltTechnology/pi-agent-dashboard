# codeql-local.mjs — index

Local CodeQL ratchet. Blocks NEW code-scanning alerts at ship time. Used by `ship-it` step 4.4 (`--check-baseline-diff origin/develop`, static) and step 4.4b (analysis). Root script `npm run codeql`.

Flow: snapshot → `database create` + `database analyze` per language (`javascript-typescript`, `actions`) → SARIF → keys (rule + file + `primaryLocationLineHash`) → compare with root `codeql-baseline.json`.

Modes: default analyse (`--json`) · `--prune` · `--accept <rule> <file> <lineHash> --reason <text>` · `--triage …` · `--mirror-dismissal <rule> <file> <lineHash> --alert <n>[,<n>…]` · `--write-baseline` (seed) · `--check-baseline-diff <ref> [--no-growth]`. Exit 0 pass/skipped · 1 new alerts or growth violation · 2 error.

Snapshot: copy of the worktree index → `git add -A` → drop baseline → `git write-tree`. Tree id = snapshot id. Real index/worktree untouched. Unmerged entries → exit 2. Materialized with `git checkout-index`. State dir `$TMPDIR/pi-codeql/<sha1 toplevel>/`: `lock/owner.json` (pid + `ps` start time; stale lock taken over; no start time → stale after 30 min), `last-run.json` `{snapshotId, headCommit, clean, counts, results, baselineHash?}` (`clean` = `git status --porcelain` empty bar the baseline file), `run-<pid>/` (src, `db-<lang>`, SARIF).

Shared config: `.github/codeql/codeql-config.yml` `paths-ignore` → `LGTM_INDEX_FILTERS` (`exclude:<glob>`, trailing `/**` dropped, newline-joined). Offline-safe: no `--codescanning-config`, no `--download`; `resolve queries` before `pack download` (60 s). Any result in an ignored path → exit 2.

Skip vs error: no `codeql` / packs unobtainable → stderr `CODEQL SKIPPED: <cause>`, exit 0. `CODEQL_BIN` set but not executable → exit 2. CLI version ≠ header → `CODEQL WARNING:`. `database create` exit 32 (no source of that language) → no results. `CODEQL_BIN` is the test seam (`__tests__/fixtures/fake-codeql.mjs`).

Baseline: `version: 1`, header `codeql` + `packs`, entries `{ruleId, file, lineHash, count, reason}`. Reasons: `untriaged` · `operator-authz: …` (3 preset rules only) · `false-positive: …` · `accepted-risk: …` · `github-dismissed (#n[, #m…], false positive|won't fix|used in tests): …` (written only by `--mirror-dismissal`). Written sorted + trailing newline (`serializeBaseline`). `untriaged` never grows per rule+file; headless uses `--no-growth`. Seed gate `SEED:`/exactness vs last run.

Model pack (JS analysis only): snapshot `.github/codeql/extensions/*.model.yml` → `<run>/model-pack/` + manifest `pi-dashboard/local-models`; `--additional-packs=<dir> --model-packs=pi-dashboard/local-models`; `resolve extensions` rowCount per file must equal data rows (any failure exit 2, never a skip); `--json` `versions.models` = sha256 of the files in sorted order. No model files → no flags.

`--mirror-dismissal`: refuses with any other mode flag; needs recorded clean run at HEAD with baseline hash; entry reason `operator-authz|false-positive|accepted-risk`; one alert per result; per alert `gh api repos/<o>/<r>/code-scanning/alerts/<n>` (`PI_CODEQL_GH_BIN`, `PI_CODEQL_GH_TIMEOUT_MS` default 15000) must be dismissed, same rule/file/commit=HEAD, one shared reason, start-line multiset = recorded. Origin parsed by strict `parseGithubRemote` (github.com only). Re-binds the run hash only when it matched the pre-write baseline.

Exports (pure, tested): `parseGithubRemote`, `MODEL_PACK`, `resultKeys`, `countResults`, `validateBaseline`, `reasonError`, `serializeBaseline`, `ratchetDecision`, `baselineGrowth`, `pruneBaseline`, `acceptEntry`, `globToRegExp`, `matchingIgnoreGlob`, `indexFilters`, `sarifPackVersions`. IO: `snapshotId`, `takeSnapshot`, `stateDir`, `acquireLock`, `processStartTime`, `main`. Constants `SEED_PACKS` (only place pack versions are written besides baseline headers), `LANGUAGES`.

Local ≠ CI note: the model now applies on both sides (quoted types); `cwd-guard` is no longer ruled out as a cause by evidence from before that fix. See change: codeql-model-pack-and-mirror.

Measured (task 2.5, develop d739f4bd, CLI 2.27.2, packs cached, 8 threads): full run ~85-90 s wall; `.mjs` (289) and `.cjs` (14) files extracted; results carry `primaryLocationLineHash`; `LGTM_INDEX_FILTERS` exclusions verified by the real-CLI test (#E4); offline run with cached packs verified (#X6); `js/path-injection` count identical (100) with and without the cwd-guard model pack.

Baseline binding: `baselineHash` = sha256(`serializeBaseline(parsed)`) — canonical, formatting/order-insensitive. Plain run records hash of baseline its verdict used; seed re-records hash of written baseline. `requireFreshRun(cwd, baseline)`: mismatch → exit 2 "baseline changed since the recorded run; re-run the analysis first"; hashless (legacy) record → `CODEQL NOTE:` on stderr, proceeds. `--prune`/`--accept` re-bind via `rebindLastRun` after write. `--triage` re-binds only when record hash = pre-triage baseline hash (no laundering); no record → none written.

Known limit: local ≠ CI. Post-switch measured cause (`ce50677ee`): local-only 29 = explicit `--threat-model=remote` (fetch-response sources); 29 plugin-server results lost both sides = shared `paths-ignore` `**/__tests__/**`. Evidence: change `harden-codeql-ratchet-followups` `evidence/local-vs-ci.md`; pre-switch: archived `add-local-codeql-ratchet/evidence/local-vs-github.md`.

See change: add-local-codeql-ratchet, harden-codeql-ratchet-followups.
