---
session: 019f7c53
week: 2026/W29
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-stacked-escape-closes-layers, fix-session-diff-eventloop-block]
proposal_excerpt: "Pressing Escape while a full-screen overlay is stacked on top of another dismissible surface closes both layers at once. Reported case: open the OpenSpec Explore dialog, click a pasted-image thumbnail to open the lightbox, press Escape — both the lightbox and the dialog close."
---

# How we did it: Diagnosing & planning the "Escape closes two dialogs at once" fix — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator entered **explore mode** on a UI bug: pressing **Escape** while a
full-screen overlay (image lightbox, file-preview, Mermaid fullscreen) sits stacked
on top of an already-dismissible dialog closes **both** layers at once. The reported
symptom was narrow — "open the Explore dialog → click a pasted-image thumbnail → the
lightbox opens → Escape closes lightbox *and* dialog" — but the *real* objective, once
the exploration surfaced the mechanism, was to **capture a correct, spec-level
OpenSpec change proposal** for a general class of bug (uncoordinated global Escape
listeners across ~15 overlays), and then run it through the full planning phase
(doubt review + scenario design + test-plan fold) up to the git-worktree boundary.

## 2. TL;DR playbook

1. **Enter explore mode** (`/openspec:openspec-explore`) — stance = think, don't
   implement. Read/search/investigate only.
2. **Trace the mechanism, not the symptom.** Grep for every global Escape/keydown
   listener across the overlay + dialog surfaces; confirm none call
   `stopPropagation`. Find the *class* of bug, not the one repro.
3. **Present options with a trade-off**, then let the operator pick. Here: Option A
   (per-overlay `stopPropagation` patch) vs **Option B** (shared LIFO escape-dismiss
   stack + `useEscapeDismiss` hook, one global listener → topmost layer only).
4. On **"Capture proposal with Option B"** — scaffold the OpenSpec change by
   mirroring an existing `openspec/changes/<name>/` tree (there is *no* `scaffold`
   subcommand); write `proposal.md`, `tasks.md`, and spec deltas; `openspec validate
   --strict`.
5. Run **`/plan-proposal`** — it auto-fires `doubt-driven-review` because the proposal
   was created this session. Let the cross-model reviewer (`@propose-review-1`) run
   adversarially with ARTIFACT + CONTRACT only (no claim, no reasoning).
6. **Reconcile every finding by class** (contract-misread → actionable → trade-off →
   noise). Correct the artifact; if the *core mechanism* changed, run a **second**
   doubt cycle on the corrected design. Stop when findings converge (≤3 cycles).
7. Run **`scenario-design`** at proposal stage (HARD gate) → write `test-plan.md`
   manifest → **fold every automated row 1:1 into `tasks.md`**; verify `openspec
   status` parses the checkbox count.
8. **Commit only your change's artifacts** to `develop`; leave unrelated working-tree
   changes alone. **Stop at the worktree boundary** — planning ends here.

## 3. How the collaboration unfolded

**Phase 1 — Diagnosis (explore stance).** The AI grepped `packages/client/src` and
`packages/client-utils` for the lightbox, the Explore dialog, `ImagePreviewStrip`,
and every `onClose|Escape|stopPropagation` site. It found that the shared `Dialog`
attaches a **`window`** keydown→close listener while `ImageLightbox`,
`FilePreviewOverlay`, and `MermaidBlock` each attach an independent **`document`**
keydown→close listener with **no `stopPropagation`** — so one Escape fires both.
*Why it worked:* it chased the propagation mechanism across all overlays instead of
patching the single reported dialog, correctly reframing it as an event-arbitration
class bug. (Note: grep output was partially redacted/mangled — the AI fell back to
reading the files directly rather than trusting mangled symbol names.)

