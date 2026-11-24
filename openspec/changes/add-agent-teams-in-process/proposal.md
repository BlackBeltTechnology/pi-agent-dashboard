## Why

`add-agent-teams-core` runs every teammate as its own dashboard pi session (`mode: "session"`). That is the right default (the user can chat with a teammate, it survives a dashboard restart, it can be resumed), but it is also heavy: one pi process, one full extension load and ~50k tokens of base context per teammate, and a ~4 s spawn. Claude Code (CC) offers a lighter *in-process* mode in which teammates live inside the lead's process. Decision D2 of the group makes both modes selectable **per team**. Core already owns the seams for a second mode (`MemberDriver`, the `modes.ts` registry, `ResolvedSpawnSpec`, `TEAM_TOOLS_BY_ROLE`, `createTeamTools(transport)`, `resolveCaller`, `abortMember`/`teamDelete`). This change adds the **in-process driver** that plugs into them: teammates run as **background children of the lead** through the external `@blackbelt-technology/pi-dashboard-subagents` pi extension instead of as separate sessions.

**Plain verdict: in-process mode cannot be built on pi-dashboard-subagents as published.** Verified against the installed 0.6.0 and the latest published 0.8.1 (see `design.md` § "What the package can do today"):

- A child can only be spawned, steered, answered or waited on by the *model* calling the `Agent` / `AgentControl` tools. The bus carries only observation, `subagents:list` / `subagents:get` queries, `subagents:stop`, and a `before_spawn` veto/patch of prompt, model and description. The spawn and orchestration functions are not exported (the package `exports` map exposes only `.`).
- pi's `ctx.executeTool()` lets an extension tool call `Agent` / `AgentControl`, but only from inside a running tool call of the lead. The server-driven parts of a team (auto-dispatch after another member completes, teammate-to-teammate mail, hook feedback, REST start, stop from the Team view) have no such call to ride on.
- A child cannot receive custom tools, an identity, a skill set, a tool allowlist per spawn, an isolated (no lead history) context, or a non-default idle policy. Children load every extension with `noSkills: true`, and all settlement handlers (`agent_settled`, `agent_end`, `turn_end`) are stripped.

So this change has a **cross-repo prerequisite**: an upstream PR in `BlackBeltTechnology/pi-dashboard-subagents` that adds a small programmatic API (spec `agent-teams-subagents-contract`). The agent-teams side is fully specified here and is gated by a capability handshake, so it degrades to `mode_unavailable` until the upstream release is installed.

## What Changes

