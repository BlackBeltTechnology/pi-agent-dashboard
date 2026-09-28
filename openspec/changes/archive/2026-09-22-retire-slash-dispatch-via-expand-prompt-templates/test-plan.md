# Test Plan — retire-slash-dispatch-via-expand-prompt-templates

Stage: design   Generated: 2026-09-21

Stance: falsify. The change's value is "one in-process call replaces three paths
and works in every session kind"; its risks are the version gate (silent raw
slash to the model), the exactly-one-terminal-event invariant, and the
server-side removal leaving stuck pills. Harness facts used: the bridge itself
registers `dashboard-where` (`source:"extension"`, not `__`-prefixed) whose
handler writes to stderr and never produces a model turn — the dispatchable
target for L3 without pi-flows. Docker e2e port comes from
`.pi-test-harness.json` `dashboardPort`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | command-routing ADDED dispatch | EP (session kind: headless) | L1 | automated | stub pi with `getCommands()` → `[{name:"ctx-stats",source:"extension"}]`, version reader → `"0.86.1"`, `PI_DASHBOARD_SPAWNED=1` + `--mode rpc` argv | `tryDispatchExtensionCommand(pi,"/ctx-stats",sid,sink,"followUp")` | `pi.sendUserMessage` called once with `("/ctx-stats",{expandPromptTemplates:true,deliverAs:"followUp"})`; sink = `[started, completed]`; returns `true`; no `connection.send` |
| E2 | command-routing ADDED dispatch | EP (session kind: non-headless) | L1 | automated | same as E1 but env WITHOUT `PI_DASHBOARD_SPAWNED`, argv without `--mode rpc` | same call | identical to E1 — no `error`, no "requires pi 0.71+" / `RPC_KEEPER_HINT` text anywhere in sink |
| E3 | bridge-extension ADDED helper (delivery) | EP | L1 | automated | E1 stub, `delivery:"steer"` | same call | `sendUserMessage` options `deliverAs:"steer"` |
| E4 | bridge-extension ADDED helper (delivery default) | BVA (absent) | L1 | automated | E1 stub, `delivery` omitted | same call | `deliverAs:"followUp"` |
| E5 | command-routing ADDED gate | BVA just-below | L1 | automated | version reader → `"0.84.1"` | `/ctx-stats` | sink = `[started, error]`, error message contains `"require pi 0.84.2+"`; `sendUserMessage` NOT called; returns `true` |
| E6 | command-routing ADDED gate | BVA min | L1 | automated | version reader → `"0.84.2"` | `/ctx-stats` | `sendUserMessage` called with `expandPromptTemplates:true`; sink = `[started, completed]` |
| E7 | command-routing ADDED gate | BVA just-above | L1 | automated | version reader → `"0.84.3"` | `/ctx-stats` | as E6 |
| E8 | command-routing ADDED gate (mariozechner) | EP | L1 | automated | `readRunningPiVersion` with injected argv[1] `/x/node_modules/@mariozechner/pi-coding-agent/dist/cli.js` and fs stub whose walk-up manifest is `{name:"@mariozechner/pi-coding-agent",version:"0.73.1"}` | read + dispatch | reader returns `"0.73.1"`; sink = `[started, error]` |
| E9 | command-routing ADDED gate (hoisted copy) | EP | L1 | automated | injected argv[1] walks up to `{name:"@earendil-works/pi-coding-agent",version:"0.80.10"}` while a by-name resolver stub would return `"0.85.1"` | read | reader returns `"0.80.10"` (argv-anchored, resolver never consulted); dispatch → `error` |
| E10 | command-routing ADDED gate (undefined) | EP | L1 | automated | injected argv[1] whose walk-up finds no matching manifest | `/ctx-stats` | reader returns `undefined`; `sendUserMessage` called; exactly one `console.warn` across two consecutive dispatches |
| E11 | command-routing ADDED gate (unparseable) | EP (invalid partition) | L1 | automated | version reader → `"dev"` | `/ctx-stats` | treated as new: `sendUserMessage` called; one `console.warn` with a distinct "unparseable" message; NOT `error` |
| E12 | command-routing MODIFIED detection (`__`) | decision-table | L1 | automated | `isExtensionSlashCommand("/__dashboard_reload",[{name:"__dashboard_reload",source:"extension"}])` | call | `false` |
| E13 | command-routing MODIFIED detection (native) | decision-table | L1 | automated | `("/roles",[{name:"roles",source:"extension"}])` | call | `false` |
| E14 | command-routing MODIFIED detection | decision-table | L1 | automated | `("/ctx-stats\nmore",[…ctx-stats extension])` | call | `false` (multi-line) |
| E15 | command-routing MODIFIED routing order | state (precedence) | L1 | automated | `getFlowsList()` → `["deploy-prod"]`, `getCommands()` → `[{name:"deploy-prod",source:"extension"}]` | `send_prompt "/deploy-prod"` through `command-handler` | `pi.events.emit("flow:run",{flowName:"deploy-prod"})` fired; `sendUserMessage` NOT called with `expandPromptTemplates:true` |
| E16 | command-routing MODIFIED routing order | state (precedence) | L1 | automated | `getFlowsList()` → `[]`, `getCommands()` → `[{name:"flows:new",source:"extension"}]` | `send_prompt "/flows:new"` | `sendUserMessage("/flows:new",{expandPromptTemplates:true,deliverAs:"followUp"})`; `expandPromptTemplateFromDisk` NOT called |
| E17 | dashboard-slash-commands MODIFIED precedence | decision-table (name collision) | L1 | automated | `getCommands()` → `[{name:"foo",source:"extension"}]` AND `.pi/prompts/dashboard-foo.md` with `executable: bash` in a temp cwd | `send_prompt "/foo"` | `sendUserMessage` called with `expandPromptTemplates:true`; NO `bash_output` event; bash not executed |
| E18 | command-routing ADDED exactly-one-terminal | invariant | L1 | automated | E1, E5, E10, X1, X2 sinks | each dispatch | every sink has exactly one `started` and exactly one of `completed`/`error`, in that order |
| E19 | bridge-extension ADDED helper (call sites) | structural | L1 | automated | `bridge.ts` `sessionPrompt` with `delivery:"steer"`; `command-handler.ts` else-arm | invoke each site with an extension slash | helper receives `delivery`; helper signature has no `connection` param (TS compile + spy on args) |
| E20 | bridge-prompt-expansion (unchanged) | regression guard | L1 | automated | `getCommands()` → `[{name:"skill:foo",source:"skill"}]`, temp cwd with `.pi/skills/foo/SKILL.md` | `send_prompt "/skill:foo hi"` | `sendUserMessage(<SKILL.md content + " hi">, {deliverAs:"followUp"})` — NO `expandPromptTemplates` key in options; helper returned `false` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | none | — | — | — | the change removes an IPC hop and adds one `fs` walk-up per dispatch; no latency budget is asserted by any delta | — | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | command-routing ADDED dispatch (headless, rendered) | state-convergence | L3 | automated | fresh dashboard-spawned headless session in the docker harness (`spawnFreshGitSession`) | `sendPrompt(page,"/dashboard-where")` | within 10 s the command pill for `/dashboard-where` converges to `completed`; transcript gains NO user row with text `/dashboard-where` and NO assistant row; no pill ever shows `error` |
| F2 | command-routing ADDED dispatch (reattach) | state-convergence | L3 | automated | F1 state | reload the page and re-open the same session | pill still renders `completed` after replay (bridge-emitted terminal is persisted like any `command_feedback`) |
| F3 | extension-rpc-dispatch tombstone (reattach) | state-transition | L1 | automated | `event-wiring` handler with in-memory `eventStore` + subscriber spy | inject `dispatch_extension_command {sessionId,command:"/ctx-stats",requestId}` | `eventStore.insertEvent` called once with `command_feedback {command:"/ctx-stats",status:"error",message:"bridge outdated — reload the session"}` AND broadcast called once with the same event; `console.warn` once; no keeper socket write attempted |
| F4 | proposal "user-facing win" (tmux) | end-to-end judgment | — | manual-only | terminal-hosted pi in tmux with the bridge connected, current dashboard | type `/dashboard-where` in the dashboard composer for that session | pill → `completed`; pi's terminal stderr shows `[dashboard] where:`; no model turn appears in the terminal transcript [no rendered-UI harness has a terminal-hosted pi; automating needs a tmux-hosted session in `qa/` — see New infra] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | command-routing ADDED dispatch (sync throw) | fault-injection (abort) | L1 | automated | `pi.sendUserMessage` throws `new Error("Extension context is stale")` | `/ctx-stats` | sink = `[started, error]` with `message:"Extension context is stale"`; no `completed`; returns `true`; nothing propagates |
| X2 | command-routing ADDED gate (reader throw) | fault-injection (abort) | L1 | automated | injected version reader throws | `/ctx-stats` | reader wrapper returns `undefined`; sink = `[started, completed]`; `sendUserMessage` called; no unhandled rejection |
| X3 | bridge-extension ADDED helper (stale getCommands) | fault-injection (abort) | L1 | automated | `pi.getCommands` throws | `/ctx-stats` | helper returns `false`; sink empty; caller proceeds to `expandPromptTemplateFromDisk` + plain `sendUserMessage` (existing passthrough) |
| X4 | extension-rpc-dispatch tombstone (server) | fault-injection (protocol skew) | L1 | automated | F3 setup with `insertEvent` throwing | inject `dispatch_extension_command` | handler does not throw; `console.warn`/`error` logged; broadcast still attempted (best-effort, mirrors existing `emitCommandFeedback` contract — assert whichever the closure guarantees) |
| X5 | rpc-keeper-sidecar MODIFIED (no dispatch traffic) | structural | L1 | automated | grep-style compile assertion: `KeeperManager`/`HeadlessPidRegistry` interfaces have no `writeRpc`/`writeRpcToSockPath`; `process-manager-keeper-spawn.test.ts` `km` literal compiles | `npx tsc --noEmit -p packages/server` | zero type errors; `rg writeRpc packages/server/src` → only comments referencing history, no call sites |

---

## Coverage summary

- Requirements covered: 9/9 (command-routing ADDED + 2 MODIFIED; bridge-extension ADDED; extension-rpc-dispatch tombstone ADDED; dashboard-slash-commands MODIFIED; rpc-keeper-sidecar MODIFIED; bridge-prompt-expansion unchanged-guard; REMOVED requirements verified by absence in E1/E2/X5)
- Scenarios by class: edge 20 · perf 0 · frontend 4 · error 5
- Scenarios by level: L1 25 · L2 0 · L3 2 · manual 1
- Scenarios by disposition: automated 28 · manual-only 1

## New infra needed

- none required. Optional: a `qa/` tmux-hosted-pi smoke row would automate F4 later; not in this change.
