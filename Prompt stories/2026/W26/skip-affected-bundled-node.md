---
session: 019f1041
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (8 user prompts); large facts sheet (~11847 tok)"
upgrade_status: pending
openspec_changes: [unify-node-version-gate, skip-affected-bundled-node]
proposal_excerpt: "The nodejs/node#58515 affected-version range and the engines-cap range are encoded three times across the repo, and the copies have already drifted:"
---

# How we did it: Unify the Node-version gate — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a validation request, not a build request:

> "Current proposal is: skip-affected-bundled-node. The code improved a lot from the creation with this spec. Validate proposal"

The *real* objective only crystallized after two steering turns. Validating the old
`skip-affected-bundled-node` proposal exposed that it had **drifted from the tree** —
tasks marked `[x]` were never landed (superseded by a later redesign), and worse, a
genuine bug was hiding underneath: the Node "affected version" predicate was encoded
**three times** across `server`, `electron`, and `shared`, and the copies had already
diverged (`minor < 18` in one place vs `minor < 19` in the canonical guard). The true
goal became: **archive the stale change, then hoist one canonical Node-version
predicate into `shared` so the drift can never recur — and make 24/25 explicitly
usable.** That work became the new `unify-node-version-gate` change, implemented,
reviewed, rebased, and shipped end-to-end in one session.

## 2. TL;DR playbook

1. **Validate the incumbent proposal against the actual tree**, not just its schema:
   `openspec validate <change> --strict` passes ≠ the code matches. Grep for each
   claimed symbol; build a "proposal says vs. actual code" table.
2. **Archive the superseded change with `--skip-specs`** when its spec-delta still
   describes deleted code — applying it would corrupt the live spec.
3. **Ground the redesign in a survey** — grep every Node-version gate across packages,
   confirm the dependency direction (both `server` + `electron` already depend on
   `shared`), *then* scaffold the new change with `openspec new change`.
4. **Write the proposal so it names the real fix**: one source of truth in
   `packages/shared/src/node-version.ts` (`isAffectedNode`, `isOutOfEnginesRange`,
   `isUsableNodeVersion`), imported by both consumers. Validate `--strict` clean.
5. **Apply via `/skill:openspec-apply-change`**: create the shared module, re-export
   from the barrel, rewire consumers to import it, delete the drifted inline copies.
6. **Verify in the worktree with a throwaway aliased vitest config** — worktree
   `node_modules` symlinks the *main* checkout's `shared`, so a brand-new file isn't
   visible via the package specifier until you `npm install` in the worktree or alias
   `shared` to the worktree-local source.
7. **Self-review the diff** when CodeRabbit is rate-limited; keep imports surgical
   (revert any `organizeImports` that reorders a pre-existing block).
8. **Commit → rebase onto `origin/develop` → `/skill:ship-change`**: PR, watch CI,
   wait out CodeRabbit's rate window, auto-apply its one real finding, re-rebase on
   every `DIRTY` merge state, squash-merge, clean up worktree from the **parent** repo.

## 3. How the collaboration unfolded

**Phase 1 — Validate & disprove (Discovery).** The AI ran `openspec validate --strict`
(green) but refused to stop there: it grepped for `bundledNodeVersion`,
`isBundledNodeAffected`, and the `kind:"system"` picker branch the proposal claimed,
and found none in the tree. It produced a task-by-task "proposal says vs. actual code"
table showing tasks 1/2/4 were checked but never landed, and surfaced the real bug —
`isVersionAffected` (`< 18`) drifting from canonical `isAffectedNode` (`< 19`).
*Why it worked:* schema-valid ≠ code-true; the grep-per-claim discipline is what caught
the drift.

**Phase 2 — Archive the superseded change.** On "archive", the AI chose
`openspec archive --skip-specs` **deliberately**, explaining that the spec-delta still
described the deleted `kind:"system"` picker and syncing it would corrupt the live
`bundled-node-runtime` spec. It preserved the one surviving artifact's `See change:`
tag. *Decision point:* the human said only "archive" — the AI supplied the `--skip-specs`
judgment and flagged the still-live drift bug.

**Phase 3 — Ground, then design.** On "create proposal and able to use 24 and 25 too",
the AI first surveyed every Node-version gate and confirmed the dependency direction,
*then* scaffolded `unify-node-version-gate` with `openspec new change`, wrote proposal +
design + two spec-deltas, and validated `--strict` clean. It was also honest that 24.3+
and 25.x were *already* accepted — the real defect was the opposite (a 22.18 false-accept).

