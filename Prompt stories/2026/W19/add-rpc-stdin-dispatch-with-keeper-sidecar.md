---
session: 019e13e4
week: 2026/W20
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [enable-rpc-keeper-by-default, retire-rpc-keeper-when-dispatchcommand-available, add-rpc-stdin-dispatch-with-keeper-sidecar]
proposal_excerpt: "The parent change `add-rpc-stdin-dispatch-with-keeper-sidecar` shipped the per-session RPC keeper as **opt-in** (`useRpcKeeper: false` default) — a deliberate de-risking move so the legacy headless spawn paths (Unix `…"
---

# How we did it: Splitting an "already-done" OpenSpec change into scoped follow-ups — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the standard `/opsx-apply` prompt:

> "Implement tasks from an OpenSpec change… Auto-select if only one active change exists… get apply instructions."

The named change was `add-rpc-stdin-dispatch-with-keeper-sidecar`. But the *real*
objective only became clear once the AI checked status: the change was already
**65/71 tasks complete and `isComplete: true`**. The 6 remaining tasks were explicitly
tagged in `tasks.md` as **out of scope** — §12 "Upstream follow-up (NOT blocking this
change)" and §13 "Phase 2 ship criteria — separate change." So the true task was not
"finish implementing" but: **recognize the scope boundary, don't cross it, and
relocate the deferred work into properly-scoped follow-up changes** — then verify the
parent is archive-ready. Two new OpenSpec changes (`enable-rpc-keeper-by-default`,
`retire-rpc-keeper-when-dispatchcommand-available`) were scaffolded to absorb the
deferred tasks, and the parent's tasks.md was reconciled to 71/71.

## 2. TL;DR playbook

1. Run `openspec status --change "<name>" --json` **first** — read `isComplete` and the
   per-task completion before writing any code.
2. Open `tasks.md` and look for scope-fence headings (`NOT blocking`, `separate change`,
   `Phase 2`). Deferred tasks are a routing signal, not a to-do list.
3. If the in-scope phases are green, **do not implement the deferred tasks in place** —
   announce that finishing them would cross a scope boundary.
4. Scaffold a follow-up per deferred cluster: `openspec new change "<kebab-name>"` (CLI
   lowercases the slug — use lowercase yourself to avoid a failed run).
5. Draft each follow-up's `proposal.md` with an explicit **gating precondition** (e.g.
   "parent must ship in a tagged release + ≥1 soak cycle"), verified against `git tag`
   and the `[Unreleased]` CHANGELOG section.
6. Reconcile the parent's `tasks.md`: mark relocated tasks `[x]` with a
   `Relocated to <change-name>` annotation — keep genuinely-outstanding tasks unchecked.
7. Run `/opsx-verify`; delegate the heavy multi-spec read to an **Explore subagent** to
   keep main context lean; collect file+line evidence per requirement.

## 3. How the collaboration unfolded

**Phase A — Status-first triage (Discovery).** The AI's first move on the apply prompt
was *not* to code but to run `openspec status … --json` and read `tasks.md`. It found
65/71 done, `isComplete: true`, and the two out-of-scope fences. *Why it worked:*
reading the completion state before touching code prevented pointless (and
scope-violating) implementation. Decision point: the AI declared "there is nothing to
implement here without crossing into a different change's scope."

**Phase B — Scaffold the first follow-up (Design).** It switched from the `apply`
workflow to the `new change` workflow, ran `openspec new change
"enable-rpc-keeper-by-default"`, and drafted a proposal covering §13.1–13.4. It grounded
the gating condition in real evidence: `git log`/`git tag` showed latest tag `v0.5.1`,
and `grep` on CHANGELOG showed the keeper entry still under `[Unreleased]` — so the
follow-up is explicitly gated on the parent shipping first.

