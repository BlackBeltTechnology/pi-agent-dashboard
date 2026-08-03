---
session: 019e6c85
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [configurable-chat-display]
proposal_excerpt: "The chat / stream view shows a lot of surface: token usage bar, context window bar, reasoning blocks, tool call cards, tool result bodies, turn metadata. Power users need it. Non-technical users open the dashboard, se…"
---

# How we did it: Configurable chat-display preferences — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single hard constraint — `do not use jj` — then handed the
whole build to a skill: `/skill:openspec-apply-change configurable-chat-display`. The
*real* objective lived in the already-written OpenSpec proposal: turn the dashboard's
chat/stream view from a fixed power-user firehose (token bar, context bar, reasoning
blocks, tool-call cards, tool-result bodies, turn metadata) into a **configurable
display-preferences system** — global + per-session, server-managed, with presets for
non-technical users. The human's job this session was almost entirely *ratification*:
kick off the apply skill, say "go on", then archive and push. The 47-task plan carried
the intent; the AI executed it end to end.

## 2. TL;DR playbook

1. State environment guardrails first: `do not use jj` (this repo has a jj/git trap —
   say git up front).
2. Have the OpenSpec change fully authored (proposal + design + spec + tasks.md) before
   you start. The plan *is* the spec; a good tasks.md is what makes hands-off apply work.
3. Kick off: `/skill:openspec-apply-change <change-name>`. Let the model group the 47
   tasks into ~10 logical groups (shared types → server → client hook → gating → UI →
   modal → migration → docs).
4. Nudge with `go on` when it pauses between groups — no re-planning needed.
5. Let it self-verify per layer: `HOME=$(mktemp -d) npx vitest run <project>` per package,
   then `npm test`, then a client `build`, then `/api/restart`.
6. Delegate every `docs/` write to a subagent in caveman style (repo rule) — the model
   spawned `Explore` for the doc + file-index update.
7. Close out: `/skill:openspec-archive-change <change-name>` (syncs delta specs into
   `openspec/specs/`), then `commit and push`.
8. Review the final commit note for incidental-change reverts (`.pi/settings.json`,
   `package-lock.json`) — keep the commit focused.

## 3. How the collaboration unfolded

**Phase 1 — Constraint + kickoff (2 prompts).** The human set `do not use jj`, the AI
acknowledged and switched to git, then received the apply-skill invocation. No design
discussion — the OpenSpec artifacts already existed.

**Phase 2 — Discovery (read/grep sweep).** Before writing a line, the AI grepped for
existing patterns: route registration in `server.ts`, `metaPersistence` wiring in the
browser gateway, the client store/context conventions, the tool-renderer registry, and
where `useDebugToolsVisible` / `showDebugTools` were consumed. *Why it worked:* it
matched the codebase's existing shapes (context+hook, sparse per-session meta override,
REST + WS broadcast) instead of inventing new ones.

**Phase 3 — Layer-by-layer generation (10 groups).** Shared schema + pure
`mergeDisplayPrefs` first (with unit tests), then server (global prefs in
`preferences.json`, per-session override in `<session>.meta.json`, REST GET/PATCH, WS
broadcast), then client (`DisplayPrefsContext` + `useDisplayPrefs(sessionId?)`), then
render-gating across `ChatView`/`SessionCard`/`ToolCallStep`/`CollapsedToolGroup`, then
Settings UI, per-session popover, first-launch modal, and localStorage→server migration.
The AI marked each group done in `tasks.md` as it went.

**Phase 4 — Verify.** Typecheck server early to catch issues before client work; run
tests per-package with an isolated `HOME`; full `npm test` (shared 1040 / server 2125 /
client 1882); client `build` to catch TS the tests miss; then `/api/restart` (confirmed
pid change + uptime reset).

**Phase 5 — Archive + ship (2 prompts).** `openspec-archive-change` synced the delta
spec into `openspec/specs/chat-display-preferences/spec.md` and moved the change to
`archive/`. Then `commit and push`: 43 files, +1560/-141, new branch on origin.

## 4. Prompts that worked

- **`do not use jj`** — a one-line environment guardrail issued *before* any work. Cheap,
  and it prevents a whole class of version-control mistakes in a repo with a jj/git trap.
- **`/skill:openspec-apply-change configurable-chat-display`** — the goal prompt. Its
  power is that all the real specification lives in the named change; the prompt is just
  the trigger. A strong kickoff here means a strong tasks.md upstream.
- **`go on`** — high-leverage, near-zero-cost. Because the plan was solid, a two-word
  continue was enough to carry the model through ~40 more tasks. Only works when the
  underlying plan is trustworthy.
- **`/skill:openspec-archive-change …`** then **`commit and push`** — clean handoff to
  the close-out skills; no manual git choreography.

