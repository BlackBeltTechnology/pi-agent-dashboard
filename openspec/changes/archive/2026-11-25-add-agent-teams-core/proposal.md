## Why

Claude Code "agent teams" (a lead plus named teammates, each with its own context window, a shared task list and a mailbox) is a proven way to parallelise research, review and implementation work. pi-dashboard already manages many pi sessions, but a session cannot hand work to its peers: there is no shared task list, no messaging between sessions, and no way for a lead to spawn and coordinate teammates that the user can also watch and chat with.

The goal is a **general pi-dashboard feature that behaves like Claude Code agent teams without Claude Code**, delivered as one bundled plugin (`agent-teams`). This change is the foundation (change 1 of 5 in the `agent-teams` group): the headless mechanics — team store, tools, mailbox, task list, idle notification, shutdown handshake, session-mode teammates and per-teammate limits. UI, templates/hooks, OpenSpec integration and in-process mode build on it.

A spike (Phase A: 3 real `pi --mode rpc` processes with a faux LLM; Phase B: a real sonnet lead plus haiku teammates spawned through the live dashboard) proved the mechanics end to end and shaped this design: mail must be custom messages woken via `pi.sendMessage`, idle handling must hang on `agent_settled`, claims must be atomic, assignment must be a task field, notices must be coalesced, team size must be capped, and a busy recipient needs an interrupt path.

## What Changes

- **New bundled plugin package** `packages/agent-teams-plugin` (plugin id `agent-teams`, NOT `team` — `packages/team-plugin` is the unrelated multi-user persona product) with three entries:
  - **bridge** (pi extension, auto-registered for every pi session): CC-named agent tools (`TeamCreate`, `TeammateSpawn`, `SendMessage`, `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TeamStatus`, `ShutdownRequest`, `ShutdownResponse`, `TeamDelete`), mail delivery (`pi.events` listener → `pi.sendMessage` custom message), `agent_end`/`agent_settled` idle report, and the teammate guard layers (tool allowlist, skill allowlist in 4 layers, nested-team ban, sleep-poll guard).
  - **server**: server-owned team store persisted in the plugin data dir, request-lane handlers for every tool, `emitEventToSession` mail push, `spawnSession` for session-mode teammates with `pluginRef` + `scope`, `onSessionResolved`/`onSessionEnded` membership, `shutdownSession` cleanup, team size cap, notification coalescing, urgent interrupt path, minimal read-only REST routes for the later UI.
  - **client** (minimal): manifest registration and i18n catalog only; no visible UI (that is change 2).
- **Task list** with dependencies, atomic claim, owner assignment (an `owner` field the auto-claim respects), auto-unblock, and teammate self-claim on settle.
- **Mailbox**: direct + broadcast messages delivered as custom messages (never user messages), queued for busy/spawning/disconnected recipients, acknowledged, with an `urgent` interrupt path for the lead.
- **Idle notification** carrying the teammate's final answer (or the error text), coalesced, to the lead.
- **Shutdown handshake**: the lead requests, the teammate approves or rejects with a reason; `TeamDelete` cleans up (lead only).
- **Limits**: `maxTeammates` (default 5), one team per lead session, no nested teams, per-team and per-member tool/skill allowlists, reserved member names, result/final-text/mail-rate caps, hub-local-only lane handlers, no team leadership for sessions confined by another plugin.
- **Fail-closed teammate spawn**: the spawn prompt travels as a `spawn_prompt` custom message after bind and a guarded `hello` (not via the per-cwd `initialPrompt` queue); `lifecycle.recover:false`; the bridge reports `hello`/`busy`/`idle` so the server knows real member state.
- **Seams for the four dependent changes** (additive, inert by default): `MemberDriver` + mode registry, open mail-kind envelope (`formatEnvelope`), extension-point registries (spawn-spec contributors, op gates, dispatch eligibility, route visibility), typed store events with `rev`, actor operations (`abortMember`, `teamDelete`), optional lead (`starting` team), per-team `committer` and `overrides`.
- Registration of the new package in every CI/contract registry (publish allowlist, bundled plugins, client dependency, vitest, knip, route tiers, MCP denylist, i18n lint).

## Capabilities

### New Capabilities

- `agent-teams-runtime`: plugin package, server-owned persisted team store, identity binding, team lifecycle, size cap, member/lead/server failure handling, minimal REST read routes, configuration.
- `agent-teams-task-list`: shared task list, dependencies, atomic claim, owner assignment, auto-claim/dispatch, task tools.
- `agent-teams-messaging`: mailbox, custom-message delivery, queueing and acknowledgement, urgent interrupt, idle notification, notice coalescing, shutdown handshake, untrusted-peer envelope.
- `agent-teams-teammate-scope`: session-mode teammate spawn scope, per-role tool sets, tool and skill allowlists (4 layers), nested-team ban, sleep-poll guard.

