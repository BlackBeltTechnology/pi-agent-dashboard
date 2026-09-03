---
session: 019f742a
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "yes — created 0 skill(s) / 3 memory(ies); large facts sheet (~17056 tok)"
upgrade_status: pending
openspec_changes: [fold-oversized-agents-directories]
proposal_excerpt: "`kb dox lint` reports 9 residual `over-threshold` issues. All are the row-count arm (`> ROW_CAP 40`), not the byte arm. Two very different shapes hide under the one `over-threshold` kind, and the lint conflates them:"
---

# How we did it: fold-oversized-agents-directories — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was the `ship-change` skill invocation: *"End-to-end land-it pipeline for
an OpenSpec change… runs **after** `openspec-apply` has implemented the code."* The
operator expected to simply **ship** the already-implemented `fold-oversized-agents-directories`
change.

The real objective surfaced within the first two turns: **the change was NOT
implemented** — the worktree branch was byte-identical to `origin/develop`, all 44
tasks unchecked. So the true job became *"actually implement the fold, then ship it"*:
fix the `kb dox lint` `over-threshold` conflation (byte-arm vs row-arm), decompose two
oversized rollup `AGENTS.md` files, and **fold ~416 flat source files** in
`components/`, `server/src/`, and `lib/` into cohesive subfolders — rewriting **2403
import specifiers** without breaking a single build, test, or type-check — then merge
`develop` and land the PR.

## 2. TL;DR playbook

1. **Verify preconditions first, don't trust the checkbox.** `git rev-parse HEAD` vs
   `origin/develop` — if identical SHA, nothing is implemented. Stop and re-scope.
2. **Fresh worktree needs `npm install`** before any build/test; the `kb` bin resolves
   from the published npm package, not the local `tsc` build (which fails on
   `node:sqlite` types — a benign pre-existing gap; vitest uses esbuild, so tests run).
3. **Implement §1 (the lint fix) first** — it's the prerequisite and the only new
   automatable behavior. Add `countInlineRows()` (excludes `→ see X.AGENTS.md` sidecar
   rows), split `over-threshold` into `bytes`/`rows` arms via an `arm` discriminator.
   TDD: write E1–E10/X1/X2 scenarios, confirm red, implement.
4. **Fix the `.worktrees/` lint blind spot**: `doxLint`'s `walkAgents` tested the
   **absolute** path against `DEFAULT_EXCLUDE` → returned 0 issues from any worktree.
   Mirror the existing cwd-relative fix at `walkFiles`.
5. **Fold each big directory with a context-aware codemod** (`ts-morph` or a
   resolve-based rewriter) that rewrites **import/export/require specifiers ONLY** —
   never bare relative string literals. Move files with `fs.renameSync` (git detects
   renames by content similarity), `git add -A` between folds to refresh the index.
6. **Gate every fold**: root `tsc --noEmit` (import safety net) → hunt **string-literal
   path refs** tsc can't see (`readFileSync`, `path.join(__dirname,…)`, allowlist test
   data-paths, `vi.mock`/`vi.importActual`) → full `npm test` → `npm run build` →
   server boot on an **alternate port** → `kb dox lint`.
7. **Merge `develop` (not rebase)** before shipping; resolve conflicts by *keeping your
   subfolder import structure + merging develop's net-new logic*; write a moveMap-aware
   fixer to rewrite develop's new flat imports to their moved targets.
8. **Ship via `ship-change`/`ship-it` inline**: archive+sync spec → commit → push → PR
   against `develop` → watch CI → squash-merge → remove worktree from the **parent**
   repo (this session runs *inside* the worktree it deletes).

## 3. How the collaboration unfolded

**Phase 1 — Precondition check (the "nothing to ship" stop).** The AI ran `git
rev-parse`, `git status`, `openspec status`. Finding: branch SHA == `origin/develop`,
0/44 tasks checked. It **refused to fabricate a ship** — printed a precondition-failure
table and stopped. *Why it worked:* honoring the skill guardrail *"never mark real work
done to force a ship"* prevented a bogus empty PR. **Decision point:** the human
redirected with `/skill:openspec-apply-change fold-oversized-agents-directories`.

