---
session: 019e1377
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (14 user prompts); large facts sheet (~10443 tok)"
upgrade_status: pending
openspec_changes: [add-rpc-stdin-dispatch-with-keeper-sidecar, retire-rpc-keeper-when-dispatchcommand-available, enable-rpc-keeper-by-default, extension-ui-system]
proposal_excerpt: "Pi 0.74's `ExtensionAPI` still does not expose `dispatchCommand`, `prompt`, or any path to `AgentSession._tryExecuteExtensionCommand`. Typed extension slash commands in the dashboard chat (`/ctx-stats`, `/curator`, `/…"
---

# How we did it: RPC stdin dispatch with a keeper sidecar — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was the standard `/opsx-apply` prompt: *"Implement tasks from an OpenSpec
change."* The concrete objective, once the change was selected, was to finish
**Phases 6–11 of `add-rpc-stdin-dispatch-with-keeper-sidecar`** — make typed extension
slash commands (`/ctx-stats`, `/curator`, `/agents`, `/flows:*`) actually work inside
the dashboard chat for *headless* pi sessions. Pi 0.74 never shipped `pi.dispatchCommand`,
so the change adds a **keeper sidecar** that writes `{"type":"prompt","message":"/cmd"}`
straight to pi's RPC stdin — bypassing the missing API entirely. What started as a pure
"apply the tasks" job turned into a **long deploy-and-debug loop**: the code landed
quickly, but making the command *render correctly in the browser* and *survive a server
restart* took most of the session.

## 2. TL;DR playbook

1. `openspec status --change <name> --json` + `openspec instructions apply --change <name> --json` — read the real task schema before touching code.
2. Announce scope explicitly: *"Phases 6–11 in scope, 12–13 out of scope per tasks.md"* — then implement phase-by-phase, marking tasks as you go.
3. Implement each phase against its tests: registry extensions → bridge wiring (`isHeadlessRpcSession` + Path C) → server `dispatch-router.ts`. Run the touched test files with `HOME=$(mktemp -d) npx vitest run <files>` after every phase.
4. Run the **full** suite once (`npm test 2>&1 | tee /tmp/pi-test.log | tail -50`) before declaring code done.
5. Deploy per AGENTS.md: `npm run build` (client) → `curl -X POST /api/restart` (server) → `npm run reload` (bridges). Confirm `/api/health` mode + pid.
6. **Test the real user path in the browser, not just the backend.** Read the keeper log to prove pi ran the handler, then trace the event through server → browser reducer → renderer.
7. When a command "does nothing", split the pipeline: keeper log (did pi dispatch?) → server log (did `dispatch_extension_command` arrive + emit feedback?) → browser (did the reducer/renderer show it?). The bug is usually in the last hop.
8. Test **restart survival** and **same-cwd disambiguation** — persist every identity field (`spawnToken`, `piPid`, `keeperPid`, `keeperSockPath`) so reattach maps to the right session.
9. Audit Windows compatibility for any socket/pid/spawn code before archiving.
10. `openspec validate --strict` → archive → sync delta specs → commit **only** this change's files.

## 3. How the collaboration unfolded

**Phase A — Read the schema, announce scope (Discovery).** The AI ran `openspec status`
and `instructions apply`, grepped the existing registry/bridge/protocol files, and
announced a precise scope split (65/71 tasks, Phases 12–13 explicitly deferred). *Why it
worked:* stating in/out-of-scope up front prevented gold-plating the upstream-PR phases.

**Phase B — Implement phase-by-phase against tests (Build).** Registry keeper fields →
`isHeadlessRpcSession` + Path C in `tryDispatchExtensionCommand` → `dispatch-router.ts` on
the server. Each phase added tests first, then code, then a scoped vitest run; a full
`npm test` (5405 passing) gated "code complete". *Why it worked:* the test-per-phase rhythm
caught regressions immediately instead of at the end.

**Phase C — Deploy and hit the wall (Verify → Debug).** After build+restart+reload, the
user reported `/ctx-stats` "did nothing". This kicked off the longest stretch: **the
backend was proven correct end-to-end via the keeper log** (pi dispatched, returned
`success:true`, emitted the stats), so the bug had to be in the browser. Two real bugs
surfaced only because Path C delivered events for the first time:
- `NotifyRenderer` read `params.message` (undefined) instead of `params.title` / the prompt-bus component props.
- The optimistic `completed` feedback bypassed `eventStore.insertEvent`, so on chat reload the pill stuck at "in progress".

**Phase D — Restart-survival bug (Debug).** The user noticed that after restart, two
same-cwd keeper sessions cross-mapped: `/ctx-stats` in A hit B's keeper, and closing A
killed B. Root cause: `headless-pids.json` persistence dropped the identity fields, so on
bridge reattach `linkByPid` missed and fell through to a cwd-FIFO coin flip. Fix: persist
all four fields + extend `linkByPid` to match `entry.piPid`.

**Phase E — Windows audit + archive (Close).** The user's one-word *"Is it windows
compatible?"* triggered a full socket/pid/spawn cross-platform audit (named pipes vs UDS,
gated `chmod`/`unlink`). Then `validate --strict` → archive → sync 6 delta specs → a
**scoped commit** that deliberately excluded intermingled unrelated work.

## 4. Prompts that worked

- **The goal prompt** (`/opsx-apply`) — effective because it forces the AI to read the
  change's task schema and instructions *before* coding. Keep using the slash-command
  form; don't paraphrase "just implement the change".
- **"build and deploy - restart dashboard"** — a high-leverage 4-word prompt that pushed
  the AI from "code done" into the real deploy pipeline. Effective because the AI already
  knew the AGENTS.md build/restart/reload sequence.
