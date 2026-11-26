## Context

**Goal.** Add the second teammate mode of the `agent-teams` group (decision D2): `in-process`, where teammates are background children of the lead run by the external pi extension `@blackbelt-technology/pi-dashboard-subagents`, selectable **per team** next to core's `session` mode. Everything else (store, task list, mailbox, idle notice, shutdown handshake, guards) is core's and must behave the same from the model's point of view.

**Verdict first.** The package, as published (installed 0.6.0, latest 0.8.1), does not allow another extension to spawn, steer or wait for a child, give it tools or an identity, or limit its skills. In-process mode therefore needs an **upstream PR** (§ "Required upstream API"). Without it the only honest outcome is `mode_unavailable`.

### What the package can do today (0.6.0 installed, 0.8.1 latest)

Evidence: installed copy `~/.pi/agent/npm/node_modules/@blackbelt-technology/pi-dashboard-subagents` (v0.6.0; no background runs: `grep -c run_in_background extensions/agent.ts` = 0; only `subagents:stop` at `agent.ts:741`), and `npm pack …@0.8.1` extracted to `/tmp/sa81/package` (paths below are `extensions/…` inside it).

| Need | Possible from another extension? | Evidence |
|---|---|---|
| **Spawn** a background child | **No.** Only the model, by calling `Agent({run_in_background:true})`. `subagents:before_spawn` can veto or patch `prompt`/`model`/`description` of a model-initiated spawn, nothing more. | `agent.ts:1531-1580` (`execute`), `hooks.ts:45-56` (`BeforeSpawnPayload.patch`) |
| Spawn through exports | **No.** `runAgentTool` is exported from `agent.ts:1808` but not re-exported by the entry, the `exports` map allows only `"."`, it needs an `ExtensionContext` and the per-activation registries that `activate()` creates, and a second import would be a second module instance with its own empty registries (`agent.ts:1721` "MUST NOT be held in module-level state"). | `index.ts` (re-export list), `package.json` `exports`, `agent.ts:2674-2706` |
| Spawn from inside the lead's tool call | **Partly.** pi ≥ 0.99 gives a *tool's* `execute()` a `ctx.executeTool(name,args)` (`docs/extensions.md:2792`, `dist/core/agent-session.js:443-470` needs a live parent tool call and a last assistant message). `TeammateSpawn` could call `Agent` that way, but `Agent` takes only `subagent_type, description, prompt, model, cwd, run_in_background, timeout_s` (+ `isolated` only if the global setting exposes it). | `agent.ts:1399-1470` |
| **Steer / reply / wait / cancel** a child | **No** from the bus. They are `AgentControl` actions (model tool) backed by the per-activation `Orchestrator`, which is not exported. Again only reachable through `ctx.executeTool("AgentControl", …)` inside a running lead tool call. `steer` on a running child is `session.steer` only while `record.status==="running"` and reports `queued` without checking consumption. | `agent-control.ts:1-80`, `orchestration.ts:90-130,539-553`, `agent.ts:2680-2706` |
| **Stop** a child | **Yes.** `subagents:stop {agentId}` (helper `stopSubagent(pi, agentId)`), also frees an idle child. | `agent.ts:2740`, `agent.ts:1846-1850`, `hooks.ts:322-329` |
| **Observe** a child | **Yes.** `subagents:created/started/entry/delta/completed/failed/retry` (full payloads) and `idle/disposed/question/answer/steer/slot/mail/push` (ids only), typed helper `onSubagentEvent`. Query `subagents:list` / `subagents:get` return summaries and a timeline page. | `hooks.ts:21-62,150-243,262-312`, `agent.ts:2717-2736` |
| Give a child **custom tools** | **No.** The only `customTools` entry is the child's own `ask_parent`. | `agent.ts:2274-2280` |
| Give a child an **identity** | **No.** The child loads the lead's extensions again in the same process with its own event bus; nothing per-child reaches an extension. | `agent.ts:558-570`, `dist/core/resource-loader.js:262` (`eventBus ?? createEventBus()`) |
| Per-child **tool allowlist** | Only via an agent `.md` frontmatter (`tools`), not per spawn. | `agent.ts:395-420`, `2311-2320` |
| **Isolated** context (spawn prompt only, CC parity) | Only via global `inheritContext` (default `true`), the hidden `isolated` tool param, or `.md` `inherit_context`. | `settings.ts:126-130`, `agent.ts:2227-2236` |
| Per-child **skills** | **No.** Child loaders are built with `noSkills: true`, but `noSkills` only empties the set when no extension adds skill paths (`resource-loader.js` `updateSkillsFromPaths`: `noSkills && skillPaths.length === 0`), so extension-contributed skills survive (empirical: 158→49, 48 survivors). Frontmatter has no `skills` field. | `agent.ts:564`, `395-420` |
| Per-child **MCP** | **No built-in extensions in a child.** `builtin:<name>` extensions exist in a loader only when the caller passes them as `extensionFactories`; `createChildLoader` passes none, so a child gets no MCP. | `agent.ts:558-570`, `resource-loader.js:264-265,550-552`; to confirm with a real child (task 6.6) |
| Per-child **cwd** | Yes, `Agent.cwd`, checked by global `cwdScope` (`"repo"` default) against the lead's cwd. Not overridable per spawn. | `cwd.ts:55-75`, `agent.ts:1544` |
| Child **idle** behaviour | Global: `backgroundIdleTtlSec` 600 (`<= 0` frees the child at run end: `orchestration.ts:301-309`; keep-alive needs TTL and cap `> 0`: `agent.ts:1649`), `maxIdleBackground` 4 (oldest freed first), `notifyParent` true. Not per child. | `settings.ts:141-143`, `agent.ts:1649`, `orchestration.ts:256-275,301-309` |
| Slot pool | One `maxConcurrent` pool shared by foreground `Agent` calls, resumed background runs and background children; foreground waiters are served first; an idle child releases its slot and a continued run re-acquires one. | `agent.ts:704-742,794,2504,2514,2538` |
| Child **lifetime** | In-memory session; stopped on the lead's `session_shutdown` (also `/reload`); after a reload `steer`/`reply` report `not_alive`. | `agent.ts:2257,2708-2714`, `CHANGELOG.md` 0.8.0 "Persistence" |
| Stop reasons | `stoppedBy` distinguishes `timeout` (spawn `timeout_s`) from other stops; stopping a queued child removes it from the queue. | `agent.ts:862,2055-2078,2545` |
| Settlement hooks inside a child | **Stripped**: `turn_end`, `agent_end`, `agent_before_settle`, `agent_settled` handlers of every extension are deleted from the child. `tool_call`, `before_agent_start`, `input` and every non-settlement handler and tool stay. | `agent.ts:580-595` |

Consequence for `ask_parent` / `notifyParent` / push: a finished child result and every question are pushed to the **lead model** as a `subagents:mail` custom message (`orchestration.ts:256-275`). For team children that would duplicate the team's own idle notice, so upstream must be able to silence it per child (`managed`).

### What the dashboard already renders for background children

- Frames `subagent_created|started|entry|delta` are folded by the subagents plugin reducer keyed by `agentId`, with a sticky `background` mark (`packages/subagents-plugin/src/client/sessionEventReducer.ts:53-82,167-168`); the composer dock lists background subagents in their own Processes group with name, task, `type · N steps`, elapsed, **Stop** and **Open** (`SubagentDockGroup.tsx:154-205`, spec `openspec/specs/background-subagent-display/spec.md:47-90`). The dock does not depend on an `Agent` tool row (no `toolCallId` use there).
- **Open** is the read-only full-screen popout (`openspec/specs/subagent-popout-view/spec.md`); there is no composer and no steer input anywhere in `SubagentPopoutPage.tsx`/`SubagentDetailView.tsx`. **There is no direct user chat with a child.** Stop is per child through `subagents:stop` (`openspec/specs/subagent-stop-control/spec.md:10`). A row leaves the lane at run end even though the idle child stays alive (a continued run re-emits `subagents:started`, `agent.ts:2554`).
- So in-process teammates are visible and stoppable with no dashboard change; what is missing is chat and resume (parity gaps, below).

### Verified host facts this design relies on

