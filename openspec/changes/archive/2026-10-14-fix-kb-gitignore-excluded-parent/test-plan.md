# Test Plan — fix-kb-gitignore-excluded-parent

Stage: design   Generated: 2026-10-13

Fixture convention (all L1 rows): temp dir with a `.git/` marker at its root, matcher/indexer called with `cwd: <tmp>`. Unit rows live in `packages/kb/src/__tests__/gitignore.test.ts`; dox/indexer rows in `packages/kb/src/__tests__/kb.test.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | kb-indexing-pipeline: Nested negation cannot re-include | decision-table (dirOnly root × nested file negation) | L1 | automated | root `.gitignore` `vendored/`; `vendored/.gitignore` `!keep.md`; files `vendored/keep.md`, `vendored/other.md` | `loadGitignoreMatcher(tmp).isIgnored(...)` on both | both `true` (E15 inverted) |
| E2 | kb-indexing-pipeline: Ignored directory containing nested .gitignore files is pruned | decision-table (anchored non-dirOnly × nested walk root × vendored .gitignore) | L1 | automated | root `.gitignore` `packages/electron/out`; `packages/electron/out/a/.gitignore` `!*.md`; file `packages/electron/out/a/b/x.md` | matcher on walk root `<tmp>/packages`, `isIgnored("electron/out/a/b/x.md")`, `isIgnoredDir("electron/out")` | both `true` |
| E3 | kb-indexing-pipeline: Directory-only negation does not re-include files | decision-table (bare `*` × dirOnly negation) | L1 | automated | root `.gitignore` `*` then `!*/`; file `docs/x.md` | `isIgnored("docs/x.md")`, `isIgnoredDir("docs")` | `true`, `false` |
| E4 | design D1 file mode path-only | decision-table (bare `*` × unanchored name negation) | L1 | automated | root `.gitignore` `*` then `!foo`; file `foo/bar.md` | `isIgnored("foo/bar.md")`, `isIgnoredDir("foo")` | `true`, `false` |
| E5 | kb-indexing-pipeline: Source directory inside an ignored directory | state (walk root position: inside ignored dir) | L1 | automated | root `.gitignore` `packages/electron/out`; file `packages/electron/out/app/z.md` | matcher on walk root `<tmp>/packages/electron/out/app`, `isIgnored("z.md")` | `true` |
| E6 | kb-indexing-pipeline: Nested negation cannot re-include (root-level form) | decision-table (dirOnly × same-file root negation) | L1 | automated | root `.gitignore` `vendored/` then `!vendored/keep.md`; file `vendored/keep.md` | `isIgnored("vendored/keep.md")` | `true` |
| E7 | design D1 E13 note (`!dir/` prune-only) | decision-table (trailing `/**` × dir negation) | L1 | automated | root `.gitignore` `foo/**` then `!foo/`; file `foo/x.md` | `isIgnored("foo/x.md")`, `isIgnoredDir("foo")` | `true`, `false` |
| E8 | proposal Impact: own-dir allowlist stays selected | decision-table (own-base `*` × file negation) | L1 | automated | `gen/.gitignore` `*`, `!.gitignore`, `!plugin-registry.tsx`; files `gen/plugin-registry.tsx`, `gen/other.ts` | `isIgnoredDir("gen")`, `isIgnored("gen/plugin-registry.tsx")`, `isIgnored("gen/other.ts")` | `false`, `false`, `true` |
| E9 | design D1 dirOnly never matches a file | BVA (same name, file vs dir) | L1 | automated | root `.gitignore` `out/`; file `out` (regular file) in one fixture, file `out/x.md` in another | `isIgnored("out")`, `isIgnored("out/x.md")` | `false`, `true` |
| E10 | kb-indexing-pipeline: any ancestor directory ignored | BVA (depth of ignored ancestor) | L1 | automated | fixture A root `.gitignore` `a/`, file `a/b/c/d/e.md`; fixture B root `.gitignore` `a/b/c/d/`, files `a/b/c/x.md`, `a/b/c/d/x.md` | `isIgnored` on each | A: `true`; B: `false`, `true` |
| E11 | kb-indexing-pipeline: Negation of the directory itself keeps it | decision-table (E13 regression) | L1 | automated | existing E13 fixture (`skills/openspec-*/**`, `!skills/openspec-shared/**`, `!skills/openspec-shared/`) | existing E13 unit + dox assertions | pass unchanged |
| E12 | design D1 `patternMatches` keeps E16 meaning | decision-table (E16 regression) | L1 | automated | existing 25-row E16 table + negation row | `patternMatches(pattern, rel)` | every row's expected value unchanged; table file not edited |
| E13 | design D3 memo validity | state (query order) | L1 | automated | E1+E2+E8 combined fixture with sibling subtrees | two fresh matchers; query all fixture paths forward on one, reversed on the other | verdict arrays identical |
| E14 | contract: matcher ≡ git check-ignore | parity oracle | L1 | automated | E1–E10 fixtures, `git init`, `.git/info/exclude` truncated, env `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1` | per FILE path: `git -c core.excludesFile=/dev/null check-ignore --no-index -q <path>` (exit 0 ignored / 1 not; never `-v`, never `<dir>/`) vs `isIgnored` | equal for every path; suite skipped when `git` absent |
| E15 | markdown-knowledge-base: Negation inside an ignored directory does not re-include | decision-table (dox E15 inverted) | L1 | automated | E1 fixture as a dox tree | `kb dox lint` (runDoxLint) | no `missing` finding for `vendored/keep.md` nor `vendored/other.md` |
| E16 | markdown-knowledge-base: Tracked file is still reported | regression | L1 | automated | same tree plus non-ignored `docs/notes.md` with no AGENTS.md row | `kb dox lint` | a `missing` finding for `docs/notes.md` |
| E17 | kb-indexing-pipeline: Ignored directory containing nested .gitignore files is pruned | integration (indexer walk) | L1 | automated | E2-shaped tree with `.md` files under `packages/electron/out/` and one under `packages/docs/` | `indexSource` with `src.dir = <tmp>/packages`, `cwd: <tmp>` | stored paths contain `docs/…` and zero `electron/out/…` |
| E18 | kb-indexing-pipeline: Newly ignored files leave the index | state-transition (indexed → ignored) | L1 | automated | E17 tree WITHOUT the root pattern | index once; append `packages/electron/out` to root `.gitignore`; index again | second run: `electron/out/…` paths absent from `files`, chunks, nodes, properties; `stats.deleted` equals their count |
| E19 | kb-indexing-pipeline: Opt-out still indexes ignored files | decision-table (respectGitignore=false) | L1 | automated | E17 tree | `indexSource` with `respectGitignore: false` | `electron/out/…` paths present |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design D3 ordering hazard | fault (load-order / TDZ) | L1 | automated | ignored dir `vendored/` holding its own `.gitignore`, loader consults verdict during `scan` | `loadGitignoreMatcher(tmp, { cwd: tmp })` | returns without throwing (no `ReferenceError`); `isIgnored("vendored/x.md")` `true` |

### Manual verification

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | proposal Impact (live index self-heal) | checkout verification | — | manual-only | this repo's `.pi/dashboard/kb/index.db`, baseline captured before change | from repo root: reindex; `sqlite3 … "select root\|\|'/'\|\|path from files" \| GIT_CONFIG_GLOBAL=/dev/null git -c core.excludesFile=/dev/null check-ignore --no-index --stdin \| wc -l`; chunk count; `kb dox lint` count | `0` ignored paths; chunks ≈1,522 below baseline; dox lint findings not increased [checkout-specific — not a repeatable fixture] |
| M2 | proposal Why (result quality) | eval run | — | manual-only | `packages/kb/eval/run-fixtures.ts` baseline vs after | `tsx packages/kb/eval/run-fixtures.ts` | no metric regression vs baseline [corpus-dependent judgment] |

---

## Coverage summary

- Requirements covered: 10/10 spec scenarios (kb-indexing-pipeline 7, markdown-knowledge-base 3) + design D1/D3 invariants
- Scenarios by class: edge 19 · perf 0 · frontend 0 · error 1 · manual 2
- Scenarios by level: L1 20 · L2 0 · L3 0
- Scenarios by disposition: automated 20 · manual-only 2
- Performance: none — no perf requirement (design D1: indexer walk not on a latency budget).

## New infra needed

- none
