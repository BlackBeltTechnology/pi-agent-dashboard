---
session: 019f2ca0
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-nodescript-argv-electron-execpath-fallback]
proposal_excerpt: "`nodeScriptToArgv` (the shared `toArgv` for Node-script executors — `npm`, `pi`, `openspec`) node-wraps a `.js` entry point and, when `registry.resolve(\"node\")` fails, falls back to `process.execPath`:"
---

# How we did it: Ship the Electron `execPath` fallback fix, apply → land — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single slash-command: `/skill:openspec-apply-change
fix-nodescript-argv-electron-execpath-fallback`. The real objective: implement an
already-scoped OpenSpec change end-to-end inside its `.worktrees/` checkout — a bug
where node-wrapped spawns that fall back to `process.execPath` (the Electron binary)
lose `ELECTRON_RUN_AS_NODE=1` because the shared resolver strips it — then, on the
follow-up "Use ship-change skill", carry it all the way to a squash-merged PR against
`develop` with the worktree torn down. Two prompts, a full apply→verify→archive→ship
pipeline.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill read `proposal.md`,
   `design.md`, `tasks.md` and the context files before touching code.
2. Write the **failing test first** (Task 1), run it, confirm it goes red pre-fix —
   here a parity test proving the two env-builders diverge.
3. Implement the minimal design: **one shared predicate**
   (`electronAsNodeRequired(argv0, deps?)`) + apply it at every node-wrapped
   `execPath` spawn (`spawnWt`, `spawnHeadless`, keeper's own launch).
4. **Bootstrap the worktree** if cross-package imports resolve to the main repo:
   `npm ci` inside `.worktrees/<name>` (the `worktreeInit` hook may not have fired).
5. Verify: run YOUR tests in isolation (`HOME=$(mktemp -d) npx vitest run <files>`),
   then the full suite; **separate real breakage from parallel-load flakes** by
   re-running failing files single-threaded.
6. Gates: `openspec validate --strict`, `biome check` (fix only files you touched),
   type-check via the repo's approach (not bare `tsc --noEmit`), inline code-review.
7. Update the per-directory `AGENTS.md` rows for modified source files (`See change:`).
8. "Use ship-change skill" → archive+sync specs, commit, push, open PR vs `develop`.
9. Resolve the inevitable `develop` merge conflict (union-keep additive spec
   requirements), watch CI green, wait out CodeRabbit rate-limit, process threads.
10. Squash-merge via API (worktree blocks `gh pr merge --delete-branch`), delete
    remote branch, `git worktree remove` from the **parent** checkout.

## 3. How the collaboration unfolded

**Phase 1 — Discovery.** The AI read the apply skill, `openspec status`, then the
context + source files (`runner.ts`, `process-manager.ts`, `keeper-manager.ts`,
`binary-lookup.ts`) and existing test files to learn conventions *before* editing.
Effective because it grounded the design in the actual seam (which builder strips the
flag, which spawns hit `execPath`).

**Phase 2 — TDD implementation.** Wrote the parity test first, ran it, confirmed it
diverged pre-fix, then implemented D1 (extract `electronAsNodeRequired`) and D2 (thread
`argv0` through `buildSpawnEnv` and re-add the flag when the binary is Electron).
Guarded the keeper's own spawn independently. Absent `argv0` ⇒ byte-identical to today
— a deliberately conservative default.

**Phase 3 — Worktree bootstrap (dead end → fix).** The parity test failed because the
worktree had no local `node_modules`; cross-package imports resolved to the main repo's
*unedited* shared source. `npm ci` inside the worktree fixed it. Decision point: the AI
recognized the `worktreeInit` hook hadn't run rather than "fixing" the test.

**Phase 4 — Verify under flake noise.** Full suite showed 1 then 15 failures. The AI
re-ran failing files in isolation (`HOME=$(mktemp -d)`, single-threaded) and proved
13/15 were port-contention parallel-load flakes and 1 was a pre-existing machine-specific
isolation leak (owned by the sibling change `fix-node-electron-resolution-test-isolation`),
zero from this diff. This diagnosis is what let the operator approve proceeding on CI-green.

**Phase 5 — Ship.** Archive tripped on a `MODIFIED` delta whose requirement didn't exist
in the main spec → corrected to `ADDED`, archived, synced +1 requirement. `develop` had a
conflicting sibling change; union-kept both additive requirements — and the merge *also*
pulled in the sibling's isolation fix, resolving the earlier local red. CI green,
CodeRabbit rate-limited (waited out the window, triggered a full review, fixed 1 minor
doc finding), squash-merged, worktree removed.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change <change>`. Effective because the
  change was already fully specified (proposal/design/tasks); the slash-command hands
  the AI a bounded, test-first plan instead of an open-ended "fix the bug."
