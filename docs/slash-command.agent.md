# slash-command.md — index

Pull-only condensed map. Source: docs/slash-command.md. Slash command routing.

## Purpose
Documents how dashboard bridge routes typed `/foo` chat text to pi handlers. Records `pi.registerCommand` extension-command bug rooted in pi 0.70 ExtensionAPI. Two-step fix: dashboard stopgap now, upstream `pi.dispatchCommand` later.

## Routing Order
`command-handler.ts::parseSendPrompt` + `bridge.ts::sessionPrompt` process `send_prompt` in order: 1 `!!`→silent bash `pi.exec`; 2 `!`→bash+LLM; 3 `/compact`→`compact()`; 4 `/quit`|`/exit`→`shutdown()`; 5 `/reload`→`reload()`; 6 `/new`→`spawnNew()`; 7 `/model`→`setModel()`; 8 `/<name>` user flow (`getFlowsList()`)→`pi.events.emit("flow:run")`; 9 `/<name>` extension command (`source:"extension"`, not `DASHBOARD_NATIVE_COMMANDS`)→3-way B/C/D; 10 `/` fall-through→`expandPromptTemplateFromDisk`+`pi.sendUserMessage`; 11 no prefix→passthrough. Steps 1-7 in parseSendPrompt, step 8 in sessionPrompt, step 9 new.

## Surface Map
Mermaid flowchart: parseSendPrompt → ParsedPrompt type branches (bash/compact/shutdown/reload/new/model/mgmt/slash/passthrough). Slash → sessionPrompt → flow fast-path or step-9 gate `isExtensionSlashCommand` → Path B `pi.dispatchCommand` / Path C RPC keeper / Path D error / fall-through.

## Pi 0.70 ExtensionAPI Constraint
0.70 ExtensionAPI exposes: sendMessage, sendUserMessage, registerCommand, getCommands, events, exec, setSessionName, getActiveTools (`types.d.ts:770-922`, `loader.js:155-260`). Does NOT expose: prompt, session, dispatchCommand. Slash dispatch belongs to pi external `prompt()` (TUI, RPC `case "prompt"`), never delegated. `getCommands()` returns `SlashCommandInfo[]` name+description, no handler. `pi.sendUserMessage`→`prompt(text,{expandPromptTemplates:false})` skips `_tryExecuteExtensionCommand` (`agent-session.js:1002`).

## Affected Commands Today
`pi.registerCommand` commands fall through to sendUserMessage: context-mode `/ctx-stats`,`/ctx-doctor`; pi-web-access `/websearch`,`/curator`,`/google-account`,`/search`; pi-subagents `/agents`; pi-flows `/flows`,`/flows:new`,`/flows:edit`,`/flows:delete`,`/roles`. Flow kebab buttons mask bug via `flow_management` WS. Empirical: `echo '{"type":"prompt","message":"/flows:new","id":"1"}' | pi --mode rpc` dispatches correctly.

## Decisions
- Decision 1: Dispatch path — Path B primary, Path D stopgap. Add `pi.dispatchCommand(text,options?)` upstream + dashboard detection+error interim. Rejected Path A (private handler ref), Path C (too invasive) — REOPENED in `add-rpc-stdin-dispatch-with-keeper-sidecar` after Path B failed through pi 0.71→0.74; narrowed to slash dispatch via per-session keeper.
- Path C: server-routed via RPC keeper — headless only (tmux/Win Terminal own stdin). Probe `PI_DASHBOARD_SPAWNED==="1"` AND argv `--mode rpc`. Bridge emits `dispatch_extension_command{sessionId,command,requestId}` → server `dispatch-router.ts` writes `{"type":"prompt",...}` to keeper UDS via `headlessPidRegistry.writeRpc` → keeper→pi stdin → `session.prompt(text,{expandPromptTemplates:true})`. Server owns terminal event. Default via `enable-rpc-keeper-by-default` (was `useRpcKeeper` flag ≤v0.5.4).
- Decision 2: Detection rule — intersect cmdName vs `getCommands()` `source==="extension"` AND not `DASHBOARD_NATIVE_COMMANDS`. Per-invocation, no caching. Skills/templates/native stay on template path.
- Decision 3: Feature detection over version sniffing — `typeof pi.dispatchCommand === "function"` per call. Same build works pi 0.70 (stopgap) + 0.71+ (dispatch).
- Decision 4: Telemetry events — `command_feedback{status:"started"}` before, `"completed"` after resolve, `"error",message` stopgap. Pi `extension_error` forwarded by existing wiring, not duplicated.
- Decision 5: Test shape — `bridge-slash-command-routing.test.ts`. Stub pi with dispatchCommand+sendUserMessage. Payload table asserts call counts. Pins extension slash NEVER falls through.

## Two-Step Fix
sessionPrompt → flow? (step 8) → `isExtensionSlashCommand` (step 9 gate) → false: fall-through sendUserMessage; true: emit started → `typeof pi.dispatchCommand==="function"`? B dispatch→completed / C isHeadlessRpcSession→RPC keeper / D stopgap error. All paths NO sendUserMessage. Path D ships standalone; Path B needs pi 0.71+.

## Empirical Verification
From `notes/preflight-empirical-checks.md`.
- Q1: typed `/flows:*` broken same way — YES. `getFlowsList()` = user flows only; pi-flows names never match; falls through. Buttons mask via `flow_management`.
- Q2: `sendUserMessage` sites in command-handler.ts — line 264 (slash else-arm) needs gate YES; 286/453/455/458 (sendUserMessageWithImages internals) NO; 495 (handleBashCommand) NO. Two sites need gate: `bridge.ts::sessionPrompt` fallback + `command-handler.ts:264`.

## Detection Helper
`isExtensionSlashCommand(text, commandList): boolean` — pure, exported from `bridge-context.ts`. No pi calls. True iff: starts `/` + no newline; token cmdName in commandList `source==="extension"`; not in `DASHBOARD_NATIVE_COMMANDS`. Truth table: `/ctx-stats`→true, `/ctx-stats verbose=1`→true, `/skill:foo`(skill)→false, `/review`(prompt)→false, `/__dashboard_reload`→false, unknown→false, multi-line→false, no-prefix→false.

## Telemetry
`command_feedback` around step 9: started before dispatch/stopgap; completed after Path B resolve; error stopgap. Pi swallows handler exceptions → `extension_error` forwarded by existing wiring, bridge no duplicate.

## Risks
Upstream dep for Path B → Path D standalone. Path D false-positives → `__` prefix filter + step-8 flow short-circuit. Fails-loud on `/agents`,`/curator`,`/websearch` (acceptable). `dispatchCommand` shape may differ → feature-detect. Multi-line slash = passthrough.

## Cross-References
Spec `openspec/specs/command-routing/spec.md`. Changes `fix-extension-slash-commands-in-dashboard/`, `add-rpc-stdin-dispatch-with-keeper-sidecar/`. Bridge `bridge.ts` (sessionPrompt ~669), `command-handler.ts` (parseSendPrompt ~256), `bridge-context.ts` (DASHBOARD_NATIVE_COMMANDS, isExtensionSlashCommand, isHeadlessRpcSession), `slash-dispatch.ts` (`tryDispatchExtensionCommand` B/C/D). Keeper `rpc-keeper/keeper.cjs`,`keeper-manager.ts`,`dispatch-router.ts`. Architecture § "RPC keeper sidecar". Pi internals `types.d.ts:770`, `agent-session.js:798/1002`, `rpc-mode.js`.