Core's facts (spawn seam, request lane, `emitEventToSession`, `onSessionResolved`, `abortSession`, `shutdownSession`) are in `add-agent-teams-core/design.md` "Verified host facts" and are not repeated.

- **A plugin bridge entry and the subagents extension share one pi runtime and one `pi.events` bus in the lead**, so a bridge can use `onSubagentEvent`/bus requests directly; a **child has a different bus** (`DefaultResourceLoader` creates one per loader, `dist/core/resource-loader.js:262`, and `createChildLoader` passes none) but shares `process` and `globalThis`.
- **The dashboard bridge already treats a subagent child as a re-entry** and does nothing there: `initBridge` skips when `prev.pi && prev.pi !== pi` (`packages/extension/src/bridge.ts:176-190`, `terminal-reload.ts:288-290`; ownership released on `session_shutdown` reasons in `BRIDGE_RELEASE_REASONS` = `reload|new|resume|fork`, `terminal-reload.ts:296-300`). The agent-teams bridge must do the same or a child would register `TeamCreate`/`TeammateSpawn` under the lead's identity.
- **The request lane is process-global**: `requestPluginServer` reads `globalThis[Symbol.for("pi-dashboard.pluginRequest")]` (`packages/dashboard-plugin-runtime/src/bridge/index.ts:25-33`, installed by `packages/extension/src/plugin-request-client.ts:17,106-113`). A child calling it reaches the server on the **lead's socket**, so the server sees the lead's `sessionId` for every child call. Core's rule "identity = socket sessionId" cannot identify a child; core allows "a later mode MAY define its own proxied identity" and this change does so (D4).
- **`requestPluginServer` never rejects and never retries**: it resolves `{ok:false}` on `unavailable|disconnected|timeout` (`bridge/index.ts:20-33`; lane timeout 15 s, `docs/plugin-seams.md:170`). Reports from the host must therefore be buffered by the sender (D3).
- **`emitEventToSession` refuses undeclared event types**: `!policy.allowed().has(eventType)` returns `false` and warns once (`packages/server/src/plugin-event-seam.ts:128-135`; `openspec/specs/dashboard-plugin-loader/spec.md:15`). Core's manifest `emits` lists only `agent-teams:mail` and `agent-teams:team_closed`, so this change must add `agent-teams:inproc`.
- **`onSessionEnded` fires on every death path**, including heartbeat-timeout and reconnect-grace expiry (`packages/dashboard-plugin-runtime/src/server/server-context.ts:118-133`), not only on real death.
- **Package requirement probing is name-only and non-blocking**: `probePiExtension` matches installed package sources by name, no version (`packages/dashboard-plugin-runtime/src/server/requirement-probes.ts:106-118`), and a missing `requires.piExtensions` entry leaves the plugin loaded with a warning pill (`openspec/specs/dashboard-plugin-loader/spec.md:1421`). So the version floor must be a runtime handshake.
- **The dependency lives only as a recommended pi package**, not an npm dependency: `packages/shared/src/recommended-extensions.ts:145-170` (source `npm:@blackbelt-technology/pi-dashboard-subagents`, unversioned, `status:"optional"`, copy still says "no background sessions"), and the subagents plugin's `targetPackage` + `requires.piExtensions` (`packages/subagents-plugin/package.json:51,95`). There is no version-floor field in the manifest.
- pi pieces used: loader options `extensionFactories`, `noExtensions`, `noContextFiles`, `appendSystemPrompt`, `additionalSkillPaths`, `skillsOverride`, `noSkills` (`dist/core/resource-loader.d.ts:70-130`); `AgentSession.sendCustomMessage` and `abort()` (`dist/core/agent-session.d.ts:640,681`); `pi.sendMessage` inside a child extension targets that child.

### Core seams used (names exactly as in `add-agent-teams-core` and `core-gaps-decisions.md`)

| Seam | Use here |
|---|---|
| `server/driver.ts` `MemberDriver {spawn(spec), deliver(member, mails, {wake}), abort(member), shutdown(member), isConnected(member)}` | the in-process driver implements it; the session driver stays core's only host caller |
| `server/modes.ts` registry (`session` registered, unknown → `mode_unavailable`) | `in-process` is registered from `server/modes-inproc.ts`; core's per-caller `available` predicate and default-mode resolution from `teammateMode` are used (task 3.1) |
| `ResolvedSpawnSpec {cwd, model, tools, skills, noMcp, noContextFiles, promptFiles[], env}`, `registerSpawnContributor`, `TrustedSpawnOptions {cwd?, committer?}` | the child is built from the same resolved spec (ordered `promptFiles`, `env`, `tools` that already include the team tools); contributors (change 3: agent/member prompt, `PI_EXT_AGENT_TEAMS_PLAN_MODE`) are honoured with no in-process code |
| `shared/protocol.ts` `TEAM_TOOLS_BY_ROLE` | children build their team tools from the teammate row; later changes extend that one table |
| `bridge/tools.ts` `createTeamTools(transport)` | the child extension passes a closure transport |
| `resolveCaller(meta, payload)` | one explicit `as` branch (D4) |
| `store.on(event)` (`change`, `team_created`, `lead_bound`, `task_completed`, `member_status`, `team_closed`), `Member.lastSettleId`, `Team.closeReason` | this change subscribes only through `store.on`; adds `closeReason` values `lead_ended`, `lead_reloaded`, `mode_unavailable`; reuses `lastSettleId` as the settle id |
| `abortMember(team,name,{actor})`, `teamDelete(team,{actor,force})` | reach the driver's `abort`/`shutdown`; no UI-specific path |
| `shared/mail-format.ts` `formatEnvelope`/`parseEnvelope`, mail-kind registry | the envelope header of each framed mail (D5) |
| Manifest `emits` | `agent-teams:inproc` is added (D3) |
| Mail-as-custom-message scoped to `session` mode; orphan window scoped to `session` mode | this change states its compensating control (D5) and closes at once (D7) |

## Goals / Non-Goals

**Goals:** selectable per-team in-process mode with the same tool contract, task list, mailbox, idle notice, shutdown handshake and guard layers as session mode; an explicit, minimal, verifiable upstream contract; fail-closed capability gate; no security regression from the shared process; honest parity-gap documentation.

