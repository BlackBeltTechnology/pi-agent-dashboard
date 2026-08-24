---
session: 019dc646
week: 2026/W17
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [add-dashboard-shell-slots-runtime, dashboard-plugin-architecture, extension-ui-system, extract-openspec-as-plugin, extract-flows-as-plugin, extract-subagents-as-plugin]
proposal_excerpt: "The umbrella proposal `dashboard-plugin-architecture` defines the slot taxonomy and plugin loader contract as design-only artifacts. That gives us the schema and the ADRs but no working code."
---

# How we did it: Landing the dashboard-plugin-architecture OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with the standard `/opsx:apply` slash command against the
`dashboard-plugin-architecture` OpenSpec change:

> *"Implement tasks from an OpenSpec change… If a name is provided, use it… Get apply
> instructions… Parse the JSON to understand which artifact contains the tasks…"*

The *real* objective, once the steering settled it, was narrower and more subtle:
**work through an explicitly design-only umbrella change without accidentally building
the deferred prototype code** — validate that the design covers the existing codebase,
scaffold the follow-up runtime change, write spec stubs and docs, and leave the four
prototype tasks (5.1–5.4) unchecked with a documented rationale. Then, several days
later, *reconcile* that plan against reality (the prototypes had already shipped in a
sibling change), close out the umbrella, archive it, and finally commit an unrelated
working tree.

## 2. TL;DR playbook

1. **Announce the change and read the whole scope before touching anything.** Run
   `openspec status --change <name> --json` + `openspec instructions apply --change
   <name> --json`; classify each remaining task (validation / scaffold / doc / prototype).
2. **Respect a "design-only" label as a hard boundary.** State up front which tasks you
   will do and which you will leave unchecked *with a rationale block in `tasks.md`* —
   don't silently build code the proposal defers.
3. **Validate design claims against real code**, don't rubber-stamp them: `grep`/`read`
   `App.tsx`, `SessionCard.tsx`, `SettingsPanel.tsx` to confirm each "design covers X"
   task, and fix factual errors you find in sibling proposals as you go.
4. **Scaffold the follow-up change** (`add-dashboard-shell-slots-runtime/proposal.md`)
   matching the existing sibling convention (proposal-only at scaffold stage).
5. **When re-invoked on an unchanged state, STOP and ask once** — don't loop the same
   defer/skip decision on every `/opsx:apply`. Reframe the choice for the operator.
6. **Before archiving, reconcile plan vs. filesystem reality.** The prototypes had
   already been built + archived in a sibling change — verify with the test suites, wire
   the one real gap (Vite plugin not imported in `vite.config.ts`), then mark tasks done
   with citations.
7. **Archive with a deliberate delta-sync decision** (contract-level umbrella requirements
   layered above implementation-level runtime requirements), then `openspec validate --strict`.
8. **On "commit and push", re-check the working tree first** — it may be unrelated to the
   session's work. Confirm the commit split, then push.

## 3. How the collaboration unfolded

**Phase 1 — Scope triage (design-only discipline).** The AI opened the change, read the
proposal + tasks, and immediately classified the 16 remaining tasks into validation,
scaffold, doc, and prototype buckets. Crucially it *flagged* that tasks 5.1–5.4 were
prototypes the proposal explicitly marked "not blocking" and building them "would
contradict the design-only scope." **Why it worked:** treating the proposal's own scope
language as a constraint prevented scope-creep into a separate change.

**Phase 2 — Validate-then-edit.** Rather than marking validation tasks done on faith, the
AI grep'd/read `App.tsx`, `SessionCard.tsx`, `SessionList.tsx`, `SettingsPanel.tsx` and
`docs/architecture.md` to confirm each design claim. It found and fixed real drift —
descriptor kinds (`session-card-action-bar`, `content-view-data`) referenced in one
design but absent from `extension-ui-system`, and a factual error in
`extract-openspec-as-plugin/proposal.md` (claimed OpenSpec settings weren't surfaced;
they were). Then wrote the runtime-change scaffold, two spec stubs, and doc sections.

**Phase 3 — The re-invocation loop (steering pressure).** The operator re-ran the exact
same `/opsx:apply` prompt three times across two days. Each time the state was identical
(19/23, the four deferred prototypes). **The AI correctly refused to silently flip the
earlier "skip" decision** — it paused, restated status, and offered explicit next-step
options instead of looping.

