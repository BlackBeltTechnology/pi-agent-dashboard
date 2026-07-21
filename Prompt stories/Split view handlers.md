# How we did it: Redesigning the split-view layout controls — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator entered **explore mode** (`/skill:openspec-explore`) to think through a UI
problem: the dashboard's split-editor workspace felt confusing. The chat/editor divider
had tiny hover-only chevrons, the rotated "Editor/Chat" captions had been dropped, a
collapse cluster overlapped narrow panes, and there were **two competing collapse
controls** (the header `Chat│Split│Editor` mode switch *and* the divider chevrons).

The real objective, once the steering turns clarified it: **produce an approved,
research-grounded mockup of the whole split layout — including the left session-holder
rail — that removes the collapse confusion, then wrap it in a validated OpenSpec change
whose implementation is driven pixel-for-pixel by that mockup.** Explore → mockup loop →
proposal → doubt-reviewed plan, all before a single line of production code.

## 2. TL;DR playbook

1. **Enter explore mode first** (`/skill:openspec-explore`) — think, read, no implementing.
   Ground the discussion in the *real* components before mocking anything.
2. **Ask for a full-layout mockup + UX review**, naming every region ("whole layout with
   session holder (the left side)"). Let the dashboard mockup-loop skill load and ground
   in real theme tokens + component sources.
3. **Serve the mockup live** (`serve_mockup`), screenshot it at breakpoints with the
   `browser` tool, and write a scored `ux-review.md` next to it.
4. **When something feels "confusing," ask the AI to RESEARCH the pattern** — pull real
   docs (NN/g, Microsoft Fluent, Material) via `ctx_fetch_and_index`, cite findings, and
   let the citations drive a v2. This is the highest-leverage move in the whole session.
5. **Iterate the mockup with small, specific steering** ("move the switch before the name",
   "one selector not two", "dotted grip on the sidebar seam too"). Keep re-serving.
6. **Once approved, scaffold the OpenSpec change** with the CLI, `git mv` the mockups
   *inside* it, and make **tasks.md Task 0 = "serve the mockup as the source of truth"** so
   every build task references exact mockup classes.
7. **Run `plan-proposal`** to doubt-review the proposal/design (single-model **and**
   cross-model), fix the blockers, fold `scenario-design` scenarios into `tasks.md`, and
   commit to `develop` — stopping at the worktree boundary.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI read `SplitDivider.tsx` and
`SplitWorkspace.tsx`, traced where the workspace mounts, and diagnosed the design as
"fighting itself": three collapse affordances, a divider cluster that overlaps narrow
panes, and inconsistent seam language between the sidebar (`w-1 blue/30`) and the divider
(`w-1.5 blue/40` + floating chevrons). *Why it worked:* grounding in the actual source
before proposing anything meant the mockup used real tokens and named real files.

**Phase 2 — First mockup + UX review.** Loading the dashboard mockup-loop skill, the AI
read the App shell, `SessionSidebar`, `SessionCard`, and theme tokens, then built
`index.html`, served it live, screenshotted both themes at three breakpoints, and wrote a
scored `ux-review.md`. *Decision point:* the operator liked it but flagged confusion.

**Phase 3 — Research-driven fix (the turning point).** Told "check how to design this type
of window split," the AI fetched and indexed real design docs and returned **citable
findings**: its own hover-reveal tabs were the NN/g "hidden signifier" anti-pattern, and
two symmetric collapsers violated the Fluent **SplitView** model (one always-visible
content area + one collapsible pane + one obvious toggle). v2 made captions always
visible, kept one selector, and made the restore peek *in-flow (push), not overlay*.

**Phase 4 — Iterative polish (4 steering rounds).** The operator moved the selector to sit
right after the back button (then changed their mind — before Seek), removed model/level/pi
version from the header, restored the sidebar collapse pill, and asked for a **unified seam
system**: the same dotted grip on the session-list seam and the divider, a vertically
centered collapse knob, and a vertical `SESSIONS` restore tab matching the `CHAT`/`EDITOR`
peeks. Each round = read real markup → apply → re-serve → verify with a screenshot.

**Phase 5 — Proposal scaffold.** On approval, the AI scaffolded
`openspec/changes/redesign-split-layout-controls/` via the CLI, `git mv`'d the mockups
inside (v2 → `index.html`, first pass → `v1.html`), wrote proposal/design/two spec deltas,
and wired **tasks.md Task 0** to serve the mockup as the implementation source of truth.

**Phase 6 — Doubt-reviewed plan (`plan-proposal`).** Doubt-driven-review spawned a
fresh-context adversarial reviewer, then a cross-model reviewer (`glm-5.2`). Both
independently converged on a **real blocker**: `piVersion` renders *only* in the header,
not on the session card — so the planned removal would delete it from the UI. The operator
decided to keep pi-version, remove only model+level. The AI folded in mobile-scope, a11y,
sidebar-centering, and tablet carve-out fixes, then `scenario-design` produced an
18-scenario test-plan folded into `tasks.md`, validated `--strict` green, and committed.

## 4. Prompts that worked

- **The goal prompt** — entering explore mode was the right kickoff: it forced a
  read-and-diagnose stance before any mockup, so the design was grounded, not invented.
- **"Create mockups and ux review for whole layout with session holder (the left side)"** —
  high-leverage because it named *every region to include*. The parenthetical stopped the
  AI from mocking only the divider and forgetting the rail.
- **"Check this solution to research how to design this type of window split"** — the single
  most valuable prompt. It converted a subjective "this is confusing" into an
  evidence-based redesign with citations. *Rewrite of the weaker original* ("Check this
  solution…" with no link): **"Research how established products (NN/g, Fluent, Material)
  design split panes + pane switching, cite the rules, and fix my mockup's confusion."**
- **"Create proposal and move the mockup inside of it and in implementation use the
  mockup"** — a short prompt that unlocked the whole planning phase and the mockup-as-
  source-of-truth pattern.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Mock only the pane it was told about | "whole layout with session holder (the left side)" | Name every region to include in the *first* mockup prompt |
| Reach for an external link when told "check this solution" | "no link, I mean you mockup solution" | Say "critique *your own* mockup" explicitly when you mean self-review |
| Use hover-reveal signifiers (looks clean, fails users) | Research forced always-visible captions (NN/g) | State up front: signifiers must be always visible, never hover-only |
| Build two symmetric collapse controls | Research → Fluent one-pane model | Ask for "one selector for view, one seam for size" as the mental model |
| Overlay the restore peek (clips the caption) | "peek is in-flow, pushes content" | Require in-flow (push) layout for restore affordances, not absolute overlay |
| Put the mode switch on the far right | "after the back button… before the session name" then "before Seek button" | Expect placement to change; keep the mockup cheap to re-serve |
| Duplicate metadata (model/level/pi-ver) in header AND card | "not be on header… lives on the card" | Decide one home per metadata field before building |
| Stick the collapse control at the top of the seam | "don't like it became to top… make dotted line for resize… integrate well" | Ask for a *unified* seam idiom across sidebar + divider from the start |
| Assume removed header fields exist elsewhere | Doubt-review caught `piVersion` only-in-header | Verify every "it already lives elsewhere" claim against source before removing |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was *authored* this session, but five existing assets carried it —
worth invoking the same way next time:

- **`openspec-explore`** — enforces a think-only stance. Effective because it stops the AI
  from jumping to implementation and produces a grounded diagnosis first. Invoke when the
  problem is still fuzzy and you want a thinking partner, not code.
- **`frontend-mockup-loop-dashboard`** — grounds mockups in the dashboard's real theme
  tokens and component sources (App shell, `SessionSidebar`, `SessionCard`). Effective
  because the mockup uses production tokens, so the handoff to implementation is 1:1.
  Invoke for any client-surface redesign.
- **`serve_mockup` + `browser` + `score_mockup`** — live-serve, screenshot at breakpoints,
  score against a rubric. Effective because it makes UX review *observable* (both themes,
  three breakpoints, collapse states) instead of asserted. *Pitfall handled:* Playwright's
  binary wasn't installed, so the AI fell back to the `browser` tool for screenshots.
- **`ctx_fetch_and_index`** — pull external design docs into a searchable index, then cite
  them. Effective because it turns "this feels off" into a defensible, cited redesign. The
  best single lever in the session. Invoke whenever a design choice needs authority.
- **`plan-proposal` → `doubt-driven-review` (single + cross-model) → `scenario-design`** —
  the planning pipeline. Effective because the cross-model review (`glm-5.2`, a different
  architecture than the author) *independently* re-derived the `piVersion` blocker,
  proving it wasn't doubt-theater. Invoke before committing any non-trivial plan.

**Recommended new memory:** a project convention — *"metadata has exactly one home; verify
in source before moving/removing a field from a surface."* The `piVersion` blocker would
have been avoided entirely.

## 7. Pitfalls & dead ends

- **"Check this solution" with no attachment** → the AI first assumed an external link and
  fetched SPA/404 pages. *If you mean your own mockup, say so.* The recovery was to research
  the *pattern* generically, which turned out better than any single link.
- **Playwright binary not installed** → `score_mockup`'s screenshot path failed. *If you hit
  this, use the `browser` tool to capture breakpoints directly.*
- **OpenSpec CLI scaffold** → `npx openspec change new` and `npx openspec new change` were
  both tried before the right invocation; the tree was then created with `mkdir -p`. *If the
  CLI subcommand is unclear, `npx openspec --help` first, then fall back to manual dirs.*
- **`openspec status --json` parse** → one Python one-liner failed on the JSON shape before
  a recursive finder worked. *Don't assume the JSON key path; walk it defensively.*
- **Removing header fields that "live elsewhere"** → `piVersion` did NOT live on the card.
  *Grep the source for every field before deleting it from a surface.*
- **Validator wants a SHALL on the first body line** of a requirement → reorder so the
  normative statement leads. *Run `openspec validate --strict` and fix ordering early.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The real component sources for the surface (here: `SplitDivider.tsx`, `SplitWorkspace.tsx`,
  App shell, `SessionSidebar`, `SessionCard`) and the theme tokens.
- A running mockup server (`serve_mockup`) and the `browser` tool for screenshots.
- The OpenSpec CLI and the target capability specs to delta (`split-editor-workspace`,
  `resizable-sidebar`).

**Steps:**
1. `/skill:openspec-explore` → read the real components, diagnose the design tension.
2. Ask for a **full-layout mockup + scored UX review**, naming every region.
3. Serve live, screenshot both themes × 3 breakpoints, write `ux-review.md`.
4. On any "confusing," **research the pattern** (NN/g / Fluent / Material) and cite it.
5. Iterate v2 with small specific steering; re-serve each time. Enforce: always-visible
   signifiers, one selector + one seam, in-flow (push) restore, unified seam idiom.
6. Verify every "metadata lives elsewhere" claim in source before removing a field.
7. Scaffold the OpenSpec change, `git mv` mockups inside, make **Task 0 = serve the mockup
   as source of truth**, reference exact mockup classes in each build task.
8. `plan-proposal`: doubt-review (single + cross-model), fix blockers, fold
   `scenario-design` scenarios, `validate --strict`, commit to `develop`, stop at worktree.

**Final artifacts produced:**
- `mockups/split-layout-redesign/{index.html, v2.html, ux-review.md}` (working copies)
- `openspec/changes/redesign-split-layout-controls/` — `proposal.md`, `design.md`,
  `tasks.md`, `test-plan.md`, `specs/split-editor-workspace/spec.md`,
  `specs/resizable-sidebar/spec.md`, and `mockups/{index.html, v1.html, ux-review.md}`
- Committed to `develop` as `fafcb317d`.

---

_Generated from session `019f6c8e-a19a-7e7e-9e6b-65f220d8aaf1` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract: `/tmp/session_facts.md`._
