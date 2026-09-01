---
session: 019de886
week: 2026/W18
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (19 user prompts); large facts sheet (~10234 tok)"
upgrade_status: pending
openspec_changes: [add-openspec-jj-bridge, add-jj-workspace-plugin]
---

# How we did it: Designing the openspec-jj-bridge plugin in explore mode — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — a deliberately non-implementing "thinking
partner" stance ("*You may read files, search code, and investigate the codebase, but
you must NEVER write code or implement features… You MAY create OpenSpec artifacts*").
The operator's real objective surfaced two prompts later, in one line:

> *"Primarly I would like to attach a workspace for an openspec implementation."*

That reframed everything. The true goal was **not** "add a generic jj workspace feature"
— it was to design a plugin that binds a **jj workspace 1:1 to an OpenSpec change**, so
that implementing a change happens in an isolated venue that spawns, folds back, and
forgets in lockstep with the change lifecycle. The deliverable was a validated OpenSpec
change proposal (`add-openspec-jj-bridge`) plus a patch to the existing
`add-jj-workspace-plugin`, with mermaid + nano-banana visual aids and a comprehensive
plan doc — **all thinking, zero implementation**.

## 2. TL;DR playbook

1. **Enter explore mode explicitly** and state the constraint up front: think & design
   only, may write OpenSpec artifacts, never implement.
2. **Give the one-line goal that names the binding**: "attach a workspace for an openspec
   implementation" — this tells the AI the workspace is *bound to a change*, not generic.
3. **Answer the AI's option menus tersely** (`1:1`, `2`, `D with B fallback`, `all`) —
   the AI draws 2–3 concrete shapes at scale (ASCII at realistic load); you pick.
4. **State the hard invariant early**: "jj and openspec must operate standalone and work
   without each other" → forces a 3-package split (jj-plugin, openspec core, NEW bridge).
5. **Let the AI find the edge cases, then push for more** ("What special cases can be?")
   — surfaces working-tree leakage, dirty-WT dialog, existing-`.shadow` reuse.
6. **Ask for visuals in two engines**: "draw with mermaid and after nano banana" →
   temporal mechanics (mermaid) + spatial/journey metaphor (image).
7. **Scaffold with the tool, not by hand**: `openspec change new <name>`, then
   `openspec validate <name>` after every edit round — keep both proposals green.
8. **Commit the artifacts isolated** via `jj split` (bump `snapshot.max-new-file-size`
   first — PNGs exceed the 1 MiB default), then `jj describe`.
9. **Persist the thinking**: "save comprehensive version to docs/plans" as a standalone
   plan doc so the design survives outside the change folder.

## 3. How the collaboration unfolded

**Phase 1 — Reframe (Discovery).** The AI initially explored a generic
workspace-grouping bug (`.shadow/<name>` sessions each spawning their own sidebar folder
card). Prompt 3 collapsed the scope: the workspace is *the implementation venue for a
change*. The AI immediately drew the "generic framing vs openspec-bound framing" diff and
re-anchored the whole design around a **1:1 change↔workspace binding**. *Why it worked:*
one plain-language sentence about the primary use case saved a long generic exploration.

**Phase 2 — Decision menus (Design).** The AI presented numbered option menus at each
fork (relocate-parent vs spawn-child; where the 🌿 button lives; grouping shape). The
operator answered in shorthand (`1:1`, `2`, `D with B fallback`, `Q1 no Q2 manual`). The
AI logged each into a running decision table (D1–D7 + sub-decisions). *Decision points:*
promote-parent = session relocation (Option A) with spawn-child fallback; archive
integration lives in the bridge, **not** openspec core; workspace name = change name
verbatim.

**Phase 3 — Constraint conflict caught (Design).** After Q1="no structural refactor", the
AI flagged that the desired "🎬 silently becomes 🌿" mechanism *depended on* the forbidden
slot-priority refactor, and offered honest alternatives. It landed on **auto-promote on
attach** (bridge subscribes to `session_register`, promotes before first prompt, zero
core mods). *Why it worked:* the AI surfaced the contradiction instead of silently
picking — the human got to re-decide with full information.

**Phase 4 — Edge cases (Design).** "What special cases can be?" unlocked the biggest
missed case: **working-tree leakage** (unrelated uncommitted edits bleeding into the
workspace via `jj workspace add -r @`). Led to the dirty-WT **strategy modal**
(silent/split/trunk/cancel) and existing-`.shadow` **reuse/focus/unhealthy**
classification replacing a naive 409 refusal.

**Phase 5 — Visuals (Generate).** "draw with mermaid and after nano banana" produced 5
mermaid diagrams (sequence, state machine, auto-promote flowchart, arch graph) + nano-
banana images (branches metaphor, 8-station journey, dashboard UI mockup, card states).
"all three" parallelized image generation + doc embedding + README. A `docs/diagrams/…`
folder with a README indexing each image landed alongside.

**Phase 6 — Scaffold, validate, commit, persist (Verify).** `openspec change new`,
repeated `openspec validate` after each round, then `jj split` to isolate artifacts into
their own commit (after bumping the snapshot size limit for large PNGs), and finally a
442-line `docs/plans/openspec-jj-bridge.md` comprehensive plan — explicitly written
without a subagent on request.

## 4. Prompts that worked

- **Goal prompt (rewrite for reuse):** the raw kickoff was the generic explore-mode
  preamble; the *effective* goal was prompt 3. State it directly next time:
  > *"Explore mode. Design a plugin that binds a jj workspace 1:1 to an OpenSpec change —
  > workspace is the implementation venue for that change. jj and openspec must each work
  > standalone. Capture as OpenSpec artifacts, don't implement."*
