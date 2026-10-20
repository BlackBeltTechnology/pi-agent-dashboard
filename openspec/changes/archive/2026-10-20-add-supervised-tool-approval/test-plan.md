# Test Plan — add-supervised-tool-approval

Stage: design   Generated: 2026-10-19

Hard gate satisfied: all five gaps were answered before this plan was finalised.
G1 diff cap = 16 KiB, truncated diff ends `… (truncated)` (E44, F15) · G2 `PUT /api/config`
normalises out-of-range `supervisedMode.timeoutSeconds` to 120 and persists it (X26) ·
G3 mode flip is session-owner only, same gate as `send_prompt`, non-owner is dropped by the owner gate (no error frame) and mode kept (X27) ·
G4 no new harness fixture: F11 → L1 component test, X9 → L1 bridge-gate test (owner slot marked) ·
G5 server log line `[supervised] mode on|off rev=<n> session=<id> source=<connId>` (X28).
P2 kept as a regression guard. No open slots remain.

Supersedes the 2026-09-22 plan (old design). Ids E1–E13, P1, F1–F13, X1–X12 kept stable
where still valid; rows re-specified where the Triple changed (labels `Allow once`, key
`supervisedMode.*`, outcome vocabulary `approved|denied|dismissed|timeout|aborted|error`,
effective-deadline formula, allow-first unclassified tools). New rows start at E14 / P2 /
F14 / X13.

