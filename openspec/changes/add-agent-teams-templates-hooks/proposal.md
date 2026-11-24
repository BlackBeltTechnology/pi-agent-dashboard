## Why

`add-agent-teams-core` gives a lead the headless mechanics (store, tools, mailbox, task list, session-mode teammates, extension points) and `add-agent-teams-ui` makes them visible. Both are *ad hoc*: every team is described in natural language and every teammate is spawned with free-form arguments. Claude Code (CC) agent teams add four things on top that make teams repeatable and governable, and that this change adds:

1. **Reusable team definitions** — a file a user or project commits (`.pi/teams/<name>.md`) that says who the lead and teammates are, with what model, tools and skills, plus the lead's playbook; started with one command or from the dashboard.
2. **Teammate types** — reuse the existing `.pi/agents/<Name>.md` definitions (the `pi-dashboard-subagents` frontmatter) as teammate roles instead of re-typing prompts and tool lists.
3. **Hooks** — `TeammateIdle`, `TaskCreated`, `TaskCompleted` quality gates: a shell command may veto an event with exit code 2 and its stderr is fed back to the agent (CC semantics).
4. **Plan approval** — a teammate works read-only until the lead (or the user) approves its plan.

This is change 3 of 5 in the `agent-teams` group (blocked by core and ui). Runtime state is deliberately *not* pre-authored (CC parity): a template describes how to start a team; the live team (members, tasks, mail) is created by the runtime from core.

## What Changes

