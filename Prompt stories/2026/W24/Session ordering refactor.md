---
session: 019ebd8e
week: 2026/W24
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [simplify-session-card-ordering, add-async-action-feedback]
proposal_excerpt: "Session-card ordering grew into two parallel systems that no longer reconcile:"
---

# How we did it: Session ordering refactor — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore` skill) — a thinking-only
stance: read, search, visualize, but never implement. The real objective surfaced
across the first few steering turns: the dashboard's session-card ordering had grown
into *two parallel systems that no longer reconcile* — a server-side
`SessionOrderManager` tracking only **alive** sessions, and a separate client-side
sort for **ended/hidden** cards. The user wanted one coherent model where "session
ended → top of the ended tier," worktree/jj sessions order correctly, and completion/
question toggles behave predictably. The deliverable was an **OpenSpec change
proposal** (`simplify-session-card-ordering`) capturing that unified model — not code.

## 2. TL;DR playbook

1. **Enter explore mode** with the `openspec-explore` skill. State up front: thinking
   only, may produce OpenSpec artifacts, no implementation.
2. **Ground in real code first.** `rg` the ordering machinery
   (`sortSessionsByOrder`, `SessionOrderManager`, `session-grouping.ts`) before
   theorizing. Read the server single-source-of-truth and the client tier-split.
3. **Draw the current system** as an ASCII/Mermaid data-flow so contradictions become
   visible (alive-only order map vs. separate ended sort).
4. **Surface the unifying invariant**: *one persisted flat list per resolved
   group-path + stable status-partition* → `moveToFront` = "top of this card's own
   tier" for free. No tier-aware move logic.
5. **Chase the worktree seam early** (steering unlocked this): verify order-map keys
   line up with group keys. They didn't — three write paths disagreed. Fold the fix
   into the proposal as a prerequisite.
6. **Force the ambiguity to a decision.** When "completed first" meant two different
   things, put concrete timelines (Model X/Y/Z) in front of the user via `ask_user`
   and let them pick.
7. **Write the artifacts** against existing specs: `proposal.md`, `design.md`,
   `tasks.md` (TDD-ordered), plus `MODIFIED`/`REMOVED` spec deltas. Run
   `openspec validate <change> --strict`.
8. **Commit with an explicit pathspec** — only your change directory — so pre-staged
   unrelated files stay out of the commit.
9. **Later: archive** with `openspec archive <change> -y`. If it aborts on a corrupt
   main spec, repair the spec structurally first (dedupe requirements, single
   `## Purpose` + `## Requirements`), then re-archive.

## 3. How the collaboration unfolded

**Discovery (explore mode, grounded).** The AI resisted theorizing and instead `rg`'d
the actual ordering code — found `SessionOrderManager` (server, in-memory
`Record<cwd, sessionId[]>` persisted via `PreferencesStore`) is *already* a single
source of truth, but only for **alive** sessions; ended cards are pruned and sorted
separately on the client. Reading the lifecycle call-sites in `server.ts` and the
client `sortSessionsByOrder` exposed the two-systems problem concretely. *Why it
worked:* every claim was backed by a file, so the contradictions were real, not
imagined.

**Design (the invariant).** The AI crystallized the fix as one insight: if the single
persisted list per cwd holds **all** sessions and the render does a **stable partition
by status**, then `moveToFront` automatically lands a card at the top of its own tier
— zero special cases. It drew this with worked ASCII examples so the user could
verify the mechanics.

**Steering: worktrees.** The user's "what about worktrees?" turned out to be the
exact case that breaks "one list keyed by cwd." The AI traced all three write paths +
the read path and found a **latent inconsistency**: new-session/resume keyed by
`.worktrees/<slug>`, drag-reorder keyed by the parent `/repo`, client read keyed by
parent. Decision point: key the order map by `resolveSessionGroupPath` everywhere —
folded into the proposal as a prerequisite fix.

**Steering: disambiguation.** "Completed" was doing two jobs — *task completed*
(agent finishes a turn, session stays alive → active tier) vs. *session ended*
(process exits → ended tier). The AI refused to paper over it and instead presented
three explicit models (X/Y/Z) via `ask_user`. The user chose **Model Z**, which
resolved every contradiction.

**Generate.** With the model locked, the AI read an existing change for format,
read the existing `session-ordering` spec to write a proper delta, then wrote
`proposal.md` / `design.md` (D1–D8, precedence, migration, risks) / `tasks.md`
(7 TDD groups) / two spec deltas. `openspec validate --strict` passed.

**Verify & land (much later, +35h).** A follow-up turn discovered `tasks.md` was now
fully checked — implementation had happened in a *prior session*
(`1e164b02` feat + `dda1830a` fixes), but the change was never archived. The AI ran
the targeted tests (77 pass), then archiving aborted on a **structurally corrupt main
`session-grouping` spec** (stray delta headers + duplicated requirements from earlier
bad archives). It repaired the spec programmatically and re-archived cleanly.

## 4. Prompts that worked

- **The goal prompt** — invoking `openspec-explore` was the right kickoff: it set a
  thinking-only stance and licensed artifact creation without implementation drift. A
  stronger version would state the concrete target in the same breath: *"Explore how
  session-card ordering works today and draft a proposal to unify it — thinking only."*
