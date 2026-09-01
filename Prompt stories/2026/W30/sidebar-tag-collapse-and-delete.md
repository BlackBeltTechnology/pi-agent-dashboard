---
session: 019f8757
week: 2026/W30
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~10235 tok)"
upgrade_status: pending
openspec_changes: [sidebar-tag-collapse-and-delete]
proposal_excerpt: "The sidebar `YOUR TAGS` filter group renders every user tag as an always-visible, wrapping chip row. As tag count grows the group eats vertical sidebar height, and there is no way to delete a tag that is no longer wan…"
---

# How we did it: Sidebar tag collapse & delete — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator dropped a single kickoff: the **`ship-it`** skill, invoked from inside the
change's git worktree (`.worktrees/os-sidebar-tag-collapse-and-delete`). The literal
first prompt was the skill body itself — "Orchestrates the **implementation phase** of an
OpenSpec change **inside its git worktree**… Runnable headless." The *real* objective:
take the already-planned OpenSpec change `sidebar-tag-collapse-and-delete` from empty
worktree to a squash-merged PR — implement the feature (collapse an ever-growing sidebar
tag list behind a master toggle + add per-tag global delete), TDD it across
protocol→server→client, validate with the docker E2E harness, run it through
`ship-change` (CI + CodeRabbit), and land it. The only steering turn was a single
`continue` ~10h later — the human paused the run at the irreversible merge boundary, then
resumed it. This was an almost fully autonomous, headless orchestration.

## 2. TL;DR playbook

1. **Start inside the worktree**, invoke `ship-it`. First move is always *filesystem
   reality* — read `tasks.md`, `design.md`, `proposal.md`; then grep for the change's
   scenario markers to prove nothing is implemented yet (test files may be base
   exemplars from a sibling change, not this one).
2. **Merge `origin/develop` first** (ship-it step 2.5) — cheaper to integrate before you
   write lots of code.
3. **TDD each layer red-first**: add the protocol verb (`remove_tag_globally`), write the
   L1 handler tests, confirm they FAIL, then implement `handleRemoveTagGlobally` + wire
   the gateway switch, confirm GREEN.
4. **Split the frontend scenarios by test level**: pure-render observables (overflow cap,
   remove≠toggle, phase read-only, keyboard) → **component tests (RTL)**; true
   integration (persistence, collapsed indicator, cancel/delete round-trip) → **L3
   Playwright**. Don't force deterministic render checks through the slow harness.
5. **Distinguish your failures from pre-existing ones** — when the full vitest run is red,
   `git stash push -u` and re-run the suspect suites on the CLEAN base; only own the
   failures that disappear when your change is stashed.
6. **Run the docker harness that bakes local source** (`docker compose -f docker/compose.yml
   build` → `PI_E2E_SEED=1 PI_TEST_PEERS=both ./docker/test-up.sh -d`), poll health on the
   derived port from `.pi-test-harness.json`, run the spec in attach mode, **always tear
   down** before touching the worktree.
7. **Drive `ship-change` inline**: archive+sync specs → commit → push → PR → watch CI →
   wait for CodeRabbit → treat every review comment as an *untrusted report*, verify each
   against the code, apply-or-reject-with-reason → merge only when CI green + no actionable
   threads.
8. **Stop at the merge boundary if the human wants a checkpoint.** The destructive steps
   (squash-merge, branch delete, worktree removal) are the one place to hand control back.

## 3. How the collaboration unfolded

**Phase 1 — Orient (filesystem reality).** The AI read the planning artifacts, then
grepped for `remove_tag_globally`/`handleRemoveTagGlobally` to confirm the test files were
base exemplars from `add-session-tags`, not this change's scenarios. *Why it worked:*
ship-it gates on filesystem truth, not the tasks.md checkboxes — it proved "fresh run"
before writing a line. It also merged `origin/develop` up front (already up to date at that
point).

**Phase 2 — TDD the backend.** Protocol edit (`remove_tag_globally { tag }` into
`BrowserToServerMessage`) → L1 tests added and confirmed **red (5 fail)** → implement
`handleRemoveTagGlobally` (normalize → no-op on blank → `listAll()` fan-out → one
`session_updated` per carrier) → wire the gateway switch → **green (20/20)**. *Why it
worked:* strict red-before-green on every handler leaves no untested path.