**Phase C — Reconcile the parent (steering-driven).** The human said "The relocated
tasks be marked as done." The AI marked §13.1–13.4 `[x]` with a `Relocated to
enable-rpc-keeper-by-default` annotation (65→69/71) but **pushed back** on §12.1/12.2:
those were a different scope (an upstream PR + a keeper-teardown change), not
relocations. The human then said "relocate to new proposal," so the AI scaffolded
`retire-rpc-keeper-when-dispatchcommand-available` to absorb 12.1/12.2 and marked them
`[x]` → **71/71**.

**Phase D — Verify (Verify).** On `/opsx-verify`, the AI recognized it would need to read
6 spec files + design and cross-check 40 requirements against the codebase — "heavy
reading work" — and **delegated to an Explore subagent**. Result: 71/71 tasks, 40/40
requirements with implementation+test evidence, no CRITICAL/WARNING/SUGGESTION items,
archive-ready.

## 4. Prompts that worked

- **The goal prompt** (`/opsx-apply …`): effective because it forced a status check
  first. The lesson isn't the prompt text — it's that the *apply* skill's step-1
  ("check status to understand the schema") is what caught the already-done state. A
  stronger kickoff would add: *"If the change is already `isComplete`, do not implement;
  report the scope boundary and propose follow-ups."*
- **"The relocated tasks be marked as done"** — a high-leverage 6-word steer that told
  the AI the deferred §13 work now had a home and the parent could be reconciled.
- **"relocate to new proposal"** — another terse steer that unblocked the §12 cluster
  once the AI had flagged it as genuinely-distinct scope.
- **`/opsx-verify`** — closed the loop by demanding evidence, not assertion, that the
  parent was archive-ready.

Rewrite for next time: pair the apply prompt with an explicit stop-condition —
*"Apply `<change>`; if it is already complete, relocate any deferred tasks into new
changes rather than implementing them here."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the apply request literally and hunt for something to implement | (AI self-corrected via status-first) — reinforce by stating the stop-condition up front | Add "if `isComplete`, don't implement, relocate" to the apply prompt |
| Leave deferred tasks unchecked with no home | "The relocated tasks be marked as done" | Route each deferred-task cluster to a named follow-up change and annotate `Relocated to …` |
| Lump §12 (different scope) with §13 (relocatable) | "relocate to new proposal" | Distinguish *relocatable* (belongs in a peer change) from *genuinely-outstanding* (upstream PR, other repo) before marking anything done |
| Risk over-marking real outstanding work | AI correctly pushed back that 12.1/12.2 were "real outstanding work, not relocations" | Only mark `[x]` when the task truly moved; keep an audit annotation |

The valuable discipline here: **the AI refused to silently check boxes** and made the
human confirm intent before marking §12 done. Preserve that — box-marking is an audit
trail, not a formality.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created, but the workflow is clearly repeatable and deserves
one. Recommended skill: **`opsx-relocate-deferred-tasks`** —

- **What it would capture:** the status-first triage → detect scope fences in tasks.md →
  scaffold a gated follow-up change → reconcile the parent with `Relocated to …`
  annotations → verify pattern.
- **Why it's effective:** it removes the judgment overhead of "is this change done or
  not," prevents the classic failure of implementing deferred work in the wrong change,
  and standardizes the relocation annotation so archive-time verification is trivial.
- **When to invoke:** any `/opsx-apply` where `openspec status` reports `isComplete:
  true` but tasks.md still has unchecked items behind `NOT blocking` / `separate change`
  fences.

**Subagent that earned its keep:** the `Explore` subagent for verification. Reading 6
specs + design + cross-checking 40 requirements is exactly the read-heavy, low-decision
work that belongs off the main context.

## 7. Pitfalls & dead ends

- **CLI slug casing:** `openspec new change "retire-rpc-keeper-when-dispatchCommand-available"`
  **failed** (1 of 18 commands). The CLI lowercases the slug; the mixed-case name caused
  a mismatch. Fix: pass the kebab-case lowercase name yourself
  (`…-dispatchcommand-available`).
- **Don't confuse two different follow-ups:** `enable-rpc-keeper-by-default` retires the
  *config flag*; `retire-rpc-keeper-when-dispatchcommand-available` retires the *keeper
  itself* once upstream `pi.dispatchCommand` lands. They are separate changes with
  separate gates — the AI called this out explicitly to avoid merging them.
- **Gating on release reality:** a follow-up that depends on the parent shipping must
  verify against `git tag` + the `[Unreleased]` CHANGELOG section, not assume. Here the
  parent sat under `[Unreleased]` with latest tag `v0.5.1`, so the follow-ups are
  correctly marked "not yet ready to implement."

## 8. Reproduce it faster — checklist

Inputs to have ready:
- The change name and a clean `openspec` CLI in the repo.
- Write access to `openspec/changes/**/tasks.md` and `proposal.md`.

Steps:
1. `openspec status --change "<name>" --json` → check `isComplete` + per-task state.
2. Read `tasks.md`; find `NOT blocking` / `separate change` / `Phase 2` fences.
3. If in-scope phases are green, **stop** — do not implement deferred tasks in place.
4. `openspec new change "<lowercase-kebab-name>"` per deferred cluster.
5. Draft each `proposal.md` with an explicit gate; verify against `git tag` + CHANGELOG
   `[Unreleased]`.
6. Mark relocated tasks `[x]` with `Relocated to <change-name>`; leave true-outstanding
   tasks unchecked.
7. `/opsx-verify`; delegate the multi-spec read to an `Explore` subagent; collect
   file+line evidence.

Artifacts produced:
- `openspec/changes/enable-rpc-keeper-by-default/proposal.md` (created)
- `openspec/changes/retire-rpc-keeper-when-dispatchcommand-available/proposal.md` (created)
- `openspec/changes/add-rpc-stdin-dispatch-with-keeper-sidecar/tasks.md` (reconciled to 71/71)

---

_Generated from session `019e13e4-e9c3-77cb-b1cb-e1b7c5107543` · `pi-agent-dashboard` · 2026-05-11. Source extract: session-to-guideline facts sheet._