**Phase 2 — Environment + §1 lint fix (TDD).** `npm install` in the fresh worktree,
confirmed the `node:sqlite` tsc gap is benign. Implemented `countInlineRows()` + the
`bytes`/`rows` arm split in `dox.ts`, wrote 11 red-first scenarios, went green (62 kb
tests). *Material discovery:* the new inline-count rule showed `components/`/`server/src/`/`lib/`
were **already at/under ROW_CAP** (their heavy rows were pre-split to sidecars) — design
D6 predicted exactly this. The AI **paused and surfaced the scope finding** via
`ask_user`. **Decision point:** human answered *"full spec, fold everything."*

**Phase 3 — Rollup decomposition (§2/§3, doc-only).** Redistributed `qa/AGENTS.md`
(54→3 rows) and `docker/AGENTS.md` (47→16) into subdir `AGENTS.md` files via scripts
that preserved every purpose string **verbatim** — safest way to move giant caveman-style
rows.

**Phase 4 — The three source folds (§4/§5/§6) + the codemod redo.** Built deterministic
keyword-based assignment maps (every bucket ≤40, cohesive domains, 0 unassigned) before
moving anything. First codemod pass had a **greedy-regex bug**: `REL_RE` rewrote bare
relative string literals in source logic (`"./"`→`".."`, path-builders) — silent
corruption tsc can't catch. The AI **hard-reset to the §3 commit and redid all three
folds** with an import-context-only codemod. Then a second narrower bug:
`vi.importActual<typeof import("…")>` — the `<[^>]*>` swallowed the type-arg, so only
outer specifiers rewrote (6 `git-api` refs, all caught by tsc). *Why it worked:* the
layered gate (tsc → string-ref hunt → npm test → build → boot) caught each class of
breakage the previous layer missed.

**Phase 5 — Merge develop + ship.** Merged (not rebased) `origin/develop` (5 commits
ahead, incl. a `view-message-store` **retirement**). 19 conflicts resolved by keeping
subfolder imports + merging develop's new logic; folded develop's 3 new root files into
subfolders; a moveMap-aware fixer rewrote 23 stale flat imports. Then `ship-it` inline:
archive+sync (`dox-directory-foldering` spec), PR **#362**, CI green (11m), squash-merge
`c37a5852e`, worktree removed from the parent repo.

## 4. Prompts that worked

- **The goal prompt (the `ship-change` skill):** good because it declared the full
  land-it contract *including its preconditions* — which is precisely what let the AI
  detect "nothing implemented" and stop instead of shipping air. A stronger kickoff
  would state the *expected* state up front: *"The change should be implemented; verify
  the branch is ahead of develop before shipping — if not, apply first."*
- **`/skill:openspec-apply-change fold-oversized-agents-directories`** — the
  high-leverage redirect. One line pivoted a stuck ship into a full implementation run.
- **`merge develop first`** (3 words) — unlocked the entire integration phase and forced
  the correct *merge-not-rebase* convention before the PR.
- **`full spec, fold everything`** (the `ask_user` answer) — decisively resolved the
  scope-reduction temptation; without it the AI might have shipped only §1–§3.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume the change was implemented and try to ship an empty branch | Redirect to `openspec-apply-change` | Kickoff prompt should say "verify branch ahead of develop; apply if not" |
| Consider narrowing scope after §1 obviated the big folds | Answer `full spec, fold everything` | State scope intent up front in the proposal; don't leave "fold everything?" implicit |
| Try to ship before integrating upstream | `merge develop first` | Make "merge develop (step 2.5)" a hard gate in the ship flow (ship-it already does) |
| Write a greedy codemod that corrupts bare string literals | (self-caught via full `npm test`) | Codemod must match **import context only**; never touch data-path strings |

## 6. Skills, tools & memory created — and why they're effective

No skills were created; **3 project memories** were saved. Two capture reusable facts:

- **The §1 inline-count insight** — `countInlineRows()` (excluding sidecar-pointer rows)
  already drops `components/`(40)/`server/src/`(5)/`lib/`(22) to/under ROW_CAP.
  *Effective because* it records the non-obvious interaction between the lint fix and the
  fold scope, so a future operator won't re-derive it.