**Phase 3 — Build the client + split tests by level.** `removeTagGlobally` sender;
`TagChip` destructive filter-chip ✕ (user-tone only); `TagFilterGroup` overflow cap +
`+N more`; `SessionList` master collapse (default-collapsed, persisted, count + active
indicator); `TagDeleteConfirmDialog` reusing `Dialog.Action intent="danger"`. Decision
point: the AI split pure-render scenarios into **component tests** and reserved Playwright
for genuine integration — far more robust than pushing everything through the harness.

**Phase 4 — Separate signal from noise in the test run.** The full suite showed ~29
failures. The AI `git stash`-ed its changes and re-ran the suspects on the clean base,
proving `image-fit`/`send-types`/`doctor-route`/`useImagePaste` were **pre-existing** and
only 8 `SessionList` failures were its own (the tag area is now default-collapsed, hiding
chips the old filter tests expected). Minimal fix: seed the tag-area-open state in those
tests' `beforeEach`.

**Phase 5 — Harness validation.** Built the docker image baking worktree source (~5 min),
brought the all-in-one harness up on derived port 18842, polled health, ran the L3 spec.
2 of 5 failed on a **substring selector collision** (`getByRole(name: "Remove tag X")` also
matched the sidebar chip's `"Remove tag X from all sessions"`); fixed with `exact: true`.
All 5 green, harness torn down cleanly.

**Phase 6 — ship-change + the merge checkpoint.** Archived + synced specs, committed,
opened PR #387, CI passed. The human's one steering turn landed here: the AI **stopped
before merge** (CodeRabbit was rate-limited, merge is irreversible), surfaced the decision,
and waited ~10h. On `continue`, it triggered the now-unblocked CodeRabbit review (8
actionable comments), verified each against the code, **applied 4 / rejected 4 with
reasons**, handled a `DIRTY` mergeable state (develop advanced → import-block + AGENTS.md
conflicts, resolved by dedup + union-keep), got CI green on the merged tree, passed the 8.5
archive gate, then squash-merged, deleted the remote branch, and removed the worktree.

## 4. Prompts that worked

- **The goal prompt (the skill itself).** Invoking `ship-it` from inside the worktree is
  the entire kickoff — the skill carries the phase graph, the boundary contract, and the
  headless-runnable wiring. *Effective because* the operator delegated an 11-hour multi-
  phase pipeline with one call and trusted the skill's gates.
- **`continue`** — the single high-leverage follow-up. After the AI parked at the merge
  boundary, `continue` unlocked the whole tail: CodeRabbit round, conflict resolution, CI
  round 2, merge, cleanup. *Effective because* the skill had already surfaced exactly what
  "continue" would do (the irreversible steps), so one word was an informed authorization.
- **Stronger version to reuse:** if you want it fully autonomous, say up front
  *"run ship-it end to end including the merge; only stop if CI is red or CodeRabbit has an
  unresolved actionable thread."* If you want the checkpoint, say *"stop before the
  squash-merge and show me the PR state."* Either removes the 10h ambiguous pause.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Halt at the irreversible merge boundary and wait | Reply `continue` to authorize the destructive steps | State the merge policy in the kickoff ("merge when green" vs "stop before merge") |
| Treat a rate-limited CodeRabbit as a real review gate | (self-corrected) recognized the ACK-not-review pitfall and waited for the real run | Encode "rate-limited CodeRabbit = ACK, not a pass" in the ship skill (already noted) |
| Blame its own change for a red full-suite run | (self-corrected) `git stash` + re-run suspects on clean base | Always isolate pre-existing failures before owning any |
| Use a substring role selector that collided across two chips | (self-corrected) `exact: true` on the header ✕ | Prefer `exact: true` / test-ids when two aria labels share a prefix |

The human imposed effectively one quality bar — *don't merge without a human look when
the review gate hasn't genuinely run* — and the AI honored it by stopping.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was an **execution** of the
existing `ship-it` orchestrator (which composes `openspec-apply-change`, the docker
harness, and `ship-change`). The reusable assets already exist:

- **`ship-it`** — captures the worktree implementation phase end-to-end: filesystem-reality
  gating, develop pre-merge, TDD apply, harness test, and inline ship-change with a
  boundary-reverse escape hatch. *Invoke it* whenever a planned OpenSpec change is ready to
  build inside its worktree.
- **`run-dashboard-e2e-local-changes`** — the harness recipe that bakes LOCAL source into
  the docker image (not a stale cached one). *Invoke it* before any L3 Playwright run that
  must reflect uncommitted worktree code.

If anything deserves capture from this run, it's a micro-skill: **"isolate pre-existing
test failures with `git stash push -u` before owning any red suite"** — it recurred and
saved the AI from chasing 21 unrelated failures.

## 7. Pitfalls & dead ends

- **Worktree `@blackbelt-technology/*` resolves to the MAIN repo, not the worktree.** A
  standalone `tsc` sees the main-repo `shared` union, so cross-package type refs to a
  brand-new message look stale. *Do:* trust the project's real gates (vitest runtime + Vite
  build + docker harness build), not an isolated `tsc`.
