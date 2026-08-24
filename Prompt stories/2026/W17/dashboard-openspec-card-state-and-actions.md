---
session: 019da879
week: 2026/W17
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [dashboard-openspec-card-state-and-actions]
proposal_excerpt: "Today the session card quietly encodes an OpenSpec change's lifecycle in the *choice* of which action button renders (Apply vs. Verify/Archive), and that choice is driven exclusively by whether every checkbox in `task…"
---

# How we did it: OpenSpec session-card state pill, Tasks popover & Archive-anyway overflow — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with the standard `/opsx:apply` slash-prompt: *"Implement tasks
from an OpenSpec change… Select the change… Check status to understand the schema… Get
apply instructions…"* — i.e. drive the OpenSpec **apply** workflow end-to-end for the
change `dashboard-openspec-card-state-and-actions`.

The *real* objective, once the steering turns landed, was a full vertical feature slice
across all three dashboard components: teach the session card to (1) render a color-coded
**ChangeState pill**, (2) show a **`Tasks N/M`** popover with individually toggleable
`tasks.md` checkboxes (persisted via new REST routes + broadcast), (3) add an **Archive-anyway**
`⋯` overflow, and (4) relocate Bulk Archive to unattached sessions — then verify against
the spec, sync deltas, archive the change, and land a **clean single-change commit** out of
a working tree polluted by six sibling OpenSpec changes.

## 2. TL;DR playbook

1. Fire the `/opsx:apply <change>` prompt. Let the AI read `proposal.md` + `design.md` +
   `tasks.md` and announce the schema (`spec-driven`) before touching code.
2. Implement bottom-up by section: **shared types/poller → server parser/writer → REST
   routes + broadcast → client components** (StatePill, TasksPopover, overflow menu).
   Write a colocated test per module as you go.
3. Tell it up front: **"scoped test runs only — the full suite kills the session."** Run
   `npx vitest run <specific paths>` per package + a scoped `tsc --noEmit`.
4. Deploy the 3-component way: `npm run build` (client) → `POST /api/restart` (server,
   jiti — no build) → `npm run reload` (bridge extension + connected sessions).
5. When a popover/menu renders clipped, **portal it to `document.body` with `position:
   fixed` from `getBoundingClientRect()`** and auto-close on outside-click/scroll/resize.
6. Run `/opsx:verify` — produce a Completeness/Correctness/Coherence report mapping every
   requirement to a concrete file:line.
7. Run `/opsx:archive` — sync delta specs into `openspec/specs/`, matching the repo's
   existing `## ADDED Requirements` shorthand convention, then move to `archive/`.
8. Commit **only this change's hunks**: checkout HEAD versions of shared docs, re-apply
   just your isolated hunks, stage a clean set, leave sibling-change edits untouched.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the change).** The AI ran `openspec status` / `instructions
apply`, `cat`ted proposal/design/tasks, then grepped the existing type + poller + route +
component surfaces to learn the seams before writing. *Why it worked:* it grounded the
plan in the actual schema and existing patterns instead of inventing structure.

**Phase 2 — Bottom-up generation.** It implemented in dependency order across 10 spec
sections: `OpenSpecChange.isComplete?` on shared types + poller pass-through → the
`openspec-tasks.ts` parser/atomic-writer on the server → `GET/POST /api/openspec/tasks`
routes with the broadcast dep wired in `server.ts` → the client `StatePill`, `TasksPopover`,
`openspec-tasks-api.ts`, and the `SessionOpenSpecActions.tsx` rewire. Each module got a
colocated vitest. *Decision point:* the human capped test execution to **scoped runs** (see
§5) after the full suite killed the session.

**Phase 3 — Deploy & fix the popover.** After the first `build → restart → reload`, the
operator pasted a screenshot: *"The popup … does not render correctly."* The AI diagnosed
the session card's `overflow:hidden` clipping the absolutely-positioned menu and fixed it by
**portalling to `document.body`** with fixed coordinates from the button rect, auto-closing
on outside interaction. *Why it worked:* the screenshot gave an unambiguous visual symptom;
the fix addressed the root cause (clip context) not the symptom.

**Phase 4 — Verify.** `/opsx:verify` produced a three-dimension report (34/34 tasks, 6/6
requirements, 5/5 design decisions) mapping each requirement to a file:line.

**Phase 5 — Archive & clean commit.** `/opsx:archive` synced both delta specs into main
specs (new `openspec-task-toggle` capability + modified `openspec-attach-combo`), matching
the repo's dominant `## ADDED Requirements` shorthand. The final `commit changes` turn hit
the real hazard: **67 uncommitted changes spanning six OpenSpec changes.** The AI paused,
enumerated the sibling changes, then surgically extracted only this change's hunks (checkout
HEAD of shared docs, re-apply isolated edits, stage clean) → one commit, 25 files, sibling
work left untouched.

## 4. Prompts that worked

- **The goal prompt** (`/opsx:apply <change>`): effective because it names the exact
  change and defers schema/task discovery to the tool rather than the operator. A future
  kickoff is even stronger if it states the test-scope constraint immediately (see §5).
- **"build bridge, server and client, and deploy"** — a high-leverage one-liner that
  triggered the full correct 3-component deploy sequence (build → restart → reload) without
  spelling out each command.