- **High-leverage follow-up** — `Use ship-change skill`. Four words that unlocked the
  entire land pipeline (archive → PR → CI → review → merge → teardown). Naming the skill
  explicitly beats "now ship it," which would have left the AI improvising the gates.

Stronger next time: state the acceptance bar in the kickoff — e.g. "apply this change;
new code's own tests must pass in isolation; a red full-suite from pre-existing
machine-specific leaks or parallel-load flakes is acceptable if CI is green."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation ("Implementation Complete") | "Use ship-change skill" | State "apply **and** ship via ship-change" in the goal prompt |
| Treat a full-suite red as a blocker | (skill guardrail: never push a red gate) — AI self-resolved by isolating flakes vs real breakage | Pre-authorize "proceed on CI-green when local red is provably pre-existing/environmental" |
| Trust the delta's `MODIFIED` label | CLI aborted; AI corrected to `ADDED` | Verify the requirement actually exists in the main spec before archiving |

Most steering here was *self-correction* — the operator gave only 2 prompts. The AI's own
discipline (isolate flakes, correct the delta op, union-merge additive specs) did the rest.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session *consumed* existing skills rather
than producing them. The reusable assets exercised:

- **`openspec-apply-change`** — turns a spec'd change into a test-first implementation
  loop with built-in scope/quality gates. Invoke when a proposal+tasks already exist.
- **`ship-change`** — the land pipeline (verify → archive+sync → PR → CI → review →
  squash-merge → worktree teardown), with the worktree-collision and merge-conflict
  pitfalls encoded. Invoke once tasks are 12/12 and you want it merged.

Recommendation: the flake-triage move (re-run failing files with `HOME=$(mktemp -d)`
single-threaded to separate port-contention flakes from real breakage) is repeatable
enough to deserve its own short skill or a `ship-change` pitfall note.

## 7. Pitfalls & dead ends

- **Worktree imports resolve to the main repo.** If a new test fails because the code
  under test looks unedited, the worktree lacks `node_modules` → `npm ci` inside it (the
  `worktreeInit` hook may not have run).
- **Full-suite reds are mostly flakes.** Server integration tests (health, doctor,
  model-proxy, event-wiring) fail under parallel load; re-run single-threaded / in
  isolation before blaming your change. One leak (`node-electron-resolution.test.ts`
  reading the real `~/.pi-dashboard/node/bin/node`) is machine-specific and green in CI.
- **`openspec archive` aborts on a mislabeled delta.** A requirement new to the main spec
  must be `ADDED`, not `MODIFIED` — fix the delta header and re-run.
- **`develop` conflict on the spec.** A sibling change appended at the same location;
  union-keep both additive requirements (don't drop either).
- **CodeRabbit "pass" can be a rate-limit ACK**, not a real review. Check for "Review
  limit reached"; wait out the window, post `@coderabbitai full review`, then process.
- **CI red after a one-line doc edit** = an unrelated client flake (`EditorFileTree.test.tsx`
  jsdom timing) — re-run the job, don't "fix" it.
- **`gh pr merge --delete-branch` fails in a worktree** (tries to switch to `develop`
  already checked out in the parent). Merge via API, delete the remote branch separately,
  then `git worktree remove` from the parent.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change>` — read proposal/design/tasks first.
- [ ] Failing test first; confirm red pre-fix.
- [ ] Minimal implementation; absent-input path stays byte-identical.
- [ ] `npm ci` inside `.worktrees/<name>` if cross-package imports look stale.
- [ ] Verify YOUR tests in isolation (`HOME=$(mktemp -d) npx vitest run <files>`); triage
      full-suite reds single-threaded.
- [ ] Gates: `openspec validate --strict`, `biome check` (touched files), repo type-check,
      inline review; update `AGENTS.md` rows with `See change:`.
- [ ] "Use ship-change skill" → archive (fix `MODIFIED`→`ADDED` if needed), commit, push,
      PR vs `develop`.
- [ ] Resolve `develop` conflict (union-keep additive specs); CI green; wait out
      CodeRabbit rate-limit; fix findings.
- [ ] Squash-merge via API; delete remote branch; `git worktree remove` from the parent.

**Key inputs:** a fully-specified OpenSpec change in `.worktrees/<name>`; GitHub auth
(`gh`) for the PR/merge; patience for the CodeRabbit rate-limit window.

**Final artifacts:** 3 edited source files (`runner.ts`, `process-manager.ts`,
`keeper-manager.ts`), 2 new tests (`spawn-env-electron-parity.test.ts`,
`keeper-electron-run-as-node.test.ts`), +1 synced spec requirement, PR #233 squash-merged
into `develop` (SHA `d67adf89`).

---

_Generated from session `019f2ca0` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-04. Source extract: facts sheet (mktemp)._
