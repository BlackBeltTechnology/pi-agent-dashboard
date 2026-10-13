## 0. Baseline (before any code change)

- [ ] 0.1 From the repo root, capture on this checkout: total chunk count (`sqlite3 .pi/dashboard/kb/index.db "select count(*) from chunks"`), the 3.1 pipeline count (expected 576, with the same git guards as 3.1), and the `kb dox lint` finding count. Record them in the PR description; §3 compares against these, not the drafting-time numbers.

## 1. Tests first (red) — folded from test-plan.md

- [ ] 1.1 (test-plan #E1) in `gitignore.test.ts` invert the E15 unit and rename its title to the excluded-parent rule; drop `hasDeeperGitignore` assertions. Triple: root `vendored/` + `vendored/.gitignore` `!keep.md` · `isIgnored` on `vendored/keep.md`, `vendored/other.md` · both `true` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.2 (test-plan #E2) anchored root pattern from a nested walk root. Triple: root `packages/electron/out` + `packages/electron/out/a/.gitignore` `!*.md`, walk root `<tmp>/packages` · `isIgnored("electron/out/a/b/x.md")`, `isIgnoredDir("electron/out")` · both `true` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.3 (test-plan #E3) dir-only negation. Triple: root `*` then `!*/` · `isIgnored("docs/x.md")`, `isIgnoredDir("docs")` · `true`, `false` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.4 (test-plan #E4) unanchored name negation. Triple: root `*` then `!foo` · `isIgnored("foo/bar.md")`, `isIgnoredDir("foo")` · `true`, `false` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.5 (test-plan #E5) walk root inside an ignored dir. Triple: root `packages/electron/out`, walk root `<tmp>/packages/electron/out/app` · `isIgnored("z.md")` · `true` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.6 (test-plan #E6) root-level file negation under an ignored parent. Triple: root `vendored/` then `!vendored/keep.md` · `isIgnored("vendored/keep.md")` · `true` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.7 (test-plan #E7) `!dir/` is prune-only. Triple: root `foo/**` then `!foo/` · `isIgnored("foo/x.md")`, `isIgnoredDir("foo")` · `true`, `false` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.8 (test-plan #E8) own-dir allowlist stays selected. Triple: `gen/.gitignore` `*`, `!.gitignore`, `!plugin-registry.tsx` · `isIgnoredDir("gen")`, `isIgnored("gen/plugin-registry.tsx")`, `isIgnored("gen/other.ts")` · `false`, `false`, `true` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.9 (test-plan #E9) dirOnly never matches a file. Triple: root `out/`; regular file `out` vs file `out/x.md` (separate fixtures) · `isIgnored` on each · `false`, `true` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.10 (test-plan #E10) ancestor depth boundary. Triple: A `a/` + `a/b/c/d/e.md`; B `a/b/c/d/` + `a/b/c/x.md`, `a/b/c/d/x.md` · `isIgnored` on each · A `true`; B `false`, `true` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.11 (test-plan #E11) E13 regression (dir + content negation) unit and dox assertions. Triple: existing E13 fixture · existing assertions · pass unchanged — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.12 (test-plan #E12) E16 regression. Triple: existing 25-row E16 table + negation row · `patternMatches(pattern, rel)` · every expected value unchanged, table not edited — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.13 (test-plan #E13) memo / query-order independence. Triple: combined E1+E2+E8 fixture · two fresh matchers, all paths queried forward vs reversed · identical verdict arrays — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.14 (test-plan #E14) parity vs real git (skip when `git` absent; POSIX). Triple: E1-E10 fixtures after `git init`, `.git/info/exclude` truncated, env `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1` · per FILE path `git -c core.excludesFile=/dev/null check-ignore --no-index -q <path>` (exit 0 ignored / 1 not; never `-v`, never `<dir>/`; do not let the exec wrapper throw on exit 1) vs `isIgnored` · equal for every path — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.15 (test-plan #X1) loader TDZ guard. Triple: ignored `vendored/` holding its own `.gitignore` · `loadGitignoreMatcher(tmp, { cwd: tmp })` · no throw (no `ReferenceError`), `isIgnored("vendored/x.md")` `true` — exemplar: `packages/kb/src/__tests__/gitignore.test.ts` (E13/E15 units, L90-118).
- [ ] 1.16 (test-plan #E15) invert dox E15 and rename its title. Triple: E1 fixture as dox tree · `kb dox lint` · no `missing` for `vendored/keep.md` nor `vendored/other.md` — exemplar: `packages/kb/src/__tests__/kb.test.ts` (`dox: gitignore-aware walks`, L1014-1060).
- [ ] 1.17 (test-plan #E16) tracked file still reported. Triple: same tree + non-ignored `docs/notes.md` without an AGENTS.md row · `kb dox lint` · a `missing` finding for `docs/notes.md` — exemplar: `packages/kb/src/__tests__/kb.test.ts` (`dox: gitignore-aware walks`, L1014-1060).
- [ ] 1.18 (test-plan #E17) indexer Electron-shape regression (see E14 indexer test L1043). Triple: E2-shaped tree with `.md` under `packages/electron/out/` and `packages/docs/`, `.git/` marker · `indexSource` with `src.dir = <tmp>/packages`, `cwd: <tmp>` · stored paths include `docs/…`, zero `electron/out/…` — exemplar: `packages/kb/src/__tests__/kb.test.ts` (`dox: gitignore-aware walks`, L1014-1060).
- [ ] 1.19 (test-plan #E18) orphan self-heal. Triple: E17 tree WITHOUT the root pattern, indexed once · append `packages/electron/out` to root `.gitignore`, index again · `electron/out/…` gone from files/chunks/nodes/properties; `stats.deleted` equals their count — exemplar: `packages/kb/src/__tests__/kb.test.ts` (`dox: gitignore-aware walks`, L1014-1060).
- [ ] 1.20 (test-plan #E19) opt-out regression. Triple: E17 tree · `indexSource` with `respectGitignore: false` · `electron/out/…` paths present — exemplar: `packages/kb/src/__tests__/kb.test.ts` (`dox: gitignore-aware walks`, L1014-1060).

## 2. Implementation

- [ ] 2.1 `gitignore.ts` `verdictFor`: ancestor-excluded short-circuit over absolute ancestors from the shallowest set base down (design D1), memoized dir verdicts, `/`-normalized paths; ancestor checks consider only sets based at/above the ancestor.
- [ ] 2.2 `gitignore.ts` `matches`: file mode = `pat.dirOnly ? false : pat.re.test(rel)` (design D1) — remove the dirOnly (`:131`) and unanchored (`:134`) ancestor extensions (D1); `patternMatches` = any ancestor matches in dir mode OR path matches in file mode, so E16 is unchanged.
- [ ] 2.3 `gitignore.ts` loader `scan`: skip descending into a dir ignored by sets loaded so far (D3). Move `verdictFor` + memo ABOVE `scan(walkRoot)` first (TDZ — design D3); test each child dir in the parent loop BEFORE recursing, so an excluded dir's own `.gitignore` is never parsed.
- [ ] 2.4 `indexer.ts` `walk` and `dox.ts` walk sites (3): prune on `isIgnoredDir(rel)` alone (D2).
- [ ] 2.5 Remove `hasDeeperGitignore` + `nestedBases` if no caller remains (`rg hasDeeperGitignore packages/*/src`); update header comment (drop "conservative pruning", state excluded-parent rule).
- [ ] 2.6 `cd packages/kb && npm test` green; typecheck with `cd packages/kb && node ../../scripts/tsc7.mjs -p tsconfig.json --noEmit`.

## 3. Verify on this checkout

- [ ] 3.1 (test-plan: manual-only, #M1) From the repo root, reindex the project kb; `sqlite3 .pi/dashboard/kb/index.db "select root||'/'||path from files" | GIT_CONFIG_GLOBAL=/dev/null git -c core.excludesFile=/dev/null check-ignore --no-index --stdin | wc -l` → `0` (source labels equal repo-relative dirs here); chunk count drops by ≈1,522 vs the 0.1 baseline; `kb dox lint` finding count unchanged or reduced vs 0.1 — investigate any increase.
- [ ] 3.2 (test-plan: manual-only, #M2) `tsx packages/kb/eval/run-fixtures.ts` — no retrieval regression (duplicates removed may only improve).

## 4. Docs

- [ ] 4.1 `packages/kb/src/AGENTS.md`: update `gitignore.ts` row (excluded-parent rule, file-path-only file matching, no conservative pruning) and `indexer.ts` row; `See change: fix-kb-gitignore-excluded-parent`.
