---
session: 019e763b
week: 2026/W22
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [redesign-process-list-activity-bar]
proposal_excerpt: "The session card's PROCESS subcard today is a flat dump of every PGID child the bridge's `ps`-scanner finds. It answers *\"what's in this session's process tree?\"* — useful as a safety net for leaked dev servers, but r…"
---

# How we did it: split the PROCESS subcard into an activity bar + drawer — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command:

```
/skill:openspec-apply-change redesign-process-list-activity-bar
```

The *real* objective, spelled out in the change's proposal: the session card's PROCESS
subcard was a flat dump of every PGID child the bridge's `ps`-scanner found — a "what's
in this process tree?" safety net, but poor at surfacing the thing an operator actually
watches: the in-flight `bash` tool call. The task was to **split that one subcard into two
purpose-built surfaces** — a live *activity bar* (`⏵ <cmd> <elapsed> [⏹]` for unresolved
bash toolCalls) stacked over a collapsible *background-processes drawer* (the old ps list,
now opt-in) — with full desktop + mobile parity, tests, docs, and an openspec-validated
close-out. The later three prompts (`commit and push`, `Create proper description for PR`,
`build and deploy`) were pure ship-phase steering, not scope changes.

## 2. TL;DR playbook

1. From the worktree, run `/skill:openspec-apply-change <change>`. Let it read
   `tasks.md` and resolve any open threads (task 0) **before** writing code.
2. Work the tasks in dependency order: **data first** — add `startedAt` to
   `ToolCallState`, stamp it in `event-reducer.ts`; then a pure selector
   (`useInflightBashTools.ts`) over the reducer's `toolCalls` Map.
3. Build each leaf as a **pure component + its test file together** (`SessionActivityBar.tsx`
   + test, refactor `ProcessList.tsx` → drawer + test). Write the test alongside, not after.
4. Compose in `SessionCard.tsx` (desktop `ProcessSubcard` + `MobileProcessSubcard`), then
   thread props up: `SessionList` → `SessionCard`, `App.tsx` derives the inflight map and
   provides `onAbortTool`.
5. Run the **targeted** new tests first (`npm test -- --run <files>`), then the **full**
   client suite to catch snapshot/parity regressions.
6. Add the four-state PROCESS-subcard snapshot tests (empty / activity-only / drawer-only /
   both) for desktop *and* mobile — this is where card composition breaks silently.
7. Handle docs: update `proposal.md` yourself; route `docs/` edits through a subagent in
   caveman style (fall back to doing them directly, still caveman, if the delegate infra
   is unavailable).
8. Close out: `openspec validate <change> --strict`, then `commit and push`, update the
   existing PR body from a `/tmp/pr-description.md`, and `npm run build`.

## 3. How the collaboration unfolded

**Phase 1 — Orient inside the change (Discovery).** The AI resolved the open threads
recorded as task 0, then read `tasks.md`, the shared `browser-protocol.ts`, and the
`event-reducer.ts` to find where toolCalls live. Effective move: it grepped for the exact
seams (`toolCall|toolResult|bash`, `sessionStates`, `handleAbort`) instead of reading whole
files — locating the data path before touching UI.

**Phase 2 — Data layer first (Design → Build).** It added `startedAt` to `ToolCallState`
and stamped it in the reducer, then built `useInflightBashTools.ts` as a *pure selector +
memoized hook*. Building the selector before the view meant the component had a clean,
already-tested input.

**Phase 3 — Leaf components with co-located tests (Generate).** `SessionActivityBar.tsx`
(`MAX_VISIBLE=2`, overflow chip, `role="status"` + `aria-live="polite"`) and the
`ProcessList.tsx` → `BackgroundProcessesDrawer` refactor (controlled `expanded`/`onToggle`,
`⚠ N background process(es)` summary row, `KILL_TOOLTIP`). Each shipped with its test file
in the same beat.

**Phase 4 — Compose & thread props (Integrate).** `SessionCard.tsx` composed the two
surfaces via `ProcessSubcard`/`MobileProcessSubcard` + a `useDrawerExpansion` helper;
`SessionList` and `App.tsx` were wired to derive `inflightBashMap` and pass `onAbortTool`.
Decision point: keep the composition in `SessionCard` and push only data down, rather than
letting each child reach into context.

**Phase 5 — Verify (parity net).** Targeted tests for the 3 new files passed, then the
full suite (6597 → 6605 as 8 new tests landed). The four-state + mobile snapshot tests were
the deliberate guard against silent card-composition breakage.

**Phase 6 — Docs & ship.** `proposal.md` edited directly; `docs/file-index-client.md`
updated in caveman style after the subagent-delegate path was unavailable. Then
`openspec validate --strict`, `commit and push`, PR #53 body rewritten, and `npm run build`.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change redesign-process-list-activity-bar`.**
  Effective because *all* the specification work was already captured in the change
  (proposal/design/tasks). The prompt just pointed the AI at a fully-formed plan, so it
  spent its budget implementing, not guessing. **Lesson: front-load the spec into an
  openspec change; then the kickoff is one line.**
