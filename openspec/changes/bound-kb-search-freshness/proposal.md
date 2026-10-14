## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/895

`kb_search` could hang for minutes and freeze the whole pi process in a cwd with many nested worktrees (one observed call still running after 8m24s).

**Already fixed, out of scope.** The dominant root cause — descending into a gitignored dir because it carries a nested `.gitignore` — was fixed by `fix-kb-gitignore-excluded-parent` (#899). Verified on `develop`: `packages/kb/src/indexer.ts:89-91` prunes an ignored dir unconditionally, and `packages/kb/src/gitignore.ts:194` skips an ignored child before recursing (`:195`). Issue §Root cause items 1–2 no longer hold.

**Verified remaining defects:**

- No time budget. `packages/kb-extension/src/extension.ts:258` awaits `reindexNow(state, cwd)` with no bound before every `kb_search`; `kb_get`/`kb_neighbors` await `ensurePopulated` (`extension.ts:304`, `extension.ts:337`) the same way. Any pathological walk is paid in full by the caller.
- Cancellation ignored. All three tools take `_signal: AbortSignal | undefined` and never read it (`extension.ts:237`, `:298`, `:328`), so Esc cannot end the wait. Concurrent calls join the same `state.inflight` promise (`packages/kb-extension/src/reindex.ts:160-163`) and wait with it.
- The walk pins the event loop. `walk()` (`packages/kb/src/indexer.ts:84-98`) is a synchronous recursive `readdirSync` called at `indexer.ts:126`; the `setImmediate` yields happen only later, in the file loop (`indexer.ts:147-149`). A long walk blocks the whole session, not just the tool.
- The gitignore pre-scan pins it too. `loadGitignoreMatcher`'s descend phase (`packages/kb/src/gitignore.ts:176-198`) is a second synchronous recursive `readdirSync` over the same pruned tree, run at `indexer.ts:125` *before* the walk. Leaving it synchronous would leave a hole in "never freezes the session".
- The verdict rename scan pins it too. `enrichHits` runs after the search and, on the first hit with an absent subject, spawns a repo-wide `git diff HEAD --name-status -M -z` via `execFileSync` (`packages/kb/src/verdict.ts:219-237`, called at `:365`). Its cost scales with the working-tree diff, not the hit count.
- Exclusion sets diverge. `packages/kb/src/indexer.ts:43` `DEFAULT_EXCLUDE` has no `.worktrees`; `packages/kb/src/dox.ts:28` does. A `.worktrees/` that is not gitignored is still walked in full.

Provisional baseline (one warm macOS run, this repo, 2,885 files / 37,964 chunks): a warm freshness reindex costs **439–486 ms** and is paid on *every* `kb_search`, before the FTS query itself. Treat the number as indicative only — task 1.1 re-measures it (warm, cold, deep tree) before the budget default is frozen.

## What Changes

- **Time-bounded freshness.** The pull tools wait at most a freshness budget (default 1500 ms, env override `KB_FRESHNESS_BUDGET_MS`, `0` = never wait) for the reindex. On expiry the tool answers from the existing index and labels the result as possibly stale.
- **Expiry abandons the wait, not the work.** The shared in-flight reindex keeps running for the debounce path and later callers; batched commits mean its partial progress persists and becomes queryable.
- **Cancellation honoured.** `kb_search`, `kb_get`, `kb_neighbors` observe their `AbortSignal` at stage boundaries and return an aborted result instead of running to completion. Aborting a caller does not cancel the shared reindex.
- **Cooperative walk.** The directory walk *and* the gitignore pattern pre-scan that precedes it yield to the event loop periodically, so a deep or broad pathological tree no longer freezes the session (a single directory's listing remains one blocking call — see design R10).
- **Rename scan async and bounded.** The verdict enrichment's `git diff` runs via async `execFile` with a timeout and the caller's `AbortSignal`; timeout/abort degrade like a spawn failure (absent subject → `GONE`).
- **Staleness and cancellation are visible to the model.** pi describes tool-result `details` as a rendering / state-reconstruction channel and `content` as the model-facing one (`@earendil-works/pi-coding-agent/docs/extensions.md:136`, pi's package docs), so every marker this change adds lands in the tool's *text*, for all three tools.
- **`.worktrees` added to the indexer's built-in exclusion set**, aligning that one entry with the dox walk.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `kb-extension-auto-reindex` (`openspec/specs/kb-extension-auto-reindex/spec.md`) — the freshness/cold-start requirement gains a time budget and a staleness label; a new requirement covers cancellation of the pull tools.
- `markdown-knowledge-base` (`openspec/specs/markdown-knowledge-base/spec.md`) — cold-start self-population is bounded by the same budget and reports an incomplete index instead of a false-empty answer; the condensed `kb_search` output gains a single freshness status line while `json` stays a bare array.
- `kb-indexing-pipeline` (`openspec/specs/kb-indexing-pipeline/spec.md`) — the built-in exclusion set gains `.worktrees`; cooperative yielding extends from the upsert loop to the directory walk.

## Non-goals

- Making the warm reindex itself cheaper (fs-watch invalidation, cached file lists, worker-thread indexing). The budget bounds the symptom; the ~450 ms warm cost is a separate proposal.
- Cancelling an in-flight reindex. A cancelled walk restarts from scratch and would never make forward progress in a repo that always exceeds the budget.
- Converting the *other* `loadGitignoreMatcher` call sites (`packages/kb/src/dox.ts:338`, `:394`, `:553`) to the yielding variant. They run in CLI/lint paths, not in a session-blocking tool call.
- Reconciling the rest of the two exclusion sets. Only `.worktrees` is aligned here; `dox.ts`'s `DEFAULT_EXCLUDE` keeps its extra, DOX-specific entries.
- Re-litigating gitignore semantics (owned by #899).
- Bounding the `scope: "git"` path, which already has its own forge request budget and "sync in progress" notice (`openspec/specs/kb-git-forge-scope/spec.md:148`, `:243`).

## Discipline Skills

- `performance-optimization` — a latency budget is the core of the change; measure warm reindex + a synthetic deep-tree repro before/after.
- `systematic-debugging` — the issue's measurements predate #899; re-measure before trusting any number.
- `review-code` — before commit.
- No security / observability triggers: local filesystem walk, no untrusted input, no new endpoint or external call.

## Impact

- `packages/kb-extension/src/extension.ts` (three `execute` bodies), `packages/kb-extension/src/reindex.ts` (budgeted wait helper + join-in-flight), `packages/kb/src/indexer.ts` (`walk` async + `DEFAULT_EXCLUDE`), `packages/kb/src/gitignore.ts` (additive async matcher loader sharing one pure descend helper with the sync export, which stays for `dox.ts`), `packages/kb/src/verdict.ts` (async `renameBatch` with timeout + signal; `EnrichCtx.signal` optional, `EnrichCtx.git` may return a promise).
- Build artifact: editing `packages/kb/src` requires `npm run build` in `packages/kb` (`packages/kb/package.json:25`) and committing the regenerated `packages/kb/engine-fingerprint.json`; CI's `scripts/check-kb-dist-fresh.mjs` (`.github/workflows/ci.yml:167-175`) otherwise fails per `kb-retrieval-eval` "The built CLI artifact SHALL NOT lag its source" (`openspec/specs/kb-retrieval-eval/spec.md:167`).
- Compatibility: no index format or config schema change; `KB_FRESHNESS_BUDGET_MS` is additive and optional. `indexSource` stays `async` with the same signature; `walk` is internal (not exported).
- Behaviour change: a `.worktrees/` directory that is **not** gitignored stops being indexed. Any file only reachable there leaves the index via normal orphan removal on the next walk. There is no opt-out, exactly as for the existing `node_modules` / `dist` entries — `include` globs cannot re-add a pruned directory. A repo that deliberately keeps notes under `.worktrees/` must move them or configure that path as its own source.
- Behaviour change: an answer served before the freshness pass completed now carries a visible staleness line; callers that diff `kb_search` text verbatim will see it.
- Migration: none. Rollback: revert the commit — unbounded blocking freshness returns; no data migration either way.