**Phase 2 — Options + capture.** The AI laid out Option A vs Option B with an explicit
trade-off (why per-overlay `stopPropagation` fails the overlay-on-overlay
`document`-vs-`document` case and isn't DRY across ~15 listeners). The operator chose
**Option B**. The AI discovered `openspec change new` has no scaffold, mirrored an
existing change tree, wrote the three artifacts, and got a strict-clean validate.

**Phase 3 — Doubt-driven review (the high-value phase).** `/plan-proposal` fired two
**cross-model** review cycles on `@propose-review-1` (`zai/glm-5.2`, a different model
family than the Opus author — this is what made it substantive, not rubber-stamping):
- *Cycle 1* caught an **inverted event-phase rationale** ("window bubble composes with
  document listeners" is backwards — bubble order is document→window, so window fires
  *last* and can't arbitrate) plus ~10 real gaps (sibling-listener consumption,
  `defaultPrevented`/input-focus opt-out, "topmost registered" ≠ "visually topmost").
- *Cycle 2* caught that the fix's **correctness was wrongly resting on propagation
  arbitration**. The reconciliation **reframed the core mechanism**: the double-close
  is fixed by *one shared listener + LIFO stack*, independent of event phase; consume
  is demoted to best-effort vs unmigrated peers; attach-once/never-detach for ordering
  stability; documented the React synthetic-`stopPropagation` constraint + migration
  checklist; **scoped v1 to the 3 portaled surfaces and deferred MermaidBlock** (inline
  focus → LIFO ≠ visual order).

**Phase 4 — Scenario design + fold.** `scenario-design` ran at the proposal HARD gate;
all Triple slots (input · trigger · observable) were fillable from the corrected spec,
so no blocking `ask_user`. 18 automated manifest rows (E1–E11, F1–F6, X1) folded 1:1
into `tasks.md` (4.1–4.18); `openspec status` parsed 37 tasks matching the raw checkbox
count — parser-safe confirmed.

**Phase 5 — Commit at the boundary.** The AI staged **only** the change dir, committed
`4a20bf4aa`, then noticed two *unrelated* working-tree changes (`groups.json`,
`scripts/ab-context/`). It refused to sweep them in silently — committed `groups.json`
separately (`a898af07a`) and left `ab-context/` untracked. Stopped at the worktree
boundary per the skill.

## 4. Prompts that worked

- **The goal prompt** — the `openspec-explore` skill invocation. Effective because it
  set a **stance** ("think, don't implement; you MAY create OpenSpec artifacts") that
  kept the AI in diagnosis mode instead of jumping to a code patch. A future operator
  should open bug work this way when the fix approach is still unknown.
- **"Capture proposal with Option B"** — a 4-word, high-leverage unlock. It worked
  because the AI had already presented A vs B with a trade-off, so a single-word
  choice launched the whole capture. *Lesson:* make the AI enumerate options **with a
  recommendation and trade-off** first, then pick with one word.
- **`/plan-proposal`** — invoking the orchestrator skill did the heavy lifting (auto
  doubt-review, scenario-design, fold, commit-and-stop). Better than hand-driving each
  phase.
- **"commit"** — trusted the AI to stage the right files. It paid off *because* the AI
  had the discipline to isolate its own artifacts and flag unrelated changes rather
  than blindly `git add -A`.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay in open-ended explore mode | "Capture proposal with Option B" | State the decision explicitly once options are on the table — the AI won't self-authorize the jump from explore → capture |
| Trust grep output whose symbols were redaction-mangled | (self-corrected) read files directly | When grep output looks mangled, read the source file instead of guessing at identifiers |
| Author a design rationale with an **inverted event-phase claim** | The cross-model doubt reviewer flagged it | Always run `doubt-driven-review` with a **different model family** as reviewer; give it ARTIFACT + CONTRACT only, no claim/reasoning, so it can't anchor on the author's framing |
| Rest the fix's correctness on propagation arbitration | Cycle 2 reviewer forced the reframe | Prefer a mechanism that is correct by *structure* (one shared listener + LIFO) over one that depends on event-phase subtleties |
| Bare `commit` could have swept unrelated changes | (self-corrected) isolated its own artifacts | Commit only the change dir; inspect and separately handle anything else in the working tree — never `git add -A` at a planning boundary |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session **used** the existing planning
pipeline rather than authoring one:

- **`openspec-explore`** — enforces a think-only stance so diagnosis reframes the class
  of bug before any code is written. Invoke when the fix approach is unknown.
- **`plan-proposal`** — orchestrates doubt-review → scenario-design → fold → commit,
  stopping at the worktree boundary. Invoke once a proposal exists and you want it
  planning-complete.
- **`doubt-driven-review`** with a configured `@propose-review-1` cross-model role — the
  single highest-leverage asset here. It caught a factual design error and a core-
  mechanism flaw that a same-model self-review would almost certainly have missed.
  *Effective because* the reviewer is a **different model family** fed only ARTIFACT +
  CONTRACT.
- **`scenario-design`** — turns spec requirements into a Triple-checked test manifest and
  a HARD gate that blocks planning if any (input · trigger · observable) slot is
  unfillable.

*Recommended memory to save for next time:* "`openspec change new` has no `scaffold`
subcommand — mirror an existing `openspec/changes/<name>/` tree to create artifacts."

## 7. Pitfalls & dead ends

- **`openspec change new … scaffold` doesn't exist.** The AI tried the CLI, found no
  scaffold subcommand, and had to mirror an existing change directory structure by
  hand. → If you need a change tree, copy the shape of a sibling change.
- **Redaction mangles grep output** (symbols replaced with `ln`). → When identifiers
  look corrupted, read the file directly instead of trusting the grep line.
- **Same-model self-review is doubt theater.** The inverted event-phase rationale
  survived the author's own passes; only the cross-model reviewer caught it. → Always
  configure a *different-family* reviewer role for `doubt-driven-review`.
- **Bare `commit` at a planning boundary is risky** if unrelated changes sit in the
  working tree. → Stage only the change dir; handle `groups.json` / experiment folders
  separately.
- **Inline-focus overlays (MermaidBlock) break the LIFO≠visual assumption.** → Scope a
  shared-escape-stack v1 to portaled/full-screen surfaces; defer inline-focus cases.

## 8. Reproduce it faster — checklist

- [ ] Open with `/openspec:openspec-explore` (think-only stance).
- [ ] Grep every global Escape/keydown→close listener across overlays + dialogs;
      confirm which lack `stopPropagation`. Read files directly if grep is mangled.
- [ ] Reframe the reported symptom as the *class* of bug; present Option A vs B **with
      a trade-off + recommendation**.
- [ ] On the operator's one-word pick, mirror an existing `openspec/changes/<name>/`
      tree; write `proposal.md` + `tasks.md` + spec deltas; `openspec validate --strict`.
- [ ] Run `/plan-proposal`; ensure a **cross-model** `@propose-review-1` role is
      configured; run doubt cycles until findings converge (≤3).
- [ ] Reconcile findings by class; if the core mechanism changed, run a 2nd cycle.
- [ ] `scenario-design` → `test-plan.md` manifest → fold all automated rows 1:1 into
      `tasks.md`; verify `openspec status` parses the checkbox count.
- [ ] Stage **only** the change dir; commit to `develop`; stop at the worktree boundary.

**Key inputs to have ready:** a configured `@propose-review-1` reviewer role of a
different model family; a sibling OpenSpec change to mirror; the `plan-proposal` /
`doubt-driven-review` / `scenario-design` skills installed.

**Final artifacts produced:** `openspec/changes/fix-stacked-escape-closes-layers/`
(`proposal.md`, `tasks.md`, `test-plan.md`, 3 spec deltas — `modal-escape-dismiss`
new, `dialog-primitive` + `image-lightbox` modified). Commits `4a20bf4aa`
(planning) and `a898af07a` (unrelated board regroup).

---

_Generated from session `019f7c53` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-24. Source extract: `/tmp/facts-6nQDvC`._