**Phase 4 — Apply (implement).** Via `/skill:openspec-apply-change`: new
`node-version.ts`, barrel re-export, `node-guard.ts` and `dependency-detector.ts` both
rewired to the shared gate, drifted inline copy deleted, `isUsableNodeVersion` hardened
to reject unparseable strings, tests across all three packages, docs delegated to a
subagent in caveman style, CHANGELOG entry. 14/14 tasks, `--strict` clean.

**Phase 5 — Verify under worktree constraints.** The first test run failed because the
worktree's `node_modules/@blackbelt-technology/pi-dashboard-shared` symlinks to the
*main* checkout, so the new file was invisible via the specifier. The AI diagnosed this
as a known worktree-resolution limitation (not a code bug) and proved correctness with a
**throwaway aliased vitest config** pointing `shared` at the worktree-local source —
green across all three packages, no committed change.

**Phase 6 — Review & ship.** "review" → manual self-review (CodeRabbit rate-limited)
caught a dual import/export, lost cap-history comments, and an over-eager import reorder.
"rebase to develop" → clean rebase. "Use ship-change skill" → PR #189, CI green, then a
long CodeRabbit rate-limit dance: wait out the window, `@coderabbitai full review`,
auto-apply its one real finding (prefix-regex looseness letting `22.19.0.1` slip
through), re-rebase on every `DIRTY`/conflict, squash-merge, worktree cleanup.

## 4. Prompts that worked

- **Goal prompt — "Validate proposal" (with the hint "the code improved a lot").** The
  hint that the code had moved was what licensed the AI to check the *tree*, not just the
  schema. A stronger version: *"Validate this proposal against the current code, not just
  `openspec validate` — flag any task marked done that isn't actually in the tree."*
- **"archive"** — one word, but the AI correctly inferred `--skip-specs` from the
  superseded-spec context. Bake the reasoning in: *"archive; skip-specs if the delta
  describes removed code."*
- **"create proposal and able to use 24 and 25 too"** — a scope expansion that both set
  the goal and the accept-set. Effective because it named the concrete versions.
- **"review" / "rebase to develop" / "Use ship-change skill"** — high-leverage
  single-verb handoffs that delegated whole skills; they worked because the AI already
  had full context loaded from authoring the change.
- **"it seems stuck"** — unblocked a rebase paused on a blocking editor; a good reminder
  that a stalled `git rebase --continue` often just opened `$EDITOR`.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust `openspec validate --strict` as proof the code matches | Implicitly, via "the code improved a lot" — prompting a tree check | State up front: validate against the tree, grep each claimed symbol |
| Stop after archiving without addressing the live drift bug | (AI self-flagged; human redirected to "create proposal … 24 and 25") | Treat a drift finding as an action item, not a footnote |
| Overstate the fix ("now supports 24/25") | AI self-corrected: 24.3+/25.x were already accepted | Verify the *actual* accept-set before claiming a behavior change |
| Let Biome `organizeImports` reorder a whole pre-existing block | Surgical-changes rule → revert to a +1-line insertion | Only auto-fix imports on lines you added; never a committed-unsorted block |
| Assume test failures were its own | Re-ran failing files in isolation to prove flakes vs. real | Isolate suspicious failures before blaming your diff |
| Get stuck on a blocking `git rebase --continue` editor | "it seems stuck" → continue with a no-op editor (`GIT_EDITOR=true`) | Use `GIT_EDITOR=true git rebase --continue` in scripted flows |

Quality bars the human imposed implicitly: don't corrupt live specs (→ `--skip-specs`),
keep diffs surgical, and don't merge on a rate-limited CodeRabbit ACK — wait for a real
review.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session, but three existing skills carried the
weight and one **new skill is worth creating**:

- **`/skill:openspec-apply-change`** — drove the 14-task implementation; effective
  because it kept task/verify discipline (mark `[x]` only after tests green).
- **`/skill:ship-change`** — owned the PR→CI→review→merge→cleanup loop, including the
  rate-limited-CodeRabbit and rebase-on-DIRTY sub-loops.