Harness note: L3 rows run against the docker harness port from `.pi-test-harness.json`
(`dashboardPort`) — never a hardcoded `:18000`. L1 = vitest
`packages/*/src/**/__tests__/*.test.ts(x)` (incl. jsdom component tests). L2 = `qa/tests/*.sh`
(no UI asserts). manual-only = no automatable observable.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Configurable risky-tool set — default set | decision-table | L1 | automated | supervised policy builder with unset `supervisedMode.tools` → `{approval:["bash","powershell","write","edit","Agent"],defaultAction:"allow"}` | `decideToolCall(name)` for `bash`,`powershell`,`write`,`edit`,`Agent`,`read`,`grep`,`find`,`ls` | first five `action:"approve"`; last four `action:"allow"` |
| E2 | Widen `ToolDefaultAction` with `"allow"` | EP | L1 | automated | `{approval:["bash"],defaultAction:"allow"}` | `decideToolCall("read")` | `{action:"allow"}` — not `deny` (guards type-widened-without-branch bug) |
| E3 | Chat-gateway posture unchanged (absent default) | EP | L1 | automated | `{allow:["read"]}`, `defaultAction` absent | `decideToolCall("rm_tool")` | `{action:"deny",reason:"denied_by_default"}` |
| E4 | `"allow"` not exposed in gateway config | EP | L1 | automated | gateway config `toolPolicy.defaultAction:"allow"` | `normalizeToolPolicy` + `configSchema.json` validation | normaliser coerces to `"deny"`; schema rejects (`enum:["deny","approve"]`) |
| E5 | `"allow"` not exposed via env | EP | L1 | automated | `PI_EXT_CHAT_GATEWAY_GUARD_POLICY='{"defaultAction":"allow"}'` | `policyFromEnv()` → `parseToolPolicy(raw,{allowedDefaults:["deny","approve"]})` | resolved `defaultAction:"deny"` |
| E6 | Case-insensitive matching (supervised builder only) | EP | L1 | automated | `supervisedMode.tools:["Agent"]` | supervised builder decides `agent`, `AGENT`, `Agent` | all three `approve`; the shared `decideToolCall` is called with lower-cased names on both sides |
| E7 | Configured set authoritative (no read exemption) | decision-table | L1 | automated | `supervisedMode.tools:["read"]` | supervised gate sees `read` | `approve` → a prompt is requested for `read` |
| E8 | Default set does not drift from pinned built-ins | EP | L1 | automated | fixture of pinned pi 1.3.0 built-ins `read,bash,powershell,edit,write,grep,find,ls` + `codemode,tool_search`; variant fixture adds `patch_file` | drift test classifies each against `readFamily ∪ riskySet ∪ wrapperTools` | pinned fixture passes; variant FAILS with a message naming `patch_file` |
| E9 | Approval timeout boundary (single clock) | BVA | L1 | automated | `timeoutSeconds:120`, bus timeout 300, fake timers | answer arrives at 119.9 s / 120.0 s / 120.1 s after prompt opens | 119.9 s → honoured; 120.0 s and 120.1 s → `{block:true}`, outcome `timeout`, `PromptBus.cancel(id)` called once |
| E10 | Timeout config default | EP | L1 | automated | `~/.pi/dashboard` without `supervisedMode` / with `timeoutSeconds:45` | resolve config | 120 / 45 |
| E11 | Full access — flag off is inert | decision-table | L1 | automated | session mode `false` | `bash` call reaches the supervised gate | returns `undefined`; surface `request` never called; no decision entry written |
| E12 | Config default starts sessions Supervised | EP | L1 | automated | `supervisedMode.default:"supervised"`, new session, no `supervised-mode` entry | `session_start` | session mode `true` before the first `tool_call`; first `bash` requests a prompt |
| E13 | `allow` beats `approval` (pinned precedence) | decision-table | L1 | automated | `{allow:["bash"],approval:["bash"],defaultAction:"allow"}` | `decideToolCall("bash")` | `{action:"allow"}` |
| E14 | Timeout bounds | BVA + EP | L1 | automated | `timeoutSeconds` = 9 / 10 / 11 / 3599 / 3600 / 3601 / `"abc"` / `-5` / config file with a JSON parse error | resolve config | 120 / 10 / 11 / 3599 / 3600 / 120 / 120 / 120 / 120 |
| E15 | Effective deadline = `max(1, min(cfg, bus−1))` | BVA + decision-table | L1 | automated | (cfg, bus s): (120,300) (120,60) (10,11) (10,10) (120,2) (120,1) (120,0) (120,−1) | gate opens prompt; read `metadata.deadline − openedAt` and the bus-timeout accessor | 120 / 59 / 10 / 9 / 1 / 1 / 120 / 120; gate timer always fires before the bus backstop |
| E16 | Answer mapping | EP | L1 | automated | answers `"Allow once"`, `"Deny"`, `"allow once"`, `""`, `"run it in /tmp"` | gate maps the select answer | allow / deny (no operator text) / deny with reason `allow once` / deny / deny with reason `run it in /tmp`; only exact `Allow once` runs the tool |
| E17 | Deny reason hygiene | BVA + EP | L1 | automated | reason `"\x1b[31mno\x07pe\r\n"`; reason of 499 / 500 / 501 chars | deny with reason | block reason `supervised: denied — operator said: "<text>"`; text contains no U+0000–U+001F/U+007F; 499/500 intact, 501 truncated to 500 |
| E18 | Card rejects a reason equal to an option label | EP | L1 | automated | `ToolApprovalCard`, reason field `Allow once` / `Deny` / `nope` | submit Deny-with-reason | first two: field error, no `prompt_response` sent; `nope`: response sent with answer `nope` |
| E19 | Path-gate hand-off set bound | BVA | L1 | automated | one session; 63 / 64 / 65 enriched path prompts answered `Allow once` (ids `t1..t65`) | supervised gate sees `t1` | 63, 64: `t1` consumed, allowed without prompt, decision `via:"path-gate"`; 65: `t1` evicted → supervised prompt requested |
| E20 | Hand-off only for Allow once on an enriched prompt | decision-table | L1 | automated | path-gate outcomes: Allow once (enriched) / Always allow + confirm / silent in-root allow / existing grant / YOLO auto-allow | supervised gate sees the same `toolCallId` | only Allow once skips the prompt (and only once: a 2nd call with the same id prompts); the other four request a supervised prompt; `source` value never changes the result |
| E21 | Path-prompt enrichment decision table | decision-table | L1 | automated | (mode, tool, owner): (on,`edit`,none) (on,`write`,none) (off,`edit`,none) (on,`read`,none) (on,`edit`,`chat-gateway`) | path gate builds its out-of-root prompt | rows 1–2: `message` and `plainMessage` contain `+N −M` stat + diff/new content, `metadata.supervised:true`; rows 3–5: unchanged prompt, no `metadata.supervised` |
| E22 | Accepted double-prompt exceptions | state-transition | L1 | automated | (a) out-of-root `edit` with no `toolCallId`; (b) path prompt opened while session Full, then flipped Supervised, answered Allow once | supervised gate runs | both raise a supervised prompt (never zero) |
| E23 | Unclassified tool runs, logged once, annotations ignored | EP + decision-table | L1 | automated | Supervised session A calls `ctx_execute` twice; session B once; tool `x_tool` with `annotations:{destructiveHint:true}`; `bash` registered with `readOnlyHint:true` | gate sees each call | `ctx_execute`/`x_tool` run, no prompt; `[supervised] unclassified tool ctx_execute` logged exactly once for A and once for B; `bash` still prompts |
| E24 | Custom set extends default | EP | L1 | automated | `supervisedMode.tools:[...default,"ctx_execute"]` | `ctx_execute` call | prompt requested; not logged as unclassified |
| E25 | Case-folding does not leak into gateway | EP | L1 | automated | gateway policy `{allow:["bash"]}` (default deny) | gateway guard sees tool `Bash` | `{block:true,reason:"chat-gateway: …"}` exactly as pre-extraction (exact match); shared engine never lower-cases |
| E26 | `./guard` entry rejects `"allow"` | EP | L1 | automated | `createToolCallGuard({policy:{defaultAction:"allow"}})` imported from `@blackbelt-technology/pi-dashboard-chat-gateway-plugin/guard` | unlisted tool `foo` called | blocked (policy parsed with `allowedDefaults:["deny","approve"]` → `deny`) |
| E27 | Owner slot crosses module instances | state-transition | L1 | automated | two fresh imports of the shared package (`vi.resetModules`) | instance A `markToolGateOwner("s1","chat-gateway")` | instance B `toolGateOwner("s1")==="chat-gateway"`, `toolGateOwner("s2")===undefined`; A `clearToolGateOwner("s1")` → B sees `undefined`; slot is `globalThis[Symbol.for("pi-dashboard.toolGateOwner")]` Map |
| E28 | Owner lifecycle in the guard | state-transition | L1 | automated | chat-gateway guard extension with fake `pi` | register → `session_start(s1)` → `session_shutdown(s1)` → `session_start(s2)` | after register: no owner; after start s1: `chat-gateway`; after shutdown: `undefined`; s2 marked, s1 not |
| E29 | Supervised gate self-disables on guard-owned session | decision-table | L1 | automated | mode `true`, owner `chat-gateway`; env `PI_EXT_CHAT_GATEWAY_GUARD_POLICY` set but owner unset | `bash` call | owner set → `undefined`, no request; env-only → prompt requested (env never sniffed) |
| E30 | Mode restore per session id; no inheritance | state-transition | L1 | automated | session file s1 has `supervised-mode` entries `{on:true,rev:1}`,`{on:false,rev:2}`; s2 none; config default `full` | `session_start` for s1 (resume), then switch/fork to s2 | s1 mode `false` (last entry) before first tool call; s2 `false` from config default even though previous session was `true` in an earlier variant; state is `Map<sessionId,boolean>` |
| E31 | Revisioned reconciliation | decision-table | L1 | automated | (bridge, server): ({false,5},{true,4}) ({true,4},{false,5}) ({false,5},{true,5}) ({false,∅},{false,3}) ({true,2},{true,2}) | bridge registration | winner false / false / true / true / true; server meta persists winner; server sends `set_supervised{on,rev}` with winner; bridge appends entry |
| E32 | Malformed `set_supervised` ignored | EP | L1 | automated | payloads `{on:"yes"}`, `{}`, `null`, `{on:1}`; one pending approval | bridge dispatch | mode unchanged; pending prompt still open, not resolved |
| E33 | Metadata pass-through live + replay | EP | L1 | automated | `prompt_request` with `metadata:{kind:"supervised-tool-approval",deadline,tool,summary,command,path,diffStat,diff,cwd,toolCallId}` | (a) live `useMessageHandler`; (b) replay `useSessionState` | both produce a prompt object carrying all ten keys verbatim |
| E34 | Question stack read-only, REST rejects, never briefed | decision-table | L1 | automated | pending prompts of kind `supervised-tool-approval` and enriched `agent-path-gate` (`metadata.supervised:true`) | `GET /api/questions`, `POST /api/questions/:id/answer`, brief scheduler | listed with read-only origin; POST → 403 (file-access precedent) and no `prompt_response` forwarded; `briefStatus:"unavailable"`, brief model never called |
| E35 | Chat gateway skips supervised + enriched, keeps plain path | decision-table | L1 | automated | bound channel, spawned AND attached session; frames: `kind:"supervised-tool-approval"`; `kind:"agent-path-gate", supervised:true`; `kind:"agent-path-gate"` (plain); `ask_user` select | gateway receives each `prompt_request` | first two: no message/controls posted; plain path prompt and ask_user: posted with controls |
| E36 | Attention predicate + consumers | decision-table | L1 | automated | sessions (fileAccess,toolApproval): (F,F) (T,F) (F,T) (T,T) | `awaitingOperatorApproval`; `SessionCard`, `session-lanes`, `session-status-visuals`, `browser-gateway` | predicate F/T/T/T; card "Needs you" + needs-you lane + urgency on rows 2–4 only |
| E37 | Server derives `awaitingToolApproval` | state-transition | L1 | automated | session with no prompts | `prompt_request(kind supervised)` → `prompt_response` / `prompt_cancel` / timeout cancel | flag false → true → false on each resolution path |
| E38 | Per-session mutex serialises | state-transition | L1 | automated | session A two concurrent `bash` calls; session B one `bash` | dispatch all three | A2's `request` called only after A1 resolves; B's `request` called while A1 pending; A2's deadline starts at its own open |
| E39 | Agent card states the caveat | EP | L1 | automated | `ToolApprovalCard` with `tool:"Agent"` | render | text states the subagent's own commands and edits are not approved one by one |
| E40 | Decision record content, cap, redaction | EP + BVA | L1 | automated | approve a `bash` whose command is 600 chars and contains a vault secret value | `onDecision` | `supervised-tool-decision` entry: sessionId, tool, summary ≤500 chars with secret literal absent, outcome `approved`, `answeredSurface:"dashboard"`, `via:"supervised"`; console line `[supervised] …` with no control chars |
| E41 | Copy never claims isolation | EP | L1 | automated | string sources of `ToolApprovalCard`, mode menu, Settings section, docs note | static scan | no match for `/\bsandboxed\b\|\bsafe\b\|\bisolated\b\|\bprotected\b/i`; `not a sandbox` present; menu names `!` commands + YOLO caveats |
| E42 | No preselection / no autofocus | state-transition | L1 | automated | rendered `ToolApprovalCard` | mount, then press Enter | no option `aria-checked/selected`; `document.activeElement` not inside the card; no `prompt_response` sent |
| E43 | Default config shape | EP | L1 | automated | no `supervisedMode` key | resolve config | `{default:"full",timeoutSeconds:120,tools:["bash","powershell","write","edit","Agent"]}` |
| E44 | Diff byte cap 16 KiB, truncation marked | BVA | L1 | automated | `edit` whose diff is 16383 / 16384 / 16385 bytes | build supervised summary (`metadata.diff`) | 16383 and 16384: diff verbatim, no marker; 16385: first 16384 bytes kept, then trailing `… (truncated)` |
| E45 | Supervised Settings has no allow list | EP | L1 | automated | Security tab "Tool approval (Supervised mode)" section | render | fields: default mode, timeout, tools chips; no allow-list field |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Non-supervised sessions add negligible cost | tail-latency | L1 | automated | 10 000 `tool_call` dispatches (`bash`) through the supervised gate, mode `false`, owner slot populated with 100 other sessions | p95 added latency per call < 1 ms (vs no-gate baseline) | single timed run |
| P2 | Supervised gate on an unclassified/read call | tail-latency | L1 | automated | 10 000 `read` calls, mode `true` (allow path, no prompt) | p95 added latency per call < 1 ms | single timed run |