- **Team templates** (`agent-teams-templates`): markdown + YAML frontmatter at `<cwd>/.pi/teams/<name>.md` (project; gated by the host's project-trust decision) and `<piAgentDir>/teams/<name>.md` (user). Fields: `name`, `description`, optional `mode` (must be a registered core mode), `lead {model}`, `maxTeammates`, `autoDispatch`, `spawn`, `requirePlanApproval`, `members[] {name, agent, model, count, cwd, tools, skills, prompt, requirePlanApproval}`, team-level `defaultModel` / `defaultTools` / `defaultSkills`, `notify {coalesceMs}`, `hooks`; the body is the lead playbook. Only two template variables: `{{goal}}` and `{{cwd}}`.
- **Start paths**: `/agent-team start <template> <goal>` (a pi extension command registered by the plugin bridge, so it appears in the dashboard command list; named `agent-team` because the group reserves the bare word `team` for `packages/team-plugin`), `/agent-team templates`, and a dashboard **Start team** action hosted by a `sidebar-folder-section` claim (one per workspace folder) backed by new REST routes. An automation action is **deferred** (design D9).
- **Teammate types** (`agent-teams-teammate-types`): `TeammateSpawn` gains `agent` (a `.pi/agents/<Name>.md` / `<piAgentDir>/agents/<Name>.md` definition resolved against the team's lead cwd). Precedence per field: spawn argument > template member > agent definition > team default; a template-declared `tools` / `skills` list is a ceiling for lead-supplied lists; the template's `requirePlanApproval` is a floor. `inherit_context` is ignored for teammates.
- **Hooks** (`agent-teams-hooks`): server-run shell commands (`bash -c`, lead cwd, JSON on stdin, sanitized env) installed as core **op gates**, all commands of an event sharing the core 12 s budget. Exit 0 allow, exit 2 block + stderr as feedback, anything else log + allow. Hooks load only from trusted sources (user dir; project dir when the project is trusted *and* the hook set was confirmed by hash) and are frozen into the team at start — never taken from agent input.
- **Plan approval** (`agent-teams-plan-approval`): a member with `requirePlanApproval` starts with an explicit tool list, is narrowed to a read-only set (in-session `pi.setActiveTools` + `tool_call` backstop), submits `PlanSubmit`, and is widened after `PlanDecision` by the lead — or by the user from the approval card via plugin REST. `"user"` removes the lead's right to decide. Held members are excluded from the dispatcher through core's eligibility registry.
- **Core extension points consumed, not redefined**: `createTeam({starting})`/`bindLead` (server-started lead), `registerMailKind` (`plan_request`, `plan_decision`, `hook_feedback`, `playbook`), `registerOpGate`, `registerDispatchEligibility`, `registerSpawnContributor`, `Team.overrides`, the modes registry and `TEAM_TOOLS_BY_ROLE` (extended with `PlanSubmit`/`PlanDecision`). This change only adds additive tool parameters (`agent`, `requirePlanApproval`), a `hello` reply field `planMode`, the `registerStartProfile` seam with a trusted `bundled` template source (used by change 4), and its own modules.
- **Dashboard surface owned here**: the Start team entry and dialog, and the `agent-teams-approval` (with Approve/Reject) and `agent-teams-playbook` card renderers. The ui change's own cards stay read-only; its spec text is amended separately (see Impact).
- **Owner-accepted decisions** (all recommended options): hooks need project trust plus per-hash confirmation, fail open, and stay frozen when trust is revoked mid-team (A7); `"user"` plan approval is advisory, never a security boundary (A8); template `tools`/`skills` are ceilings (key present, `[]` allows nothing) while the spawn-arg model wins (A9); `spawn` defaults to `eager` and automation start stays deferred (A11); thresholds are regression gates, not SLOs (A12); validation uses one stable error code per cause, strict YAML without aliases, integer-only numerics, a single-line goal and core's counting helper (B1, B2, B9, B50–B66). See design.md `## Accepted risks (owner decision)`.

## Capabilities

### New Capabilities

- `agent-teams-templates`: template format, discovery, trust, validation, variables, runtime/template separation, start paths (command, REST, dashboard entry), server-started lead, playbook message, overrides, owner recording.
- `agent-teams-teammate-types`: agent-definition resolution and trust, field mapping to the spawn, precedence/ceiling/floor rules, prompt files, `inherit_context` ignored.
- `agent-teams-hooks`: hook model, execution contract and shared budget, exit-code semantics, op-gate integration, limits, trust, freeze at start, retry cap, observability.
- `agent-teams-plan-approval`: read-only plan mode, `PlanSubmit`/`PlanDecision`, user decision route and ownership guard, tool-scope widening from the server, dispatcher exclusion, approval card.

### Modified Capabilities

None. Core's capabilities are unarchived and already define every seam used here. Two sentences of the ui change ("no approval control", "no team creation from the UI") conflict with the capabilities above; they are tracked as a cross-change fix to the ui change (its chat-rendering and team-view requirements apply to the mail/idle/notice cards and to the Team view only), not as a MODIFIED block.

## Impact

- **Package** `packages/agent-teams-plugin/` (created by core): new modules `server/templates.ts`, `server/agents.ts`, `server/spawn-resolve.ts`, `server/hooks.ts`, `server/hook-trust.ts`, `server/plans.ts`, `server/start.ts`, routes additions; `bridge/command.ts` (the `/agent-team` command), `bridge/plan-mode.ts`; client `StartTeamDialog`, folder-section entry and the two card renderers; new `yaml` dependency (already used by `packages/automation-plugin/package.json:97`).
- **Registrations**: six new route rows in `packages/shared/src/route-tiers.ts` (two `observe`, four `operate`); manifest `claims` (`sidebar-folder-section`, `custom-entry-renderer` ×2) and any `emits` additions; `configSchema.json` keys; i18n keys (zh-CN, hu, en). The MCP denylist pattern added by core (`/api/plugins/agent-teams/`) already covers the new routes.
- **Runtime**: hooks spawn `bash -c` children from the server (through the shared platform wrappers; the repo-wide `no-direct-child-process` invariant); plan mode changes a teammate's active tool set in-session.
- **Data / migration**: additive optional fields on the persisted team record (`template`, `hooks`, `plans[]`, `leadSpawnToken`, `leadBindDeadline`; member `agent`, `planApproval`) — `schemaVersion` stays 1 (readers ignore unknown optional fields). New `<dataDir>/hook-trust.json` and `<dataDir>/prompts/<teamId>/`. **Rollback**: revert the change; the extra fields are inert, `hook-trust.json` can be deleted, running teams keep working without templates/hooks/plan mode (members awaiting plan approval remain read-only until their session ends — noted in design).
- **Compatibility**: purely additive over core; templates are optional; a team started the CC way (natural language) behaves exactly as in core. Requires core to provide `createTeam` with an optional `owner` and lead binding from a `pluginRef` with role `lead` (tracked as a core cross-fix).
- **Security**: new code-execution surface (hooks) and a tool-scope widening decision (plan approval) — owner-/user-authored only, trust-gated, frozen at start, never reachable from agent tool input; new `operate`-tier mutating REST routes guarded by cwd admission and the team owner/control rule; the honest limit that a same-user local-token caller can reach the REST routes is stated in design D8.

## Discipline Skills

- `security-hardening` — hooks execute shell from repo content (trust gate + hash-bound confirmation + frozen snapshot + sanitized env + process-tree kill + no agent path); plan approval widens tool scope (decision authority, forged-approval resistance, read-only backstop, local-token limit); template/agent file reads (symlink/path confinement, size caps); mutating REST routes with `cwd` admission and owner guard (tasks §2, §5, §6, §7).
- `observability-instrumentation` — new REST routes, hook runs (exit code, duration, block/timeout counters) and plan transitions need structured logs and counters in the existing `stats` snapshot (tasks §8).
- `performance-optimization` — hooks sit on the task/idle hot path under a 12 s total budget with per-team and global concurrency limits (tasks §5).
- `doubt-driven-review` — the `.pi/teams/*.md` schema, the hook JSON/exit contract and the `PlanSubmit`/`PlanDecision` tool contract become public surfaces that change 4 (OpenSpec templates) builds on; review them before they stand (tasks §1.8).
- `systematic-debugging` — applies only if the in-session tool-scope narrowing/widening misbehaves mid-implementation.

## Non-goals

- **No OpenSpec templates** (`openspec-group`, `openspec-apply`) and no worktrees → `add-agent-teams-openspec` (change 4); this change only guarantees the template format and hook points they will use.
- **No in-process mode**: a template `mode` that is not registered in core's mode registry is rejected with `mode_unavailable` until `add-agent-teams-in-process` (change 5) registers it.
- **No automation action** and no `automation-action-editor` claim (design D9).
- **No `wakeOnIdle` knob**: core's wake rules stay as they are.
- **No bundled / package-tier agent definitions**: only project and user `agents/` directories are read.
- **No hooks outside templates** (no global dashboard hook config), no per-hook fail-closed flag, no hook-supplied tool/permission mutation beyond allow/deny.
- **No file locking, no git automation, no nested teams** (unchanged from core).
- **No new teammate-initiated powers**: teammates still cannot spawn teammates, decide plans, or alter hooks.
