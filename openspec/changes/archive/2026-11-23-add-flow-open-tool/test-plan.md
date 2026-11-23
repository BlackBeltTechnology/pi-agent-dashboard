# Test Plan — add-flow-open-tool
Stage: design   Generated: 2026-11-23

No clarification gaps: every Triple fills from the specs/design (windows 1.5 s, rate limit 10/10 s, walk depth 6 / 20 hits, max file size from `MAX_FILE_BYTES`). Paths below are relative to `packages/flows-plugin/src/` unless they start with `packages/` or `tests/`.

---

## Scenarios

### Edge-case
| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | flow-open-tool: exactly one argument | decision table | L1 | automated | `{}`, `{flow,path}`, `{flow:"a/b"}`, `{flow:"x".repeat(201)}`, `{flow:".."}` | lane handler called | each returns `{status:"refused", reason:"invalid-arguments"}`; no broadcast |
| E2 | path admitted inside cwd | EP | L1 | automated | tmp cwd `/w` with `/w/flows/a/flow.yaml` | `flow/open {path:"flows/a"}` | admitted; broadcast payload `source` = realpath of `/w/flows/a/flow.yaml`, `name` = `flows/a/flow.yaml` relative display, `viewOnly:true` |
| E3 | path outside cwd | BVA | L1 | automated | `../other/flow.yaml`, `/etc/flow.yaml`, sibling dir `/w2/flow.yaml` sharing prefix `/w` | `flow/open {path}` | `refused/path-not-allowed`; `readFileGuarded` never called |
| E4 | symlink escape | EP | L1 | automated | `/w/flows/link` → dir outside `/w` holding `flow.yaml` | `flow/open {path:"flows/link"}` | `refused/path-not-allowed` |
| E5 | non-flow file / size | BVA | L1 | automated | `/w/x/other.yaml`; `/w/x/flow.yaml` of `MAX_FILE_BYTES` and `MAX_FILE_BYTES+1`; a directory named `flow.yaml` | `flow/open {path}` | first, oversize, dir → `refused/not-a-flow`; exactly-max → admitted |
| E6 | cwd is `/` | BVA | L1 | automated | session cwd `/`, path `/tmp/x/flow.yaml` (realpath'd) | `flow/open {path}` | admitted (no `//` prefix bug) |
| E7 | candidates walk | BVA | L1 | automated | dir with 25 nested `flow.yaml` at depths 1–7, a `node_modules/flow.yaml`, a `.git/flow.yaml`, a symlinked subdir with `flow.yaml` | `flow/open {path:dir}` | `refused/not-a-flow`; `candidates` ≤ 20, all cwd-relative, none deeper than 6, none from `node_modules`/`.git`/symlinked dir |
| E8 | catalog name opens catalog flow | EP | L1 | automated | catalog `[{name:"custom:a", source:"/w/.pi/flows/flows/custom/a/flow.yaml"}]` | `flow/open {flow:"custom:a"}` + 1 ack | broadcast `{name:"custom:a", viewOnly:false}`; result `shown, acks:1` |
| E9 | cold catalog rediscovery | state-transition | L1 | automated | empty catalog; fake `requestCatalog` returns false once (cooldown) then catalog fills at 400 ms | `flow/open {flow:"custom:a"}` | `requestCatalog(…,{rediscover:true})` retried; flow opens; result `shown` |
| E10 | unknown flow | BVA | L1 | automated | catalog never contains `custom:missing` | `flow/open {flow:"custom:missing"}` | `refused/unknown-flow` after ≥ 1.5 s rediscovery poll; no broadcast |
| E11 | path equals catalog definition | EP | L1 | automated | catalog source given RELATIVE `.pi/flows/flows/custom/a/flow.yaml`; session cwd `/w` | `flow/open {path:".pi/flows/flows/custom/a"}` | broadcast `{name:"custom:a", viewOnly:false}` |
| E12 | opened files only | EP | L1 | automated | opened flow: step `load` (code, no target), step `x` (code, `target: ../../out/s.ts`), file `_lib.ts` present | `GET /api/plugins/flows/file` for `load.ts`, `_lib.ts`, `../../out/s.ts` | `load.ts` 200; `_lib.ts` 403; escaped target 403 |
| E13 | other session isolation | EP | L1 | automated | S1 opened a flow; S2 live | S2 requests S1's opened `flow.yaml` | 403 |
| E14 | re-report keeps opened | state-transition | L1 | automated | S opened a flow, then bridge re-reports catalog | `GET …/file` for opened `flow.yaml` | 200 |
| E15 | never-reported session | state-transition | L1 | automated | S has no catalog report, opened a flow | `GET …/files?sessionId=S` and `GET …/file` | `/files` `reported:true` with `handlers[displayName]`; `/file` 200 (no 409) |
| E16 | handler map for node cards | EP | L1 | automated | opened flow with code step `load` | client `withNodeFiles(idleState, files)` | `load` card `codeTarget` = `<flowDir>/load.ts` |
| E17 | rate limit | BVA | L1 | automated | 10 then 11 calls from S within 10 s; S ends | 11th call; call after session end resets | 11th `refused/rate-limited`; limiter map has no entry for ended S |
| E18 | view-only slot ignores catalog | decision table | L1 | automated | attachments {viewOnly, catalog-has, catalog-lacks, catalog-empty} | `resolveFlowSlot` | viewOnly+lacks → `idle` (not `unavailable`); non-viewOnly+lacks → `unavailable`; others unchanged |
| E19 | attachment parse coercion | EP | L1 | automated | stored JSON with `viewOnly:true`, `viewOnly:"yes"`, absent | `getAttachment` | `true` kept; `"yes"` dropped to undefined; legacy entry unchanged |
| E20 | view-only header | decision table | L1 | automated | `FlowDashboard` idle with view-only vs catalog attachment; `FlowHeaderActions` `viewOnly` | render | view-only: no `flow-idle-run`, no AUTO button, no Edit…, label "view only - not registered", Close present, Open flow… present; catalog: Run, AUTO, Edit… present |
| E21 | tool registration + guidance | EP | L1 | automated | bridge `activate` with fake `pi.registerTool` | activate | one tool `flow_open` with `description` + `promptGuidelines` mentioning showing flows after writing/inspecting |

### Frontend-quirk
| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | listener stores + acks | state-convergence | L1 | automated | `FlowOpenListener` mounted, fake plugin socket | `flows_open {sessionId:S, requestId:r1, attachment{…, baselineStartedAt:T}}` | `getAttachment(S)` = attachment with baseline T; `dashboard` collapse for S = expanded; one `flows_open_ack {sessionId:S, requestId:r1}` sent |
| F2 | dedupe per tab | state-convergence | L1 | automated | same frame delivered twice; 130 distinct requestIds | deliver | one ack for the duplicate; dedupe set size never exceeds 128 |
| F3 | only calling session | EP | L1 | automated | attachments exist for S1 and S2 | `flows_open` for S1 | S2 attachment unchanged |
| F4 | later flow replaces off-screen pin | state-transition | L1 | automated | attachment baseline T; event stream with `flow_started` at T+1000 | `resolveFlowSlot` | live mode; attachment consumed |
| F5 | agent pin replaces picker pin | state-transition | L1 | automated | picker attachment A in S | `flows_open` for B | `getAttachment(S).name` = B |
| F6 | agent pin expands collapsed panel | state-transition | L1 | automated | `setFlowCollapsed(S,["dashboard"],true)` | `flows_open` for S | collapse for S = false |
| F7 | view-only fetch has no host fallback | EP | L1 | automated | plugin `/file` returns 403 | `fetchFlowFile(S, p, {noHostFallback:true})` | no request to `/api/pi-resource-file`; load error with re-open hint rendered |
| F8 | end-to-end pin in the browser | state-convergence | L3 | automated | docker harness, session with flows bridge, browser viewing it | agent-side `flow_open {flow:"test:capabilities"}` via bridge test hook | flow panel shows `test:capabilities` not-started, expanded; tool result `shown, acks:1` |
| F9 | mobile layout receives pin | state-convergence | L3 | automated | docker harness, 375 px viewport viewing S | `flow_open` for S | mobile flow bar shows the pinned flow; `acks:1` |
| F10 | panel looks right | visual | — | manual-only | real session, dark + light themes | open a path flow with `flow_open` | [judgment: label legible, header not crowded, matches accepted mock frame 3] |

### Error-handling
| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | no viewer | fault-injection (abort) | L1 | automated | no client acks | `flow/open` admitted | result `no-viewer` after ≥ 1.5 s and < 2 s; pending map empty afterwards |
| X2 | two viewers | EP | L1 | automated | two distinct `ws` ack; one `ws` acks twice | window ends | `shown, acks:2` |
| X3 | ack wrong/unknown requestId | fault-injection | L1 | automated | ack with unknown requestId; ack after window | handler | ignored; no throw; pending map bounded at 64 |
| X4 | flow running (bridge) | state-transition | L1 | automated | bridge saw `flow:flow-started{runId:r1}`; then `flow:complete{status:"rejected"}` (no runId); then `flow:complete{runId:r1}` | `flow_open` before and after each | refused `flow-running` until the matching complete; rejected complete does not clear; after `session_start` cleared |
| X5 | no dashboard | fault-injection (abort) | L1 | automated | request seam absent; lane throws; lane times out | tool `execute` | `refused/unavailable`; never throws |
| X6 | guarded read missing | fault-injection | L1 | automated | `ctx.readFileGuarded` undefined | `flow/open {path}` | `refused/unavailable` |
| X7 | swapped symlink after admission | fault-injection | L1 | automated | admitted `/w/f/flow.yaml` replaced by symlink to `/outside/x.yaml` | `GET …/file` | 403 |
| X8 | remote session | EP | L1 | automated | lane origin not hub-local | `flow/open` | `origin_denied`; registry unchanged |
| X9 | ack tier + scope | contract | L1 | automated | `WS_MESSAGE_TIERS`, `SESSION_OWNED_MESSAGES` | test run | `flows_open_ack` tier `observe`; present in `SESSION_OWNED_MESSAGES`; `ws-message-tiers.test.ts` + `ws-message-scope.test.ts` green |
| X10 | frame never shed | contract | L1 | automated | `frameClassOf({type:"flows_open", sessionId:"S"})` | call | `{cls:"state", key:"flows_open:S"}` |
| X11 | log line | EP | L1 | automated | refused `path-not-allowed`; shown with 2 acks | handler | exactly one `logger.info` per call containing session id, kind, outcome, reason/acks; no file content |
| X12 | server restart drops admission | state-transition | L1 | automated | view-only attachment stored; registry fresh | slot loads definition | load error with "ask the agent to open it again" hint + Close |

---

## Coverage summary
- Requirements covered: flow-open-tool 10/10 · flow-pre-run-attach 5/5 touched · flow-panel-collapse-persistence 1/1 · flow-controls 1/1
- Scenarios by class: edge 21 · perf 0 · frontend 10 · error 12
- Scenarios by level: L1 40 · L2 0 · L3 2
- Scenarios by disposition: automated 42 · manual-only 1

## New infra needed
- F8/F9: an L3 hook to trigger `flow_open` from the harness session (e.g. a test prompt that makes the agent call the tool with the faux provider, or a harness-only bridge test event). Extend the existing `tests/e2e/flow-attach-before-run.spec.ts` harness.
