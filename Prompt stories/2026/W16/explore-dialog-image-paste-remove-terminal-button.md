---
session: 019da4ce
week: 2026/W16
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [explore-dialog-image-paste-remove-terminal-button]
proposal_excerpt: "Two small UX improvements to the dashboard sidebar and OpenSpec dialogs:"
---

# How we did it: Land an OpenSpec change through recheck → apply → verify → archive — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a terse audit request: **"Recheck proposal
explore-dialog-image-paste-remove-terminal-button"**. The code for this two-part UX
change (add image-paste to the Explore dialog; remove the `+Terminal` button from the
`FolderActionBar`) was already committed across three earlier commits. The *real*
objective, which emerged over the next five steering turns, was **not to write the
feature but to finish landing it**: reconcile the git reality against the OpenSpec
artifacts, close the bookkeeping gaps (docs, tests, tasks.md), fix a genuine
type-signature divergence the verify step caught, sync the delta specs into the main
specs, and archive the change cleanly under `--strict` validation.

## 2. TL;DR playbook

1. **Recheck first.** Ask the AI to verify the proposal's claims against *current
   source* — a claim table (proposal says X → code reality ✅/❌) plus
   `openspec validate <change> --strict` and `git log` for the landing commits.
2. **Apply the remaining tasks.** Run the `/opsx:apply` flow. Most code was done; the
   AI closed doc gaps (`AGENTS.md`, `docs/architecture.md`) and one stale test
   assertion, ran the **scoped** client tests + `npm run build`, then ticked tasks.md.
3. **Say "go on"** to unblock the AI when it pauses after a phase — it batches the next
   set of verification steps.
4. **Verify against the design.** Run `/opsx:verify`. This caught the real bug: a
   `SessionHeader.onSendPrompt` type never widened to `(text, images?)` despite design
   decision **D3** naming it. Verify produces a CRITICAL/WARNING report, not a pass/fail.
5. **Say "fix"** — one word — to have the AI apply the flagged widening across all three
   sites and update the matching test assertion, then re-verify (build + scoped tests +
   `--strict`).
6. **Archive.** Run `/opsx:archive`. The AI syncs the three delta specs into main specs
   and moves the change to `openspec/changes/archive/<date>-<name>/`.

## 3. How the collaboration unfolded

**Phase A — Recheck (discovery).** The AI grepped the actual components
(`ExploreDialog.tsx`, `FolderActionBar.tsx`, `CommandInput.tsx`), confirmed the new
`useImagePaste.ts` hook and `ImagePreviewStrip.tsx` existed, verified no stray
`onCreateTerminal` remained on `FolderActionBar`, ran `--strict` validation, and read
`git log` for the three landing commits (`94c9a27`, `b25743a`, `867e34c`). *Why it
worked:* it treated the proposal as a set of falsifiable claims and checked each against
source, producing a claim-vs-reality table instead of trusting the doc.

**Phase B — Apply (close the gaps).** Driven by the `/opsx:apply` flow. Code was
already in place, so the AI found and fixed *bookkeeping* gaps: added the two new files
to `AGENTS.md`, removed the `+Terminal` reference from `docs/architecture.md`, fixed the
one stale assertion in `Dialogs.test.tsx` caused by the `(text, images?)` signature
widening, ran scoped tests + build, and ticked all 33 tasks. *Decision point:* it
scoped tests to the touched suites (CommandInput, Dialogs, MobileActionMenu) and
explicitly called out 59 pre-existing unrelated failures as noise, not regressions.

**Phase C — Verify (catch the divergence).** The `/opsx:verify` flow compared code
against the design decisions. It surfaced **W1**: `SessionHeader.tsx onSendPrompt` was
still `(text: string) => void` at two sites, though D3 listed it among three props to
widen. The AI confirmed the runtime path still worked (App.tsx forwards images) so it
was a WARNING, not CRITICAL — but a real divergence.

**Phase D — Fix + re-verify.** On the one-word "fix", the AI widened both
`onSendPrompt` signatures, added the `ImageContent` import, updated the
`MobileActionMenu.test.tsx` assertion to `toHaveBeenCalledWith(text, undefined)`, and
re-ran build + 36 scoped tests + `--strict`. W1 closed.

**Phase E — Archive + spec sync.** The `/opsx:archive` flow synced three delta specs
(`folder-action-bar`, `image-paste`, `openspec-dialogs`) into the main specs and moved
the change into `openspec/changes/archive/2026-04-19-<name>/`. It noted repo-wide spec
`## Purpose` drift as pre-existing, not caused by the sync.

## 4. Prompts that worked

