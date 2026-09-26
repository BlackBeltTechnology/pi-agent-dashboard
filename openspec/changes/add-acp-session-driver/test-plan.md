# Test Plan — add-acp-session-driver

Stage: design   Generated: 2026-09-25

Gate note: six clarifications (agent-exit behaviour, config clamps, duplicate ids, log-cap truncation, perf budget, OS scope) were resolved by adopting the recommended defaults, recorded in design.md D13 and in the spec. No open markers.

Harness notes: "fake agent" = `packages/server/src/acp-bridge/__tests__/fake-acp-agent.mjs` (task 0.2). "fake gateway" = in-process ws server speaking the bridge protocol. L3 rows run against the docker harness (`docker/test-up.sh`, port from `.pi-test-harness.json`) with the fake agent configured as `acpAgents[0]`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | update-model: unknown variant preserved | EP | L1 | automated | `{sessionUpdate:"_querymt_hook_notice",x:1}` and `{sessionUpdate:"future_kind"}` | `parseSessionUpdate` | returns `{kind:"unknown", raw}` deep-equal to input; no throw |
| E2 | update-model: malformed tolerated | EP | L1 | automated | `{}`, `{sessionUpdate:5}`, `null`, `{sessionUpdate:"tool_call_update"}` (no toolCallId) | `parseSessionUpdate` | each → `unknown`; no throw |
| E3 | update-model: upsert semantics | decision-table | L1 | automated | tool call `t1` `{title:"Read",status:"pending"}` then patches: omitted title / `title:null` / `title:"W"` | `applyUpdate` | title "Read" / cleared / "W"; status patched independently |
| E4 | update-model: whole-message reset then chunk | state-transition | L1 | automated | `m1=[A,B]`, `agent_message{m1,[C]}`, chunk `D` | `applyUpdate` ×2 | `m1.content == [C,D]` |
| E5 | normalise-v1: turn end | state-transition | L1 | automated | v1 prompt response `{stopReason:"end_turn"}` | normaliser | exactly one `state_update{idle,end_turn}` |
| E6 | normalise-v1: synthetic ids | BVA (run boundaries) | L1 | automated | 3× id-less `agent_message_chunk`, 1× `agent_thought_chunk`, 1× `agent_message_chunk` | normaliser | chunks 1–3 share id; thought id differs; chunk 5 id differs from chunk 1 |
| E7 | normalise-v1: tool_call/plan/mode mapping | decision-table | L1 | automated | v1 `tool_call`, `tool_call_update`, `plan`, `current_mode_update` | normaliser | `tool_call_update` ×2 same id; `plan_update{items,planId:"default"}`; `config_option_update{category:"mode"}` |
| E8 | synthesis: streamed answer event order | state-transition | L1 | automated | running, chunks "Hel","lo" (m1), idle end_turn | `toDashboardEvents` | eventTypes exactly `agent_start,message_start,message_update,message_update,message_end,turn_end,agent_end,agent_settled`; snapshots "Hel","Hello" |
| E9 | synthesis: golden through real reducer | invariant | L1 | automated | E8 output + querymt fixture turn | feed to client `event-reducer.ts` | one assistant ChatMessage "Hello", clean end (no error anchor); fixture renders expected tool cards |
| E10 | synthesis: thinking streams live | state-transition | L1 | automated | `agent_thought_chunk` "a","b" | adapter → reducer | `message_update.assistantMessageEvent` thinking deltas "a","b"; reducer shows thinking "ab" before `message_end` |
| E11 | synthesis: thought + message different ids → one bubble | invariant | L1 | automated | `agent_thought_chunk{th1}` then `agent_message_chunk{m1}` same segment | adapter → reducer | one `message_start`/`message_end` pair; 1 assistant message with thinking + text blocks |
| E12 | synthesis: stop-reason vocabulary | decision-table | L1 | automated | idle with `end_turn`,`cancelled`,`max_tokens`,`max_turn_requests`,`refusal`,`_custom` | adapter | final stopReason `stop`,`aborted`,`length`,`length`,`error`(+errorMessage),`stop`+`data.acpStopReason:"_custom"` |
| E13 | synthesis: failed tool | EP | L1 | automated | `tool_call_update{t1,status:"failed"}` | adapter | `tool_execution_end{toolCallId:"t1",isError:true}` |
| E14 | synthesis: thought level does not clobber model | EP | L1 | automated | reducer state model `acp:qmt/gpt`; `config_option_update{thought_level:"high"}` | adapter → reducer | `model_select` has `thinkingLevel:"high"`, no `model`; reducer model unchanged |
| E15 | synthesis: suppressed user echo | EP | L1 | automated | `u1` marked suppressed; `user_message{u1}` | adapter | zero user-turn events |
| E16 | synthesis: terminal output folds into tool | EP | L1 | automated | tool `t1` referencing `term1`; 3× `terminal_output_chunk{term1}`; 1× chunk for unreferenced `term9` | adapter | 3 `tool_execution_update` for t1; 0 events for term9; drop counter = 1 |
| E17 | config: registry parse + duplicates | decision-table | L1 | automated | `acpAgents` = [valid qmt, dup qmt, missing command, non-array args] | `loadConfig()` | exactly 1 agent (first qmt); 3 warnings |
| E18 | config: numeric clamps | BVA | L1 | automated | `spawnTimeoutMs` 4999/5000/120000/120001/"x"; `maxLineBytes` 65535/67108865 | `loadConfig()` | 5000/5000/120000/120000/30000(default); 65536/67108864; warning per adjusted value |
| E19 | config: env redact + preserve | state-transition | L1 | automated | agent qmt `env:{OPENAI_API_KEY:"sk-x"}` | `readConfigRedacted` then `writeConfigPartial` with returned object | GET body lacks `sk-x`; file on disk still `sk-x`; a non-`***` new value is written |
| E20 | child env allowlist + forbidden keys | decision-table | L1 | automated | adapter env with `PATH`,`PI_DASHBOARD_SPAWN_TOKEN`,`PI_DASHBOARD_URL`,`PI_DASHBOARD_MCP_TOKEN`,`ELECTRON_RUN_AS_NODE`; agent env `{NODE_OPTIONS:"--require x",FOO:"1",PI_X:"y"}` | `buildAgentEnv` | result has `PATH`,`FOO` only among these; warnings for `NODE_OPTIONS`,`PI_X` |
| E21 | argv-only launch | EP | L1 | automated | fake agent args `["; rm -rf ~", "$(id)"]` | adapter launches agent | fake agent records argv exactly those 2 literal strings; `spawn` called with `shell:false` |
| E22 | Windows `.cmd` rejection | EP | L1 | automated | `process.platform` stubbed `win32`, command `qmt.cmd` / `qmt.exe` | launch | `.cmd` → error "…requires a shell…", no spawn; `.exe` → spawned |
| E23 | version negotiation | decision-table | L1 | automated | flag off/on × agent answers 1/2/3 | initialize | off: 1 ok, 2 fail, 3 fail; on: 1 ok, 2 ok, 3 fail with "unsupported ACP protocol version" |
| E24 | refused client methods | EP | L1 | automated | fake agent sends request `fs/read_text_file`, `terminal/create`, `_x/y`, notification `_x/n` | adapter | first three get error `-32601`; no reply to notification; no fs access (spy) |
| E25 | line splitter bounds | BVA | L1 | automated | `maxLineBytes`=65536; lines of 65535, 65536, 65537 bytes, then a valid JSON line; a non-JSON line | splitter | 65535/65536 delivered, 65537 discarded (counter 1), next line delivered; non-JSON skipped (counter 1); peak buffered bytes ≤ 65536 |
| E26 | server-message coverage | EP | L1 | automated | each server→bridge union member | `server-requests` dispatch | `list_files` → empty `files_list`; `transcript_request` → refused chunk; supported ones hit handlers; unknown-to-ACP ones ignored; type-level exhaustiveness check compiles |
| E27 | register payload fields | EP | L1 | automated | adapter start with spawn token `tok` against fake gateway | first frame | `session_register` has UUID `sessionId`, `cwd`, `source:"dashboard"`, `pid`, `hasUI:false`, `dashboardSpawned:true`, `spawnToken:"tok"`, `registerReason:"spawn"`, `driver:"acp"`; sent before agent spawn |
| E28 | hostile ACP session id | EP | L1 | automated | fake agent `session/new` → `{sessionId:"../../../etc/x"}` | session starts, events logged | log file path is `~/.pi/dashboard/acp/<uuid>.events.jsonl`; no file created outside `acp/` |
| E29 | echo hold-and-drop (v2 early echo) | state-transition | L1 | automated | fake agent v2 sends `user_message{u1}` before prompt response `{messageId:"u1"}` | `send_prompt "hello"` | exactly 1 user-turn event set for "hello" |
| E30 | echo v1 | state-transition | L1 | automated | fake v1 agent echoes id-less `user_message_chunk` during active dashboard prompt; later agent-inserted user chunk with no pending prompt | prompt then idle | echo dropped; agent-inserted message emitted once |
| E31 | queue while running | state-transition | L1 | automated | turn running; send prompts P2, P3; edit P3, remove none, promote P3 | idle transitions | `prompt_received{fresh:false}` ×2; `queue_update` reflects edits/order; `session/prompt` sent for P3 then P2, each once |
| E32 | steer mapped to queue | EP | L1 | automated | running; `send_prompt{delivery:"steer"}` | adapter | queued, `fresh:false`; no `session/prompt` until idle |
| E33 | rejected prompt | fault-injection (abort) | L1 | automated | fake agent answers `session/prompt` with JSON-RPC error | send prompt | `agent_end` with error message; session idle; next queued prompt sent |
| E34 | abort with pending permission | state-transition | L1 | automated | running + pending `session/request_permission` id 7 | `abort` | agent receives `session/cancel` and response id 7 `{outcome:{outcome:"cancelled"}}` |
| E35 | permission mapping | decision-table | L1 | automated | v2 request `{title:"Run?",options:[allow "Allow once", deny "Deny"]}`; v1 request with toolCall title | select "Allow once" / dismiss / `prompt_cancel` | `prompt_request` shape equals prompt-bus select fixture (question, options, component, placement); outcomes `selected allow` / `cancelled` / `cancelled` |
| E36 | config options bridging | state-transition | L1 | automated | agent advertises model options [a,b] (current a), thought_level [low,high] | `set_model b`; then `set_thinking_level high` | `models_list` lists a,b; `session/set_config_option` ×2 with right ids/values; after `config_option_update` model = `acp:qmt/b` |
| E37 | request timeout | fault-injection (delay) | L1 | automated | `requestTimeoutMs`=1000; agent never answers `set_config_option` | `set_model` | `notify` error at ≥1000 ms and <1500 ms; later prompt still works |
| E38 | commands + session name | EP | L1 | automated | `available_commands_update` [review]; `session_info_update{title:"T"}` | adapter | `commands_list` with `source:"acp"`; `session_name_update` "T"; no chat events |
| E39 | event-log cap truncation | BVA | L1 | automated | `eventLogMaxBytes`=1 MiB; 10 turns ≈120 KiB each | append 11th turn | file ≤ 512 KiB, starts with notice + whole turns; replay emits notice first, no orphan `message_end` |
| E40 | reattach sequence | state-transition | L1 | automated | adapter with 2 logged turns + pending permission; fake gateway drops and reaccepts | reconnect | frames in order: `session_register{reattach,driver:"acp"}` without `eventCount` → `models_list` → `commands_list` → model state → `event_forward`×N → `replay_complete` → `prompt_request` for pending permission |
| E41 | heartbeat | BVA | L1 | automated | fake timers; connected idle adapter | advance 45 s | ≥3 `session_heartbeat` frames, spacing 15 s |
| E42 | driver persistence | state-transition | L1 | automated | register with `driver:"acp"`; session ends; `sessionToMeta` round-trip | save + reload meta | restored session `driver:"acp"`; pi register without driver → `driver` absent/"pi" |
| E43 | pi-only op guards | decision-table | L1 | automated | ACP session; ops: flow start, dispatch command, fork, tree nav, reload, retry, role push, stop-after-turn, terminal command, list files | browser handler | each → typed "unsupported for ACP sessions" error; `sendToSession` spy not called; same ops on a pi session forward as before |
| E44 | spawn routing (WS + REST) | decision-table | L1 | automated | `spawnStrategy` tmux/headless × agent absent/known/unknown × `acpAgents` empty/non-empty; pi missing | `handleSpawnSession` and `POST /api/session/spawn` | known agent → headless keeper, `piCmd=[node, bin/acp-bridge.mjs]`, `piArgs=["--agent",id]`, no pi resolution, no `PI_NOT_FOUND`; unknown/none → error; absent agent → call args identical to baseline snapshot |
| E45 | spawn picker | EP | L1 | automated | agents projection `[]` / `[{id:"qmt",name:"querymt"}]` | render spawn dialog | no picker / picker with "querymt" defaulting to pi; projection never includes command/env |
| E46 | pi-only controls hidden | EP | L1 | automated | session `driver:"acp"` vs pi session | render session view | flows/fork/reload/terminal controls absent for ACP, present for pi; driver badge on ACP card |
| E47 | hosts: gateway local connection | state-transition | L1 | automated | `LocalBridgeSocket` attached via `attachLocalConnection`; register frame with spawn token `tok` | register, heartbeat, close | session registered once; watchdog entry for `tok` cleared; `heartbeat_ack` delivered to socket; close → `onDisconnect(sessionId)`; existing WebSocket gateway suite unchanged and green |
| E48 | spawn routing by durable | decision-table | L1 | automated | agent `durable` absent / `false` / `true` | spawn via WS `spawn_session` | absent+false → host A: no keeper spawned, agent pid in headless PID registry; true → keeper with `piCmd=[node, bin/acp-bridge.mjs]`, `piArgs=["--agent",id]` |
| E49 | hosts: behaviour parity | invariant | L1 | automated | same fake-agent script (prompt, tool call, permission, idle) | run through host A (LocalBridgeSocket) and host B (fake WS gateway) | browser-visible message sequences equal after normalising ids/timestamps |
| E50 | hosts: in-process origin local | EP | L1 | automated | in-process ACP session registered | read session record | origin local (no `originDeviceId`); resume/stop capability same as a local pi session |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D13 adapter overhead | tail-latency | L1 | automated | 10 000 `agent_message_chunk` (50 B) + 1 000 tool updates through connection → normaliser → adapter → mock gateway send | p95 per update < 5 ms | single run, after 500-update warm-up |
| P2 | D13 replay time | threshold | L1 | automated | event log at 64 MiB (synthetic turns) | reconnect → `replay_complete` < 10 s | single run |
| P3 | D13 adapter memory | soak | L2 | automated | adapter + fake agent streaming until log at cap, then 1 000 more turns | adapter RSS < 150 MB throughout | until 1 000 post-cap turns |
| P4 | untrusted output flood | soak | L1 | automated | fake agent emits 1 000 `usage_update` + 1 000 unreferenced terminal chunks | 0 chat events; counters reported ≤ 1 `bridge_diagnostic` per minute | 2 simulated minutes (fake timers) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | spawn + chat end-to-end | state-convergence | L3 | automated | harness with fake agent `qmt` configured | spawn "querymt" from dialog, send "hello" | card with ACP badge appears; exactly one user bubble "hello"; assistant reply rendered; status converges idle |
| F2 | queue UI | state-convergence | L3 | automated | fake agent turn delayed 3 s | send second prompt mid-turn | optimistic bubble replaced by queue chip (no double render); after idle, chip becomes one user bubble |
| F3 | permission prompt UI | state-transition | L3 | automated | fake agent requests permission | click "Allow once" | prompt card disappears; tool card completes; agent log shows `optionId:"allow"` |
| F4 | model selector | state-convergence | L3 | automated | fake agent advertises models a,b | select b | selector shows b after `config_option_update`; no pi provider list shown |
| F5 | restart mid-turn | state-transition | L3 | automated | durable fake agent streaming slow reply | `POST /api/restart` mid-stream | after reconnect: one assistant bubble containing pre- and post-restart text; model selector populated; next prompt works |
| F6 | pi-only controls hidden | invariant | L3 | automated | ACP session open | inspect session header/menus | no flow/fork/reload/terminal entry points |
| F7 | ACP UX overall | visual/subjective | — | manual-only | querymt real session | human uses it for a task | [judgment: badge, degraded-feature messaging and tool cards feel coherent] |
| F8 | hosts: non-durable end-to-end | state-convergence | L3 | automated | harness with fake agent `durable:false` | spawn from dialog, send "hello" | card with ACP badge; one user bubble; reply rendered; no keeper process for the session |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | init timeout | fault-injection (delay) | L1 | automated | fake agent never answers `initialize`; `spawnTimeoutMs`=5000 | adapter start | at 5 s: `agent_end` error "timeout", `bridge_diagnostic` `"acp"`, agent killed, adapter exit code ≠ 0 |
| X2 | init error / auth required | fault-injection (abort) | L1 | automated | `initialize` error; `session/new` auth error | adapter start | session error with cause; exit ≠ 0; agent not left running |
| X3 | agent binary missing | fault-injection (abort) | L1 | automated | command `/nope/qmt` | adapter start | error "ENOENT"-cause in session; exit ≠ 0 |
| X4 | agent crash mid-turn | fault-injection (abort) | L1 | automated | SIGKILL fake agent while streaming, permission pending | — | error naming signal; permission prompt cancelled; queue cleared; adapter unregisters + exits |
| X5 | gateway down at start | fault-injection (delay) | L1 | automated | fake gateway unavailable 5 s then up | adapter start | backoff retries; frames buffered; register delivered once gateway up; no duplicate register |
| X6 | ACP preflight failure | fault-injection (abort) | L1 | automated | cwd missing / agent command not on PATH | spawn via WS | spawn error via existing path; no keeper spawned |
| X7 | real spawn via keeper survives server restart | fault-injection (abort) | L2 | automated | headless ACP session (fake agent) on macOS/Linux/Windows VM | kill + restart dashboard server | keeper, adapter, agent PIDs unchanged; `/api/sessions` lists session after restart; adapter reconnect logged |
| X8 | watchdog reclaim | fault-injection (abort) | L1 | automated | adapter never registers (stub), register timeout 5 s | watchdog fires | keeper pid killed (token probe miss tolerated); spawn error surfaced |
| X9 | hosts: in-process session on server stop | fault-injection (abort) | L1 | automated | running in-process ACP session (fake agent) | server shutdown hook runs, then meta reload | fake agent pid no longer alive within 3 s; reloaded session status ended with `driver:"acp"` |

---

## Coverage summary

- Requirements covered: 18/18 (acp-agent-sessions 14, acp-update-model 4)
- Scenarios by class: edge 50 · perf 4 · frontend 8 · error 9
- Scenarios by level: L1 60 · L2 2 · L3 7
- Scenarios by disposition: automated 70 · manual-only 1

## New infra needed

- `fake-acp-agent.mjs` scripted agent (task 0.2) + in-process fake bridge gateway helper (bridge-protocol ws server) for adapter unit tests.
- L3: docker harness config injection of `acpAgents` pointing at the fake agent (extend harness env/config seeding).
- L2: new `qa/tests/*-acp-session.{sh,ps1}` smoke using the fake agent.