- **Register mode `in-process`** in core's `modes.ts` registry with a per-caller availability check, and resolve the per-team mode as `TeamCreate {mode}` argument, else template `mode`, else config `teammateMode` (default `session`). One mode per team, fixed at creation.
- **In-process driver** (`server/driver-inproc.ts`) implementing core's `MemberDriver` (`spawn`, `deliver`, `abort`, `shutdown`, `isConnected`), built from core's `ResolvedSpawnSpec` (same ordered `promptFiles`, `env`, `tools`). Core's session driver and every session-mode path stay untouched.
- **In-process host in the lead's bridge**: the lead bridge is the only code that calls the subagents API (it shares the lead's process and event bus). The server sends it commands (`spawn`, `steer`, `interrupt`, `stop`, `snapshot`) through `emitEventToSession("agent-teams:inproc")` — a new event type this change adds to the manifest `emits` — with idempotent `cmdId`s, and the host reports lifecycle through the request lane with an outbox that survives a lane outage.
- **Member identity without a socket**: in-process members share the lead's socket, so `resolveCaller` gains one explicit branch for a per-member secret token proxied by the lead's bridge. The token never reaches a model.
- **Per-child team extension**: an inline extension factory loaded into each child registers that member's team tools through core's `createTeamTools(transport)` over a closure transport, reuses core's guard layers and the plan-mode backstop of `add-agent-teams-templates-hooks`, and takes the role's tools from `TEAM_TOOLS_BY_ROLE`. The agent-teams bridge entry becomes inert when the process re-activates it inside a child.
- **Lifecycle mapping**: a member is `spawning` while queued for a subagent slot, `busy` while a run is active, `idle` after a run ends (final text or error to the lead), `gone` when disposed. Children die with the lead (no orphan period, no resume); closing or deleting the team stops its children.
- **Mail as framed text**: each mail is delivered as its own block (envelope from core's `formatEnvelope`, body quoted line by line) through the steer request, because the upstream accepts only strings. The lead host keeps a per-member handover ledger so each mail id reaches a child once, and a queued steer is never re-sent as text. The envelope plus the teammate prompt rule are the compensating control for core's session-mode "mail is a custom message" rule.
- **Documented parity gaps** vs session mode: no direct user chat with a teammate, no resume, no survival of a lead `/reload`, no MCP in children, no project/user skills until upstream adds them, urgent interrupt only with an upstream feature.
- **Team view touch points** (on the Team view of `add-agent-teams-ui`, a declared dependency): member rows without a session link open the subagent view by `childAgentId`, the header shows the mode and the parallelism bound.
- **Dependency bump**: refresh the `pi-dashboard-subagents` recommended-extension entry (stale "no background sessions" copy, tool list) and gate on the upstream API version at runtime; `agent-teams` does not add the package to its manifest `requires`.

## Capabilities

### New Capabilities

- `agent-teams-in-process-runtime`: mode registration and availability gate, in-process driver, lead bridge host and command protocol (per-member serialisation, `commandSecret`, bounded queues), lead-proxied member identity, lifecycle, close/restart reconciliation, mail delivery, Team view touch points and test contract, parity gaps.
- `agent-teams-in-process-scope`: isolated context, child tool surface, per-child team extension and guards, skills/MCP/context-file/prompt mapping, cwd rules, plan-mode in a child, foreign extensions in a child.
- `agent-teams-subagents-contract`: the consumer-side contract with `pi-dashboard-subagents` (capability handshake, spawn, steer and interrupt requests, claim rule, managed children, version gate). This is the minimum upstream API and the acceptance criteria of the upstream PR.

### Modified Capabilities

None. Core, ui and templates-hooks are unarchived stacked changes (declared in `dependencies.yaml`: core, templates-hooks, ui), so nothing is expressed as a MODIFIED block. Core states the hooks this change relies on (mode scoping of the custom-message rule and the orphan window, `closeReason`, "a later mode MAY define its own proxied identity"). The few additions this change still needs on core are listed in `/tmp/agent-teams-plan/rev/add-agent-teams-in-process-c1-crossfix.md`.

## Cross-repo prerequisite (upstream PR)

**Required before this change can ship:** a release of `@blackbelt-technology/pi-dashboard-subagents` newer than 0.8.1 containing the API of `agent-teams-subagents-contract` (a minor release, **0.9.0** — owner decision A3: upstream-first; the owner opens or assigns the upstream PR). Minimum scope, all in `BlackBeltTechnology/pi-dashboard-subagents`:

1. `subagents:capabilities` query (api version, feature list, live limits).
2. `subagents:spawn` request with a synchronous reply (`id`, `agentId`, status) and per-spawn `isolated`, `tools`, `ask: false`, `inline`, `managed`, and a whitelisted `loader` pass-through (`extensionFactories`, `noExtensions`, `noContextFiles`, `appendSystemPrompt`, plus skill options).
3. `subagents:steer_request` that continues an idle child or steers a running one.
4. `managed` children are invisible to the lead's model (no push, no `AgentControl` action, not counted in the pending or idle caps, kept alive when idle).
5. A claim rule so exactly one activation executes a request.
6. Optional: `subagents:interrupt_request`, skill pass-through, per-spawn `cwdScope`.

`tasks.md` §1 lists these as external work tracked in the upstream repository, with one gate task here (1.11) that the owner checks off after the release is installed. Nothing in §3 onward can be verified end to end before that release is installed, but every agent-teams task can be built and unit-tested against a recorded contract double.

## Impact

- **New/changed code** in `packages/agent-teams-plugin/` only: `server/modes-inproc.ts`, `server/driver-inproc.ts`, `server/proxy-identity.ts`, `bridge/inproc-host.ts`, `bridge/inproc-child.ts`, `shared/subagents-contract.ts`, `shared/inproc-protocol.ts`, `configSchema.json` (`teammateMode`, `inProcessIdleTtlSec`, `inProcessLeanChildren`, `inProcessCmdTimeoutMs`), the manifest `emits` (+`agent-teams:inproc`), and small additive edits to core files (the `as` branch of `resolveCaller`, an optional availability predicate on the `modes.ts` registry unless core already has it, the bridge entry re-entry guard). Core's session driver and session-mode behaviour are not modified.
- **One host-adjacent edit**: `packages/shared/src/recommended-extensions.ts` (entry copy and `toolsRegistered`). No wire-protocol change, no host seam change.
- **Runtime**: in-process teammates share the lead's Node process (event loop, memory, credentials, crash domain). Effective parallelism is bounded by the subagents `maxConcurrent` setting (default 4), which the lead's own `Agent` calls also use, not only by `maxTeammates`.
- **Data / migration**: additive optional fields on the persisted team record (`mode` value `in-process`; team `leadIncarnation`, `subagentsApi`, `pendingStops`; member `childId`, `childAgentId`, `proxyToken`, `queuePosition`, `steerAckRun`); `schemaVersion` stays 1. **Rollback**: disable the mode (`teammateMode: "session"`) or revert; an in-process team that is still open at rollback is closed on load with `mode_unavailable` and its members are marked `gone`.
- **Compatibility**: purely additive for session mode. Installing a newer `pi-dashboard-subagents` is optional; without it, in-process mode reports `mode_unavailable` with a reason and an install/update hint. pi must provide `AgentSession.steer`/`followUp` and loader `extensionFactories` (present in pi 1.6.0, `dist/core/resource-loader.d.ts:85`).
- **Security**: a lead-proxied identity token (new authorization path on the request lane), teammates in the lead's process (no OS isolation), peer mail arriving as user-role text in a child that has no human user, a new server→lead command channel.

## Discipline Skills

- `security-hardening` — the proxied-identity token (server-minted, constant-time compared, bound to the lead's socket and team), peer mail arriving as user-role text (forgery-proof framing), the cross-extension spawn request on the shared bus, the idempotent command channel, and cwd confinement for children (tasks §4–§8).
- `doubt-driven-review` — the upstream API is a public cross-repo contract that cannot be changed cheaply once published, and the command/ack protocol is new; review both before they stand (tasks §1 gate, §4.5 gate).
- `observability-instrumentation` — new command/ack protocol, outbox, driver events and counters (tasks §9).
- `performance-optimization` — per-child extension load cost, token cost of the registered tool set per child, and the `maxConcurrent` queue (tasks §6, §7).
- `systematic-debugging` applies if lead-bridge command delivery or child event mapping misbehaves mid-implementation; `node-inspect-debugger` for the shared-process state if a stale `ExtensionContext` or module-instance issue appears.

## Non-goals

- **No direct user chat with an in-process teammate** and no composer in the subagent popout (read-only today). The user steers a teammate through the lead. A user-to-member message route (a `user`-actor action) is a follow-up change, not part of v1 (owner decision B109).
- **No resume** of an in-process teammate (children are `SessionManager.inMemory`; they die with the lead). `TeammateSpawn {resume:true}` fails with `resume_unsupported_in_process`.
- **No mixed-mode teams**: one mode per team, never both.
- **No in-repo fork or vendoring** of `pi-dashboard-subagents`, and no reimplementation of its child-session machinery inside the plugin.
- **No change to the subagents inspector plugin** (`packages/subagents-plugin`) beyond what its existing background-subagent display already does.
- **No nested teams**, no file locking, no git automation: unchanged from core.
- **No driver/registry/template/hook/OpenSpec work**: the seams are core's, templates and hooks are change 3, OpenSpec is change 4. This change only registers a driver and honours what those seams already carry.

## Owner decisions applied

Accepted by the owner (recommended options): **A1** core defaults Q1–Q6 ratified (cwd confinement, no orphan period here, REST scoping, `TeamStatus`, `autoDispatch` true, visible teammates); **A3** upstream-first bus API, minor release 0.9.0, fail-closed `mode_unavailable` until it is installed (D2 "selectable per team" is only fully met after the release); **A4** `blocked_by` core, templates-hooks and ui, no conditional wording; **A12** ratchet and relative performance budgets, absolutes after a recorded run; **B1, B2, B9, B59, B94–B109** routine answers, recorded in `design.md` "Decisions (owner-accepted)". Risk acceptances are in `design.md` "Accepted risks (owner decision)".
