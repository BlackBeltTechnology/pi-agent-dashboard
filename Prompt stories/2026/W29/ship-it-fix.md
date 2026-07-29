---
session: 019f627c
week: 2026/W29
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [integrate-develop-before-ship-gate, add-auto-session-naming]
proposal_excerpt: "`ship-change` opens the PR (step 5) from wherever the worktree branch sits, with **no `develop`-integration step first**. When `develop` moved since the worktree branched, the PR ships a tree the local gates never val…"
---

# How we did it: capturing a ship-workflow ordering fix — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking-partner stance,
explicitly *not* implementation. The operator's real objective emerged over the first two
turns: **pressure-test a suspected gap in the ship workflow** — that `ship-it`/`ship-change`
"does not archive the proposal before the PR" — and, once that turned out to be a false
premise, chase the *actual* bug it uncovered: **the PR is opened from a worktree branch that
was never integrated with `develop`, so CI validates a tree the local gates never saw.** The
end state wasn't code — it was a **captured, validated OpenSpec change** (`integrate-develop-
before-ship-gate`) ready to build later.

## 2. TL;DR playbook

1. Start in `openspec-explore` — you want a thinking partner, not an implementer.
2. Give the AI a **specific, falsifiable premise** ("X does not happen before Y") and tell it
   to *ground it in reality* by reading the actual skills.
3. Let it trace the real ordering across the `ship-it → ship-change → openspec-archive` chain
   and render it as a numbered/mermaid flow. Accept that the original premise may be **false**.
4. Ask the sharp follow-up the trace exposes: *"Is it worth rebasing to develop BEFORE PR?"*
5. Make it reason about **where** the integration step belongs (before the strongest gate that
   runs, not just before the PR) and **merge vs rebase** (merge `origin/develop`; force-push is
   a worktree footgun).
6. Say **`capture`** to scaffold the OpenSpec artifacts (proposal / design / tasks / spec).
7. Run `openspec validate <change>` until green.
8. Say **`commit`** — stage only the change dir, leave side-effect churn (`groups.json`,
   stray `.bak`) unstaged and call it out.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / premise check (23:16–23:17).** The AI resisted taking the premise at
face value. It read the ship skills and traced the true ordering: `ship-change` step 3 *does*
archive before the PR (step 5), so "no archive before PR" was **false**. It then explained
*why* nobody documents "archiving the proposal": `openspec-archive-change` does a single
directory-level `mv` of the whole change root, so `proposal.md`/`design.md`/`tasks.md` ride
along implicitly — only `specs/` gets special sync treatment. *Why it worked:* grounding the
claim in the actual skill text killed a phantom bug before any work was spent on it.

**Phase 2 — The real fork (23:28–23:29).** The operator asked the load-bearing question:
*rebase to develop before PR creation?* The AI drew the stale-branch failure modes (semantic
break, textual conflict, `mergeStateStatus: DIRTY`) and located the correct slot: the merge
must sit **upstream of the strongest gate that actually runs** — ship-it's e2e harness (step
2.5) or ship-change's verify gate (step 1.5) — so the gate validates the *integrated* tree.

**Phase 3 — Capture (23:31–23:33).** On `capture`, the AI scaffolded four artifacts and ran
`openspec validate` to green. The decision crystallized into a two-placement design (primary
ship-it 2.5, backstop ship-change 1.5), with one open question (the develop-moved-during-
harness race) deliberately deferred in `design.md`.

**Phase 4 — Commit (23:35).** On `commit`, it staged only the change dir, deliberately left
`openspec/groups/groups.json` (a validate side effect) and a stray `.bak` unstaged, and
reported both.

## 4. Prompts that worked

- **Goal prompt (explore mode + falsifiable premise).** Entering `openspec-explore` and
  handing over a *specific, checkable* claim ("does not archive the proposal before the PR")
  gave the AI something to disprove rather than a vague "look into ship." Stronger next time:
  *"In explore mode, verify this claim against the actual skills before agreeing: …"*
- **"Is it worth rebasing to develop BEFORE PR creation?"** — a short, high-leverage fork
  question. It reframed a disproved premise into the real design problem and drove the whole
  design.
- **One-word unlocks:** `capture` → scaffold the OpenSpec change; `commit` → stage + commit.
  These worked *because* the preceding turns had fully specified the decision — the verbs just
  released it.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Risk accepting the premise as stated | "Check active sessions, because there is not mentioned the archivation of proposal" | Hand it a *falsifiable* claim and say "ground it in the actual skills first" |
| Stop at "premise is false" | "Is it worth rebasing to develop BEFORE PR?" | Ask the follow-up the trace exposes — a disproved premise often hides a real bug |
| Could have jumped to implementing | Stayed in explore → only `capture` | Keep the explore stance: capture a proposal, don't write code |
| Might commit incidental churn | Implicit expectation on `commit` | State "stage only the change dir; leave side-effect files unstaged and report them" |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session *used* the existing `openspec-explore` →
capture → commit pipeline. The reusable asset is the **captured change itself**:
`integrate-develop-before-ship-gate` (proposal / design / tasks / `specs/ship-workflow/
spec.md`), a docs-only change to `.pi/skills/ship-it` + `ship-change`. It encodes the
load-bearing principle *"the develop-merge must sit upstream of the strongest gate that
runs"* and flags `doubt-driven-review` to stress-test the ordering before it's built.

*Recommended skill to create:* a "premise-check in explore mode" habit — always ground a
reported workflow gap against the actual skill text before designing a fix.

## 7. Pitfalls & dead ends

- **Phantom bug.** The starting premise ("no archive before PR") was false; the archive is an
  implicit `mv` of the whole change root. *If a workflow gap is reported, trace the real
  ordering before designing a fix.*
- **`git merge develop` vs `origin/develop`.** In a worktree, local `develop` is checked out
  in the parent repo → branch-collision footgun. Always merge the **remote ref**.
- **Merge, don't rebase/force-push.** Squash-merge makes linear history moot; force-push from a
  worktree is a documented footgun.
- **Validate side effects.** `openspec validate`/`status` touches `openspec/groups/groups.json`
  — leave it unstaged rather than sweeping it into an unrelated commit.

## 8. Reproduce it faster — checklist

- [ ] Enter `openspec-explore`; hand over a **falsifiable** premise, not a vague ask.
- [ ] Make the AI trace the real ordering across `ship-it → ship-change → openspec-archive`.
- [ ] Ask the fork question the trace exposes (integrate develop before PR?).
- [ ] Pin the design: merge `origin/develop` upstream of the strongest gate (ship-it 2.5 /
      ship-change 1.5); defer the develop-moved-during-harness race explicitly.
- [ ] `capture` → scaffold artifacts → `openspec validate <change>` until green.
- [ ] `commit` staging only the change dir; report side-effect files left unstaged.

**Key inputs:** the ship skills (`.pi/skills/ship-it`, `ship-change`, `openspec-archive-change`),
`openspec` CLI. **Final artifacts:** `openspec/changes/integrate-develop-before-ship-gate/`
(`proposal.md`, `design.md`, `tasks.md`, `specs/ship-workflow/spec.md`) — committed,
216 insertions.

---

_Generated from session `019f627c` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-14. Source extract: session facts sheet._