**Phase 4 — Plan meets reality.** On the third re-invocation the operator signalled
"switch from design-only to real code." The AI discovered `packages/dashboard-plugin-runtime/`
and `packages/demo-plugin/` *already existed*, fully built with 58 passing tests, shipped
by an already-archived sibling change (`add-dashboard-shell-slots-runtime`). It verified
each prototype task against its test suite, found the one genuine gap (the Vite plugin
existed with tests but wasn't imported into `packages/client/vite.config.ts`), wired it,
removed the now-stale "deferred" rationale block, and marked 23/23 done with citations.

**Phase 5 — Archive + delta sync.** Archiving surfaced a partial-overlap sync situation:
the umbrella's 20 delta requirements were contract-level, the main specs already held 14
implementation-level requirements from the runtime change. The AI laid out the overlap
explicitly and, on operator direction, layered contract requirements above implementation
ones. `openspec validate --strict` passed.

**Phase 6 — The surprise commit.** Days later "commit and push" arrived. The AI checked
`git status` first and found the working tree was **unrelated** to the session's work
(a `reattach-move-to-front` feature + doc scaffolds). It surfaced that mismatch, ran the
full 3820-test suite, proposed a two-commit split, and pushed to `origin/develop`.

## 4. Prompts that worked

- **The goal prompt** — the raw `/opsx:apply` slash command. It works *because the
  underlying skill is disciplined*: it forces status → instructions → task classification
  before edits. A stronger kickoff would add one line: *"This is a design-only umbrella;
  do NOT build the deferred prototype tasks — leave them unchecked with a rationale."*
  That would have pre-empted the entire three-invocation defer loop.
- **High-leverage follow-up: "commit and push"** (Prompt 5) — three words, but the AI's
  own guardrail (check `git status` before committing) turned it into a safe operation
  despite the working tree being unrelated to the session.
- **Rewrite of the weak repeated prompt:** re-running the identical `/opsx:apply` to
  "make progress" is a weak prompt — it carries no new information. The stronger move is
  to state the *decision*: *"Archive the umbrella as-is; the 5.1–5.4 rationale block
  justifies the unchecked boxes"* or *"the prototypes shipped in the runtime change —
  reconcile and close out."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to execute *all* remaining tasks, including deferred prototypes | Implicitly relying on "design-only" scope; AI self-corrected but re-litigated it | State "design-only, skip 5.1–5.4" in the kickoff prompt, or save it as a memory on the change |
| Re-hit the same defer decision on every `/opsx:apply` re-run | Re-issuing the identical prompt (no new info) | Give the *decision* not the *command* — "archive as-is" / "the prototypes shipped, reconcile" |
| Trust the proposal's "design covers X" claims | (AI did this well unprompted) validate against real source | Keep the validate-then-check habit; grep the actual components |
| Assume the session's edits are what gets committed | "commit and push" on a stale/unrelated tree | Always `git status` + `git log` before committing; confirm the diff matches intent |
| Auto-pick a commit strategy | No selection given, AI chose the "cleanest balance" two-commit split | Fine to let the AI choose when no answer comes, but state the split preference if you have one |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session. The workflow leaned entirely on the
existing OpenSpec skill family (`openspec-apply-change`, `openspec-archive-change`,
`openspec-sync-specs`) and a single `general-purpose` subagent spawn to sync the delta
specs.

**What *should* be captured:** the reusable lesson here is a **"design-only change
discipline"** — when a proposal declares itself design-only, the applier must (a) refuse
to build deferred code, (b) record the skip as a rationale block in `tasks.md`, and (c)
on re-invocation, detect the unchanged state and *ask once* rather than loop. That belongs
as a note in the `openspec-apply-change` skill (or a project memory keyed to design-only
umbrellas), so a future run doesn't rediscover it through three identical prompts.

## 7. Pitfalls & dead ends

- **Re-invocation looping:** running the same `/opsx:apply` against an unchanged change
  re-hits the same decision point every time. *If you hit this, stop and make the
  decision (archive / reconcile / start the follow-up) instead of re-running.*
- **Plan drift from reality:** the "deferred prototypes" were already built and archived
  in a sibling change. *If tasks look un-done on paper, verify against the filesystem +
  test suites before building — you may be about to re-implement shipped code.*
- **The isolated-but-unwired gap:** the Vite plugin had passing tests but was never
  imported into `packages/client/vite.config.ts`. *Tests-pass ≠ wired-in; check the
  integration point, not just the unit.*
- **Stale working tree on commit:** the tree at "commit and push" time was unrelated to
  the session's edits (the plugin work had been committed earlier by a human).
  *Always `git status`/`git log` before committing — never assume the diff is yours.*
- **A few `openspec validate --strict` calls "failed"** on the scaffold-only sibling
  changes — that's expected (proposal-only, no deltas yet), not a real error.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a clear statement of whether it's
design-only; access to the source components the design claims to cover.

- [ ] `openspec status --change <name> --json` → classify remaining tasks.
- [ ] If design-only: declare which tasks you'll skip + write a rationale block in `tasks.md`.
- [ ] Validate each "design covers X" task against real source (`grep`/`read` the components).
- [ ] Fix factual errors in sibling proposals as you find them.
- [ ] Scaffold the follow-up change (proposal.md only) matching sibling convention.
- [ ] On re-invocation with unchanged state → **ask once**, don't loop.
- [ ] Before archive: reconcile plan vs. filesystem (test suites) + wire any real gaps.
- [ ] Archive with a deliberate delta-sync decision; `openspec validate --strict`.
- [ ] On "commit and push": `git status`/`git log` first, run full tests, confirm split, push.

**Final artifacts produced:**
- `openspec/changes/add-dashboard-shell-slots-runtime/proposal.md` (scaffold)
- `openspec/specs/dashboard-shell-slots/spec.md`, `openspec/specs/dashboard-plugin-loader/spec.md` (stubs)
- Edits to `openspec/changes/dashboard-plugin-architecture/{design,tasks}.md`, `docs/architecture.md`,
  `openspec/changes/{extension-ui-system,extract-openspec-as-plugin}/proposal.md`
- Archived change `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/`
- Two commits pushed to `origin/develop` (`reattach-move-to-front` impl + docs scaffolds)

---

_Generated from session `019dc646-0e3f-72ca-baec-e1754c9fa0db` · `pi-agent-dashboard` · 2026-04-25. Source extract: facts sheet._