### Modified Capabilities

None. No existing spec is changed; the host seams used (`spawnSession`, `emitEventToSession`, request lane, …) already exist.

## Impact

- **New package** `packages/agent-teams-plugin/` (bridge, server, client entries, `configSchema.json`, teammate prompt file, README, AGENTS.md rows).
- **Manifest**: `emits: ["agent-teams:mail","agent-teams:team_closed"]` (the host refuses undeclared emits).
- **Registrations** (see tasks §1): `.github/workflows/publish.yml`, `packages/server/package.json#piDashboard.bundledPlugins`, `packages/client/package.json` + regenerated `packages/client/src/generated/plugin-registry.tsx`, root `vitest.config.ts`, `knip.json`, `packages/shared/src/route-tiers.ts`, `packages/mcp-server-plugin/src/server/tools.denylist.ts`, `scripts/i18n-lint.mjs` walk exclusion.
- **Runtime**: every pi session loads the (small) bridge entry; a plain session registers only `TeamCreate` and `TeammateSpawn`, the rest appear after the session becomes lead or teammate. Each teammate is a full pi session (~50k tokens base context per call from global extensions + AGENTS.md); cost scales with teammates, hence the cap and per-member scope.
- **Data / migration**: new state under `~/.pi/dashboard/plugin-data/agent-teams/` (`teams/<id>.json`, versioned `schemaVersion: 1`). Nothing existing is migrated. **Rollback**: disable the plugin (or revert the package); the bridge entry is removed from `settings.json` by the host, orphaned team files are inert and can be deleted. Teammate sessions already spawned stay as ordinary sessions.
- **Compatibility**: purely additive; no wire-protocol change in `packages/shared`; no host change (all seams exist). Depends on pi ≥ the version that provides `agent_settled` and `pi.sendMessage` (spike ran on pi 1.6.0; the bridge already consumes `agent_settled` natively — `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts:1`).
- **Security**: new first-party spawn/abort/shutdown/emit capability use (trusted-gated), new agent-facing request-lane surface, peer-message input that must never count as user approval.

## Decisions

The owner accepted all recommended options of the cross-change decision sheet; they are recorded in `design.md` (`## Decisions ratified by the owner`, `## Accepted risks (owner decision)`): Q1–Q6 defaults (explicit sign-off for `TeamStatus` and `autoDispatch` true), per-member committer, forced shutdown for lead and user actors, stop-member semantics, generous performance regression gates and the routine edge rules.

## Discipline Skills

- `security-hardening` — peer messages are untrusted input (never user approval); tool-level authorization by server-verified session identity with hub-local-only handlers and `lead_confined`; per-member tool/skill limits; cwd confinement for teammate spawn; mail rate limit and size caps (tasks §2, §6, §8, §9).
- `observability-instrumentation` — new request-lane handlers, mail/idle/claim events and REST routes need structured logs and counters (tasks §11).
- `doubt-driven-review` — the CC-named tool surface is a public contract that the other four changes and agent prompts depend on; review it before it stands (tasks §3 gate).
- `performance-optimization` — mail/notice coalescing, persistence write batching, token cost of the registered tool set (tasks §2, §6, §8).
- `eng-disciplines` skill `systematic-debugging` applies if the lane/emit/delivery path misbehaves mid-implementation; no other discipline is triggered.

## Non-goals

- **No chat/Team UI**: custom-entry renderers, tool renderers, Team view, session-card badges → `add-agent-teams-ui` (change 2). The mail custom messages use stable `customType` values (`agent-teams-mail`, `agent-teams-idle`, `agent-teams-notice`) so the UI can render them later; until then they appear as generic custom messages.
- **No team templates, no `.pi/agents/` teammate types, no hooks** (TeammateIdle / TaskCreated / TaskCompleted), **no plan approval** → `add-agent-teams-templates-hooks` (change 3).
- **No OpenSpec integration** (`openspec-group`, `openspec-apply`, task-checkbox writer, per-change worktrees) → `add-agent-teams-openspec` (change 4).
- **No in-process teammate mode** and no dependency on `pi-dashboard-subagents` → `add-agent-teams-in-process` (change 5). Core only implements `mode: "session"`; the data model, mode registry and `MemberDriver` let change 5 add a driver without editing core.
- **No file locking** and **no git automation**: teammates share the lead cwd by default, the lead is the sole committer in the shared cwd (CC parity); a trusted server caller may designate a per-member committer for the owner of an exclusive worktree (owner-accepted, decision A2 — used by `openspec-group`).
- **No nested teams** and no lead hand-over; one team per lead session.
- **No host change**: worktree spawn (`add-plugin-spawn-worktree`) is not used here.