- **High-leverage terse answers:** `1:1`, `2`, `D with B fallback`, `all` — the AI had
  already drawn the concrete shapes, so a single token per fork moved the whole design.
- **Edge-case unlock:** *"What special cases can be? For example in implementation new
  spec created? How it be handled?"* — one open question surfaced the leakage bug the AI
  had glossed.
- **Dual-engine visual ask:** *"Can you draw these with mermaid and after nano banana?"*
  — got both precise mechanics and an intuitive metaphor.
- **Persistence ask:** *"save comprehensive version to docs/plans. For that do not use
  agent"* — explicit no-subagent instruction kept the plan authored in the main context.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Explore a **generic** workspace feature | "Primarly attach a workspace for an openspec implementation" | Open with the *binding* (1:1 change↔workspace) in the goal prompt |
| Reach for a **structural refactor** (slot-priority) to get the silent 🎬→🌿 swap | "Q1 no" → forced auto-promote-on-attach instead | State "no source mods to either peer" as a hard constraint up front |
| Risk **coupling** jj and openspec | "jj and openspec have to operate standalone and work without each other" | Name the standalone-degradation contract as a first-class requirement |
| **Gloss edge cases** (working-tree leakage) | "What special cases can be?" | Ask "what breaks when the working tree is dirty / a workspace already exists?" early |
| Leave nano-banana **duplicate labels** (known quirk) | Iterative edit prompt to remove them | Expect label duplication; plan a cleanup edit pass for any nano-banana diagram |
| Default to spawning a **subagent** for the plan write | "do not use agent" | Say "author inline, no subagent" when you want the plan in main context |

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session — it was pure design work. But the
workflow is highly repeatable, so **the reusable assets are the tools already leaned on**:

- **`openspec change new` + `openspec validate` loop** — scaffold once, validate after
  *every* edit round. Keeping both proposals green continuously is what let the design
  churn through six rounds of decisions without drift. Invoke it as the heartbeat of any
  explore→proposal session.
- **Dual-engine diagramming (mermaid for mechanics, nano-banana for metaphor)** —
  mermaid sequence/state/flowchart diagrams capture *who-calls-who-when* precisely;
  nano-banana images give an intuitive spatial/temporal metaphor for the same flow. A
  `docs/diagrams/<change>/README.md` indexing each image keeps them legible later.
- **Candidate skill worth creating:** an `openspec-explore-to-commit` skill capturing
  this exact arc — reframe → decision-menu loop → edge-case sweep → dual-engine visuals →
  `openspec change new`/`validate` → `jj split` commit → `docs/plans` persist — would
  turn a 32-hour, 19-prompt session into a guided procedure.

## 7. Pitfalls & dead ends

- **jj snapshot size limit blocks the commit.** Two PNGs exceeded jj's default 1 MiB
  `snapshot.max-new-file-size`. Fix: `jj config set --repo snapshot.max-new-file-size 2097152`
  before `jj st`/`jj split`.
- **`jj split` opens an interactive editor.** The bare `jj split <paths>` hung on the
  editor. Fix: `JJ_EDITOR="true" jj split <paths>` (or `":"`) to auto-accept.
- **jj author/user identity may be unset in a colocated repo.** Had to
  `jj config set --user user.name/user.email` (mirrored from git config) and
  `jj metaedit --update-author` before the commit had a proper author.
- **nano-banana duplicates text labels** (top + bottom of the image) — a known quirk.
  Plan an edit-pass prompt: *"remove all duplicate text labels from the bottom, keep the
  top row."*
- **Working-tree leakage into a new workspace.** `jj workspace add -r @` snapshots the
  *entire* current `@`, so unrelated uncommitted edits bleed into the workspace and get
  attributed to the change on fold-back. The design's dirty-WT strategy modal exists to
  prevent exactly this — don't skip it.
- **A grep returned nothing (1 failed command)** looking for spec text that had been
  reworded — expected when specs churn; re-grep on the current heading names.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- `openspec` CLI available in the repo; a jj-colocated repo (`.jj/` present).
- `GEMINI_API_KEY` set (nano-banana image generation checks for it).
- Clear one-line statement of the *binding* the plugin encodes and the standalone constraint.

**Steps:**
1. Enter explore mode; state "design only, may write OpenSpec artifacts, never implement."
2. Give the goal as the binding + standalone constraint (see §4 rewrite).
3. Answer each AI option menu tersely; let it draw shapes at realistic scale.
4. Ask "what special cases / dirty working tree / existing workspace?" to force edge cases.
5. `openspec change new <name>`; edit proposal/design/tasks/spec; `openspec validate <name>`
   after every round — keep it green.
6. "Draw with mermaid and after nano banana"; embed diagrams; write a `docs/diagrams/<name>/README.md`.
7. `jj config set --repo snapshot.max-new-file-size 2097152`; `JJ_EDITOR="true" jj split <paths>`;
   `jj describe -m "docs(openspec): …"`.
8. "Save comprehensive version to docs/plans — do not use agent."

**Artifacts produced:**
- `openspec/changes/add-openspec-jj-bridge/{proposal,design,tasks}.md` +
  `specs/openspec-jj-bridge/spec.md`
- `docs/diagrams/openspec-jj-bridge/README.md` + 4 PNGs (branches, 8-station timeline, UI
  mockup, card states)
- `docs/plans/openspec-jj-bridge.md` (comprehensive 442-line plan)
- Patched `add-jj-workspace-plugin` (Decision 15 workspace-grouping + spec, then archived)

---

_Generated from session `019de886` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-02. Source extract: `/tmp/session_facts_43393_1784861587.md`._