- **"I started a new session and gave /ctx-stat and nothing happened"** — the single most
  valuable steer: it moved verification from *unit tests pass* to *the actual user path*.
  Rewrite for reuse: *"Test the real chat command in a fresh session and tell me exactly
  what rendered — this is the acceptance criterion, not the test suite."*
- **"After restart there was a new session… when I close the new session it closes the
  resumed one"** — a precise repro of a subtle identity bug. Effective because it described
  the *observable* (cross-session kill), which pointed straight at the mapping layer.
- **"Is it windows compatible?"** — one line that forced a cross-platform audit that
  unit tests never would have. Bake this in as a standing checklist item for any
  socket/pid/spawn code.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Declare "done" once the test suite passed | "I gave /ctx-stat and nothing happened" | Make the acceptance test the real browser render, not vitest — state it in the goal |
| Trust the backend (keeper log green) as proof the feature works | pointing at the actual chat output | Always trace the *last hop* (browser reducer/renderer), not just the server side |
| Assume restart-survival was fine because IDs reattached | "closing the new session closes the resumed one" | Add a same-cwd, post-restart disambiguation test whenever sessions are keyed by pid |
| Overlook cross-platform paths | "Is it windows compatible?" | Keep a Windows audit checklist for socket/pid/spawn code; gate `chmod`/`unlink` |
| Risk committing intermingled workspace changes | (AI self-caught) staging only this change's files | Grep the diff for unrelated change dirs before `git add`; commit one change at a time |

## 6. Skills, tools & memory created — and why they're effective

No new pi *skills* or *memories* were saved this session — the work rode existing skills
(`openspec-apply-change`, `openspec-archive-change`, `openspec-sync-specs`) and the
AGENTS.md doc-write protocol. Two `general-purpose` subagents were spawned:

- **Phase 10 docs subagent** — wrote the architecture / slash-command / AGENTS / CHANGELOG
  / FAQ updates in caveman style. *Effective because* doc prose is a clean, self-contained
  job that keeps the main context focused on code.
- **Delta-spec sync subagent** — synced 6 delta specs (4 modified, 2 added) into main specs.

**Skill worth creating:** a `diagnose-headless-slash-command` skill capturing the
three-hop trace (keeper log → server `dispatch_extension_command` → browser reducer/
renderer). This session spent ~2 hours rediscovering that split; a skill would make it a
5-minute checklist next time.

## 7. Pitfalls & dead ends

- **"Nothing happened" was a browser-render bug, not a dispatch bug.** ~2h were spent
  half-suspecting Path C before the keeper log proved pi *had* run the handler. → When a
  command silently fails, read the keeper log FIRST to bisect backend vs frontend.
- **`NotifyRenderer` read the wrong field** (`params.message` was undefined; message lived
  in `params.title` / the prompt-bus component props). → For notify/prompt renderers,
  defensively read from multiple sources.
- **Optimistic `completed` event bypassed `eventStore.insertEvent`** → pill stuck "in
  progress" after chat reload. → Terminal command-feedback events MUST go through
  `insertEvent + broadcastEvent`, exactly like the bridge's `event_forward` path.
- **`headless-pids.json` dropped identity fields** on persist → same-cwd sessions
  cross-mapped after restart. → Persist `spawnToken`, `piPid`, `keeperPid`,
  `keeperSockPath`; make `linkByPid` also match `entry.piPid`. Note: pre-fix json has no
  `piPid`, so already-running sessions need a fresh spawn to benefit.
- **A hook auto-committed unrelated SessionCard work mid-commit**, unstaging the RPC work.
  → Re-stage and commit immediately; verify the final commit's file list matches only your
  change.
- **`curl /api/health | python3 ...` failed 4×** on JSON parsing quirks. → Use
  `urllib.request` or write to a temp file first when the one-liner chokes.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an active OpenSpec change with a phased `tasks.md`; a running
dashboard (`/api/health` reachable); `useRpcKeeper: true` in `~/.pi/dashboard/config.json`
to exercise Path C.

- [ ] `openspec status` + `instructions apply` (JSON) → announce in/out-of-scope phases.
- [ ] Implement phase-by-phase: tests first, code, scoped `HOME=$(mktemp -d) npx vitest run <files>`.
- [ ] Full `npm test 2>&1 | tee /tmp/pi-test.log | tail -50` before "code done".
- [ ] Deploy: `npm run build` → `curl -X POST /api/restart` → `npm run reload`; confirm `/api/health`.
- [ ] **Acceptance = real browser render** of the slash command in a fresh session.
- [ ] If "nothing happened": keeper log → server log (`dispatch_extension_command`) → browser reducer/renderer.
- [ ] Test restart survival + same-cwd disambiguation; persist all keeper identity fields.
- [ ] Windows audit for socket/pid/spawn paths.
- [ ] `openspec validate --strict` → archive → sync delta specs.
- [ ] Commit **only** this change's files (grep diff for unrelated change dirs first).

**Final artifacts:** `packages/extension/src/slash-dispatch.ts`,
`packages/server/src/rpc-keeper/dispatch-router.ts`,
`packages/client/src/components/interactive-renderers/NotifyRenderer.tsx`,
extended `headless-pid-registry.ts` + tests; commit `e2cd03b3`
(*feat(server,extension): RPC keeper sidecar for headless extension slash dispatch*),
change archived to `openspec/changes/archive/2026-05-11-add-rpc-stdin-dispatch-with-keeper-sidecar/`.

---

_Generated from session `019e1377-1453-72d1-b31e-9391ea8ad41c` · `pi-agent-dashboard` · 2026-05-11. Source extract: deterministic facts sheet._
