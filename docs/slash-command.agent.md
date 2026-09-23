# slash-command.md — index

Pull-only condensed map. Source: docs/slash-command.md. Slash command routing.

## Purpose
Documents how dashboard bridge routes typed `/foo` chat text to pi handlers. Extension command dispatch (step 9) = ONE in-process call `pi.sendUserMessage(text,{expandPromptTemplates:true,deliverAs})`, gated running pi >= 0.84.2. Every session kind. Paths B/C/D retired by `retire-slash-dispatch-via-expand-prompt-templates`.

## Routing Order
`command-handler.ts::parseSendPrompt` + `bridge.ts::sessionPrompt` process `send_prompt` in order: 1 `!!`→silent bash `pi.exec`; 2 `!`→bash+LLM; 3 `/compact`→`compact()`; 4 `/quit`|`/exit`→`shutdown()`; 5 `/reload`→`reload()`; 6 `/new`→`spawnNew()`; 7 `/model`→`setModel()`; 8 `/<name>` user flow (`getFlowsList()`)→`pi.events.emit("flow:run")`; 9 `/<name>` extension command (`source:"extension"`, not `DASHBOARD_NATIVE_COMMANDS`)→gate pi >= 0.84.2 → `pi.sendUserMessage(text,{expandPromptTemplates:true,deliverAs})`; 10 `/` fall-through→`expandPromptTemplateFromDisk`+`pi.sendUserMessage`; 11 no prefix→passthrough. Steps 1-7 parseSendPrompt, step 8 sessionPrompt, step 9 retired+replaced. Steps 10-11 unchanged.

Step 9 history — Paths B/C/D RETIRED: B `pi.dispatchCommand` never shipped; C headless bridge→`dispatch_extension_command`→server→keeper UDS→pi stdin (dispatch-router.ts deleted); D tmux/Win-Terminal error. Also deleted `hasDispatchCommand`, `connection` param + `DispatchConnection`, `keeperManager.writeRpc`/`writeRpcToSockPath`, `headlessPidRegistry.writeRpc`. Kept `isHeadlessRpcSession` (live caller bridge registration).

## Surface Map
Mermaid flowchart: parseSendPrompt → ParsedPrompt branches (bash/compact/shutdown/reload/new/model/mgmt/slash/passthrough). Slash → sessionPrompt → flow fast-path or step-9 gate `isExtensionSlashCommand` → true: pi>=0.84.2? no→`command_feedback{error,'...require pi 0.84.2+'}`; yes→emit started + `pi.sendUserMessage(text,{expandPromptTemplates:true,deliverAs})` + emit completed (sync throw→error); false→steps 10-11 fall-through. Stale-ctx `getCommands()` throw→false.

## Pi 0.70 ExtensionAPI Constraint
0.70 ExtensionAPI exposes: sendMessage, sendUserMessage, registerCommand, getCommands, events, exec, setSessionName, getActiveTools (`types.d.ts:770-922`, `loader.js:155-260`). Does NOT expose: prompt, session, dispatchCommand. Slash dispatch belongs to pi external `prompt()` (TUI, RPC `case "prompt"`), never delegated. `getCommands()` returns `SlashCommandInfo[]` name+description, no handler. `pi.sendUserMessage` defaults `prompt(text,{expandPromptTemplates:false})` skips `_tryExecuteExtensionCommand` (`agent-session.js:1002`). RESOLVED pi>=0.84.2: explicit `expandPromptTemplates:true` honored → `prompt()` runs `_tryExecuteExtensionCommand` FIRST (before compaction guard, before streamingBehavior). Verified 0.86.1 `agent-session.js` L938/L945/L953 + L1273/L1296, `loader.js` L284-287.

## Affected Commands Today
`pi.registerCommand` commands dispatch in-process (step 9) now: context-mode `/ctx-stats`,`/ctx-doctor`; pi-web-access `/websearch`,`/curator`,`/google-account`,`/search`; pi-subagents `/agents`; pi-flows `/flows`,`/flows:new`,`/flows:edit`,`/flows:delete`. Excluded by `isExtensionSlashCommand`: `DASHBOARD_NATIVE_COMMANDS` (`{"roles"}`) + `__`-prefixed names (`/__dashboard_reload`). Flow kebab buttons route via `flow_management` WS. Empirical: `echo '{"type":"prompt","message":"/flows:new","id":"1"}' | pi --mode rpc` dispatches correctly.