- **The ship-it/CodeRabbit reality** — CodeRabbit **auto-skips PRs >100 files**
  (*"Review skipped: N files exceed the limit of 100"*); a huge fold (renames+sidecars =
  1580 files) gets **no review** — a size-skip, not an actionable gate. *Effective because*
  it stops a future operator from waiting on a review that will never come.

**Skill that SHOULD be created:** a **`context-aware-directory-fold`** procedure — the
repeatable "assignment-map → import-context-only codemod → layered gate (tsc → string-ref
hunt → test → build → boot) → row-migration → lint" loop. This session proved the exact
sequence and its two codemod pitfalls; it deserves to be a first-class skill.

## 7. Pitfalls & dead ends

- **Empty branch = nothing to ship.** If `git rev-parse HEAD` == `origin/develop`, the
  change isn't implemented — apply first, don't fabricate a PR.
- **`node:sqlite` tsc failure in `packages/kb` is benign** — `@types/node` v20 lacks
  sqlite types; the real `kb` bin comes from npm, and vitest (esbuild) skips type-check.
  Don't chase it.
- **`kb dox lint` returns 0 issues from any `.worktrees/` checkout** — `walkAgents`
  tested the absolute path against `DEFAULT_EXCLUDE`. Mirror the cwd-relative fix from
  `walkFiles`, or every lint-verification task silently passes.
- **Greedy codemod regex corrupts source.** Rewriting all relative string literals
  (not just import specifiers) silently mangles `"./"`, path-builders, escape checks —
  tsc can't see it. Only `npm test` (loud ENOENT) catches it. Match **import context only**.
- **`vi.mock`/`vi.importActual<typeof import("…")>`** — a `<[^>]*>` type-arg swallows the
  inner `import("…")`; rewrite both call-arg and type-arg.
- **String-literal path refs are invisible to tsc**: allowlist test data-paths
  (`packages/server/src/X.ts`), `readFileSync`/`path.join(__dirname,…)` source-reads,
  and hardcoded assertion paths all need manual per-fold updates.
- **`git mv` is picky ("bad source") and crashed the codemod mid-move.** Use
  `fs.renameSync` + `existsSync` guards; git detects renames by content at commit.
- **Removing the worktree kills your own cwd.** This session ran *inside* the worktree
  it deleted — run removal from the **parent** repo and verify via the sandbox with an
  explicit parent cwd afterward.
- **`doctor-route`/`useImagePaste` tests are flaky under full-suite parallelism** — both
  pass in isolation. Don't treat as fold breakage.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, a fresh worktree (`.worktrees/os-<change>`,
branch `os/<change>`), `gh auth status` OK, `origin` resolving.

- [ ] `git rev-parse HEAD` vs `origin/develop` — confirm branch actually has work (or apply first).
- [ ] `npm install` in the worktree; ignore the `node:sqlite` tsc gap.
- [ ] Implement the lint fix TDD-first (`countInlineRows`, `bytes`/`rows` arm) + fix the `.worktrees/` `walkAgents` path bug.
- [ ] Build deterministic assignment maps (buckets ≤40, cohesive, 0 unassigned) before moving files.
- [ ] Fold with an **import-context-only** codemod; `fs.renameSync`; `git add -A` between folds.
- [ ] Gate per fold: tsc → string-ref hunt (`readFileSync`/`path.join`/allowlists/`vi.mock`) → `npm test` → `npm run build` → server boot on alt port → `kb dox lint`.
- [ ] Migrate `AGENTS.md` rows into new subfolders (files == rows per dir).
- [ ] `merge develop` (not rebase); keep subfolder imports + merge net-new logic; moveMap-aware fixer for develop's new flat imports.
- [ ] Ship inline: archive+sync → commit → push → PR vs develop → CI → squash-merge → remove worktree **from parent**.

**Final artifacts:** PR #362 (squash `c37a5852e` on `develop`); `packages/kb/src/dox.ts`
(`countInlineRows` + arm split); ~416 source files folded across `components/`(25 subfolders),
`server/src/`(18), `lib/`(17); 2403 import specifiers rewritten; archived spec
`dox-directory-foldering`.

---

_Generated from session `019f742a-41d9-7d44-bb8a-77ac267649d4` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-18. Source extract: `/tmp/facts-fold.md`._
