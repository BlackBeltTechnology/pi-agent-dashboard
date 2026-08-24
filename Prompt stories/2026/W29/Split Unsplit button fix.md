---
session: 019f6781
week: 2026/W29
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [editor-layout-modes, split-editor-workspace, add-server-push-notifications]
proposal_excerpt: "The `split-editor-workspace` capability (archived 2026-07-03) shipped the internal editor pane co-mounted with `ChatView`, controlled by a single boolean `split.open` and a header pill labelled **\"Split / Unsplit\"** (…"
---

# How we did it: Split / Unsplit button fix — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened in **explore mode** (`openspec-explore`) with a stance prompt — *"Enter
explore mode. Think deeply. Visualize freely. Follow the conversation wherever it goes."*
— pointed at one nagging UI wart: the dashboard's **"Split / Unsplit"** header pill.

The real objective, which only crystallized through the steering turns, was: **fix a
buried, badly-named, spatially-disconnected toggle** — a 10px pill lost in a wall of
identical header pills, using a made-up word ("Unsplit") for what actually opens a
code/editor pane. The session moved from *"where should this button live?"* to a full,
reviewed, committed **OpenSpec planning artifact** (`editor-layout-modes`) that migrates
the shipped `open:boolean` split into a tri-state `closed | split | full` layout mode
with a consistent segmented control and on-divider chevrons.

## 2. TL;DR playbook

1. **Enter explore mode** and ask the AI to *understand the mechanism before proposing a fix* — "what does Split/Unsplit actually do?" It reads the component, `SessionHeader`, and i18n labels first.
2. **Name the real problem out loud.** The AI surfaced the naming mismatch (mechanism = "split"; intent = "open editor"; pane title = "Editor") and the three UX defects: findability, non-word, spatial disconnect.
3. **`create mockup server`** — one short prompt. The AI builds a self-contained `/tmp/editor-toggle-mockup/index.html` and serves it with `serve_mockup`, rendering TODAY + Options A/B/C stacked, each with the toggle glow-highlighted.
4. **Pick a direction, then push it harder.** "Option B seems ok" → then ask the *hard follow-up*: can the editor go full-size (collapse chat)? This forces the boolean → tri-state model.
5. **Catch inconsistency early.** "in split mode there is no way to back closed mode and full mode in consistent way" — the single most valuable steer. It collapsed 5 scattered affordances into **one segmented `▭ Chat │ ◧ Split │ ▮ Editor` switch**.
6. **Put controls where they belong spatially.** "put controls for split line as in the border" → drag-to-resize + two chevrons on the divider, each arrow pointing at the pane it folds away.
7. **`capture and mockups be part of proposal`** — the AI runs the pre-scaffold coherence check, scaffolds the OpenSpec change, and bundles `mockups/index.html` inside it (matching the archived convention).
8. **Run `plan-proposal`** — orchestrates doubt-review (fresh-context **+ cross-model** `glm-5.2`), scenario-design HARD gate, fold-into-tasks, and commits at the worktree boundary.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI resisted the urge to jump to a fix. It
grepped `src/client` / `packages/web/src` for `split`/`unsplit`, read `SessionHeader`,
and checked i18n keys (`editor.editorTitle`, `editor.closeEditorUnsplit`). *Why it
worked:* it diagnosed the naming mismatch and pinpointed *why* the pill is lost (a wall
of near-identical 10px header pills) **before** drawing any solution.

**Phase 2 — Design via mockup (`serve_mockup`).** On "create mockup server" the AI built
a static, dashboard-styled comparison — TODAY + three placement options, each with
Wins/Still-open notes and a footer recommendation. *Why it worked:* a live URL turned an
abstract UX argument into something the human could see and react to. **Decision point:**
the human chose Option B (right-edge peek handle).

**Phase 3 — State-model escalation (the productive tension).** Three consecutive steers
drove the design deeper: (a) *"can the editor be full-sized?"* → introduced a third
state; (b) *"no consistent way back"* → replaced the ⛶/⟨⟩/✕/peek scatter with **one
segmented tri-state switch**; (c) *"controls on the split line / border"* → added
draggable divider + directional chevrons. Each steer was wired **live into the clickable
mockup** so the human felt the change immediately. *Why it worked:* the AI treated each
correction as a mental-model bug, not a cosmetic tweak — "one control = one axis".

**Phase 4 — Capture (OpenSpec scaffold).** On "capture and mockups be part of proposal"
the AI ran a coherence/collision sweep of the archive, scaffolded `editor-layout-modes`
via `npx openspec new change`, and wrote proposal + design + delta spec + tasks, bundling
the mockup at `mockups/index.html`. It re-pointed `serve_mockup` at the *bundled* copy so
the human reviewed the captured artifact, not the scratch file.

**Phase 5 — Plan-proposal verification.** `plan-proposal` ran doubt-driven-review: a
fresh-context reviewer found **1 BLOCKER + 5 MAJOR**, then a **cross-model** pass
(`@propose-review-1` → `glm-5.2`, probe-gated, non-Claude to avoid author-family bias)
corroborated and sharpened it. Biggest finding: the design's "Components touched" list
**undercounted the migration blast radius** (missed `EditorPane.tsx`,
`SessionSplitView.tsx`, `SplitWorkspace.tsx`, 5 test files; `toggleSplit` was actually
dead code). The AI reconciled **11 actionable findings** into all four artifacts, then
scenario-design's HARD gate surfaced 2 real spec gaps the human decided, folded 23
automated scenarios into tasks.md, and committed `343450be0` on `develop` — stopping at
the worktree boundary.

## 4. Prompts that worked

- **The goal prompt (explore-mode stance):** effective because it explicitly forbade
  implementing and told the AI to *think/visualize first*. That's what produced the
  diagnosis-before-solution behaviour. A future kickoff should keep this framing:
  *"Enter explore mode — understand what X does before proposing where it should live."*
