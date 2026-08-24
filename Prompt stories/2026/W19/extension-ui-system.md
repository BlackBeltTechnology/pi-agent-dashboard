---
session: 019e1259
week: 2026/W19
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [pi-flows-adopt-extension-ui, extension-ui-system]
proposal_excerpt: "Phase 3 of the `extension-ui-system` design. pi-flows currently registers TUI primitives (`flow:register-workflow`, `flow:register-gate`, `flow:register-card`, `register-footer-segment`) that have no dashboard equival…"
---

# How we did it: Auditing and splitting the extension-ui-system proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a deliberately small, audit-style question:

> "Proposal: extension-ui-system — What is missing of it?"

The real objective, once the follow-up landed, was two-fold: **(a) get a truthful
completeness assessment** of an existing multi-phase OpenSpec design change, and then
**(b) surgically extract one phase** (Phase 3, the external pi-flows / pi-judo adoption
work) into its own coordination-only change so the parent change reads as "done" for all
in-repo work. This is a scope-hygiene task on OpenSpec artifacts, not feature code.

## 2. TL;DR playbook

1. **Ask "what is missing of it?"** against the named change — let the AI enumerate
   pending / deferred / already-scaffolded items rather than guessing yourself.
2. Let it read the change's `proposal.md`, `design.md`, `tasks.md` and grep for the
   phase boundary (`grep -n -i "phase 3\|pi-flows" …`) to ground the answer in files.
3. Confirm the audit: which items are genuinely blocking vs. external-coordination vs.
   deferred-by-design.
4. **Steer the split:** "Move Phase 3 to another proposal and make it done and deferred
   in here."
5. Scaffold the new change dir (`mkdir -p openspec/changes/<new-name>`) and write its
   `proposal.md` + `specs/<capability>/spec.md` + `tasks.md` as a *coordination-only*
   tracker.
6. Edit the parent `tasks.md`: mark the moved items `[x]` **Moved** with a pointer to
   the new change — do not delete them.
7. **Validate both** with `openspec validate --changes` (note: `openspec change validate
   <name>` is the working subcommand form — see Pitfalls).
8. Report the net state: parent change now has **zero open in-repo tasks**.

## 3. How the collaboration unfolded

**Phase A — Audit (discovery).** The AI located the change (`ls openspec/changes/ |
grep -i extension-ui`), listed its artifacts, and grepped the three spec files for the
Phase 3 / pi-flows boundary. It then produced a crisp status ledger: 3 pending items
(all external maintainer sign-offs: 1.2, 1.3, 2.4), 1 explicitly deferred (3.3, an
AGENTS.md update that lands with Phase 1), and four scaffolded follow-up changes
(`add-extension-ui-modal`, `-decorations`, `-rjsf-form`, plus Phase 3 living in pi-flows).
*Why it worked:* the "what is missing" framing forced an evidence-backed inventory
instead of a vague "looks mostly done."

**Phase B — Split (the steer).** On the single steering prompt, the AI created
`openspec/changes/pi-flows-adopt-extension-ui/` with a full proposal, a specs delta
(`specs/pi-flows-extension-ui-adoption/spec.md`), and a tasks.md — a coordination-only
change owning Phase 3. It then edited the parent's `tasks.md` to mark items 1.2, 1.3, 2.4
as `[x] Moved` pointing at the new change.

**Phase C — Verify.** It validated both changes (`openspec validate --changes | grep …`)
and reported both valid, with the parent now carrying zero open in-repo tasks.

Decision point: the human chose *move, don't delete* — the moved tasks stay visible in
the parent as pointers, preserving the audit trail across the two changes.

## 4. Prompts that worked

- **The goal prompt — "What is missing of it?"** Effective because it's an open audit
  request scoped to one named artifact. It makes the AI enumerate state rather than
  editorialize. Reusable verbatim for any OpenSpec change: *"Proposal: <name> — what is
  missing of it?"*
- **The high-leverage follow-up — "Move Phase 3 to another proposal and make it done and
  deferred in here."** One sentence that encodes the whole refactor: extract a phase,
  create the new tracker, and reflect the move back in the source. Note the two verbs —
  *done* (mark complete) and *deferred* (moved elsewhere) — that told the AI to use
  `[x] Moved` rather than deleting or leaving open.

Stronger rewrite of the follow-up for future use: *"Extract Phase 3 into a new
coordination-only change `pi-flows-adopt-extension-ui` (proposal + specs delta + tasks).
In the parent tasks.md, mark the moved items `[x] Moved → <new-change>`, don't delete
them. Then run `openspec change validate` on both."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at the audit (report status, no action) | Explicitly asking to "move Phase 3 to another proposal" | State the desired end-state in the first prompt if you already want the split |
| Leave moved tasks ambiguous | Saying "make it done and deferred in here" | Specify the exact marker: `[x] Moved → <change>` (preserve, don't delete) |
| Risk inventing a proposal link | (avoided — grounded in real files) | Always require file-grounded audits (`grep`/`read`), never memory-based |

The only correction was a scope *addition* — turning a read-only audit into an
edit — so the guardrail is: if you know you want the refactor, front-load it into the
goal prompt to skip the two-turn round trip.

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session — it was a targeted, one-off OpenSpec
scope split. The workflow *is* repeatable, though. A worthwhile skill to capture:
**"split an OpenSpec phase into a coordination-only change"** — steps: scaffold new
change dir → write proposal/specs-delta/tasks → mark parent tasks `[x] Moved` → validate
both. That would turn this two-prompt dance into a single invocation for the next phase
extraction.

## 7. Pitfalls & dead ends

- **`openspec validate <name>` failed.** The bare `validate <name>` form errored; the
  working invocations were `openspec change validate <name>` (subcommand form) and
  `openspec validate --changes` (validate-all form). If a change validate errors on the
  positional name, switch to the `change validate` subcommand or the `--changes` sweep.
- **Don't delete moved tasks.** The instinct is to remove Phase 3 items from the parent.
  Instead mark them `[x] Moved` with a pointer — the audit trail matters more than a
  clean list.

## 8. Reproduce it faster — checklist

- [ ] Name the target change; ask *"what is missing of it?"* to get a file-grounded ledger.
- [ ] Have the AI `grep -n -i` the phase keyword across `proposal.md design.md tasks.md`.
- [ ] Decide the split up front and state it: which phase → which new change name.
- [ ] `mkdir -p openspec/changes/<new-name>`; write `proposal.md`, `specs/<cap>/spec.md`,
      `tasks.md` (coordination-only).
- [ ] Edit parent `tasks.md`: moved items → `[x] Moved → <new-change>` (never delete).
- [ ] Validate both: `openspec change validate <name>` or `openspec validate --changes`.
- [ ] Confirm the parent now has **zero open in-repo tasks**.

Key inputs: an existing OpenSpec change with clear phase boundaries in its `tasks.md`.
Final artifacts: `openspec/changes/pi-flows-adopt-extension-ui/` (proposal.md +
specs/pi-flows-extension-ui-adoption/spec.md + tasks.md) and an updated
`openspec/changes/extension-ui-system/tasks.md`.

---

_Generated from session `019e1259` · `pi-agent-dashboard` · 2026-05-10. Source extract: deterministic facts sheet._