- **`commit and push`** — a short ship verb that worked because the tree was already green;
  the AI produced a Conventional-Commit message and pushed without further prompting.
- **`Create proper description for PR`** — high leverage: it triggered a structured PR body
  (Why / What / resolved Q1–Q3 / known limitation / follow-up / verification) written to a
  file and applied to the existing PR #53, instead of a one-line push note.
- **`build and deploy`** — surfaced a *real* environment bug (see §7) rather than silently
  "succeeding"; the AI reported build ✅ / deploy ❌ with root cause.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation without shipping | `commit and push` | Put "commit + push when green" as a final task in `tasks.md`, or let the apply skill auto-ship. |
| Treat a PR as done with a stub note | `Create proper description for PR` | Make a structured PR body (Why/What/resolved-Qs/verification) a standing close-out step. |
| Consider the work done at "build succeeded" | `build and deploy` | Add a deploy/restart verification step; expect the auto-spawn to run from the **main repo path**, not the worktree. |

Note there were **no mid-implementation scope corrections** — the change spec was tight
enough that steering was entirely ship-phase. That is the signal of a well-specified change.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created; the session *consumed* the existing
`openspec-apply-change` skill and spawned one subagent:

- **`Explore` subagent — "Update docs file-index + architecture for activity bar."**
  Captures the read-only "where does this belong in the docs tree?" lookup so the main
  context isn't polluted with doc-scan output. Invoke it when a change adds files that need
  `docs/file-index-*.md` + `architecture.md` rows.

**Recommended skill to create:** a *co-located-test component build* micro-skill — "add
`startedAt`-style data field → pure selector + test → pure component + test → compose in
card → thread props up → four-state snapshot tests (desktop+mobile)." This session ran that
exact loop for React surfaces in `packages/client`; it is clearly repeatable.

## 7. Pitfalls & dead ends

- **Docs subagent-delegate infra was unavailable.** The AI tried to delegate `docs/` edits
  per AGENTS.md, found the delegate path missing, and **fell back to editing directly in
  caveman style**. If you hit this, do the same — do not block on the delegate; keep the
  caveman prose rules.
- **`build and deploy` failed at deploy, not build.** `/api/restart` returned HTTP 200 but
  the new server process crashed with `Identifier 'isSameWorktreePath' has already been
  declared` in `packages/server/src/git-worktree.ts`. **Root cause was unrelated** — the
  dashboard auto-spawns from the **main repo path**, whose `develop` had uncommitted edits
  from a *different* in-progress change (`harden-worktree-spawn`). Lesson: a worktree build
  can be green while the main-repo checkout is dirty; the deploy runs the main path, so
  clean/stash `develop` before expecting a restart to succeed.
- **A couple of grep probes came back empty** (e.g. searching `docs/architecture.md` for a
  PROCESS-subcard section that didn't exist → task 6.2 correctly had no work). Treat an
  empty grep as "no work here," not "search harder."

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A fully-specified openspec change (`proposal.md` / `design.md` / `tasks.md`) in a
  dedicated worktree.
- A clean `develop` in the **main** repo path (the dashboard restart spawns from there).

**Sequence:**
1. `/skill:openspec-apply-change <change>` — resolve task 0 threads first.
2. Data field + reducer stamp → pure selector + test.
3. Each leaf component + its test co-located; refactor the old flat list into the drawer.
4. Compose in `SessionCard`; thread props `SessionList → SessionCard`, derive map in `App`.
5. `npm test -- --run <new files>` → then full `npm test`.
6. Four-state snapshot tests, desktop + mobile.
7. `proposal.md` yourself; `docs/` via subagent (caveman) or direct-caveman fallback.
8. `openspec validate <change> --strict` → `commit and push` → structured PR body → `npm run build`.
9. Before "deploy": ensure the **main repo** checkout is clean, then `/api/restart` + health check.

**Artifacts produced:**
- `packages/client/src/hooks/useInflightBashTools.ts` (+ test)
- `packages/client/src/components/SessionActivityBar.tsx` (+ test)
- `packages/client/src/components/ProcessList.tsx` (refactored to drawer, + test)
- Edits: `event-reducer.ts`, `SessionCard.tsx`, `SessionList.tsx`, `App.tsx`,
  `docs/file-index-client.md`, `openspec/changes/.../{proposal,design,tasks}.md`
- Commit `a271156f`, PR #53, full suite 6605 tests green.

---

_Generated from session `019e763b-6b08-7692-bb23-f17dd1e257ae` · `pi-agent-dashboard` · 2026-05-30. Source extract: deterministic facts sheet from `extract_session.ts`._