- **Subagent (`general-purpose`)** — delegated the caveman-style doc-index row edits,
  honoring the AGENTS.md "docs are delegated" rule.

**Recommended new skill: `verify-worktree-cross-package-change`.** It would capture the
one non-obvious move that cost the most time: a brand-new file in `packages/shared` is
invisible to sibling packages in a worktree until you either `npm install` in the
worktree or run vitest with a throwaway config aliasing `shared` → the worktree-local
`src`. Invoke it whenever a change adds a file to a shared package and you need to test a
consumer inside a `.worktrees/` checkout.

## 7. Pitfalls & dead ends

- **Worktree symlink resolution.** New `packages/shared` file not seen by `server`/
  `electron` tests → *fix:* `npm install` in the worktree (CI's real behavior) or a
  throwaway `vitest.config` with `resolve.alias` mapping `pi-dashboard-shared` to the
  worktree-local `src`.
- **`openspec archive` on a superseded change.** Default sync would corrupt the live
  spec → *fix:* `--skip-specs` when the delta describes deleted code.
- **Biome `organizeImports` over-reach.** Auto-fix reordered a whole pre-existing block
  → *fix:* revert; keep the import change to the single line you added.
- **Non-deterministic server-test flakes under full-suite load** (`elapsed 3744 < 3000`,
  5s timeouts, perf smoke) → *fix:* re-run the file in isolation with an ephemeral `HOME`;
  they pass unstarved. Don't chase them as regressions.
- **The one *real* red test** (`recommended-routes` 15 vs 18) was **upstream staleness**,
  not your diff → *fix:* re-fetch and rebase onto the latest `origin/develop` tip.
- **PR stuck with no CI run** → `mergeStateStatus=DIRTY` means a conflict with an
  advanced `develop`, not a dropped webhook → *fix:* rebase, resolve (union-keep both
  independently-added spec requirements), force-push.
- **Blocking `git rebase --continue`** opened `$EDITOR` and hung → *fix:*
  `GIT_EDITOR=true git rebase --continue`.
- **`--delete-branch` / `worktree remove` from inside the worktree** kills the session's
  own cwd → *fix:* do branch/worktree cleanup from the **parent** repo (`git -C <parent>`
  or the sandbox executor).
- **CodeRabbit "pass" can be a rate-limit placeholder**, not a review ("Review limit
  reached… next in 55 minutes") → *fix:* verify a real walkthrough/inline comments exist;
  wait out the window and post `@coderabbitai full review`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the incumbent change name; a clean worktree on a branch based
off `origin/develop`; `gh` auth; the parent repo path for cleanup.

**Steps:**
1. `openspec validate <change> --strict`, then grep each claimed symbol in the tree —
   build the says-vs-actual table.
2. If superseded and its delta describes deleted code: `openspec archive <change> --skip-specs -y`.
3. Grep every Node-version gate; confirm `server`+`electron` depend on `shared`;
   `openspec new change unify-node-version-gate`.
4. Write proposal + design + spec-deltas naming the single-source module; validate `--strict`.
5. `/skill:openspec-apply-change unify-node-version-gate` — new `packages/shared/src/node-version.ts`,
   barrel re-export, rewire both consumers, delete drifted inline copies, harden parser.
6. Test in-worktree: `npm install` in the worktree **or** a throwaway vitest config
   aliasing `shared` → worktree-local `src`. All three packages green.
7. Self-review; keep imports surgical; delegate doc rows to a subagent (caveman style).
8. Commit (archive + feature as two logical commits) → rebase onto `origin/develop`.
9. `/skill:ship-change` → PR, watch CI, wait out CodeRabbit rate-limit, auto-apply real
   finding, re-rebase on every `DIRTY`, squash-merge, clean up from the parent repo.

**Final artifacts produced:**
- `packages/shared/src/node-version.ts` (+ barrel export, + test)
- rewired `packages/server/src/node-guard.ts`, `packages/electron/src/lib/dependency-detector.ts`
- archived `openspec/changes/archive/2026-06-29-unify-node-version-gate/`
- synced requirements in `doctor-diagnostic` + `server-startup-node-version-guard` specs
- PR #189, squash-merged to `develop` as `ae492319`

---

_Generated from session `019f1041-2667-7913-8e79-52a2f584128e` · `pi-agent-dashboard` · 2026-06-29. Source extract: `facts.t9rEebW48R.md`._
