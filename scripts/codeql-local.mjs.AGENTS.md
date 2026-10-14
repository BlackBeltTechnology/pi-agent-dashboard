# codeql-local.mjs — index

Local CodeQL ratchet. Blocks NEW code-scanning alerts at ship time. Used by `ship-it` step 4.4 (`--check-baseline-diff origin/develop`, static) and step 4.4b (analysis). Root script `npm run codeql`.

Flow: snapshot → `database create` + `database analyze` per language (`javascript-typescript`, `actions`) → SARIF → keys (rule + file + `primaryLocationLineHash`) → compare with root `codeql-baseline.json`.

Modes: default analyse (`--json`) · `--prune` · `--accept <rule> <file> <lineHash> --reason <text>` · `--triage …` · `--write-baseline` (seed) · `--check-baseline-diff <ref> [--no-growth]`. Exit 0 pass/skipped · 1 new alerts or growth violation · 2 error.

Snapshot: copy of the worktree index → `git add -A` → drop baseline → `git write-tree`. Tree id = snapshot id. Real index/worktree untouched. Unmerged entries → exit 2. Materialized with `git checkout-index`. State dir `$TMPDIR/pi-codeql/<sha1 toplevel>/`: `lock/owner.json` (pid + `ps` start time; stale lock taken over), `last-run.json` `{snapshotId, counts, results}`, `run-<pid>/` (src, `db-<lang>`, SARIF).

Shared config: `.github/codeql/codeql-config.yml` `paths-ignore` → `LGTM_INDEX_FILTERS` (`exclude:<glob>`, trailing `/**` dropped, newline-joined). Offline-safe: no `--codescanning-config`, no `--download`; `resolve queries` before `pack download` (60 s). Any result in an ignored path → exit 2.

Skip vs error: no `codeql` / packs unobtainable → stderr `CODEQL SKIPPED: <cause>`, exit 0. `CODEQL_BIN` set but not executable → exit 2. CLI version ≠ header → `CODEQL WARNING:`. `database create` exit 32 (no source of that language) → no results. `CODEQL_BIN` is the test seam (`__tests__/fixtures/fake-codeql.mjs`).

Baseline: `version: 1`, header `codeql` + `packs`, entries `{ruleId, file, lineHash, count, reason}`. Reasons: `untriaged` · `operator-authz: …` (3 preset rules only) · `false-positive: …` · `accepted-risk: …` · `github-dismissed (#n, reason): …`. Written sorted + trailing newline (`serializeBaseline`). `untriaged` never grows per rule+file; headless uses `--no-growth`. Seed gate `SEED:`/exactness vs last run.

Exports (pure, tested): `resultKeys`, `countResults`, `validateBaseline`, `reasonError`, `serializeBaseline`, `ratchetDecision`, `baselineGrowth`, `pruneBaseline`, `acceptEntry`, `globToRegExp`, `matchingIgnoreGlob`, `indexFilters`, `sarifPackVersions`. IO: `snapshotId`, `takeSnapshot`, `stateDir`, `acquireLock`, `processStartTime`, `main`. Constants `SEED_PACKS` (only place pack versions are written besides baseline headers), `LANGUAGES`.

Measured (task 2.5, develop d739f4bd, CLI 2.27.2, packs cached, 8 threads): full run ~85-90 s wall; `.mjs` (289) and `.cjs` (14) files extracted; results carry `primaryLocationLineHash`; `LGTM_INDEX_FILTERS` exclusions verified by the real-CLI test (#E4); offline run with cached packs verified (#X6); `js/path-injection` count identical (100) with and without the cwd-guard model pack.

Known limit: local ≠ GitHub on same commit (150/179 matched); see `openspec/changes/archive/2026-10-14-add-local-codeql-ratchet/evidence/local-vs-github.md`.

See change: add-local-codeql-ratchet.