- **The goal prompt — "Recheck proposal &lt;change&gt;".** Effective because it scoped
  the AI to *audit mode* first. Naming the exact change removes the ambiguity the
  `/opsx:*` flows otherwise resolve with an `ask_user`. Stronger version to reuse:
  *"Recheck &lt;change&gt;: verify each proposal claim against current source, run
  --strict, and tell me what's left to land."*
- **The `/opsx:apply`, `/opsx:verify`, `/opsx:archive` slash flows.** Pasting these
  structured flows as prompts is the high-leverage move — each carries its own
  select/validate/report contract, so the operator doesn't re-explain the workflow.
- **"go on"** — a one-word unblock after the AI paused between phases. Cheap and
  effective when the AI has already announced its next steps.
- **"fix"** — one word that turned a verify WARNING into an applied, re-verified patch.
  Works *only because* the preceding verify report named the exact site (D3 /
  `SessionHeader.tsx:22,40`); the AI had a precise target to act on.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after "implementation complete" with tasks unticked and change un-archived | Driving each next stage explicitly via the `/opsx:apply` → `/opsx:verify` → `/opsx:archive` flows | State up front: "take this all the way to archived, --strict clean" |
| Pause between phases awaiting confirmation | "go on" | Say "run apply→verify→archive end-to-end, only stop for a CRITICAL" |
| Trust the proposal's "task 3.1 done" checkbox for `SessionHeader` | Running `/opsx:verify` which diffed code vs design decision D3 | Always verify against **design decisions**, not just tasks.md checkboxes |
| Report 59 unrelated test failures as if scope-relevant | (Accepted the AI's own scoping) — but watch this | Ask for **scoped** test runs on touched suites + an explicit pre-existing-noise list |

The core lesson: a change whose code is committed is **not** landed. The gap between
"code merged" and "change archived" is exactly the bookkeeping (docs, tasks, tests) and
the design-vs-code divergences that only `/opsx:verify` catches.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode entirely on the existing
`/opsx:apply`, `/opsx:verify`, `/opsx:archive` OpenSpec flows.

**Recommended skill to formalize:** a *land-an-openspec-change* runbook that chains
**recheck (claims-vs-source table) → apply → verify-against-design-decisions → fix →
archive-with-spec-sync**, with the guardrails above baked in (scoped tests, design-
decision verification over checkbox trust, pre-existing-noise callouts). It would remove
the per-phase "go on" nudging and make "take it to archived, --strict clean" a one-shot
instruction. This repo already ships `ship-change` / `ship-it` skills — this session's
pattern is the OpenSpec-artifact-hygiene half that pairs with them.

## 7. Pitfalls & dead ends

- **`sed -i '' 's/- \[ \]/- [x]/g' tasks.md` failed** (bulk-tick attempt). Ticking every
  box blindly is both fragile and wrong — prefer the `/opsx:apply` flow's own task
  completion, or tick only verified tasks.
- **A `grep "^ FAIL" | awk` pipeline errored** while trying to enumerate failing suites.
  Iterating on grep/awk against vitest output wastes turns; run
  `npx vitest run --reporter=verbose <scoped-files>` and read the `×` lines directly.
- **jsdom `scrollIntoView` noise** shows up as a test "error" but is not a failure — don't
  chase it.
- **Checkbox trust bit once:** tasks.md said 3.1 done, code disagreed. If a task claims a
  type/signature change, grep the actual signature before believing it.
- **Repo-wide spec `## Purpose` drift** (176/182 specs) is pre-existing — don't let a
  global `openspec validate --strict` failure block a change that validates clean on its
  own name.

## 8. Reproduce it faster — checklist

- [ ] `openspec validate <change> --strict` and a claims-vs-source recheck table first.
- [ ] `/opsx:apply <change>` — close doc/test/tasks gaps; run **scoped** client tests +
      `npm run build`; tick verified tasks only.
- [ ] `/opsx:verify <change>` — diff code against the **design decisions** (Dn), not just
      checkboxes; expect a CRITICAL/WARNING report.
- [ ] Fix each flagged divergence at **every** named site + update matching test
      assertions; re-run build + scoped tests + `--strict`.
- [ ] `/opsx:archive <change>` — sync delta specs into main specs, move to
      `openspec/changes/archive/<date>-<name>/`.

**Inputs to have ready:** the change name; a working `openspec` CLI; the design.md
decision list (Dn) for the verify diff.

**Artifacts produced:** archived change under
`openspec/changes/archive/2026-04-19-explore-dialog-image-paste-remove-terminal-button/`;
synced `openspec/specs/{folder-action-bar,image-paste,openspec-dialogs}/spec.md`; updated
`AGENTS.md`, `docs/architecture.md`, `SessionHeader.tsx`, and the two test files.

---

_Generated from session `019da4ce` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-19. Source extract: session-to-guideline facts sheet._