> P2 reuses D4's 1 ms budget for the no-prompt (allow) path of a Supervised session; kept as a regression guard.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Supervised session prompts before a risky tool | state-transition | L3 | automated | Supervised session; faux `bash` `echo hi` | tool call reaches the gate | card titled "Run this command?" with chip `bash` and text `echo hi`; no `hi` tool output yet; transcript row is running with matching `toolCallId` |
| F2 | Allow once runs the tool | state-transition | L3 | automated | pending `bash` approval | click `Allow once` | tool result `hi` appears; card collapses to resolved row naming surface `dashboard` |
| F3 | Deny blocks; turn continues | state-transition | L3 | automated | pending `bash` approval | click `Deny` | no `hi` output; tool row shows block reason starting `supervised: denied`; assistant turn reaches its end (faux final text rendered) |
| F4 | Reconnect replay | state-transition | L3 | automated | pending approval | browser reload | card re-renders with command, countdown from same `deadline`, still answerable (Allow once runs the tool) |
| F5 | First response wins across surfaces | state-transition | L3 | automated | pending approval; two browser contexts | `Allow once` in A | B's card leaves pending state; exactly one `supervised-tool-decision` entry |
| F6 | Live toggle ON mid-turn | state-transition | L3 | automated | Full session; faux turn: `bash sleep 5` then `bash echo two` | flip chip to Supervised during `sleep 5` | no card for call 1; card for `echo two` |
| F7 | Live toggle OFF mid-turn | state-transition | L3 | automated | Supervised; same faux turn; call 1 approved | flip to Full access during `sleep 5` | `echo two` runs with no card |
| F8 | Flip never resolves a pending approval | state-transition (illegal edge) | L3 | automated | approval pending | flip to Full access | card stays pending; tool not run until answered |
| F9 | `write`/`edit` card shows concrete action | state-transition | L3 | automated | Supervised; faux `write` to in-root `notes/x.txt` (inside the session workspace, so the path gate stays silent) | gate | card "Create this file?" shows path and `+N −0` summary; diff collapsed; expand shows content |
| F10 | Expired approval leaves no answerable card | state-transition | L3 | automated | `askUserPromptTimeoutSeconds:3` via `PUT /api/config` (effective 2 s by E15), `supervisedMode.timeoutSeconds:120` | 2 s elapse | card cancelled in both contexts; tool row shows `supervised: timeout`-family reason; no Allow once control remains clickable |
| F11 | Toggle replaced on guard-owned session | decision-table | L1 | automated | `CommandInput` rendered with `toolGateOwner:"chat-gateway"` | render | mode chip absent; "Gateway policy" note present |
| F12 | Copy makes no isolation claim | manual review | — | manual-only | toggle menu, card, Settings, docs note | human reads shipped strings | judgment: reads as approval, not protection; container path named (complements automated E41) |
| F13 | Card visual fit | visual/subjective | — | manual-only | card beside `ConfirmRenderer` in base dark / base light / nord dark at 375 and 1440 | human looks | judgment: consistent with interactive-renderer surface |
| F14 | Mode survives reload / server restart / reconnect | state-transition | L3 | automated | session flipped Supervised | (a) extension reload; (b) `POST /api/restart`; (c) browser reload | after each: chip shows Supervised; next faux `bash` raises a card |
| F15 | One prompt per out-of-root edit, content shown | state-transition | L3 | automated | Supervised; faux `edit` outside workspace; variant with a 20 KiB diff | gate chain | single path-gate card showing path + `+N −M` stat + collapsed diff; `Allow once` → edit applied, no second card; 20 KiB variant: rendered diff ≤ 16384 bytes and ends `… (truncated)` |
| F16 | Always allow on enriched prompt still asks supervised | state-transition | L3 | automated | as F15 | answer path card `Always allow` + confirm | supervised card appears for the same edit |
| F17 | Path-gate deny suppresses supervised | state-transition | L3 | automated | as F15 | path card `Deny` | no supervised card; tool row blocked |
| F18 | YOLO does not answer supervised | state-transition | L3 | automated | Supervised; unscoped YOLO active; faux out-of-root `edit` | gate chain | no path card (YOLO auto-allow); supervised card raised |
| F19 | Needs you + lane + toast | convergence | L3 | automated | pending supervised approval in session not in view | observe list | card "Needs you", needs-you lane membership, one toast; all clear after Allow once / Deny / timeout |
| F20 | Deny with a reason reaches agent | state-transition | L3 | automated | pending `bash` card | Deny with reason `use a dry run` | tool row reason `supervised: denied — operator said: "use a dry run"` |
| F21 | Abort withdraws pending card everywhere | state-transition | L3 | automated | pending card in two contexts | abort turn (Esc / abort button) | card cancelled in both; tool row reason `supervised: aborted`; no late allow |
| F22 | Settings section bounds + undercut warning | EP + BVA | L3 | automated | Security tab section | enter 9, 3601, 10; set ask_user timeout 30 with supervised 120 | 9/3601 show field error, save disabled; 10 saves; undercut → warning visible stating effective 29 s |
| F23 | Chip folds into ⋯ on narrow container | convergence | L3 | automated | viewport 375 px | open composer | mode control absent from settings row, present inside ⋯ menu with both options |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Unanswered approval fails closed | fault-injection (delay) | L1 | automated | surface never answers | effective deadline elapses | `{block:true}`, outcome `timeout`, `cancel(id)` called, tool not run |
| X2 | Sync throw fails closed | fault-injection (abort) | L1 | automated | `request` throws synchronously | risky call | `{block:true,reason:"supervised: error"}`, outcome `error` |
| X3 | Rejected decision fails closed | fault-injection (abort) | L1 | automated | `decision` promise rejects | risky call | `{block:true}`, outcome `error` |
| X4 | Gate not wrapped in `safe()` | static assertion | L1 | automated | `bridge.ts` registration | source assertion | supervised gate registered 4th, after path gate, without `safe(` |
| X5 | Blocked outcomes distinguishable | decision-table | L1 | automated | deny / timeout / gate error / client dismiss / abort | inspect records + reasons | five distinct outcomes `denied`,`timeout`,`error`,`dismissed`,`aborted`, five distinct block reasons |
| X6 | Chat-gateway reason unchanged | fault-injection | L1 | automated | gateway surface: confirm false, timeout, confirm throws | each path | all `{block:true,reason:"chat-gateway: approval_denied_or_timed_out"}`; moved `guard.test.ts` assertions unchanged |
| X7 | Decision logged durably | fault-injection | L1 | automated | approve then deny | each | two `supervised-tool-decision` entries with sessionId, tool, summary, outcome, answeredSurface, via |
| X8 | Timeout attributed to `timeout` surface | fault-injection (delay) | L1 | automated | never answered | timeout | `answeredSurface:"timeout"`, outcome `timeout` |
| X9 | Guard-owned session: at most one approval | decision-table | L1 | automated | owner slot marked `chat-gateway`, mode `true`, gateway policy approval:[`bash`] / allow:[`bash`] | `bash` call through both handlers | exactly one gateway confirm / zero prompts; supervised `request` never called; out-of-root path prompt unenriched |
| X10 | Fan-out permit released on supervised block | fault-injection (abort) | L1 | automated | `Agent` admitted by fan-out, then supervised deny, ×(limit+1) | each | permits return to pool; call limit+1 is admitted (via `tool_execution_end` or the gate's release hook — order never changed) |
| X11 | Subagent tool-call visibility (spike 0.1) | fault-injection | L1 | automated | Supervised; `Agent` child calls `bash` | child call | records whether child `bash` reaches parent `tool_call`; result recorded in design Q5 |
| X12 | Missing ApprovalSurface | static/type | L1 | automated | `createToolCallGuard` call without `surface` | `tsc --noEmit` on a `@ts-expect-error` fixture | type error present (no default presenter) |
| X13 | No UI blocks at once | fault-injection | L1 | automated | `ctx.hasUI:false`, Supervised | `bash` call, fake timers not advanced | `{block:true,reason:"supervised: no-ui"}` resolved with 0 ms timer advance; `request` never called |
| X14 | Mode restore failure fails closed | fault-injection (abort) | L1 | automated | reading `supervised-mode` entries throws; config default `full` | `session_start` | mode `true`; log `[supervised] mode restore failed`; next `bash` prompts |
| X15 | Abort before mutex | fault-injection | L1 | automated | A1 pending; A2 queued | abort A2's `ctx.signal` | A2 `{block:true,reason:"supervised: aborted"}`; `request` never called for A2; A1 untouched |
| X16 | Abort after mutex | fault-injection | L1 | automated | A1 prompt open | abort signal | `cancel(id)` called; outcome `aborted`; block; mutex released (next call opens) |
| X17 | Signal already aborted at entry | state-transition (illegal edge) | L1 | automated | `ctx.signal.aborted===true` | `bash` call | blocked `supervised: aborted`, no prompt |
| X18 | Path-gate block suppresses supervised | decision-table | L1 | automated | path gate returns block | chain dispatch | supervised gate never invoked (first-block-wins) |
| X19 | Pending supervised does not delay path-gate YOLO | state-transition | L1 | automated | session A supervised prompt pending; path gate YOLO question for another call | YOLO question raised | YOLO question opens immediately (not queued behind supervised mutex) |
| X20 | `session_shutdown` clears per-session state | state-transition | L1 | automated | s1 with mode entry, mutex chain, hand-off ids | `session_shutdown(s1)` | mode map, mutex, hand-off set have no `s1`; s2 entries intact |
| X21 | Client dismiss → `dismissed` | fault-injection | L1 | automated | prompt cancelled by a client dismiss (gate set no `selfCancel`) | resolution `{cancelled:true,source:"__bus__"}` | outcome `dismissed`, block |
| X22 | Bus backstop fires first (misconfig) | fault-injection (delay) | L1 | automated | gate timer stubbed not to fire, bus timeout 5 s | 5 s | outcome `dismissed`, block — never allow |
| X23 | Server meta persists mode across server restart | state-transition | L1 | automated | `session-to-meta` with `{on:true,rev:3}` | write → reload meta → registration | restored `{on:true,rev:3}`; `set_supervised` re-sent after register and after reconnect |
| X24 | Version skew: old guard never marks slot | decision-table | L1 | automated | gateway guard active, owner slot empty, mode `true` | `bash` | supervised prompt requested (≤2 prompts, never 0) |
| X25 | Approved tool runs with full permissions | EP | L1 | automated | Supervised, Allow once on `bash` | gate result | `undefined` returned, `event.input` unmodified by the gate |
| X26 | Out-of-range timeout via API | EP | L1 | automated | `PUT /api/config {supervisedMode:{timeoutSeconds:5}}` sent directly (bypassing the Settings field) | request, then `GET /api/config` | PUT succeeds; persisted and returned `supervisedMode.timeoutSeconds` is 120 (normalised, not 5, no 400) |
| X27 | Unauthorised mode flip | fault-injection | L1 | automated | browser connection that is not the session owner sends `set_supervised{on:true}` for session s1 (mode `false`, rev 3) | server WS handler (same owner gate as `send_prompt`, `ws-message-scope.ts:48`) | frame dropped by the owner gate (no error frame, as `send_prompt`); mode stays `false`, rev 3; no `set_supervised` forwarded to the bridge; the owner's same message is accepted |
| X28 | Flip audited | EP | L1 | automated | owner flips session s1 on, then off (console spy on the server) | each accepted flip | log lines `[supervised] mode on rev=<n> session=s1 source=<connId>` then `[supervised] mode off rev=<n+1> session=s1 source=<connId>`; the rejected flip of X27 logs no mode line |

---

## Coverage summary

- Requirements covered: 9/9 ADDED (`supervised-tool-approval`) + 1/1 MODIFIED (`chat-gateway`)
- Scenarios by class: edge 45 · perf 2 · frontend 23 · error 28 (total 98)
- Scenarios by level: L1 76 · L2 0 · L3 20 · manual-only 2
- Scenarios by disposition: automated 96 · manual-only 2

No L2 rows: no install/spawn/multi-OS runtime surface; `powershell` is a policy-set
assertion (E1). No open gaps.

## New infra needed

- Shared tool-gate package (spike 0.4) — E1–E7, E13, E25–E28, X1–X3, X5–X6, X12 target it.
- Faux scenarios in `qa/fixtures/faux-scenarios.ts`: `tool-bash-echo` (F1–F5, F20, F21),
  two-call turn `bash sleep 5` + `bash echo two` (F6–F8), out-of-root `edit` incl. a 20 KiB-diff
  variant (F15–F18), supervised `write` (F9). Existing: `tool-write`, `tool-read-outside[-grantable]`, `Agent` fanout.
- No new harness fixture for a guard-owned gateway session (F11 and X9 are L1).
- Drift fixture of pinned pi built-ins (E8) + `bump-pi-version` regeneration step.

## Dropped / changed vs 2026-09-22 plan

- X10: dropped the fallback "register supervised BEFORE fan-out" — contradicts D8 (order never changes; gate releases permit itself).
- F10: 2 s *configured* timeout no longer legal (floor 10) → reached via bus timeout 3 s (E15 formula).
- E8: runtime "inventory check at session start" → L1 drift test over pinned built-in fixture.
- E9/E10/E12: key `supervised.*` → `supervisedMode.*`; `default:true` → `"supervised"`.
- X12: "construction fails loudly" → compile-time type error (D9 "fails to compile").
- F2/F5: "Approve" → `Allow once`.

## Exemplars

| row | nearest existing test file |
|----|----|
| E1–E3, E6, E7, E13, E25 | `packages/chat-gateway/src/guard/__tests__/policy.test.ts` |
| E4 | `packages/chat-gateway/src/server/__tests__/config.test.ts` |
| E5, E26, E28, X1–X3, X5–X8, X12, X21, X22 | `packages/chat-gateway/src/guard/__tests__/guard.test.ts` |
| E8, E10, E12, E14, E43 | `packages/shared/src/__tests__/config.test.ts`; `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts` |
| E9, E11, E15–E17, E19, E20, E22–E24, E29, E38, E40, X13–X20, X24, X25 | `packages/extension/src/path-gate/__tests__/handler.test.ts` |
| E21 | `packages/extension/src/path-gate/__tests__/handler.test.ts`; `packages/extension/src/path-gate/__tests__/prompt-bus-wiring.test.ts` |
| E27 | `packages/extension/src/path-gate/__tests__/production-wiring.test.ts` |
| E30, X14 | `packages/extension/src/__tests__/session-sync.test.ts` |
| E31, X23 | `packages/server/src/__tests__/meta-persistence.test.ts`; `packages/server/src/__tests__/memory-session-manager.test.ts` |
| E32 | `packages/chat-gateway/src/server/__tests__/dispatch.test.ts` (shape); `packages/extension/src/__tests__/prompt-bus.test.ts` |
| E33 | `packages/client/src/hooks/__tests__/useMessageHandler.interactive-carry.test.tsx`; `packages/client/src/hooks/__tests__/useSessionState.test.ts` |
| E34 | `packages/server/src/questions/__tests__/question-store.test.ts`; `packages/server/src/questions/__tests__/question-routes.test.ts`; `packages/server/src/questions/__tests__/brief-policy.test.ts` |
| E35 | `packages/chat-gateway/src/server/__tests__/prompts.test.ts`; `packages/chat-gateway/src/server/__tests__/gateway.test.ts` |
| E36 | `packages/client/src/lib/__tests__/session-lanes.test.ts`; `packages/client/src/lib/__tests__/session-status-visuals.test.ts`; `packages/client/src/components/__tests__/SessionCard.test.tsx` |
| E37 | `packages/server/src/__tests__/path-gate-attention.integration.test.ts` |
| E18, E39, E42 | `packages/client/src/components/__tests__/SelectRenderer.test.tsx`; `packages/client/src/components/__tests__/ConfirmRenderer.test.tsx` |
| E41, X4 | `packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts` |
| E44 | `packages/extension/src/path-gate/__tests__/handler.test.ts` |
| E45 | `packages/client/src/components/__tests__/SettingsPanel.test.tsx` |
| P1, P2, X10, X11 | `packages/extension/src/__tests__/subagent-fanout-admission.test.ts` |
| X9 | `packages/chat-gateway/src/guard/__tests__/guard.test.ts` + `packages/extension/src/path-gate/__tests__/handler.test.ts` |
| X26 | `packages/server/src/__tests__/config-api.test.ts` |
| X27, X28 | `packages/server/src/identity/__tests__/ws-message-scope.test.ts`; `packages/server/src/__tests__/browser-gateway-owner-gate.test.ts` |
| F1, F2, F3, F9, F20 | `tests/e2e/faux-ask.spec.ts`; `tests/e2e/optimistic-prompt.spec.ts` |
| F4, F5, F8, F10, F21 | `tests/e2e/pending-prompt-recovery.spec.ts` |
| F6, F7, F23 | `tests/e2e/composer-session-strip.spec.ts`; `tests/e2e/split-composer-overflow.spec.ts` |
| F11 | `tests/e2e/chat-gateway-team-controls.spec.ts` (fake gateway harness) |
| F14 | `tests/e2e/headless-reload-dispatch.spec.ts`; `tests/e2e/keeper-restart-survival.spec.ts` |
| F15–F19 | `tests/e2e/agent-path-gate.spec.ts` |
| F22 | `tests/e2e/blackhole-settings.spec.ts`; `tests/e2e/agent-path-gate.spec.ts` (`PUT /api/config`) |