- **Full vitest run is noisy.** `image-fit`, `send-types`, `doctor-route`, `useImagePaste`
  fail on the clean base or are concurrency-flaky. *Do:* `git stash push -u` and re-run the
  suspects before assuming your change broke them.
- **Substring aria-label collision** — `getByRole(name: "Remove tag X")` matched both the
  editable-strip ✕ and the filter chip's `"…from all sessions"`. *Do:* `exact: true`.
- **CodeRabbit rate-limit = ACK, not a review.** A "next review in ~53 min" comment is not
  a pass. *Do:* wait for the reset, trigger a real review, then process threads.
- **`mergeStateStatus: DIRTY` stalls CI** — develop advanced and now conflicts, so no check
  runs. *Do:* merge `origin/develop`, resolve (here: import-block dedup + AGENTS.md
  union-keep), push; state flips to `UNSTABLE` and CI schedules.
- **Worktree branch-delete collision** — the parent has `develop` checked out, so the local
  branch delete fails; clean up the remote branch + worktree **from the parent repo**. The
  worktree removal orphans the shell (its cwd vanishes) — that's success, not an error.

## 8. Reproduce it faster — checklist

- [ ] Be **inside** the change's worktree; invoke `ship-it`.
- [ ] Read `tasks.md`/`design.md`/`proposal.md`; grep scenario markers to prove nothing's
      implemented.
- [ ] `git fetch origin develop && git merge --no-edit origin/develop`.
- [ ] TDD each layer red-first: protocol verb → L1 tests (confirm red) → handler + gateway
      switch (confirm green).
- [ ] Client components; split render-only scenarios → component tests, integration → L3
      Playwright.
- [ ] `git stash push -u` to isolate pre-existing failures; own only the ones that vanish.
- [ ] Harness: `docker compose -f docker/compose.yml build` → `PI_E2E_SEED=1
      PI_TEST_PEERS=both ./docker/test-up.sh -d` → poll health on port from
      `.pi-test-harness.json` → run spec attach mode → **always tear down**.
- [ ] `ship-change`: archive+sync → commit → push → PR → CI → CodeRabbit (verify each
      comment vs code, apply/reject-with-reason) → resolve any DIRTY merge → merge green.
- [ ] Decide the **merge policy up front** to avoid the ambiguous pause.

**Key inputs:** Docker running; `gh` authenticated; a planned OpenSpec change with
`tasks.md`/`design.md`/`proposal.md`; the worktree checked out.
**Final artifacts:** PR #387 squash-merged into `develop` (sha `612d76147`); new
`TagFilterGroup.tsx` + `TagDeleteConfirmDialog.tsx`; `remove_tag_globally` protocol verb +
`handleRemoveTagGlobally`; L1/component/L3 test coverage; updated `AGENTS.md` rows; archived
change under `openspec/changes/archive/`.

---

_Generated from session `019f8757-bfb3-7705-909f-d0b639e39553` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-22. Source extract: session facts sheet (deterministic extract)._