*Rewrite for next time:* the bare `commit and push` worked but left the model to decide
what to include; a slightly stronger version — "commit and push; revert any incidental
`.pi/settings.json` / lockfile churn" — bakes in the cleanup the model did anyway.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| reach for `jj` for version control in this repo | opening with `do not use jj` | stating the git-only rule up front (or a memory) — issue before any commit step |
| pause between task groups awaiting confirmation | nudging `go on` | telling it up front "work through all groups without stopping unless blocked" |
| leave incidental churn (`.pi/settings.json` `..`→abs rewrite, `package-lock.json`) in the diff | (model self-corrected, but review the commit note) | asking for a focused commit that reverts install/bridge side-effects |

This was a *low-steering, high-trust* session: only 5 prompts for a 47-task, 43-file
change. The steering that mattered was environmental (jj) and rhythmic (`go on`), not
corrective — because the OpenSpec plan front-loaded the decisions.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session; the value came from *chaining
existing ones*:

- **`openspec-apply-change`** — turns a fully-authored change into a hands-off,
  group-by-group implementation with per-layer verification. Invoke it once the
  proposal/design/spec/tasks artifacts exist and you trust the plan.
- **`openspec-archive-change`** — syncs the delta spec into `openspec/specs/` and moves
  the change into `archive/<date>-<name>/`. Invoke after all tasks are checked and tests
  pass.
- **`Explore` subagent** — used to write the `chat-display-preferences` doc + update the
  file-index splits in caveman style, satisfying the repo rule that all `docs/` writes go
  through a subagent. Invoke whenever a change adds user/dev-facing docs.

*If anything should be captured:* the "environment guardrail first" habit
(`do not use jj`) is a candidate for a project memory so it doesn't need repeating.

## 7. Pitfalls & dead ends

- **`vitest` needs an isolated HOME.** Bare `npx vitest run` misbehaved; the working
  pattern throughout was `HOME=$(mktemp -d) npx vitest run <project>`. If tests flake or
  read real user state, isolate HOME.
- **No `check`/`typecheck` script by name.** `grep '"check"|"typecheck"' package.json`
  failed; the actual invocation is `npx tsc --noEmit -p packages/<pkg>/tsconfig.json`.
  Don't assume a named script — grep the real one.
- **One flaky doctor test** in the server suite passes in isolation. If server tests show
  a lone doctor failure in the full run, re-run that file alone before chasing it.
- **Full `npm test` is slow/heavy.** The model fell back to per-project runs
  (`--project shared --project server`, or `cd packages/<x> && vitest run`) to iterate
  faster, saving full `npm test` for the final gate.
- **Incidental diff churn.** The worktree `npm install` rewrote `package-lock.json` and
  the bridge rewrote `.pi/settings.json` (`..`→absolute). Both were reverted before commit
  to keep it focused — check for these before `commit and push`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A fully-authored OpenSpec change at `openspec/changes/<name>/` (proposal + design +
  spec + a well-grouped tasks.md) — this is the real spec.
- A worktree checkout (`.worktrees/<name>`); confirm git, not jj.

**Moves:**
1. `do not use jj` (or equivalent env guardrail) up front.
2. `/skill:openspec-apply-change <name>` — let it group tasks and self-verify per layer.
3. `go on` to carry it through groups without re-planning.
4. Per-package verify: `HOME=$(mktemp -d) npx vitest run <project>`;
   typecheck `npx tsc --noEmit -p packages/<pkg>/tsconfig.json`; then `npm test`; then
   client `build`; then `curl -X POST .../api/restart`.
5. Delegate `docs/` writes to a subagent (caveman style).
6. `/skill:openspec-archive-change <name>` — syncs delta spec, moves to archive.
7. `commit and push`, reverting incidental `.pi/settings.json` / lockfile churn.

**Artifacts produced (worktree `configurable-chat-display`):**
- `packages/shared/src/display-prefs.ts` (+ tests) — `DisplayPrefs`, `DISPLAY_PRESETS`,
  pure `mergeDisplayPrefs`, `toolCallPrefKey`.
- `packages/server/src/routes/preferences-display-routes.ts` — REST GET/PATCH; global
  prefs in `preferences.json#displayPrefs`, per-session override in
  `<session>.meta.json#displayPrefsOverride`; WS `display_prefs_updated` broadcast.
- `packages/client/src/lib/DisplayPrefsContext.tsx`, `hooks/useDisplayPrefs.ts`,
  `components/{ChatViewMenu,FirstLaunchDisplayModal}.tsx` (+ tests) — context/hook,
  per-session popover, first-launch preset modal, localStorage→server migration.
- Render-gating edits across `ChatView`, `SessionCard`, `ToolCallStep`,
  `CollapsedToolGroup`, `SettingsPanel`; new spec at
  `openspec/specs/chat-display-preferences/spec.md`.
- Commit `544e6fea` on branch `configurable-chat-display` — 43 files, +1560 / -141.

---

_Generated from session `019e6c85` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-28. Source extract: session facts sheet (mktemp)._
