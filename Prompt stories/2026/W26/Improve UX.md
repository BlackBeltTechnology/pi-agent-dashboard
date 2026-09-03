---
session: 019f05ee
week: 2026/W26
type: planning
model: "@fast"
premium: true
premium_reason: "yes — created 0 skill(s) / 3 memory(ies); heavy steering (12 user prompts)"
upgrade_status: pending
openspec_changes: [improve-dashboard-attention-routing, extend-client-utils-state-feedback-primitives, add-server-push-notifications]
proposal_excerpt: "The dashboard's single most important daily question — *\"which of my running sessions needs me right now?\"* — is the hardest to answer at a glance. Grounded in the live UI (14 active sessions across folders) and the a…"
---

# How we did it: Improve pi-dashboard UX — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore` skill) with a deliberately
open brief: *"improve pi-dashboard UX"* — think deeply, visualize freely, follow the
conversation, but **never implement**. No target surface was named up front.

The *real* objective, once the steering turns clarified it: find the highest-ROI UX
defect in the live dashboard, **ground the diagnosis in real component source** (not
screenshots or hunches), and capture the fix as **validated OpenSpec change proposals**
plus a **live-served mockup** — all with zero application code written. The session
ended with two `--strict`-validated changes committed cleanly.

## 2. TL;DR playbook

1. **Enter explore mode** with the `openspec-explore` skill — the stance that lets you
   investigate + write OpenSpec artifacts but never implement.
2. **Ground in the live UI first**: hit `curl localhost:8000/api/health` to confirm the
   dashboard is up, then drive the `browser` skill to capture home + detail + dark-theme
   surfaces. Read the `frontend-mockup-loop` rubric (Nielsen 10, Laws of UX, WCAG floor).
3. **Turn each visual hunch into a code-level defect**: open the actual source
   (`session-status-visuals.ts`, `SessionCard.tsx`, `ArtifactChip`, `ChatView.tsx`)
   and build a state→visual truth table. The smoking gun beats the screenshot.
4. **Steer with "keep exploring"** to sweep 6 surfaces; run a deliberate **falsification
   pass** on a surface you've never opened (OpenSpec board) to pressure-test the thesis.
5. **Scaffold the change** with `openspec new change <name>` (NOT `openspec change new`),
   then write proposal / design / tasks / spec deltas.
6. **Validate** with `openspec validate <name> --strict` — put **SHALL/MUST on the first
   physical line** of every `### Requirement` body (the parser only reads line 1).
7. **Build one self-contained mockup** grounded in the real `index.css` tokens; add a
   **grayscale toggle** to prove the non-hue channel; `serve_mockup` and hand back the
   live URL (screenshots are your scoring step, not the deliverable).
8. **Commit surgically**: stage only the change dirs you created; leave unrelated
   in-flight work untouched.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (rabbit-hole, then recover).** The AI opened by running
`find /` for skills and blew time on it. The human's `"it sucked"` snapped it back:
it pivoted to `curl` the live health endpoint and drive the browser at the actual
`:8000` dashboard (v0.5.4, 14 active sessions). *Effective bit:* ground in the running
system before theorizing.

**Phase 2 — Ground the diagnosis in source.** With `2 1` the human picked the
attention-routing surface + "capture as OpenSpec." The AI read
`session-status-visuals.ts` and found the code-level defect: `deriveRailBgColor` and
`deriveDotColorWithFlags` have **no `ask_user` branch**, so a session *blocked waiting
for you* renders the same green rail+dot as a finished-idle one — and `ActivityIndicator`
emits `"Waiting for input"` for two opposite states. This turned a hunch into hard WCAG
1.4.1 / Nielsen H4 violations.

**Phase 3 — Sweep + falsify.** Four `"keep exploring"` turns swept the folder-header
density, the `P D S T` `ArtifactChip` cluster, the composer/search focus rings, and
empty/loading states — every surface failed the *same shape* (hue-only state, hover-only
info, thin 1px focus, ad-hoc empty/loading). The AI then **tried to falsify** its own
thesis on the OpenSpec board view; a `grep export (EmptyState|Skeleton|FocusRing)`
returning **zero matches** was the keystone: the missing primitives literally don't exist.
It also self-corrected two earlier screenshot-based misreads (spawn buttons *were* already
elevated; the stepper *does* label in its sidebar variant).

**Phase 4 — Capture as OpenSpec.** With `2`, `2`, `scaffold` the AI wrote two validated
changes: `improve-dashboard-attention-routing` (the slice) and
`extend-client-utils-state-feedback-primitives` (the umbrella). Both passed
`--strict` after fixing the SHALL-on-line-1 parser quirk.