- **"what about worktrees?"** — a four-word high-leverage follow-up that surfaced the
  single most important latent bug. Lesson: name the edge-case subsystem you're
  worried about; it forces the AI to verify a seam rather than assume.
- **"When session ended it have to be on top of ended cards"** — a precise behavioral
  rule that anchored the whole invariant.
- **"1. ask_user / 2. Yes. There is no distinguished groups by worktree/jj / 3. ok"**
  — terse point-by-point answers to the AI's decision menu; enough to lock three
  design choices at once.
- **"just this related changes"** — a one-line guardrail that kept the commit scoped
  to the proposal directory and out of pre-staged unrelated specs.
- **"It seems simplify-session-card-ordering is not archived."** — a state observation
  that triggered the whole verify-and-archive closeout.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reason about ordering in the abstract | "what about worktrees?" | Always enumerate edge subsystems (worktree/jj) before locking a data model |
| Conflate "task completed" with "session ended" | Answering the X/Y/Z model menu | State the tier vocabulary (alive/active vs. ended) up front |
| Risk sweeping pre-staged files into the commit | "just this related changes" | Commit with an explicit pathspec by default; check `git status` first |
| Leave a finished change un-archived | "it's not archived" | Add an archive step to the change's definition of done |
| Trust the tool to handle a corrupt target | (implicit) | Validate main specs before archive; repair structural drift first |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session. The workflow leaned entirely on
existing OpenSpec skills (`openspec-explore`, plus the change/validate/archive CLI).

**Recommended skill to create:** *"repair-corrupt-openspec-main-spec"* — the archive
blocker (stray `## ADDED/MODIFIED Requirements` delta headers and duplicated
requirements left in a main spec by earlier bad archives) is a recurring failure mode.
A skill capturing the deterministic repair — parse requirement blocks, keep
first-appearance order but last-appearance content so `MODIFIED` supersedes `ADDED`,
emit a single `## Purpose` + `## Requirements` document, `openspec validate --specs
--strict` — would turn a 20-minute manual recovery into a scripted one.

## 7. Pitfalls & dead ends

- **`openspec change new` / `openspec status` don't exist** — the correct verbs are
  `openspec new change <name>` and reading `tasks.md` directly. Check `openspec --help`
  before guessing subcommands.
- **`npx vitest` needed an ephemeral HOME** — the first test run failed; re-running as
  `HOME=$(mktemp -d) npx vitest run …` (the project's wrapper pattern) fixed it.
- **Archive aborts atomically on a corrupt main spec** — nothing is half-applied, but
  the error points at *your* change, not the real cause (pre-existing spec corruption).
  Inspect the main spec's structure before assuming your delta is wrong.
- **A redundant `## REMOVED Requirements` block broke the archive** — the AI had
  written a REMOVED delta for `Worktree session cluster adjacency`, which was never a
  standalone requirement (the clustering lived *inside* "Group sessions by directory",
  already superseded by the `MODIFIED` block). Don't REMOVE a sub-clause that a
  MODIFIED block already replaces.
- **Pre-staged unrelated files in the index** (`zrok-*`, `worktree-spawn-dialog`,
  `ws-ping-pong`, `zoomable-mermaid`) — always `git diff --cached --name-only` before
  committing and use an explicit pathspec.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the dashboard repo checked out; OpenSpec CLI available;
familiarity with the ordering files (`packages/server/src/session-order-manager.ts`,
`packages/client/src/lib/session-grouping.ts`).

- [ ] Enter explore mode (`openspec-explore`); state thinking-only + artifact-OK.
- [ ] `rg` the real ordering machinery; read server SoT + client tier-split.
- [ ] Draw current data flow; surface the two-systems contradiction.
- [ ] State the unifying invariant (one flat list + stable status-partition).
- [ ] Verify worktree/jj order-map keys align with group keys — fix the seam.
- [ ] Force ambiguous terms ("completed") to an explicit `ask_user` decision.
- [ ] Read an existing change + the target spec; write `proposal.md`, `design.md`,
      `tasks.md`, and `MODIFIED`/`REMOVED` deltas.
- [ ] `openspec validate <change> --strict`.
- [ ] Commit with an explicit pathspec (only the change dir).
- [ ] On completion: `openspec archive <change> -y`; repair any corrupt main spec
      first, then re-archive; commit the archive + spec updates.

**Final artifacts produced:**
- `openspec/changes/simplify-session-card-ordering/proposal.md`
- `openspec/changes/simplify-session-card-ordering/design.md`
- `openspec/changes/simplify-session-card-ordering/tasks.md`
- `openspec/changes/simplify-session-card-ordering/specs/session-ordering/spec.md`
- `openspec/changes/simplify-session-card-ordering/specs/session-grouping/spec.md`
- (later) `openspec/changes/archive/2026-06-14-simplify-session-card-ordering/`

---

_Generated from session `019ebd8e-c565-7da6-824a-18f3e3728f6c` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-14. Source extract: `/tmp/facts-1784853689N.md`._
