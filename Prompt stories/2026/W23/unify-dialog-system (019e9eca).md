---
session: 019e9eca
week: 2026/W23
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [unify-dialog-system]
proposal_excerpt: "The dashboard accumulated three generations of dialog code, each layered on the next without retiring the previous one. The result is visually inconsistent (three overlay tints — `var(--bg-overlay)`, `bg-black/50`, `b…"
---

# How we did it: Refresh a stale OpenSpec proposal against a moved codebase — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with:

> "check unify-dialog-system proposal. The system has a tons of new features, maybe it causes changes in this proposal. Check it"

The *real* objective, once the work played out: **audit a month-old OpenSpec change
(`unify-dialog-system`, drafted 2026-05-02) against the current codebase, find where the
architecture had moved out from under it, and revise all its artifacts** (`proposal.md`,
`design.md`, `tasks.md`, `specs/*/spec.md`) so they match reality and pass `openspec
validate --strict` — then commit only those artifacts. The single steering turn ("commit
proposal") confirmed the endpoint was a committed, validated proposal, not just a review note.

## 2. TL;DR playbook

1. **Locate the change and read every artifact end-to-end.** `find`/`cat` the whole
   `openspec/changes/<name>/` tree — proposal, design, tasks, and each `specs/*/spec.md`.
2. **Extract the proposal's load-bearing premises.** Especially the Open Questions and
   Decisions (D1, D2…) — those are the assumptions most likely to have rotted.
3. **Fact-check each premise against the live code**, not against memory. `rg` for the
   components, packages, and call sites the proposal names; `git log` to see what landed since
   the draft date.
4. **Name the divergences explicitly** — "D1 chose X and rejected a shared package; that
   shared package (`client-utils`) now exists." One bullet per drifted assumption.
5. **Do one thorough gather pass before editing** so every rewrite is grounded — don't
   interleave discovery and writing.
6. **Revise surgically**: full rewrites for `proposal.md`/`tasks.md` (whole premise changed),
   targeted `edit`s for `design.md`/spec files (patch the specific stale decisions/risks).
7. **Validate**: `npx openspec validate <name> --strict` — must pass before you claim done.
8. **Commit only the change artifacts.** `git status` first; `git add openspec/changes/<name>/`
   and leave unrelated untracked files (e.g. `mockups/`) alone.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (locate + read).** The AI `find`'d the change dir and `cat`'d the
proposal, tasks, and `.openspec.yaml`. Within ~15 s it flagged "Major divergence detected."
*Why it worked:* it read the artifacts as a unit before forming an opinion, so the staleness
call was evidence-based, not a guess.

**Phase 2 — Fact-gathering against live code.** A dense batch of `rg`/`find`/`cat`/`git log`
commands cross-checked every premise: the new `packages/client-utils` package, the
re-export shim at `client/src/components/ConfirmDialog.tsx`, the `useUiPrimitive(UI_PRIMITIVE_KEYS.confirmDialog)`
registry contract, six new dialogs, and ~9 new `ConfirmDialog` call sites the old task list
missed. The AI explicitly said "I'll do a thorough fact-gathering pass first, then rewrite all
three artifacts accurately." *Why it worked:* separating gather from write meant the rewrites
were fully grounded and didn't need re-editing.

**Phase 3 — Revise.** `write` for `proposal.md` and `tasks.md` (their whole premise flipped),
targeted `edit`s for `design.md` (reverse decision D1, adjust risks) and the confirm-dialog
spec (match the registry reality). *Decision point:* the human's original ask ("check it")
left open whether to just report or to fix — the AI chose to fix all artifacts, which the
follow-up "commit proposal" ratified.

**Phase 4 — Verify + commit.** `openspec validate --strict` passed. `git status` showed an
unrelated untracked `mockups/markdown-style/index.html`; the AI staged only the four
`openspec/changes/unify-dialog-system/` files and committed `6f1e8177`. *Why it worked:*
scoping the `git add` to the change dir kept the commit clean and reviewable.

## 4. Prompts that worked

- **Goal prompt** — "check unify-dialog-system proposal. The system has a tons of new
  features, maybe it causes changes in this proposal." Effective because it named the exact
  change *and* the hypothesis (new features → proposal drift), pointing the AI straight at a
  staleness audit. **Stronger version:** *"Audit the `unify-dialog-system` proposal against
  the current codebase. It was drafted weeks ago and several features have landed since. Find
  every premise/decision that no longer holds, revise all artifacts to match, and make
  `openspec validate --strict` pass."* — states the endpoint (revised + validating artifacts)
  up front instead of leaving "check it" ambiguous between report-only and fix.
- **High-leverage follow-up** — "commit proposal." A two-word unlock that ratified the fix-and-
  land path and defined the finish line.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "check it" as possibly report-only | "commit proposal" — signalling the endpoint is committed artifacts | State the endpoint in the goal prompt: "revise + validate + commit," not just "check" |
| Nothing else needed steering — the audit-then-revise flow ran clean in one pass | — | The one-thorough-gather-before-write discipline is why; keep it |

This session was unusually low-steering (2 prompts total). The lesson is less about
corrections and more about **what a well-aimed goal prompt buys you**: naming the change +
the drift hypothesis let the AI self-direct the entire audit → revise → validate → commit arc.

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session. But the workflow is clearly repeatable and
warrants one:

**Recommended skill — `refresh-stale-openspec-proposal`.** Captures the reusable move of
re-validating an aged OpenSpec change against the live codebase: (1) read all artifacts,
(2) extract Decisions/Open-Questions as premises, (3) `rg`/`git log` each premise against
current code, (4) enumerate divergences, (5) full-rewrite vs surgical-edit by blast radius,
(6) `openspec validate --strict`, (7) scoped commit. *Why effective:* proposals rot silently
as unrelated changes land; this makes the "is this still true?" audit mechanical and
repeatable instead of ad-hoc. *Invoke when:* picking up any OpenSpec change older than a
few weeks before implementing it.

## 7. Pitfalls & dead ends

- **One `sed`/`bash` command failed** (a `design.md` slice with a chained grep). Low cost —
  the AI recovered by reading the file directly. If a compound `sed … && echo … && rg …`
  one-liner errors, split it or just `cat`/`Read` the file rather than debugging the pipe.
- **Stale decision trap:** a proposal's Decision that explicitly *rejected* an option ("not
  worth a shared package for v1") is exactly where drift hides — the rejected option
  (`client-utils`) had since been built. Always re-check rejected alternatives, not just
  accepted ones.
- **Don't sweep in unrelated files:** an untracked `mockups/…` file sat in the tree; scoping
  `git add` to `openspec/changes/<name>/` kept it out of the commit.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; repo at the branch you'll revise on; the
change's draft date (from `git log` or the proposal header).

- [ ] `cat` every artifact under `openspec/changes/<name>/` (proposal, design, tasks, specs).
- [ ] List the proposal's Decisions + Open Questions; treat each as a premise to verify.
- [ ] `rg`/`find` the named components, packages, and call sites in live code.
- [ ] `git log --since=<draft-date>` to see what landed since the draft.
- [ ] Write one bullet per divergence (include re-checking *rejected* alternatives).
- [ ] Full-rewrite artifacts whose premise flipped; targeted `edit` for local stale bits.
- [ ] `npx openspec validate <name> --strict` — must pass.
- [ ] `git status`, then `git add openspec/changes/<name>/` only; commit with a `docs(<name>):`
      message. Leave unrelated untracked files alone.

**Artifacts produced:** revised `proposal.md`, `tasks.md`, `design.md`,
`specs/confirm-dialog/spec.md`; commit `6f1e8177`.

---

_Generated from session `019e9eca-50a8-7d91-aee7-853bb13e1fce` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-06. Source extract: session-to-guideline facts sheet._