- **`create mockup server`** — three words that unlocked the whole design phase. A live
  visual beats paragraphs of UX prose. Reusable verbatim.
- **`Option B seems ok. But is it possible when the Editor is opened, able to set to be
  in full sized (to collapse chatview completely?`** — a high-leverage follow-up: accept
  a direction, then immediately stress it with the hardest requirement. This is what
  forced boolean → tri-state.
- **`when in split mode there is no way to back closed mode and full mode in consistent
  way`** — the best steer of the session. Short, names a *consistency* defect, and
  collapsed 5 affordances into 1.
- **`capture and mockups be part of proposal`** — cleanly triggered the explore→OpenSpec
  handoff. Rewrite for reuse: *"Capture this as an OpenSpec change and bundle the mockup
  inside the proposal per the archived convention."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the fix as a *placement* problem (where to move the pill) | "is it possible … full sized (collapse chatview completely)?" | State the full state-space up front: closed / split / full — don't let the design settle on a boolean. |
| Scatter multiple affordances (⛶ maximize, ⟨⟩ restore, ✕ close, edge peeks) for one axis | "no way to back closed mode and full mode in consistent way" | Demand *one control per axis*; a tri-state segmented switch, not directional icons. |
| Keep collapse controls in the header only | "put controls for split line as in the border" | Anchor controls spatially — the divider *is* the pane boundary; chevrons point at the pane they fold. |
| Leave the polished mockup as a scratch `/tmp` file | "capture and mockups be part of proposal" | Bundle the mockup into the OpenSpec change (`mockups/index.html`) and re-serve the bundled copy. |
| Undercount the migration surface in the design | (caught by doubt-review, not the human) — cross-model review flagged missing files + dead `toggleSplit` | Always list the *complete* touched-file set; run cross-model doubt-review on persisted-shape migrations. |

## 6. Skills, tools & memory created — and why they're effective

No new persistent skill or memory was created — the session was a *consumer* of existing
skills, chained well:

- **`openspec-explore`** — enforced think-don't-implement; produced the diagnosis-first
  behaviour. Invoke when a UI/feature problem is fuzzy and you need a thinking partner.
- **`serve_mockup` (bundled tool)** — turned UX arguments into a live, clickable URL
  wired to each steer in real time. Invoke whenever comparing UI placements/states.
- **`plan-proposal`** — the orchestration backbone: doubt-review → scenario-design →
  fold → commit at the worktree boundary. Its **cross-model** doubt-review (probe-gated,
  non-Claude reviewer) is what caught the undercounted migration surface.
- **Recommended new skill:** a small *"mockup-to-openspec capture"* procedure —
  coherence-check the archive → `openspec new change` → write 4 artifacts → copy mockup to
  `mockups/index.html` → re-point `serve_mockup` at the bundled copy → validate. This
  exact sequence recurred and is worth codifying.

## 7. Pitfalls & dead ends

- **`npx openspec change new <name>` is not the command.** It failed; the working form
  is `npx openspec new change <name>`. If scaffolding errors, run `npx openspec new --help`.
- **First grep was too broad** — `grep "split"` pulled in `splitter`/`splice`/`split(`
  noise; the AI narrowed with `grep -iv` filters and word-boundary patterns. Start with
  `unsplit` + `\bSplit\b`, not bare `split`.
- **A live-served scratch mockup ≠ the captured artifact.** Reviewing `/tmp/...` while the
  proposal bundles a *copy* invites drift. Always re-point the server at the bundled path.
- **Design "Components touched" lists silently undercount migrations.** A boolean→enum
  change touched `EditorPane.tsx`, `SessionSplitView.tsx`, `SplitWorkspace.tsx`, i18n keys,
  and ~5 test files — none in the first draft. `toggleSplit` was also dead code. Only
  cross-model doubt-review caught it; don't skip it on persisted-shape changes.
- **An edit failed on a Unicode glyph mismatch** (`✕` character). When an `edit` on
  emoji/box-drawing chars fails, re-read the exact bytes and retry with the correct text.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the target UI component + its `SessionHeader`/i18n keys; the
archived predecessor change (`2026-07-03-split-editor-workspace`) as a convention
reference; a configured non-Claude `@propose-review-1` role for cross-model review.

1. `openspec-explore` — read the component, header, and i18n **before** proposing anything.
2. Name the defects explicitly (findability / naming / spatial disconnect).
3. `create mockup server` → build `/tmp/…/index.html`, serve with `serve_mockup`, show TODAY + options.
4. Accept a direction, then stress it with the hardest requirement (full-size / collapse).
5. Enforce *one control per axis* — a tri-state segmented switch, not scattered icons.
6. Anchor collapse controls on the divider; chevrons point at the pane they hide.
7. Coherence-sweep the archive → `npx openspec new change <name>` → write proposal/design/delta-spec/tasks → copy mockup to `mockups/index.html` → validate → re-serve bundled copy.
8. `plan-proposal`: doubt-review (fresh + cross-model), reconcile findings into all artifacts, scenario-design HARD gate, fold scenarios into tasks, commit at the worktree boundary.

**Final artifacts produced:**
- `openspec/changes/editor-layout-modes/{proposal.md, design.md, tasks.md, test-plan.md}`
- `openspec/changes/editor-layout-modes/specs/split-editor-workspace/spec.md`
- `openspec/changes/editor-layout-modes/mockups/index.html`
- Commit `343450be0` on `develop` (38 openspec-parsed tasks).

---

_Generated from session `019f6781-3e57-7633-bb63-57658b0d171e` · `pi-agent-dashboard` · 2026-07-15. Source extract: session facts sheet._
