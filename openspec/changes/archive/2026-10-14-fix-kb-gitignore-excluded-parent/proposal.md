## Why

The kb index is ~1.8× over the ~22,000-chunk corpus the search latency budget is specified against (≈39k chunks / 98 MB at drafting time). 1,522 of those chunks (576 files) are **gitignored Electron build output** — `packages/electron/out/**` and `packages/electron/resources/server/**` — indexed as `source-md` duplicates of real package docs (e.g. `browser/references/web.md` indexed twice, 164 chunks each). Besides the size, the copies crowd real hits out of result pages.

Root cause is in `packages/kb/src/gitignore.ts` + the walks that use it, not in config:

- Walks prune an ignored directory only when `!hasDeeperGitignore(dir)` ("conservative pruning", fix-dox-lint-blind-rows design D3). The Electron bundles contain vendored plugins that carry their own `.gitignore` files, so the ignored parent is descended.
- Inside it, the file check `isIgnored(file)` extends a pattern to ancestor dirs only when the pattern is `dirOnly` or unanchored. The root patterns here are anchored and not `dirOnly` (`packages/electron/out`, `packages/electron/resources/server`), so they never match a file below them — every file passes.

Git's actual rule (gitignore(5)): *"It is not possible to re-include a file if a parent directory of that file is excluded."* Git never reads a `.gitignore` inside an excluded directory. Verified empirically: root `vendored/` + `vendored/.gitignore` with `!keep.md` → `git check-ignore` reports `vendored/keep.md` ignored. The archived test **E15** asserts the opposite and encodes non-git behaviour.

`kb dox lint` is masked by hardcoded `DEFAULT_EXCLUDE` entries in `dox.ts` (`out`, `bundled-extensions`, `electron/resources/server`); the indexer's `DEFAULT_EXCLUDE` has none of those and relies on gitignore — so the indexer leaks.

## What Changes

- **Excluded-parent rule**: a path is ignored when any ancestor directory is ignored — including ancestors above the walk root; negations (in any `.gitignore`, at any depth) cannot re-include it. Implemented in the matcher's verdict so `isIgnored` / `isIgnoredDir` are correct standalone.
- **File patterns match the file path only**: the ancestor extension of `dirOnly` / unanchored patterns in file mode is dropped (the excluded-parent rule now owns directory exclusion). Fixes a second divergence: `*` + `!*/` (or `*` + `!foo`) currently un-ignores files git ignores.
- **Unconditional pruning**: walks (indexer `walk`, dox `walkFiles`/source/agents walks) skip an ignored directory without consulting `hasDeeperGitignore`.
- **Nested `.gitignore` files inside an excluded directory are not loaded** (git never reads them), so their patterns cannot leak into verdicts.
- `hasDeeperGitignore` becomes unused by the walks; removed from the `GitignoreMatcher` interface if no other caller remains.
- **E15 inverted** to git semantics (both `keep.md` and `other.md` ignored); a new indexer-level regression mirrors the Electron shape (anchored root dir pattern + vendored nested `.gitignore` with a negation).
- Existing indexes self-heal: the next walk no longer sees the files and the existing orphan-removal step deletes their chunks/nodes/properties. No migration.

Out of scope: chunk-count reduction beyond the leaked artifacts (scenario-level chunk folding, change/research exclusions) — separate proposal; removing the now-redundant hardcoded entries in `dox.ts` `DEFAULT_EXCLUDE` (they still cover untracked noise; left untouched).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `kb-indexing-pipeline`: the source walk honours gitignore with git's excluded-parent rule (adds a requirement; the walk requirement previously did not mention gitignore).
- `markdown-knowledge-base`: "The md walk SHALL honour gitignore" gains the excluded-parent scenario; nested negation inside an excluded directory no longer re-includes.

## Impact

- `packages/kb/src/gitignore.ts` — verdict ancestor check, descend-phase skip of excluded dirs.
- `packages/kb/src/indexer.ts` (`walk`), `packages/kb/src/dox.ts` (three walk sites) — drop the `hasDeeperGitignore` guard.
- `packages/kb/src/__tests__/gitignore.test.ts`, `kb.test.ts` — E15 inverted, new regressions.
- `packages/kb/src/AGENTS.md` — `gitignore.ts` / `indexer.ts` rows.
- Behaviour change: any repo that relied on a nested negation re-including a file under an ignored dir loses it from the index — matching what `git status` would show as untracked/ignored (tracked-file override remains a non-goal). Scope: `.gitignore` files only — `.git/info/exclude` and `core.excludesFile` stay unread (unchanged). In this repo no negation-bearing `.gitignore` sits under an ignored dir — reproduce: `find . -name .gitignore -not -path '*/node_modules/*' -not -path './.worktrees/*' | xargs grep -l '^!'` → root, `.pi/`, `.pi/npm/`, `packages/client/src/generated/`, `packages/memory-eval/fixtures/hermes-golden/`; for each, `git check-ignore --no-index` on the dir's PARENT-level patterns finds no excluded ancestor (note: `git check-ignore -q <dir>/` — trailing slash — applies the dir's own `*` line to the dir itself, a check-ignore quirk; slashless `-q <dir>` reports not ignored; the dir's contents stay tracked, e.g. `generated/plugin-registry.tsx`).
- Expected effect here: −576 files / −1,522 chunks on next reindex; `git check-ignore` over indexed paths → 0.
- Rollback: revert the commit; next reindex re-adds the files.

## Discipline Skills

- `systematic-debugging` — root cause already reproduced (matcher probe + `git check-ignore` cross-check); keep the evidence-first loop if the fix misbehaves.
- `doubt-driven-review` — reverses an archived design decision (D3 conservative pruning / E15); stress-test against real git before it stands.
- `review-code` — before commit.
- No security / performance-budget / observability triggers: local file walk, no untrusted input, no new runtime path.
