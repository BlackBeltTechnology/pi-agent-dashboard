---
session: 019e9ec2
week: 2026/W23
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [replace-proposal-dialog-with-race-handling, unify-dialog-system]
proposal_excerpt: "When a session has a proposal manually attached and the LLM emits a new *active* OpenSpec change (a write under `openspec/changes/<name>/` or an `openspec` CLI invocation naming a different change), today the server s…"
---

# How we did it: Refreshing a parked OpenSpec proposal against drifted code — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore` skill) — a thinking-only
stance, no implementation. The first real instruction was terse:

> "Check the proposal, because lot of changes was made in the system"

The *real* objective, once the steering clarified it: the `replace-proposal-dialog-with-race-handling`
change had been **parked for a month** (0/46 tasks, last touched 2026-05-04). Meanwhile
`event-wiring.ts` had grown from 248 → 673 lines. The operator wanted the AI to **audit
whether the proposal was still valid** against the live code, **surgically correct the
stale anchors** (line numbers, function names, dependency links) without rewriting the
design, and **commit** the refreshed artifacts. Not a re-design — a **drift repair**.

## 2. TL;DR playbook

1. Enter explore mode (`openspec-explore`) so the AI investigates but never implements.
2. Point it at the parked change: *"Check the proposal, lots of changes were made in the system."*
3. Let it locate the change (`openspec list --json`) and read all three artifacts.
4. Have it **verify every anchor** the proposal cites (line numbers, function names) against current source via `grep -n` on the target files.
5. Ask for a **drift table**: "proposal says X → reality now Y" so you can eyeball what moved.
6. Confirm you want the corrections applied (a single "1" / "yes" is enough).
7. It makes **surgical edits** to proposal.md / tasks.md / design.md — anchors only, design untouched.
8. Run `openspec validate <change>` to prove it's still well-formed.
9. Say "commit proposal" — it stages **only** the change dir and commits with a `docs(openspec):` message.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (locate & read).** The AI ran `openspec list --json` + `ls openspec/changes/`,
matched the fuzzy ask to `replace-proposal-dialog-with-race-handling`, and read the proposal.
It immediately reported the key facts: *in-progress, 0/46 tasks, parked a month.* Effective
because it front-loaded the "is this even still alive?" answer before touching anything.

**Phase 2 — Anchor verification (the real work).** It didn't trust the proposal's own line
numbers. It `grep -n`'d for `attachmentWasAutoTracked`, `differentChangeDetected`, `agent_end`,
`isNameAutoSetFromAttachment`, `pendingReplaceProposal` in the live `event-wiring.ts`. Two
findings: (a) the **core gap still exists** — manual-attach + different-change still falls
through with no `else` branch; (b) the anchors **drifted** — auto-attach block 248 → ~330,
`agent_end` clear 282 → ~353, and the witness rule was refactored from `name === attachedProposal`
to `isNameAutoSetFromAttachment(session)`.

**Phase 3 — Drift report (decision point).** It presented a **"proposal says / reality now"
table** and an explicit *"what I deliberately left alone"* list. This is where the human chose
the direction: keep the design, fix the anchors. The operator's "1" unlocked the edits.

**Phase 4 — Surgical edits.** Four edits across the three artifacts: corrected anchors in
proposal.md, reframed "third branch" as the missing `else` branch, added the explicit
`unify-dialog-system` dependency, fixed tasks 2.1/2.5/3.3 anchors, pointed 3.1 at the existing
idempotent `applyAttachProposal()`, and pinned the client dialog to the shared `Dialog` shell.

**Phase 5 — Verify & commit.** `openspec validate` passed. On "commit proposal" it staged only
the change directory and committed `7a46eea0` (31 insertions / 15 deletions, nothing else touched).

## 4. Prompts that worked

- **Goal prompt** — *"Check the proposal, because lot of changes was made in the system."*
  Weak on the surface (no change named) but effective because the AI could disambiguate via
  `openspec list`. **Stronger version:** *"The `replace-proposal-dialog-with-race-handling`
  change has been parked a month. Verify its anchors against current code, table what drifted,
  fix the stale references but keep the design, then commit."*
- **High-leverage follow-up** — *"1"* / *"commit proposal"*. Two-character unlocks. They worked
  only because the AI had already laid out an explicit, reviewable plan (the drift table + the
  "what I'll leave alone" list), so a one-token yes was unambiguous.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to jump straight into fixing on a vague "check the proposal" | Keeping it in explore mode; the AI self-restrained to *thinking* | State up front: "audit + table the drift first, don't edit until I say go" |
| Trust the proposal's own line numbers | Nothing — the AI proactively re-verified every anchor via `grep -n` | Make anchor re-verification a standing rule for any parked change |
| Risk over-editing (redesigning while fixing) | The AI volunteered a "what I deliberately left alone" section | Ask explicitly: "fix anchors only, design stays" |
| Commit broadly | The AI staged only the change dir | Say "commit only the change directory" |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the work rode entirely on the existing **`openspec-explore`**
skill. That skill is the effective asset here: its *think-not-implement* stance is exactly right
for a drift audit, where the danger is editing before understanding. **When to invoke it:** any
time you're re-assessing a parked/stale OpenSpec change before deciding whether to revive, fix,
or scrap it.

**Skill worth creating:** a *"refresh-parked-proposal"* routine — locate change → read all
artifacts → `grep -n` every cited anchor against live source → emit a "proposal says / reality
now" drift table + a "leave alone" list → surgical anchor-only edits → `openspec validate` →
scoped commit. This session executed that exact loop by hand; it is clearly repeatable.

## 7. Pitfalls & dead ends

- **One edit failed with an invalid field, one grep errored.** The AI recovered by retrying the
  edit cleanly. *If an edit call rejects a field, re-issue it without the bad field rather than
  fighting the tool.*
- **Stale anchors are silent traps.** The proposal read plausibly but every line number was off
  by ~80 lines because the file grew 248→673. *Never edit against a parked proposal's cited line
  numbers — always `grep -n` the symbol in the current file first.*
- **A refactor renamed the witness rule** (`name === attachedProposal` → `isNameAutoSetFromAttachment`).
  *Anchors drift by rename, not just by line-move — verify function names, not just positions.*

## 8. Reproduce it faster — checklist

- [ ] Enter explore mode (`openspec-explore`) — thinking only, no implementation.
- [ ] `openspec list --json` → identify the parked change; read proposal.md / tasks.md / design.md.
- [ ] `grep -n` every cited anchor (line numbers **and** function names) in the live target files.
- [ ] Produce a "proposal says / reality now" drift table + a "leave alone" list; get a go/no-go.
- [ ] Apply **anchor-only** surgical edits; retry any edit that rejects a field.
- [ ] `openspec validate <change>` must pass.
- [ ] `git add openspec/changes/<change>/` only; commit `docs(openspec): refresh <change> anchors`.

**Inputs to have ready:** the change name (or a fuzzy hint), write access to the repo, `openspec` CLI.
**Artifacts produced:** refreshed `proposal.md`, `tasks.md`, `design.md` in
`openspec/changes/replace-proposal-dialog-with-race-handling/`; commit `7a46eea0` on `develop`.

---

_Generated from session `019e9ec2` · `pi-agent-dashboard` · 2026-06-06. Source extract: deterministic facts sheet._