**Non-Goals:** see proposal (chat with a child, resume, mixed modes, forking the package, nested teams, redefining core's seams).

## Architecture

```mermaid
flowchart LR
  subgraph LeadProc["Lead pi process (shared by all in-process teammates)"]
    LB["agent-teams bridge<br/>inproc-host"]
    SA["pi-dashboard-subagents<br/>(upstream, new API)"]
    subgraph Kids["background children (in-memory sessions)"]
      C1["child bob<br/>inline team extension<br/>identity = closure"]
      C2["child eve<br/>inline team extension"]
    end
    LB -- "bus: subagents:spawn / steer_request / interrupt_request / stop" --> SA
    SA -- "bus: created/started/completed/failed/idle/disposed" --> LB
    SA --> C1
    SA --> C2
    C1 -- "team tool call (token)" --> LB
    C2 -- "team tool call (token)" --> LB
  end
  subgraph Server["Dashboard server: agent-teams"]
    M["modes.ts registry"]
    D["MemberDriver (core)"]
    DS["session driver (core)"]
    DI["in-process driver (this change)"]
    ID["resolveCaller: socket session or proxied token"]
    S[("TeamStore (core)")]
  end
  LB -- "request lane agent-teams/call {as:{member,token}}<br/>agent-teams/inproc {hello|ack|event}" --> ID
  ID --> S
  M --> D
  D --> DS
  D --> DI
  DI -- "emitEventToSession agent-teams:inproc<br/>spawn | steer | interrupt | stop | snapshot" --> LB
  DS -- "spawnSession / emitEventToSession mail" --> Host["host seams (core)"]
  Dock["Processes lane + popout<br/>(existing, read-only)"] -. "subagent_* frames" .- SA
```

Two facts shape the picture: the **server cannot reach a child**, only the lead's bridge can (it shares the bus with the subagents extension), and **a child cannot reach the server except through the lead's process-global lane**. The lead bridge is therefore both the *host* for commands and the *proxy* for child tool calls.

**Module additions** (`packages/agent-teams-plugin/src/`):

| Path | Role |
|---|---|
| `server/modes-inproc.ts` | registers `in-process` in core's `modes.ts`; availability from the per-session map fed by `inproc hello`; `mode_unavailable` reasons |
| `server/driver-inproc.ts` | implements `MemberDriver`; commands to the lead bridge, ack correlation, timeouts, reconciliation, event intake |
| `server/proxy-identity.ts` | token mint/compare and the `as` branch used by core's `resolveCaller` |
| `bridge/inproc-host.ts` | lead side: capability probe, command executor with `cmdId` map, event mapper, member registry (with the `deliveredMailIds` ledger), outbox |
| `bridge/inproc-child.ts` | `createChildTeamExtension(identity, transport, env)`: the inline factory loaded into each child |
| `shared/subagents-contract.ts` | TypeScript types of the upstream contract + `REQUIRED_API_VERSION`, `REQUIRED_FEATURES` |
| `shared/inproc-protocol.ts` | `agent-teams:inproc` command and `agent-teams/inproc` ack/event/hello types |

## Required upstream API (cross-repo prerequisite)

Everything below is **new work in `BlackBeltTechnology/pi-dashboard-subagents`** and is the acceptance criteria of the upstream PR. It is expressed as bus channels with a synchronous mutable payload, the exact pattern of the existing `subagents:list` / `subagents:get` (`hooks.ts:262-312`), because a second module instance cannot share the extension's registries and a bus request is the only seam another extension in the same runtime can use. A handler fills `out` before `emit` returns; async results are a `Promise` in `out`.

**Claim rule.** Every request handler acts only while `out` is unset and sets it before returning; id-addressed requests (`steer_request`, `interrupt_request`) are answered only by the activation whose registry holds the id and are otherwise left unset, the same ownership logic `subagents:get` already uses (`agent.ts:2717-2736`, `onGuarded`). A child has its own bus, so a nested activation never sees the lead's requests (verified: `resource-loader.js:262`); the rule protects against a second activation on the *same* bus (for example the package loaded from two sources) that would otherwise spawn a duplicate child, and has its own upstream test.

```ts
// subagents:capabilities  (query)
interface CapabilitiesQuery { out?: {
  apiVersion: number;                 // 1 for this contract
  features: Array<"spawn"|"steer"|"managed"|"loader"|"loader_skills"|"interrupt"|"cwd_scope">;
  limits: { maxConcurrent: number; maxBackgroundPending: number; maxIdleBackground: number; cwdScope: "repo"|"any" };
}}

// subagents:spawn  (request; background is implied)
interface SpawnRequest {
  request: {
    subagent_type: string;            // label only
    description: string;              // dock row text
    prompt: string;
    model?: string; cwd?: string;     // no timeout_s unless the owner needs one
    inline: true;                     // never resolve subagent_type against agent .md files
    isolated: true;                   // spawn prompt only; no lead history
    tools?: string[];                 // active-tool allowlist applied after load (core's resolved spec already lists the team tools)
    ask?: false;                      // no ask_parent tool
    managed: { owner: string; keepAlive: true; idleTtlSec?: number };   // see below
    cwdScope?: "repo" | "any";        // feature cwd_scope
    loader?: Pick<DefaultResourceLoaderOptions,
      "extensionFactories"|"noExtensions"|"noContextFiles"|
      "appendSystemPrompt"|"additionalSkillPaths"|"skillsOverride"|"noSkills">;   // whitelisted; skills keys need loader_skills
  };
  out?: { ok: true; id: string; agentId: string; status: "queued"|"running"; queuePosition?: number }
      | { ok: false; reason: "no_context"|"cap"|"cwd_not_found"|"cwd_not_dir"|"cwd_out_of_scope"|"vetoed"|"unsupported"|"invalid"; message: string };
}

// subagents:steer_request  (request)
interface SteerRequest { id: string; message: string; mode?: "steer"|"followUp";
  out?: Promise<"queued"|"started"|"not_started"|"not_alive"|"not_found"> }   // idle child => new run on the same history

// subagents:interrupt_request  (request; feature "interrupt", optional)
interface InterruptRequest { id: string;       // abort the current turn silently, park idle; the following `idle` carries aborted:true
  out?: Promise<"interrupted"|"not_running"|"not_alive"|"not_found"> }
```

(`disabledBuiltinExtensions` is deliberately not in the whitelist: children have no built-in extension to disable, see D9.)

**`managed` semantics** (the one behavioural change inside the package): a managed child (a) is **not** pushed to the lead model and posts no `ask_parent`-style mailbox entry, (b) is excluded from `AgentControl` default coverage (`wait`/`list`/`status` without ids) so the lead model cannot block on teammates, and **every** explicit model-initiated `AgentControl` action naming it (`cancel`, `steer`, `reply`, …) is refused with "managed by `<owner>`" because an unwrapped `steer` would inject user-role text; `subagents:before_spawn` patches of `prompt`/`model` are ignored for managed spawns (veto only), (c) does not count toward `maxBackgroundPending` or `maxIdleBackground` (the owner caps it), (d) with `keepAlive:true` keeps its session alive when idle regardless of the global `backgroundIdleTtlSec`/`maxIdleBackground` until the owner stops it or an explicit `idleTtlSec > 0` elapses (this is an explicit flag because the package's own `0` means "free at run end", `orchestration.ts:301-309`), (e) still emits every `subagents:*` event and `subagent_*` dashboard frame, so the dock row and popout work unchanged. Inline factory extensions keep `tool_call`/`before_agent_start`/`input` handlers already today (only settlement events are stripped, `agent.ts:580-595`); upstream adds a regression test, not behaviour.

Other upstream requirements: capture the `ExtensionContext` from the latest handler call (needed for model runtime, cwd and thinking level, `agent.ts:1795-1805,2268-2292`) and drop it on `session_shutdown`; reply `no_context` until a context exists; per-spawn `isolated`/`tools` applied exactly like the existing `.md` path; `inline` guards against a stray `.md`; semver **minor** bump, CHANGELOG entry, README section, tests; `apiVersion` constant. Items not marked optional in the feature list are **required** (`spawn`, `steer`, `managed`, `loader`). `loader_skills`, `interrupt`, `cwd_scope` are optional and degrade behaviour (D9, D5, D8).

## Data model additions (persisted record, `schemaVersion` stays 1)

```mermaid
classDiagram
  class Team {
    +string mode  "session | in-process (fixed at creation)"
    +string leadIncarnation?  "in-process: random id of the lead bridge activation"
    +object subagentsApi?  "in-process: {apiVersion, features, limits} from the lead's inproc hello"
    +object[] pendingStops?  "in-process: {childId, agentId, incarnation} not yet confirmed stopped"
  }
  class Member {
    +string sessionId?  "absent in in-process mode"
    +string childId?  "bg-… id"
    +string childAgentId?
    +string proxyToken  "in-process only; 32 random bytes hex; never sent to a model, never in a snapshot"
    +int queuePosition?
    +int steerAckRun?  "run number of an outstanding queued steer ack"
    +int lastSettleId  "core field; the child's run counter is the settle id"
  }
  Team "1" o-- "0..N" Member
```

New `goneReason` values: `lead_ended`, `lead_reloaded`, `idle_disposed`, `stopped`, `timeout`, `child_failed`, `not_alive`. New `Team.closeReason` values: `lead_ended`, `lead_reloaded`, `mode_unavailable`. Core's member state machine gains one transition for in-process only: `spawning → busy` on the first `subagents:started` (a session-mode member is idle after `hello` and woken by mail; an in-process child starts running its spawn prompt at once).

## Decisions

### D1 — Core owns the seam; this change registers a driver
**Chosen:** `Team.mode` is fixed at creation (core `TeamCreate {mode}` and the registry already exist). This change registers `in-process` in `modes.ts` from `modes-inproc.ts`. `TeammateSpawn` gets **no** mode parameter. Precedence: explicit `mode` argument > template `mode` > config `teammateMode` (default `session`); a template **without** `mode` falls through to config (change 3's "Mode gating": mode omitted ⇒ the runtime resolves it). `mode_unavailable` listing depends on the *resolved* mode only. The registry needs two optional capabilities that core's text does not spell out: a per-caller availability predicate (`in-process` is available per lead session, not globally) and default resolution from `teammateMode`; task 3.1 checks core first and adds only what is missing, additively, and the request is in the crossfix file.
**Alternatives:** mixed teams (rejected: two delivery paths per recipient, ambiguous cap and Team-view semantics, identity rules differ); per-member mode (same); a separate plugin (rejected: duplicates the store and tools); re-registering the mode globally on every hello (a global registry cannot express per-lead availability).

### D2 — Integration path: a bus API in the upstream package
**Chosen:** the bus request/reply API above, called only from the lead bridge.
**Alternatives:** (a) `ctx.executeTool("Agent"/"AgentControl")` — needs a live lead tool call, so auto-dispatch, teammate-to-teammate mail, hook feedback, REST start and Team-view stop have nothing to ride on; and `Agent` still has no tools/identity/skills/isolation. Kept only as a *non-solution*. (b) Capture an `AgentTool` from `ctx.tools` and call `.execute()` later — undocumented, unsafe after reload, rejected. (c) Generate a temporary agent `.md` per teammate for tools/prompt/isolation — writes into the user's `.pi/agents` or agent dir, still no identity or custom tools. (d) Make the lead LLM call `Agent` and only *observe* — no identity, no mailbox, the model could ignore it. (e) Export functions from the package and import them — second module instance, no shared registries (see table). (f) Implement children inside agent-teams (`createAgentSession` ourselves) — duplicates the package's slot queue, dock frames, stop and persistence and drifts from it; rejected as the "fork" the owner did not choose. (g) Ask upstream to own teams — wrong ownership.
**Consequence:** a gate on an external release; handled by D10 and tasks §1.

### D3 — The lead bridge hosts the children; an idempotent command/ack protocol
**Chosen:** the server sends commands as `emitEventToSession(leadSid, "agent-teams:inproc", {cmdId, cmd, …})`. The event type is **declared in the manifest `emits`** (task 4.1; without it the host refuses and every command returns `false`). The lead bridge (`pi.events.on("agent-teams:inproc")`) executes them through the subagents bus API and answers on the request lane type `agent-teams/inproc` `{op:"ack", cmdId, ok, error?, childId?, agentId?}`. Commands: `spawn`, `steer`, `interrupt`, `stop`, `snapshot`.
- **At-least-once, executed once.** Commands are queued until `inproc hello` and re-flushed after reconnect, and an ack can be lost, so the bridge keeps a `cmdId → result` map and replays the stored ack for a repeated `cmdId`; a duplicate `spawn` never creates a second child. A `steer` carries a `cmdId` derived from its mail ids (D5), so its retry matches this map.
- **Refused vs unconnected.** `emitEventToSession` returns `false` both when the lead is not connected and when the host refuses the type. The driver checks the lead's connection state first: unconnected → queue for `inproc hello`; connected and `false` → `emit_refused`, fail fast, logged with the event type (the manifest contract test of core 1.14 makes this a build failure).
- **Timeouts reconcile.** Unacked commands fail with `delivery_timeout` after `inProcessCmdTimeoutMs` (default 10000). For a timed-out `spawn` the server sends `stop` for that member and a `snapshot` before the name can be reused, so a spawn that executed but whose ack was lost leaves no orphan child; a timed-out `steer` leaves the mail queued.
- **Durable reports.** `requestPluginServer` resolves `{ok:false}` and never retries, so the host keeps an ordered **outbox** of lifecycle reports (`started`, `idle` with `finalText`/`error`/`aborted`, `gone`) keyed by `(member, run)`; entries leave only on an `{ok:true}` reply and are flushed in order after every `inproc hello`. The `snapshot` also carries any unacknowledged settle. The server dedupes by `lastSettleId` (core), so redelivery is harmless.
- **`inproc hello`** `{incarnation, inProcess:{available, reason?, apiVersion, features, limits}, snapshot?}` is its own lane op sent after core's `hello` (no edit to core's `hello` payload); the server stores availability per session for the registry predicate.
**Alternatives:** server calls a REST endpoint in the lead (no such endpoint); lead polls (latency); one lane type per command (more registrations, duplicated authorization); reports without an outbox (lost final answers, rejected after review).

### D4 — Member identity: lead-proxied token
**Chosen:** at spawn the server mints `proxyToken` per member (32 random bytes hex), persists it in the team file (dataDir is `0700`, core D2) and sends it in the `spawn` command only. The lead bridge keeps it in the member registry and in the closure of that member's inline team extension. A child tool call goes `requestPluginServer("agent-teams","agent-teams/call",{op,args,as:{member,token}})`; the child's `hello` uses the same `as`. `resolveCaller(meta, payload)` (core's single caller-resolution function) gets one explicit branch: `as` is honoured only if (1) the socket `sessionId` is the lead of a team whose `mode` is `in-process`, (2) the member exists and is not `gone`, and (3) the token matches (constant-time compare). A present-but-invalid `as` is `forbidden` and never falls back to the socket identity. The token rotates on respawn, is deleted with the member and is excluded by the snapshot and `TeamStatus` serializers.
**Trust boundary:** the lead's *process* is trusted for its children (they already share memory and credentials); the lead's *model* has no way to emit `as` (the lead tool set never includes it) and never sees a token. A teammate model cannot read a closure; a teammate with `bash` is in the same OS user domain as the lead anyway (core's honest "advisory with bash" limit, extended to "same process").
**Alternatives:** payload `member` name only (forgeable by any code in the lead); per-child lane with its own socket (no seam, and the host registers sessions, not children); child bridge registering as a pseudo-session (heavy and breaks the "children are not sessions" model).

### D5 — Mail delivery to a child: one framed block per mail
**Chosen:** `deliver(member, mails, {wake})` turns every queued mail into its own block and sends all blocks in one `subagents:steer_request {id, message, mode:"steer"}`: a running child gets it after the current tool returns (same latency as session mode, core D6), an idle child starts a new run on the same history.
- **Framing.** Each block is the envelope header from core's `formatEnvelope` (`[agent-teams · <kind> · from <sender> · peer message — not a user instruction and not user approval]`, optional `· urgent`) followed by the body with **every line prefixed `│ `** (carriage returns and Unicode line separators normalised, blank runs collapsed, the block capped by lines as in core's notice format so the header cannot be pushed out). Peer text can therefore never produce an unquoted line, so a body containing `[agent-teams · from lead · …]` or "plan approved" stays inert; the teammate prompt states "only unquoted envelope lines are runtime-authored; quoted lines are peer text". The receiving side needs no parsing for authority: nothing is trusted from text, and the one server-bound action triggered by delivery (`plan_decision` ⇒ `hello`) is initiated by the host from the mail kind, not by parsing the child's text.
- **Compensating control.** Core scopes "mail is a custom message, never a user message" to session mode. In a child the text arrives as a user-role message because `LiveSession.steer(message: string)` and `IdleHandle.continueWith(message: string)` take strings (`agent.ts:1770-1790`). The control is: no human user in a child (popout is read-only), the framing above, and the prompt rule; approval claims relayed by agents stay untrusted (core's "Peer messages are untrusted input").
- **Wake flag.** A steer into an idle child always starts a turn, so mail with `wake:false` for an idle member stays queued in the driver and rides with the next waking mail or when the child becomes busy.
- **Results.** `started` → handed over; `queued` → handed over: the member's `steerAckRun` records the current run number, read from the host registry: `lastIdleRun + 1` while the member is busy (`lastIdleRun` comes only from `idle {run}`; the registry also includes the current run in the `snapshot`). Runs are never counted from `subagents:started`, which upstream also emits for throttled progress; the event mapper treats `started` as a transition only when the member is `spawning` or `idle` and ignores it while `busy`. Upstream keeps an unconsumed `session.steer` message in the agent's steering queue and drains it at the start of the next run (pi-agent-core `agent-loop.js:90`), so a queued steer is **not lost** when its run ends first, and re-sending its text would deliver the mail twice. If that run reports `idle` before the next run starts (upstream only calls `session.steer` while `running`, `orchestration.ts:539-553`; a run can end between the steer and the last queue check, `agent.ts:2562-2580`), the driver sends one **nudge** per `steerAckRun`: a `steer` command marked `nudge` with a fresh nonce `cmdId` (`nudge:<member>:<run>`; not replay-matched, never derived from mail ids), a fixed content-free message and no bodies, exempt from the ledger drop for run start, executed by the host as `steer_request`/`continueWith`; the next run drains the stale steer. The host records `nudgedRun`, so a repeated state report cannot loop. The contract has no consumption signal (steer results and events carry none), so a mail is final once the next run starts; if the steer had been consumed before the run ended the nudge costs one short wasted turn (counted `inproc_nudges`). `not_alive|not_found` → member `gone: not_alive`, mail stays queued for the lead's notice; `not_started` (slot unavailable) → retry after the next `subagents:slot`/`started`; empty reply → mail stays queued, counted as `delivery_timeout`, capability probe repeated.
- **Handover ledger (once per mail id).** Core makes `deliver` idempotent per (member, mail id) with at-least-once delivery; children are not bridges, so the lead host does it. The member registry keeps `deliveredMailIds` (last 200 per member; it lives as long as the team, because a lead end closes the team) and includes it in the `snapshot`. Steer commands are addressed `(member, mailIds)` with `cmdId = steer:<member>:<hash of the sorted ids>`, so a retry after a lost ack hits the `cmdId→result` replay map; if the map entry is gone, the ledger drops ids already handed over before `steer_request` or `continueWith` and re-acks them as `duplicate`; when nothing is left no run starts. Ids enter the ledger only on `started` or `queued`; `not_started`, `not_alive` and timeouts record nothing, and a `not_started` result is not stored for replay so the retry executes. After a duplicate-only waking mail the host sends a `state {member, busy|idle, run}` report so core's provisional `busy` resolves before `wakeConfirmMs`. Each framed block carries an unquoted `[agent-teams · mail id <id>]` line and the teammate prompt says to ignore a repeated mail id (defence in depth).
**Urgent:** `abort(member)` uses `subagents:interrupt_request` when feature `interrupt` exists: the turn is aborted silently, the child parks idle and the `idle` event carries `aborted:true`; core's urgent path then waits for that settle (`urgentSettleWaitMs`), suppresses notice and auto-claim, and delivers the wake mail through `deliver`. Without the feature `abort` returns not-ok with `interrupt_unavailable`; for an urgent mail the message goes by steer and the tool result carries `details.degraded:"urgent_as_steer"` plus a text warning; for a user `abortMember` the action fails with `interrupt_unavailable` (the dock Stop ends the member instead). A bare `session.abort()` is never used because it would surface as a failed run (`finalReplyFailure`, `agent.ts:2622-2628`).
**Alternatives:** `pi.sendMessage` from a child extension to its own session (typed custom message, but it bypasses the package's run lifecycle: no slot, no `started`/`idle` events, outcome lost); `sendCustomMessage` on `LiveSession` (needs upstream, optional follow-up, not required); one concatenated envelope (rejected: forgeable).

### D6 — Idle report and lifecycle mapping
**Chosen:** the lead bridge subscribes to the child events with `onSubagentEvent` and maps them per member (child → member by `agentId`, registry built from the spawn reply). Settlement hooks cannot run inside a child (stripped), so the lead observes instead:

| Upstream event | Server effect |
|---|---|
| spawn reply `status: queued` (+`queuePosition`) | member stays `spawning`, `queuePosition` set |
| `subagents:started` | `spawning→busy` (first run) or `idle→busy` (continued run) |
| `subagents:completed` then `subagents:idle {run}` in the same tick | `idle` report `{settleId: run, finalText: result}` |
| `subagents:failed` then `subagents:idle` | `idle` report with `error` (no auto-claim, as core D7) |
| `idle` after an interrupt (`aborted:true`) | `idle` report with `aborted:true` (silent for the lead) |
| `completed`/`failed` with `details.status` `stopped`/`aborted` and **no** `idle` in that tick | `gone`: `stoppedBy:"timeout"` → `timeout`, any other stop (dock, queue removal) → `stopped`; `failed` → `child_failed` |
| `subagents:disposed {reason}` | `gone`: `ttl`/`cap` → `idle_disposed`, `cancel` → `stopped`, `shutdown` → `lead_ended` |

The bridge decides after the current tick (`queueMicrotask`) because `completed` and `idle` are emitted in one synchronous sequence (`agent.ts:2473-2530`, `orchestration.ts:300-312`). Final text is cut to `maxFinalTextChars` scale before it crosses the lane (256 KiB cap). An empty final reply makes the package treat the run as failed ("subagent produced no final output", `agent.ts:2622-2628`); it is reported as an idle with an error, which is the same lead-visible behaviour as core's error notice. `settleId` = the child's `run` counter (monotonic) stored in core's `lastSettleId`, so core's repeated-settle dedupe works unchanged. The bridge passes no `timeout_s`, so a `timeout` stop only occurs if the owner asks for one. From here the dispatcher, coalescer, hooks and auto-claim run exactly as in core.

### D7 — Lifetime: dies with the lead, no orphan period, no resume; closing stops children
Children are `SessionManager.inMemory` and are stopped on the lead's `session_shutdown` (`agent.ts:2257,2708-2714`), including `/reload`. **Chosen:**
- **Reload / resume of the same id.** The bridge sends `inproc hello` with a per-activation `incarnation`. A hello with a *different* incarnation for a known in-process team marks every member `gone: lead_reloaded` (`closeReason` `lead_reloaded` when no member remains), releases their `in_progress` tasks and wakes the lead once.
- **New / fork (new session id).** `/new` and `/fork` unregister the old session (core D4), so `onSessionEnded(old lead)` closes the team with `lead_ended`; either path leaves exactly one closed team and one notice (idempotent close). Which path applies for `/resume` depends on whether the id is stable (core D4 assumes it is); both end in the same state.
- **Lead end.** `onSessionEnded(lead)` closes the team at once: members `gone: lead_ended`, no 30-minute orphan window (core's `orphanTtlMs` applies to session mode only). Because that event also fires on heartbeat or reconnect-grace expiry (`server-context.ts:124-133`) while a CPU-starved lead may still be alive with running children, the server records `pendingStops` (`childId`, `agentId`, incarnation) for every known child and delivers a best-effort `stop` when the same incarnation sends its next `inproc hello`; children never keep burning tokens without a member.
- **Server restart.** The lead process and its children keep running, so on startup members stay **`disconnected`** (core D14) until the lead's `inproc hello` with the same incarnation and a `snapshot` arrives, however long that takes; then members are re-bound and queued mail is flushed. Only members absent from the snapshot become `gone: not_alive` (a `spawning` member with no pending command becomes `failed`), and a lead that never returns ends through `onSessionEnded`. `reconcileGraceMs` does not mark in-process members gone.
- **Team close and delete.** Approved shutdown, `abortMember` removal and `teamDelete` (core D12) stop children through `driver.shutdown` (`subagents:stop`) and release tasks per core. `teamDelete` closes only after every child is `gone`, or after `shutdownGraceMs` plus `inProcessCmdTimeoutMs`; leftovers become `gone: not_alive` with `pendingStops` recorded so a late-connecting child is still stopped.
- **No resume.** `TeammateSpawn {resume:true}` is refused (`resume_unsupported_in_process`); spawning the same name again after `gone` starts a fresh context.
Idle teammates are kept alive until stopped (`managed.keepAlive:true`; optional `inProcessIdleTtlSec` > 0 frees them) because upstream's default 600 s TTL and cap of 4 would otherwise free a waiting teammate and silently destroy its context.

### D8 — Caps, concurrency and queueing
`maxTeammates` still counts synchronously before any await (core D13). **New:** every spawn reply is checked against `limits.maxConcurrent` from the capability handshake; a teammate beyond the free slots reports `queued` and stays `spawning` (`spawnTimeoutMs` counts from the first `started`, not from the spawn request). The slot pool is **shared**: foreground `Agent` calls of the lead use the same `maxConcurrent` slots and are served before background waiters (`agent.ts:704-742`), and a continued run of an idle child re-acquires a slot, so a steer-started run can itself be `queued` (the member stays `idle` with `queuePosition` set and becomes `busy` only on `started`). When `maxTeammates` exceeds `maxConcurrent` the `TeammateSpawn` result and the Team view show "N of M run in parallel (subagents `maxConcurrent`, shared with the lead's own subagents)"; changing that setting is the subagents plugin's existing producer-settings UI, outside this change. A teammate waiting in the slot queue cannot run tools, so a dependency chain that blocks on a queued member is visible rather than silent. `cwd`: core's confinement (`cwd_outside_lead`, `extraCwdRoots`, or a trusted `TrustedSpawnOptions.cwd`) runs first; upstream additionally enforces its own `cwdScope` against the lead cwd, so a per-member cwd outside the lead's git repository needs the optional `cwd_scope` feature (sent as `cwdScope:"any"` only after core's check passed) and otherwise fails with `cwd_outside_scope`.

### D9 — Scope mapping and the child's team extension
Isolated context (`isolated:true`) = spawn prompt only (core D10, CC parity); the prompt is the text of the `spawn_prompt` mail, because core delivers the header, role and prompt as that first mail and has no `initialPrompt`. The child is built from the **same `ResolvedSpawnSpec`** as a session member: `tools` (already including the teammate tool names, because the package intersects the allowlist, `agent.ts:2311-2320`), `noContextFiles`, and **the ordered `promptFiles`** (protocol, then agent, then member prompt, plus anything a contributor appended) passed as `loader.appendSystemPrompt`. `ResolvedSpawnSpec.env` is **not** exported to the process (it would be shared by all children and the lead); it reaches the child extension as a closure map, so `PI_EXT_AGENT_TEAMS_PLAN_MODE` and the policy keys work without a process variable. The package always strips `Agent`/`AgentControl` from children (`agent.ts:109,2311`), a second enforcement of "teammates cannot spawn teammates".

The per-child **inline extension** (`createChildTeamExtension(identity, transport, env)`) is passed in `loader.extensionFactories` and does what the session-mode bridge does for a teammate, with a closure transport instead of the socket: it registers the teammate row of `TEAM_TOOLS_BY_ROLE` through core's `createTeamTools(transport)` (so `SendMessage`, `Task*`, `TeamStatus`, `ShutdownResponse`, and `PlanSubmit` where change 3 extends the table), loads core's guard layers and the plan-mode `tool_call` backstop (no settlement hooks needed), sends a proxied `hello` at `session_start` (`guardActive`, `toolsActive`, `policyHash`; core's guard-ready rule applies, so a child whose guard failed is `degraded` and gets no dispatch), and sets nothing at module level. **Plan mode** (when a contributor from change 3 set the marker in `env`): the package calls `setActiveToolsByName` *after* extensions load (`agent.ts:2320`) and would overwrite a `session_start` narrowing, so narrowing is re-applied in `before_agent_start` of every run; the `tool_call` block is the authoritative layer either way; approval state comes only from the server's proxied `hello` reply `planMode {active, restoreTools}` — the host triggers that `hello` from the mail kind when it delivers `plan_decision`.

**Skills.** `noSkills:true` does not remove extension-contributed skills (table above), so "children have no skills" is false and an empty grant would silently leave ~48 skills visible. Therefore the child extension applies core's layers 2 to 4 (in-place `before_agent_start` filter, `input` refusal, read guard) for **every** grant: `[]` removes all, a non-empty grant is an allowlist over what the child has. Layer 1 (spawn scope) cannot give a child project or user skills without upstream `loader_skills`, so a non-empty grant is refused with `skills_unavailable_in_process` unless that feature is present (then the skills come through `additionalSkillPaths`/`skillsOverride` and all four layers apply). Honest limit: with no grant the child sees only extension-contributed skills, not the project and user skills a session teammate would see (parity matrix).

**MCP.** Children get **no MCP**: built-in extensions exist in a loader only through `extensionFactories` and `createChildLoader` supplies none (table above). This is recorded as a parity gap, `noMcp` is accepted and trivially satisfied, and the scenario asserts the observed absence of MCP tools from a real child (task 6.6) rather than a config mapping. If a real child turns out to have MCP, `noMcp` and a `loader` option for it get specified then.

**Foreign extensions.** The default (`noExtensions:false`, CC parity: same project context and tools) loads every discovered extension in each child; upstream strips only the four settlement events, so a third-party `before_agent_start`/`input`/`tool_call` handler or tool runs in the child (tools are trimmed by the allowlist, handlers are not). A misbehaving extension is scoped to that child's run; `inProcessLeanChildren` (child then has built-in tools plus the team extension only) is the mitigation and also a cost lever (see failure modes).

The agent-teams **bridge entry is inert in a child**: it detects re-entry exactly as the dashboard bridge does (`process[Symbol.for("agent-teams.bridge")]` holds the lead's `pi`; a different `pi` while it is live ⇒ register nothing, send no `hello`; released on `session_shutdown` for `BRIDGE_RELEASE_REASONS`, cf. `terminal-reload.ts:288-300`).
**Alternatives:** let the discovered bridge activate in the child and detect role by env (env is process-wide, so every child would look like the lead); custom tools through `customTools` only (no hooks for guards); a blanket refusal of every skill grant (rejected: layers 2 to 4 need no loader support).

### D10 — Availability gate and the dependency bump
**Chosen:** the lead bridge probes `subagents:capabilities` at `session_start`, on the first `subagents:*` event and after any empty reply, and reports the result in an `inproc hello` (D3), so a probe that lost the race with the subagents extension's own activation is repeated instead of waiting for a reconnect. In-process is **available** iff the query is answered, `apiVersion >= REQUIRED_API_VERSION` and all required features are present; `reason` ∈ `subagents_extension_missing` (no answer within 500 ms), `subagents_extension_outdated` (answered with a lower version or missing features; message names the missing features), `no_context` (not yet ready; re-probed on the next trigger). The registry predicate answers per caller session; `TeamCreate {mode:"in-process"}` while unavailable fails `mode_unavailable` with the reason and an install/update hint, and a template resolving to `in-process` is listed with `mode_unavailable` unless some connected session reports available (the authoritative check is the lead's first `inproc hello` after `team.start`; a mismatch closes the team with `closeReason` `mode_unavailable` before any teammate spawns; eager members spawn only after `lead_bound`). **Dependency bump in this repo:** refresh the recommended entry (`recommended-extensions.ts:145-170`): description (background runs, `AgentControl`, team API), `toolsRegistered: ["Agent","AgentControl"]`, a comment naming the version floor; no new manifest `requires` for `agent-teams` (session mode must not show a warning pill for an optional package, `dashboard-plugin-loader/spec.md:1421`). Existing installs at 0.6.0 stay valid for session mode; the gate message tells the user to update the package from the Packages tab (`updateAvailable`).
**Alternatives:** add `requires.piExtensions` (non-blocking but noisy for session-only users, and name-only so it cannot express the version); a `package.json` pin (the package is not an npm dependency of this repo); read the installed version from disk (wrong when the loaded copy differs, and blind to features).

### D11 — Dashboard surface
No UI change is required for visibility: teammates appear in the lead's Processes lane as background subagents with Stop/Open (existing). The Team view integration is **implemented in this change** (tasks §10; `add-agent-teams-ui` is a declared dependency and deliberately has no in-process specifics and leaves a data-driven status table and member list): in-process members have no `sessionId`, so the Team view member card shows "Open subagent view" (the popout by `childAgentId`) instead of a session link and omits any chat affordance; the header shows the mode and the parallelism bound; the dock **Stop** button maps to `member gone: stopped` with the usual task release. Dock row text is `description` = `<member> — <task title or spawn summary>` (≤ 80 chars), `subagent_type` = `teammate`. The snapshot exposes `childAgentId`, `queuePosition` and `mode` and never `proxyToken`.

### D12 — Security
Process isolation is weaker than session mode and is documented as such: a teammate shares the lead's credentials, memory and crash domain. New attack surfaces and mitigations: the proxied token (D4); the idempotent, declared command channel (D3: an undeclared event cannot silently fail open, a repeated command cannot double-spawn); peer text forgery in user-role delivery (D5 per-mail quoted framing); the bus is trusted extension code (any extension in the lead can already do anything, same domain as core's "forged `agent-teams:mail`" row); spawn requests are built only from server-validated command fields (cwd and tools already validated by core) and the bridge re-validates `cwd` through the package's own scope check; mail text is envelope-wrapped, line-capped and size-capped; no secret (token) is logged or placed in `description`/prompt; `emitEventToSession` carrying the token is trusted-gated and local; every model-initiated `AgentControl` action on a managed child is refused and `before_spawn` patches are ignored for them, so no other extension or the lead model can inject text into a teammate.

## Parity matrix (session vs in-process)

| Aspect | `session` (core) | `in-process` (this change) |
|---|---|---|
| User chats with a teammate | Yes (own session) | **No** (read-only popout; steer via the lead) |
| Resume a gone teammate | Yes (`resume`) | **No** (in-memory) |
| Survives dashboard server restart | Yes | Yes (lead process keeps children; re-bind on `inproc hello`) |
| Survives lead `/reload`, new, resume, fork | Yes (orphan window) | **No** (members `gone: lead_reloaded` / `lead_ended`) |
| Lead process ends | team orphaned, 30 min | team closed at once, children stopped |
| Spawn latency / base cost | ~4 s, one process each | in-process extension load per child; `inProcessLeanChildren` reduces it |
| Parallelism | `maxTeammates` | `min(maxTeammates, subagents maxConcurrent)`, pool shared with the lead's own subagents |
| Skills allowlist | 4 layers | layers 2 to 4 always; layer 1 and any non-empty grant need upstream `loader_skills`; no project/user skills without it |
| MCP | spawn scope (`noMcp`) | **none** in children |
| Tool allowlist / noContextFiles / prompt files | spawn scope | `tools` + `loader` pass-through from the same resolved spec |
| Mail as typed custom message | Yes | **No** (user-role framed text; child has no human user; quoted-body framing) |
| Urgent interrupt | `abortSession` | upstream `interrupt` feature, else degraded to steer |
| Idle report hook | `agent_settled` in the teammate | observed by the lead (`subagents:idle`) with an outbox |
| Plan mode | `setActiveTools` + backstop | re-narrow in `before_agent_start` + backstop |
| Hooks (TeammateIdle/TaskCreated/TaskCompleted) | server-side | unchanged |
| Isolation / crash | OS process per teammate | shared process |
| Visible in dashboard | session cards | Processes lane rows + popout |

## Sequences

### Spawn an in-process teammate

```mermaid
sequenceDiagram
  autonumber
  participant L as Lead model
  participant LB as Lead bridge
  participant S as Server (in-process driver)
  participant SA as subagents ext
  participant C as Child bob
  L->>LB: TeammateSpawn {name:"bob", prompt}
  LB->>S: agent-teams/call spawn
  S->>S: cap check, reserve name, mint proxyToken, status=spawning
  S-->>LB: {member:"bob", status:"spawning"}
  S->>LB: emit agent-teams:inproc {cmdId, spawn, spec}
  LB->>SA: subagents:spawn {inline, isolated, tools, managed, loader:{extensionFactories:[teamExt]}}
  SA-->>LB: out {ok, id:"bg-1a2b", agentId, status}
  LB->>S: agent-teams/inproc ack {cmdId, childId, agentId}
  SA->>C: create in-memory session (extensions + team ext)
  SA-->>LB: subagents:started
  LB->>S: agent-teams/inproc event started
  S->>S: bob=busy
  C->>LB: SendMessage / TaskUpdate (closure transport)
  LB->>S: agent-teams/call {as:{member:"bob",token}}
  S->>S: resolveCaller: lead socket + token ok => bob
```

### Idle, auto-claim and delivery to a parked child

```mermaid
sequenceDiagram
  autonumber
  participant C as Child bob
  participant SA as subagents ext
  participant LB as Lead bridge
  participant S as Server
  C->>SA: run ends (final text)
  SA-->>LB: subagents:completed {result}
  SA-->>LB: subagents:idle {run:3}
  LB->>LB: decide after tick: idle, outbox entry (bob, 3)
  LB->>S: agent-teams/inproc event idle {run:3, finalText}
  S-->>LB: ok (outbox entry removed)
  S->>S: bob=idle, dispatcher claims task 7, notice to lead
  S->>LB: emit agent-teams:inproc steer {member:"bob", blocks:[framed task_assigned mail]}
  LB->>SA: subagents:steer_request {id:"bg-1a2b", message}
  SA-->>LB: out "started"
  LB->>S: agent-teams/inproc ack
  SA-->>LB: subagents:started (run 4)
  LB->>S: event started
  S->>S: bob=busy
```

### Lead reload

```mermaid
sequenceDiagram
  autonumber
  participant LB as Lead bridge (old activation)
  participant SA as subagents ext
  participant S as Server
  participant LB2 as Lead bridge (new activation)
  LB->>SA: session_shutdown
  SA-->>SA: stop all children, dispose idle
  LB2->>S: inproc hello {incarnation: new, inProcess: {...}}
  S->>S: incarnation differs => members gone lead_reloaded, release tasks
  S-->>LB2: reply {role:lead, team, members:[gone…]}
  S->>LB2: waking notice to lead (spawn again to continue)
```

## Failure modes

| Failure | Detection | Behaviour |
|---|---|---|
| Upstream package missing / too old | capability probe | `mode_unavailable` + reason + install/update hint; session mode unaffected |
| Probe lost the race with the subagents activation | no answer at `session_start` | reported unavailable, repeated on the first `subagents:*` event and after any empty reply |
| `subagents:spawn` replies `ok:false` | reply `reason` | member `failed`, name reusable, waking notice; `cap` is retried once after any child ends |
| No reply from the upstream (handler absent mid-session) | empty `out` | spawn: member `failed` with `subagents_extension_missing`, name reusable; steer: mail stays queued, counted as `delivery_timeout`; probe repeated; in-process teams keep running |
| `agent-teams:inproc` undeclared in `emits` | `emitEventToSession` returns `false` with the lead connected | `emit_refused`, command fails at once, logged; caught by the manifest contract test |
| Lead bridge never acks a command | `inProcessCmdTimeoutMs` | `delivery_timeout`; spawn → `failed` plus `stop` and snapshot reconcile before name reuse; steer → mail stays queued, member marked `disconnected` |
| Command re-sent after reconnect | repeated `cmdId` | executed once, stored ack replayed |
| Child finishes while the lane is down | `requestPluginServer` resolves `ok:false` | report stays in the outbox, flushed after `inproc hello`; the snapshot carries it |
| Steer acked `queued` but the run ended first | `idle` for the recorded `steerAckRun` | continuation with an ids-only nudge; the stale queued steer is drained by the next run, the mail is not re-sent |
| Steer executed but its ack was lost, mail re-sent | repeated `(member, mailIds)` / `cmdId`, or ids already in `deliveredMailIds` | replayed ack or ids dropped at the host and re-acked `duplicate`; the child receives the mail once |
| Child stopped from the dock | `completed`/`failed` stopped, no idle | member `gone: stopped`, tasks released, waking notice |
| Idle child freed by upstream TTL/cap | `subagents:disposed` | `gone: idle_disposed`; avoided by `managed.keepAlive`, logged if it still happens |
| Lead reload / resume of the same id | `inproc hello` incarnation changed | all members `gone: lead_reloaded` |
| Lead `/new` or `/fork` | `onSessionEnded(old lead)` | team closed `lead_ended`, one notice |
| Lead process dies, or its heartbeat lapses | `onSessionEnded(lead)` | team closed, members `gone: lead_ended`; best-effort `stop` for every known child on the same incarnation's next `inproc hello` |
| Server restart | startup load | members `disconnected` until the lead's `inproc hello` + snapshot, however long; absent from snapshot → `gone: not_alive` |
| Team delete / close with live children | `teamDelete`, approved shutdown | `stop` per child, close after confirmation or grace; leftovers `gone: not_alive` with `pendingStops` |
| Valid `as` from a non-lead socket, or wrong token | `resolveCaller` | `forbidden`, logged with ids only |
| Child tool call after the member is `gone` | token lookup | `member_gone`; the child's next turn fails fast |
| Several children queued behind `maxConcurrent` | spawn reply `queued` | `spawning` with `queuePosition`; Team view shows the parallelism bound |
| Lead's own `Agent` calls contend for slots | shared pool | foreground first; teammates may queue; stated in the spawn result |
| Empty final reply of a child | `failed: no final output` | idle report with an error text |
| Stale `ExtensionContext` upstream after reload | `no_context` reply | spawn retried after the next `session_start`; member `failed` after `spawnTimeoutMs` |
| Upstream emits an unknown event shape (version drift) | schema guard in the mapper | event ignored and counted (`inproc_unknown_event`); handshake `apiVersion` is the contract guard |
| A non-team extension misbehaves inside a child | its handler throws or blocks in that child | scoped to that child's run (handlers are not stripped, tools are allowlisted); mitigation `inProcessLeanChildren` |
| Peer mail body tries to forge an envelope or approval | quoted-body framing | delivered quoted and inert; only unquoted envelope lines are runtime-authored |

## Risks / Trade-offs

- **Cross-repo coupling**: the whole mode hangs on an external release. Mitigations: handshake with fail-closed gate, contract double for tests, minimal API, same-organisation upstream.
- **Shared process**: one runaway teammate (CPU-bound tool, memory) can degrade the lead and every teammate (even starve the lead's heartbeat, which closes the team, D7); no OS isolation, no per-child kill besides `subagents:stop`. Documented; session mode remains the default.
- **User-role mail**: weaker peer/human distinction than core's custom messages. Contained by "no human user in a child", per-mail quoted framing and the prompt rule; revisit if upstream adds typed custom delivery (`sendCustomMessage` on `LiveSession`).
- **Plan-mode tool narrowing order** (package applies `setActiveToolsByName` after extensions load): handled by re-narrowing in `before_agent_start` and the `tool_call` backstop; must be verified (tasks §11 smoke).
- **Idle semantics are observed, not hooked**: `agent_settled` is stripped in children, so a child whose final turn has no text is reported as an error. Same lead-visible outcome as core's error notice but different wording.
- **`maxConcurrent` default 4** can silently serialise a 5-teammate team and is shared with the lead's own subagents; surfaced in the spawn result and Team view, not hidden.
- **Dock rows vanish at run end** while the idle child lives on (existing display rule); the Team view is the source of truth for member state.
- **Core registry**: the per-caller availability predicate and default resolution are core's (crossfix c1); this change only supplies the predicate (task 3.1).
- **Backward compat / rollback**: additive; session mode untouched (no driver refactor in this change); persisted additions are optional fields.

## Migration Plan

1. Land the upstream PR and release; install it locally (Packages tab) and run the handshake smoke.
2. Land this change: the in-process driver behind core's `modes.ts`; default `teammateMode` stays `session`.
3. No data migration; new optional fields only.
4. Rollback: set `teammateMode: "session"` (or revert). Open in-process teams found on load while the mode is unavailable are closed with `mode_unavailable`; members `gone`.

## Decisions (owner-accepted)

The owner accepted every recommended option. Nothing in this change is pending ratification.

- **A1 core defaults** (Q1–Q6) ratified: cwd confined to the lead cwd plus `extraCwdRoots` (spec "Working directory rules"), REST reads on the `observe` tier with ui owner filtering, `TeamStatus` and `autoDispatch` true as in core, teammates visible. Core's orphan window does not apply (D7: children die with the lead).
- **A3 upstream-first**: the bus API of D2 in `pi-dashboard-subagents`, minor release **0.9.0**, capability handshake, fail-closed `mode_unavailable`. The owner opens or assigns the upstream PR (task 1.1).
- **A4 dependency edges**: `dependencies.yaml` lists core, templates-hooks and ui; template mode resolution, plan-mode narrowing and the Team view member card are unconditional requirements of this change.
- **A12 performance policy**: relative targets plus baseline-then-ratchet (in-process spawn→`started` ≤ 50 % of the session-mode median, lean first request ≤ 25 % of the full-context tokens, ack/heap/jitter report-only until a recorded run, then ≤1.5× baseline). No SLOs.

| Id | Decision |
|----|----------|
| B1 | Mail blocks use core's helper and constants (never duplicated): 150 lines including the envelope, the final marker line `… N lines truncated` counted inside, ≥2 blank lines collapse to 1, core's mail-id comparator; a per-steer split is a follow-up. |
| B2 | Lengths count code points; C0/C1/ANSI/bidi controls stripped (keep `\n`, `\t` in mail bodies); cuts on a code-point boundary; the final-text cap reuses core's `maxFinalTextChars` plus its marker, else 256 KiB of UTF-8 with `… [truncated N bytes]`; lone surrogates become U+FFFD. |
| B9 | `inProcessIdleTtlSec` integer ≥1 or absent, `inProcessCmdTimeoutMs` integer 1000–120000, `inProcessQueueTimeoutMs` integer ≥1 or absent; out of range rejected at settings write by schema `minimum`/`maximum`, never clamped. |
| B59 | A burst of lifecycle events gives one coalesced waking notice per core coalesce window listing all members; core's coalescer is used unchanged and its window constant imported. |
| B94 | Handover ledger FIFO at 200 ids per member; outbox and command queue capped at ~1 000 entries / 8 MiB, oldest first (non-settle reports first; an `idle` with finalText only when nothing else is left), with counters; application-error reports are dead-lettered after 3 tries. |
| B95 | `queuePosition` is 1-based; a missing, 0 or non-integer `maxConcurrent` fails availability closed (`subagents_extension_outdated`). |
| B96 | The `no_context` retry deadline counts from the spawn command (`spawn_timeout`); queue wait is unbounded but visible unless the opt-in `inProcessQueueTimeoutMs` is set (default unlimited). |
| B97 | Abort/interrupt on an idle or spawning member is a success no-op with `details.noop:"not_busy"`; a gone member → `member_gone`; a user abort of a slot-queued member is a no-op with a hint to use Stop. |
| B98 | Errors reuse core's codes (cap, name in use, `invalid_args`) and add `spawn_vetoed` and `prompt_file_unreadable`; upstream's `AgentControl` refusal carries reason `managed_child`. |
| B99 | A proxied `as` verifies socket and token first (constant time), then a gone member → `member_gone`; a token mismatch → `forbidden` (no existence oracle). |
| B100 | One outstanding command per member; the next waits behind its ack. |
| B101 | A per-activation `commandSecret` minted by the bridge is echoed in each `agent-teams:inproc` command; a wrong or missing secret is ignored and counted (`inproc_bad_command`). Tokens on the bus stay visible to same-process extensions (documented). |
| B102 | Team-view test contract: `data-testid` `team-member-open-subagent`, `team-member-status` (with `data-status`), `team-header-mode`, `team-header-parallel`, registered in the ui change's tasks. |
| B103 | Events for foreign ids are ignored silently; an unknown `disposed.reason` or `stoppedBy` → `gone: stopped` and counted, so `inproc_unknown_event` means upstream drift. |
| B104 | `pendingStops` for a different incarnation are discarded and logged; entries expire on team delete or after 24 h and are capped at members-ever. |
| B105 | L2/L3 use a test-only fake subagents extension fixture in the docker harness until the release; one real-upstream smoke after gate 1.11. |
| B106 | Same-tick `completed`/`failed` + `idle` is a contract guarantee (spec, upstream acceptance tests, drift test); a mapper grace of ~50 ms is added only if upstream declines. |
| B107 | The `nudge` payload is one fixed string with no ids or bodies. |
| B108 | No run watchdog (CC parity); an approved shutdown is bounded by core's `shutdownGraceMs` plus `inProcessCmdTimeoutMs`. |
| B109 | No user-to-member messages in v1 (the user talks to the lead); a `user`-actor message route is a follow-up change. |

## Accepted risks (owner decision)

- **Cross-repo gate (A3)**: D2 ("selectable per team") is only partly met in v1 — until the upstream 0.9.0 release is installed, in-process mode reports `mode_unavailable` and session mode is the only usable mode.
- **Bus-visible secrets (B101)**: the proxied token and the `commandSecret` travel on the lead's in-process bus; any extension in the lead process can read them. Same trust domain as every in-process extension; documented, not mitigated further.
- **Shared crash and CPU domain**: a runaway teammate can starve the lead (D12, Risks). No OS isolation.
- **No run watchdog (B108)**: a child whose run never settles stays `busy` until the user or the lead stops it.
- **No numeric SLOs (A12)**: perf rows are report-only baselines then ratchets; absolute budgets are committed after the first recorded run.
- **No user chat with a teammate (B109)** and no per-steer split of oversized mail (B1) in v1.