## Decisions
- Decision 1: Dispatch path — Path B primary, Path D stopgap. RETIRED. Replaced by one in-process call at step 9. Path B never shipped; Path C headless stopgap retired too.
- Path C: server-routed via RPC keeper — RETIRED. `dispatch-router.ts` + server write client deleted. Was headless only. Keeper sidecar UNCHANGED (durable pi-stdin owner).
- Decision 2: Detection rule — intersect cmdName vs `getCommands()` `source==="extension"` AND not `DASHBOARD_NATIVE_COMMANDS`. Per-invocation, no caching. Skills/templates/native stay on template path.
- Decision 3: Feature detection over version sniffing — SUPERSEDED. Now running-pi version gate >=0.84.2; `readRunningPiVersion()` (`model-tracker.ts`) argv-anchored, walks up, accepts both pi package names; undefined/unparseable→new + warn once.
- Decision 4: Telemetry — exactly one `command_feedback{status:"started"}` before, exactly one terminal after: `completed` fire-and-forget after call returns, `error` on sync throw (stale ctx) or pi<0.84.2. Handler outcome unobservable. `deliverAs` inert for extension command.
- Decision 5: Test shape — `bridge-slash-command-routing.test.ts`, stub `sendUserMessage`+`getCommands`, assert flag + emission sequence + old-pi error gate; `pi-version-tracker.test.ts`.

## Two-Step Fix
RETIRED — now single-step: sessionPrompt → flow? (step 8) → `isExtensionSlashCommand` (step 9 gate) → false: steps 10-11 sendUserMessage; true: pi>=0.84.2? no→error; yes→started + `pi.sendUserMessage(text,{expandPromptTemplates:true,deliverAs})` + completed (sync throw→error). No RPC route, no session-kind probe.

## Empirical Verification
From `notes/preflight-empirical-checks.md`.
- Q1: typed `/flows:*` broken same way — YES. `getFlowsList()` = user flows only; pi-flows names never match; falls through. Buttons mask via `flow_management`.
- Q2: `sendUserMessage` sites in command-handler.ts — line 264 (slash else-arm) needs gate YES; 286/453/455/458 (sendUserMessageWithImages internals) NO; 495 (handleBashCommand) NO. Two sites need gate: `bridge.ts::sessionPrompt` fallback + `command-handler.ts:264`.

## Detection Helper
`isExtensionSlashCommand(text, commandList): boolean` — pure, exported from `bridge-context.ts`. No pi calls. True iff: starts `/` + no newline; token cmdName in commandList `source==="extension"`; not in `DASHBOARD_NATIVE_COMMANDS`. Truth table: `/ctx-stats`→true, `/ctx-stats verbose=1`→true, `/skill:foo`(skill)→false, `/review`(prompt)→false, `/__dashboard_reload`→false, unknown→false, multi-line→false, no-prefix→false.

## Telemetry
`command_feedback` around step 9: started once before call; completed once after call returns (fire-and-forget); error on sync throw or pi<0.84.2. Handler outcome UNOBSERVABLE from bridge: pi routes in-prompt failures to internal `runner.emitError`; `bridge.ts` does NOT subscribe to `extension_error` (`extension_error` JSON line only from rpc-mode). Bridge emits `completed` on any returned call (fire-and-forget) — no handler-success claim. Server tombstone: `dispatch_extension_command` arm in `event-wiring.ts` → warn + persist/broadcast `error,"bridge outdated — reload the session"`, no keeper write; protocol type `@deprecated`.

## Risks
Old pi<0.84.2 → gate error, raw slash never to model. Detection false-positive → completed while pi sends text to model (bounded to reload windows). Client `event-reducer.ts` handles all statuses. Multi-line slash = passthrough. Handler outcome unobservable (fire-and-forget). Un-reloaded bridge after restart → tombstone error row; reload before restart.

## Cross-References
Spec `openspec/specs/command-routing/spec.md`. Changes `fix-extension-slash-commands-in-dashboard/`, `add-rpc-stdin-dispatch-with-keeper-sidecar/`, `retire-slash-dispatch-via-expand-prompt-templates/`. Bridge `bridge.ts` (sessionPrompt ~669), `command-handler.ts` (parseSendPrompt ~256), `bridge-context.ts` (DASHBOARD_NATIVE_COMMANDS, isExtensionSlashCommand, isHeadlessRpcSession), `slash-dispatch.ts` (`tryDispatchExtensionCommand` single in-process call), `model-tracker.ts` (`readRunningPiVersion`), `event-wiring.ts` (tombstone). Keeper `rpc-keeper/keeper.cjs`,`keeper-manager.ts` (dispatch-router.ts deleted). Architecture § "RPC keeper sidecar". Pi internals `types.d.ts:770`, `agent-session.js:798/1002`, `rpc-mode.js`.
