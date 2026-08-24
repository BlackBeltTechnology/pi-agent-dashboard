---
session: 019f8c91
week: 2026/W30
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [head-tail-truncate-subagent-event-timeline]
proposal_excerpt: "An in-memory subagent's live timeline freezes after ~3 steps and its later output (including a large final result) never appears in the dashboard. The root cause is **not** a `.slice(-3)` — it is the per-event seriali…"
---

# How we did it: Head+tail truncate the subagent event timeline — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator invoked the **`ship-it`** skill on a fresh OpenSpec change worktree
(`os/head-tail-truncate-subagent-event-timeline`) — a single kickoff that says
"drive the whole implementation phase, headless." The concrete objective, per the
change proposal: **an in-memory subagent's live timeline freezes after ~3 steps and
its later output (including a large final result) never appears in the dashboard.**
The real fix was *not* a naive `.slice(-3)` — it was the per-event serialization
ceiling silently dropping over-sized subagent events wholesale. The task: replace
that drop with a **head+tail reduction** (keep first + last entries, elide the
middle) backed by **byte-accurate size accounting**, land it with tests, ship the PR
green through CI + CodeRabbit, and clean up the worktree.

## 2. TL;DR playbook

1. **Invoke `ship-it` inside the change worktree** — it orients (`git status`, reads
   the change artifacts + `tasks.md`), merges `origin/develop`, and confirms all
   tasks are unchecked (fresh implementation).
2. **Consult the doc tree before reading source** — `kb agents <path>` /
   `kb_search` on the target files (`memory-event-store.ts`, the subagent mapper)
   to get purpose + exports without burning context on raw bytes.
3. **Implement per spec, flagging deliberate behavior reversals** — export
   `capString` (head+tail 50/50 with a hidden-chars marker), add a byte-accurate
   size walk, and a type-scoped `reduceSubagentEvent` that keeps first-1 + last-4
   entries and elides the middle into a `text` sentinel.
4. **Typecheck the changed package scoped to your file**, then write the automated
   scenarios (E1–E16, P1–P2, X1–X2) as real tests — and update the *one* existing
   test that encodes the now-reversed old behavior, transparently.
5. **Run the changed packages in isolation with `HOME=$(mktemp -d)`** — prove them
   fully green; treat aggregated-suite failures as environmental until verified
   against the base.
6. **Commit non-destructively, then STOP at the ship boundary** and ask the human to
   approve the irreversible steps (archive → PR → merge → worktree removal).
7. **Drive `ship-change` inline** — mark deferrable manual tasks, merge develop,
   `openspec archive` (fix any MODIFIED-block scenario-completeness error the
   validator catches), commit, push, open the PR.
8. **Watch CI; when red, prove pre-existing** — diff the failing test against
   `develop`'s own latest CI run before touching anything.
9. **Triage CodeRabbit threads** — apply valid findings (e.g. lone-surrogate byte
   undercount) with a locking regression test; re-push; loop until CI green + no
   actionable threads.
10. **Squash-merge, delete branch, remove worktree** — expect the known
    worktree-branch-collision error after merge; verify cleanup from the *parent*
    repo (your cwd was inside the removed worktree).

## 3. How the collaboration unfolded

**Phase 1 — Orient & merge (Discovery).** `ship-it` began with `git status`, read
the change artifacts and `tasks.md` (all unchecked → fresh), and merged
`origin/develop` cleanly. *Why it worked:* establishing worktree cleanliness and a
current base up front prevents phantom conflicts later. The AI then consulted the
**doc tree** (`kb agents`) for the target files *before* reading source — the
repo's index-first discipline.

**Phase 2 — Implement with an explicit behavior-reversal callout (Design/Generate).**
The AI implemented `capString` head+tail, the byte-accurate walk
(`jsonStringByteSize` + `measureBytes` — real UTF-8/JSON-escape bytes, real base64
size, code-unit short-circuit to avoid stringifying huge strings), and
`reduceSubagentEvent` with type-scoped detection *before* the generic pass. The key
decision point: an existing test (`large pasted image survives the ceiling`)
encoded the OLD behavior that design **D8 deliberately reverses**. Rather than
silently mutate it, the AI called it out as "a documented, accepted trade-off — not
a design flaw" and updated it transparently.

**Phase 3 — Test calibration (Verify).** First test run: 4 failures, all in the
*new* tests. The AI diagnosed each as a calibration issue (floor+marker overhead,
the default string-pass shrinking the blob under the ceiling before the size gate —
production runs `maxStringFieldSize: 0`), not a logic bug, and fixed the assertions.
It then ran the changed packages in isolation (`HOME=$(mktemp -d)`) → server 3389
green, subagents 38 green. *Why it worked:* separating "my test miscalibrated" from
"my code is wrong" kept the fix surgical.

**Phase 4 — Prove aggregated failures pre-existing.** The full suite showed 55
failures. The AI clustered them (`pi-image-fit-extension` missing binaries, worktree
`node_modules` hoisting, unrelated web branding) and confirmed **none touched the
changed files** — an environmental/pre-existing verdict, not a regression.

**Phase 5 — Ship boundary & human gate (Decision point).** Work committed
(`80b76789`), the AI **stopped at the irreversible boundary** and summarized what
landed before asking to proceed. The human approved. `ship-change` ran inline:
archive (the validator caught a dropped MODIFIED-block scenario — fixed by carrying
it forward reframed), PR **#394**, CI watch.

