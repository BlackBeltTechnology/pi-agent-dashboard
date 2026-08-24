---
session: 019e79eb
week: 2026/W22
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Rebase `configurable-chat-display` onto develop and land it CI-green — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with three words: **"Rebase to develop."** The real objective, once
the four terse steering turns played out, was larger than a mechanical rebase: take the
`configurable-chat-display` feature branch (global + per-session chat-view preferences),
**bring it current with `origin/develop`, resolve every merge conflict by hand, get the
branch CI-green, and push it** so it can be merged. That meant surviving a 7-conflict
rebase (3 doc-index files + 4 source files), then discovering and fixing a set of
**pre-existing** TypeScript lint failures that were red even before the rebase — all with
minimal human prompting.

## 2. TL;DR playbook

1. `git fetch origin develop && git rebase origin/develop` from inside the worktree. If it
   aborts on a dirty tree, `git stash` first, rebase, then `git stash pop`.
2. Resolve conflicts **file-by-file, grouped by kind**: doc-index tables first (drop
   re-introduced duplicate rows, re-insert new rows in alphabetical position, layer
   feature annotations onto existing rows), then source files (merge union types /
   handler imports, keep both sides' additions).
3. `git add -A && GIT_EDITOR=true git rebase --continue` to finish without an editor prompt.
4. For `package-lock.json`, don't hand-merge: `git checkout --theirs package-lock.json`
   then `npm install --package-lock-only`, commit as a separate `chore: regenerate lockfile`.
5. Push with **`git push --force-with-lease`** (rebase rewrote history — a plain push is rejected).
6. `monitor CI` → read `gh run` job status. **Distinguish pre-existing failures from
   rebase-introduced ones** by cross-checking the same errors on the pre-rebase commit.
7. Fix the TS errors at the **type level**, not by loosening call sites: introduce a
   `PartialDisplayPrefs` mapped type so sparse overrides typecheck; thread it through every
   consumer; add the new store methods to every mock factory.
8. `npm run lint` (= `tsc --noEmit`) until zero errors, then `npm test` to confirm no
   regressions, commit, push, and re-watch CI until all jobs are green.

## 3. How the collaboration unfolded

**Phase 1 — Rebase & conflict resolution (Discovery + Merge).** The AI fetched develop and
started the rebase, hit conflicts, listed them with `git diff --name-only --diff-filter=U`,
and worked through 7 files. The effective move was **treating doc-index tables and source
files differently**: for the `docs/file-index-*.md` tables it used small `node -e` scripts to
delete duplicate rows and splice new rows into alphabetical order rather than eyeballing
diffs; for `browser-protocol.ts` / `browser-gateway.ts` it merged the union types and handler
imports keeping both branches' additions. Decision point: the human never had to intervene in
the conflict resolution — the AI inferred intent from `git show origin/develop:<file>` and
`git show <feature-commit> -- <file>` comparisons.

**Phase 2 — Lockfile & push (Gather).** After `commit and push`, the AI regenerated
`package-lock.json` via `checkout --theirs` + `npm install --package-lock-only` (avoiding a
doomed hand-merge of a generated file), committed it separately, and force-pushed with
`--force-with-lease` because the rebase rewrote history.

**Phase 3 — CI triage (Verify).** On `monitor CI` the AI read the run's per-job matrix
(`ci` + 6 Linux smoke + 3 Windows smoke). The critical judgment call: it **cross-checked the
identical TypeScript errors against the previous CI run on the original commit** and concluded
the failures were pre-existing, not caused by the rebase. It didn't stop there — it went on to
fix them.

**Phase 4 — Type-level fix (Design + Generate).** The root cause: `DisplayPrefs.toolCalls` is
a required-full field, but the override path (`ChatViewMenu`, mock stores) legitimately carries
only a *subset*. The AI introduced a `PartialDisplayPrefs` mapped type in `display-prefs.ts`,
changed `mergeDisplayPrefs`'s signature, and threaded the type through 9 source files, then
added `getDisplayPrefs` / `setDisplayPrefs` stubs to 9 test mock `PreferencesStore` factories.
`npm run lint` reached zero errors; `npm test` confirmed 6809 pass / 19 skipped, no regressions.

**Phase 5 — Land it.** Commit, push, re-watch CI: all 10 jobs green. On `I've merged` the AI
acknowledged and stopped.

## 4. Prompts that worked

- **The goal prompt — "Rebase to develop."** Terse but unambiguous *because the context (a
  named feature worktree with a clear upstream) made the intent obvious*. It worked here; for a
  colder start, prefer **"Rebase this branch onto origin/develop, resolve all conflicts by
  hand, and get it CI-green."** so the AI knows the finish line is green CI, not a clean rebase.
- **"monitor CI"** — high-leverage. Two words unlocked full `gh run` matrix reading *plus* the
  pre-existing-vs-introduced failure analysis and the decision to fix. The AI treated "monitor"
  as "diagnose and fix", which was the right read.
- **"commit and push"** — trusted the AI to pick `--force-with-lease` and a sensible split
  (lockfile as its own `chore:` commit). Worked because the AI understood rebase history rewrite.

## 5. Steering & corrections (what to watch for)

There were **no corrections** — every one of the 4 prompts moved the work forward and none
redirected a wrong turn. That itself is the lesson: a well-scoped worktree + a clear upstream
lets a 3-word prompt drive a 2-hour, 7-conflict, cross-file type-refactor. Still, bake these in:

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Interpret "rebase" as the full land-it goal (correct here) | nothing — it inferred it | State the finish line up front: "…and get it CI-green" |
| Read "monitor CI" as "diagnose + fix" | nothing — it fixed | Say "monitor and fix any failures" when that's what you want |
| Potentially blame the rebase for red CI | nothing — it cross-checked | Ask it to compare against the pre-rebase commit before assigning blame |

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session. The workflow is nonetheless repeatable and
worth a skill. **Recommended skill: `rebase-and-land-worktree`** capturing:

- The doc-index-vs-source conflict-resolution split (node-script row splicing for tables).
- The `checkout --theirs` + `npm install --package-lock-only` lockfile regeneration pattern.
- The **pre-existing-vs-rebase-introduced** CI triage (cross-check errors on the base commit).
- The type-level fix discipline: fix the *type* (`PartialDisplayPrefs`) instead of loosening
  every call site, and remember mock factories must implement every new store-interface method.

Invoke it whenever a feature worktree needs to catch up to `develop` and land CI-green.

## 7. Pitfalls & dead ends

- **Dirty-tree rebase abort.** `git rebase origin/develop` failed on uncommitted changes →
  `git stash` first, rebase, `git stash pop`.
- **Hand-merging `package-lock.json`.** A generated lockfile with conflict markers is a trap
  → `git checkout --theirs package-lock.json && npm install --package-lock-only`, don't edit it.
- **Plain `git push` rejected after rebase.** History was rewritten → use `--force-with-lease`
  (safer than `--force`; refuses if the remote moved under you).
- **Blaming the rebase for red CI.** The TS lint errors looked like rebase fallout but were
  pre-existing → always cross-check the same errors on the original commit before "fixing the rebase".
- **Fixing types at call sites.** The tempting quick fix (cast/loosen each `ChatViewMenu` and
  mock) multiplies. The durable fix was one mapped type (`PartialDisplayPrefs`) threaded through
  9 files + 9 mock factories.
- **`rebase --continue` opening an editor.** Use `GIT_EDITOR=true git rebase --continue` in a
  headless/agent context.

## 8. Reproduce it faster — checklist

- [ ] From the worktree: `git fetch origin develop && git rebase origin/develop` (stash if dirty).
- [ ] Resolve conflicts: doc-index tables (dedupe + alphabetical splice via `node -e`) then
      source (merge union types / imports, keep both sides).
- [ ] `git add -A && GIT_EDITOR=true git rebase --continue`.
- [ ] Lockfile: `git checkout --theirs package-lock.json && npm install --package-lock-only`,
      commit separately.
- [ ] `git push --force-with-lease`.
- [ ] Watch CI (`gh run`); cross-check any failure against the pre-rebase commit.
- [ ] Fix TS at the type level (`PartialDisplayPrefs`); add new store methods to every mock.
- [ ] `npm run lint` → 0 errors; `npm test` → no regressions; commit, push, re-watch CI to all-green.

**Inputs to have ready:** write access to the feature worktree + `origin`, `gh` authenticated
for CI reads. **Final artifacts:** rebased branch `configurable-chat-display` at `94934a3f`,
lockfile commit `ffaa2340`, all 10 CI jobs green (run 26692638808); edited files
`display-prefs.ts`, `browser-protocol.ts`, `browser-gateway.ts`, `ChatView.tsx`,
`ChatViewMenu.tsx`, `App.tsx`, `types.ts`, `docs/file-index-{client,server,shared}.md`, plus
9 mock `PreferencesStore` factories.

---

_Generated from session `019e79eb-5456-7fc2-81c6-77e5ec51691a` · `pi-agent-dashboard/.worktrees/configurable-chat-display` · 2026-05-30. Source extract: `/tmp/facts-PG7GPx`._