- **Screenshot + "The popup … does not render correctly"** — a visual bug report beats a
  prose description; it pinned the exact regression and let the AI go straight to the
  `overflow:hidden` root cause.
- **"commit changes"** — short, but the AI correctly refused to blind-commit a dirty tree
  and confirmed scope first. Reproduce that *pause-and-enumerate* behavior by stating
  "commit ONLY this change's files" up front.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for the full test suite | "The full test kills the session. Ignore it" | Say **"scoped vitest runs only, per-package paths"** in the opening prompt |
| Stop at code-complete | "build bridge, server and client, and deploy" | State the deploy target up front: build client → `POST /api/restart` → `npm run reload` |
| Ship a menu that got clipped | screenshot + "does not render correctly" | For any card-internal popover, portal to `document.body` from the start (card is `overflow:hidden`) |
| Risk committing a polluted tree | "commit changes" (AI self-guarded) | Say **"commit ONLY this change's hunks; leave sibling OpenSpec work untouched"** |

The 7 prompts split cleanly into 1 goal + 6 workflow-driver slash-commands (apply → verify
→ archive) plus two tactical corrections (test-scope, popover). The heavy-steering signal is
mostly *workflow orchestration*, not rework — the code itself needed one visual fix.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work rode existing OpenSpec
slash-command skills (`/opsx:apply`, `/opsx:verify`, `/opsx:archive`) and the repo's
build/restart/reload matrix.

**Skill worth creating:** a **"portal a card-internal popover"** micro-skill. The
`overflow:hidden` → clipped-menu → portal-to-body-with-fixed-coords fix is a repeatable
dashboard-client pattern (session cards clip their children). Capturing it — *symptom:
absolute menu clipped by card; fix: `createPortal` to `document.body`, position from
`getBoundingClientRect()`, close on outside-click/scroll/resize* — would remove the diagnose
step next time. The clean-single-change-commit dance (checkout HEAD → re-apply isolated
hunks → stage clean) is also skill-worthy for any repo where multiple OpenSpec changes share
a dirty working tree.

## 7. Pitfalls & dead ends

- **The full test suite kills the pi session.** Never run the unscoped suite here — use
  `npx vitest run <specific test paths>` per package and a scoped `tsc -p <pkg>/tsconfig.json`.
- **Session card `overflow:hidden` clips absolute popovers.** If a menu/popover renders
  cut off, don't fight z-index — `createPortal` it to `document.body` with `position:fixed`
  coordinates from the trigger's `getBoundingClientRect()`.
- **A `grep -c` on tasks.md exited non-zero** (no matches for one bracket pattern) — a
  benign false alarm; verify task counts with the `grep "^- \["` + `awk` listing instead.
- **Dirty working tree with 6 sibling OpenSpec changes.** Don't `git add -A`. The shared
  docs (`AGENTS.md`, `CHANGELOG.md`, `docs/architecture.md`) carry interleaved hunks from
  other changes — checkout HEAD, re-apply only your hunks, stage a verified-clean set.
- **CHANGELOG bullet was already at HEAD** (committed earlier with a sibling change) —
  restore the working-tree version so unrelated edits aren't lost, stage only what's needed.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a running dashboard on `:8000`
(`/api/health` returns mode); connected pi sessions for `npm run reload` to hit.

- [ ] `/opsx:apply <change>` — read proposal/design/tasks, announce schema.
- [ ] Implement bottom-up: shared types/poller → server parser+writer → REST routes+broadcast → client components; one colocated vitest per module.
- [ ] **Scoped tests only:** `npx vitest run <paths>` per package + scoped `tsc --noEmit`. Never the full suite.
- [ ] Deploy: `npm run build` → `curl -X POST http://localhost:8000/api/restart` → `npm run reload`.
- [ ] Any card-internal popover → `createPortal` to `document.body`, `position:fixed` from button rect, close on outside-click/scroll/resize.
- [ ] `/opsx:verify` — Completeness/Correctness/Coherence, each requirement → file:line.
- [ ] `/opsx:archive` — sync delta specs into `openspec/specs/` (match `## ADDED Requirements` shorthand), move change to `archive/`.
- [ ] Commit only this change's hunks; leave sibling-change edits in the tree.

**Artifacts produced (paths):**
- `packages/shared/src/types.ts`, `packages/shared/src/openspec-poller.ts` (+ `__tests__/openspec-poller.test.ts`)
- `packages/server/src/openspec-tasks.ts` (+ parser/routes tests), `packages/server/src/routes/openspec-routes.ts`, `packages/server/src/server.ts`
- `packages/client/src/components/StatePill.tsx`, `TasksPopover.tsx`, `SessionOpenSpecActions.tsx`, `lib/openspec-tasks-api.ts` (+ colocated tests)
- `docs/architecture.md`, `AGENTS.md`, `CHANGELOG.md`; synced `openspec/specs/openspec-attach-combo/spec.md` + new `openspec-task-toggle` spec
- Commit `3d234b7 feat(openspec-card): state pill, Tasks popover, Archive-anyway overflow` — 25 files, +1936/−28

---

_Generated from session `019da879` · `pi-agent-dashboard` · 2026-04-20. Source extract: deterministic facts sheet from `session-to-guideline/scripts/extract_session.ts`._