**Phase 5 — Mockup + verify.** `ketch mokups` [sic] triggered a single self-contained
`mockups/index.html` grounded in real tokens, with dark/light/**grayscale** toggles. The
grayscale test was decisive proof: with zero hue, `●/◐/○` shapes + labels still
distinguish "needs you" from "idle." Served live via `serve_mockup`.

**Phase 6 — Stop + commit.** `serve_mockup stop`, then `commit` — the AI staged **only**
the two change dirs (16 files), leaving a large unrelated in-flight tree untouched.

## 4. Prompts that worked

- **Goal prompt (`openspec-explore` skill):** effective because it set an explicit
  *stance* — investigate + capture, never implement — which kept the whole session on
  the thinking/spec rails and produced proposals instead of premature code.
- **`"it sucked"` (steering #1):** brutal but high-leverage — killed the `find /`
  rabbit-hole instantly. A stronger version: *"stop searching the filesystem; curl the
  live dashboard and read the real source."*
- **`"keep exploring"` ×4:** a tiny prompt that unlocked a full 6-surface sweep and the
  falsification pass. Works because the AI had a rubric to sweep against.
- **`2 1` / `2` / `scaffold`:** terse menu-picks that chose the highest-ROI direction and
  told it when to stop exploring and start capturing.
- **`commit`:** trusted the AI to scope the commit — and it correctly staged only its own
  artifacts.

Rewrite of the weakest one (`ketch mokups`): *"build one self-contained mockup grounded
in the real index.css tokens, with a grayscale toggle, and serve it."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Rabbit-hole on `find /` for skills | `"it sucked"` | Say "ground in the live dashboard + real source first" in the goal prompt |
| Diagnose from screenshots (misread "no primary", "P D S T unlabeled") | Implicitly, by the AI re-grounding in source | Make "open the actual component before asserting a defect" a standing rule |
| Keep exploring indefinitely | `2` / `scaffold` to say "stop, capture now" | State the exploration budget ("sweep ≤6 surfaces, then scaffold") |
| Risk committing unrelated in-flight work | `commit` (AI self-scoped correctly) | Reaffirm surgical-commit discipline — stage only this session's dirs |

Quality bars the human implicitly imposed: no application code (explore stance),
real-token grounding, and a WCAG grayscale proof for any color-carrying state.

## 6. Skills, tools & memory created — and why they're effective

No skills were created, but **3 memories** were saved:

- **project · insight** — `packages/client-utils/` centralizes overlay/shell/interaction
  primitives (Dialog, Popover, Confirm, useFocusTrap, StatusPill) but **not** the
  state/feedback layer (EmptyState, Skeleton, FocusRing). *Effective because* it names the
  exact architectural gap any future UX change must fill, and where.
- **project + memory · tool-quirk** — `openspec validate --strict` reads **only the first
  physical line** of a `### Requirement` body for the SHALL/MUST check; if SHALL wraps to
  line 2 it errors. Scaffold with `openspec new change <name>` (NOT `openspec change new`).
  *Effective because* it removes the exact validation dead-end this session hit.

**Skill that *should* exist:** a `ground-ux-defect-in-source` procedure — capture live
surface → build a state→visual truth table from the real status/style helper → cite the
Nielsen/WCAG rule → scaffold OpenSpec. This session executed it manually four times.

## 7. Pitfalls & dead ends

- **`find /` for skills** — slow and noisy; scope searches to `~/.pi`, `~/.agents`, and
  `node_modules` instead.
- **`openspec change new`** — wrong subcommand; it's `openspec new change <name>`.
- **SHALL on line 2 of a requirement** — `--strict` fails silently-looking; keep the
  keyword on the first physical line.
- **Screenshot-only diagnosis** — produced two wrong reads (elevated spawn buttons,
  stepper labels). Always confirm against source before writing the defect into a spec.
- **Full-page browser screenshot clipped to viewport** — snapshot interactive elements
  and scroll/navigate instead of relying on one full-page shot.
- **Memory stores full** — not blocking here (everything was captured in the proposals),
  but be ready to consolidate.

## 8. Reproduce it faster — checklist

- [ ] Dashboard running on `:8000` (`curl localhost:8000/api/health`).
- [ ] Enter explore mode via the `openspec-explore` skill.
- [ ] Browser-capture home + detail + dark theme; read the `frontend-mockup-loop` rubric.
- [ ] For each candidate defect, open the real source and build a state→visual truth table.
- [ ] Run a falsification pass on an unopened surface + `grep export` for the "missing" primitive.
- [ ] `openspec new change <name>`; write proposal / design / tasks / spec deltas.
- [ ] SHALL/MUST on line 1; `openspec validate <name> --strict`.
- [ ] One self-contained `mockups/index.html` on real tokens + grayscale toggle; `serve_mockup`.
- [ ] Stage only this session's change dirs; commit.

**Key inputs:** a running dashboard, the `openspec-explore` + `frontend-mockup-loop`
skills, and the real `packages/client/src` component sources.

**Artifacts produced:**
- `openspec/changes/improve-dashboard-attention-routing/` (proposal, design, tasks, 3 spec deltas)
- `openspec/changes/extend-client-utils-state-feedback-primitives/` (proposal, design, tasks, 4 spec deltas, `mockups/index.html`)
- Commit `0c1660c7` (16 files, no application code).

---

_Generated from session `019f05ee-99b0-74a1-9198-a74cf9c23b3e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: session-to-guideline facts sheet._