**Phase 6 — CI + CodeRabbit loop.** CI red on `routing.test.tsx` — the AI proved it
**pre-existing red on `develop`** (the "Sessions" divider is intended new UI, the
test's `queryByText("Sessions")).toBeNull()` was stale). After human approval it
fixed the stale assertion minimally. CodeRabbit flagged a real **lone-surrogate byte
undercount** in `jsonStringByteSize`; the AI applied the surrogate-pair fix + a
locking test. Loop closed: CI green, no actionable threads → squash-merge
(`5eba8f90a`), branch + worktree removed.

## 4. Prompts that worked

- **The goal prompt — `ship-it` skill invocation.** A single skill invocation on a
  prepared worktree is a high-leverage kickoff: it carries the full
  implementation→test→ship contract, so the operator doesn't re-specify each step.
  What made it effective: the change was already planned (proposal/design/tasks
  existed), so the AI had an unambiguous spec to execute against.
- **High-leverage follow-up — the approval turn.** After the AI stopped at the ship
  boundary and summarized, a short "proceed" unlocked the entire irreversible
  sequence. The pattern to reuse: **let the AI reach a decision boundary and
  summarize, then approve in one word** rather than pre-authorizing everything.
- **Rewrite for next time:** if kicking off manually (no `ship-it`), say *"Implement
  `<change>` in this worktree per its tasks.md; stop and summarize before any
  archive/PR/merge; treat aggregated-suite failures as suspect until diffed against
  develop."* — this front-loads the two behaviors that mattered most.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to proceed through the irreversible ship steps | Approve explicitly at the boundary (the AI correctly *paused* and asked) | Keep the "stop-and-summarize before archive/PR/merge" rule in the ship skill |
| Treat a red aggregated test suite as its own regression | (self-corrected) diff each failure against `develop`'s own CI before acting | Always prove pre-existing failures against the base branch, never assume ownership |
| Silently update a test that conflicted with the new behavior | (self-corrected) flag it as a *documented D8 reversal*, update transparently | State behavior-reversal design decisions (D8/E11) so tests-to-change are expected |
| Drop a pre-existing scenario from a MODIFIED spec block | The `openspec archive` validator caught it → carry it forward reframed | Remember: MODIFIED blocks must carry ALL kept scenarios, even reframed ones |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session was a clean *execution* of the
existing `ship-it` orchestration skill, which composes `openspec-apply-change`, the
docker harness, and `ship-change`. Its effectiveness here: it turned a 10-hour,
65-command, PR-through-merge journey into a single invocation with the human only
gating the irreversible boundary.

Reusable patterns worth capturing as a skill if not already:
- **"Prove-pre-existing" CI triage** — diff a failing test against the base branch's
  own latest CI run (`gh run view` on develop's HEAD) before claiming or disclaiming
  ownership. This removed a whole class of false blame.
- **Byte-accurate serialization ceiling** — the `jsonStringByteSize` /
  code-unit-short-circuit / lone-surrogate-correct accounting is a reusable recipe
  for any "never undercount a size ceiling" invariant.

## 7. Pitfalls & dead ends

- **`HOME` unset breaks scoped vitest.** First scoped test run failed until the AI
  set `HOME=$(mktemp -d)`. If a package test errors on config/home, run it as
  `cd packages/<pkg> && HOME=$(mktemp -d) npx vitest run …`.
- **Aggregated suite is noisy in a worktree.** Worktrees hoist `node_modules` to the
  main repo, so tests asserting local paths fail environmentally. Verify changed
  packages in isolation; trust CI (clean env) as the authoritative gate.
- **`openspec archive` rejects incomplete MODIFIED blocks.** If the validator errors,
  a kept scenario was dropped — carry it forward (reframed to the new behavior),
  don't delete it.
- **Squash-merge leaves a worktree-branch collision.** After merge, `gh`/git tries to
  check out `develop` locally and errors — the merge already succeeded. Remove the
  worktree and `git branch -D` (squash makes git see the branch as "unmerged").
- **Your cwd disappears with the worktree.** After `git worktree remove`, the Bash
  tool can't run (cwd gone) — finish verification from the parent repo or a sandbox
  shell with an explicit cwd.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a planned OpenSpec change worktree (proposal + design +
tasks.md), `gh` authenticated, the design's behavior-reversal decisions noted.

- [ ] Invoke `ship-it` in the worktree (or: orient → merge `origin/develop` → read tasks.md).
- [ ] `kb agents`/`kb_search` target files before reading source.
- [ ] Implement per spec; flag any test that encodes reversed old behavior.
- [ ] Scoped typecheck + `HOME=$(mktemp -d) npx vitest run` on changed packages → green.
- [ ] Cluster any aggregated failures; prove environmental/pre-existing vs base.
- [ ] Commit non-destructively; **stop, summarize, get approval** before ship.
- [ ] `ship-change` inline: mark deferrables → archive (fix MODIFIED completeness) → PR.
- [ ] CI red? diff the failing test against develop's own latest CI before acting.
- [ ] Apply valid CodeRabbit findings + locking test; loop to green + no threads.
- [ ] Squash-merge, delete branch, remove worktree; verify from the parent repo.

**Final artifacts:** PR [#394](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/394)
merged as `5eba8f90a`; `memory-event-store.ts` head+tail reduction + byte-accurate
walk; 21 automated scenarios; change archived + specs synced.

---

_Generated from session `019f8c91-fb7d-717e-835c-fec4515d9fed` · `pi-agent-dashboard` · 2026-07-23. Source extract: session facts sheet._
