# Test Plan — add-rest-prompt-delivery-mode

Stage: design   Generated: 2026-11-20

Harness exemplars (verified to exist):
- **REST** `packages/server/src/__tests__/session-api.test.ts` (real server, `postJson`, `registerSession`). It has no bridge WS; to capture the forwarded `send_prompt`, connect a real bridge WS as `plugin-ctx-session-mutations.test.ts` does (`packages/server/src/__tests__/`), or spy `piGateway.sendToSession`.
- **MCP dispatch** `packages/mcp-server-plugin/src/server/__tests__/dispatch.test.ts` (`deps({ sendToSession })`, `dispatchRpc`; context-bound tool fixture at ~L388).
- **Codegen/manifest** `.../__tests__/generated-freshness.test.ts`, `.../manifest-invariants.test.ts`.
- **L3** `tests/e2e/steer-cancel.spec.ts` (held steer bubble + cancel), `tests/e2e/background-stream-selection.spec.ts` (REST `page.request.post('/api/session/:id/prompt')` pattern), `tests/e2e/acp-session-queue.spec.ts` (ACP).

Requirement refs: DS = dashboard-server "Session prompt REST endpoint"; MCP = dashboard-mcp-server "MCP send_prompt forwards the delivery mode".

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| S1 | DS steer forwarded | ECP (valid class) | L1 | automated | registered session w/ bridge; body `{text:"focus on X",delivery:"steer"}` | `POST /api/session/:id/prompt` | bridge receives `send_prompt` with `delivery:"steer"` + `promptId`; response 200 `success:true` | session-api.test.ts + bridge-WS capture (plugin-ctx-session-mutations.test.ts) |
| S2 | DS followUp forwarded | ECP (valid class) | L1 | automated | same, `delivery:"followUp"` | POST | `send_prompt.delivery === "followUp"` (not dropped/rewritten) | same |
| S3 | DS absent not defaulted | ECP (absent class) | L1 | automated | body `{text:"hello"}` | POST | forwarded message has no `delivery` key (`"delivery" in msg === false`, not merely undefined) | same |
| S4 | DS invalid rejected | ECP + BVA on type/value (table: `"now"`, `""`, `"Steer"`, `"STEER"`, `5`, `0`, `null`, `true`, `["steer"]`, `{}`) | L1 | automated | valid session, valid `text`, each invalid `delivery` | POST | 400 `{success:false,error:'delivery must be "steer" or "followUp"'}`; zero `send_prompt` sent | session-api.test.ts (`it.each`) |
| S5 | DS precedence over lookup | decision-table (session×delivery) | L1 | automated | unknown id, `delivery:"now"` | POST | 400 (not 404) | session-api.test.ts L93 neighbour |
| S6 | DS valid + unknown session | decision-table | L1 | automated | unknown id, `delivery:"steer"` | POST | 404 `{success:false,error:"session not found"}`; nothing sent | session-api.test.ts L93 |
| S7 | design §2 order text→images→delivery | decision-table / pairwise | L1 | automated | (a) missing `text` + invalid delivery; (b) invalid `images` + invalid delivery | POST | (a) the existing text-missing 400 error body; (b) the existing images 400 error body — not the delivery error | session-api.test.ts L101 neighbour |
| S8 | DS steer = WS-path message | pairwise (delivery × images) / oracle | L1 | automated | same `{text,images,delivery}` once via REST and once via browser WS `send_prompt` | both paths | REST-forwarded message deep-equals WS-forwarded message modulo `promptId` | session-api.test.ts + WS send exemplar |
| S9 | DS response unchanged | regression | L1 | automated | `delivery:"steer"` vs absent, bridge connected | POST | response bodies same shape (`success:true`, `transmitted:true`, `promptId` present) | session-api.test.ts L109 neighbour |
| S10 | MCP steer forwarded | ECP | L1 | automated | `tools/call send_prompt {sessionId:"S",text:"focus on X",delivery:"steer"}`, real `sendToSession` wiring (helper) | dispatch | `sendToSession` called with `("S","focus on X",{delivery:"steer"})`; resulting bridge msg `{type:"send_prompt",sessionId:"S",text:"focus on X",delivery:"steer"}` exactly | dispatch.test.ts |
| S11 | MCP absent not defaulted | ECP | L1 | automated | `{sessionId:"S",text:"hello"}` | dispatch | message has no `delivery` key | dispatch.test.ts |
| S12 | MCP invalid rejected | ECP/BVA (`"now"`, `"Steer"`, `5`, `null`) | L1 | automated | `delivery` invalid | dispatch | schema validation fails (tool error/-32602 per existing convention); `sendToSession` not called | dispatch.test.ts (L843 `not.toHaveBeenCalled` pattern) |
| S13 | MCP 2-arg callers unchanged | regression | L1 | automated | other plugin calls `ctx.sendToSession("S","hello")` | call | message `{type:"send_prompt",sessionId:"S",text:"hello"}`, no `delivery` key | dispatch.test.ts + new `buildPluginSendPrompt` unit test beside server.ts tests |
| S14 | MCP helper `buildPluginSendPrompt` | BVA on opts (`undefined`, `{}`, `{delivery:undefined}`, `{delivery:"steer"}`, `{delivery:"followUp"}`) | L1 | automated | helper args | call | key present only when delivery defined; `{delivery:undefined}` ⇒ no key | pure-fn vitest (any `packages/server/src/__tests__/*.test.ts`) |
| S15 | MCP images ignored | regression | L1 | automated | `images` + `delivery:"steer"` | dispatch | message has only `type,sessionId,text,delivery`; no `images` | dispatch.test.ts |
| S16 | MCP discoverability / codegen | invariant | L1 | automated | `SendPromptRequest` gains `delivery`; manifest description extended | run codegen freshness + manifest tests | generated `tools.ts` schema has `delivery` enum `["steer","followUp"]`, freshness test passes, description ≤120 chars | generated-freshness.test.ts, manifest-invariants.test.ts |
| S17 | MCP self-target guard still applies | regression | L1 | automated | `send_prompt{sessionId:"A",text:"hi",delivery:"steer"}` from session A | dispatch | 403 SelfTargetRefused; tool not invoked | dispatch.test.ts G1 |

### Performance

N/A — adds one enum check and one optional field copy; no load, latency or throughput budget in the artifacts. No P rows.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|------------------|
| F1 | DS steer = browser steer (pending bubble) | state-transition | L3 | automated | pi-bridge faux session streaming (`[[faux:steer-hold-stream]] go`) | `page.request.post('/api/session/:id/prompt',{data:{text,delivery:"steer"}})` mid-stream | a held pending-steer bubble (`[data-testid^='pending-steer-cancel-']`) appears with the text; no duplicate user bubble before hand-off | steer-cancel.spec.ts + background-stream-selection.spec.ts POST pattern. Replaces manual task 4.2 |
| F2 | DS cancellable until hand-off | state-transition | L3 | automated | F1 state | click bubble cancel before `turn_end` | bubble disappears; steer text never appears as a user message after the turn ends | steer-cancel.spec.ts |
| F3 | DS idle steer straight to pi | state-transition | L3 | automated | idle session | REST POST with `delivery:"steer"` | no pending bubble lingers; user message + assistant reply render | optimistic-prompt.spec.ts / steer-cancel.spec.ts |
| F4 | design §3 known limitation — hand-off ack drops `sending` idle bubble | state-transition (accepted transient) | L1 | automated | client reducer state: browser idle-send bubble `sending`, then `prompt_received{fresh:false,promptId}` arrives | apply event, then authoritative `queue_update`/user `message_start` | transient drop allowed; final state converges to authoritative queue/user message; already-settled bubbles untouched | packages/client/src/lib/__tests__/event-reducer.test.ts |
| F5 | design §3 TTL | boundary (time) | L1 | automated | REST steer held; server pending-ack record expired (fake timers past TTL) | bridge emits `prompt_received{promptId}` | event still forwarded to browsers; no throw/log-error | packages/server/src/__tests__/pending-prompt-acks.test.ts |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| X1 | DS unchanged transmit failure | fault-injection (no bridge) | L1 | automated | session registered, no bridge connection | POST `{text,delivery:"steer"}` | 502, `transmitted:false`, no `promptId` | session-api.test.ts L109 |
| X2 | MCP send failure | fault-injection (`sendToSession` → false) | L1 | automated | `sendToSession` returns false | `send_prompt` with `delivery:"steer"` | same tool-failure result as without `delivery` | dispatch.test.ts |
| X3 | DS ACP steer queues as follow-up | fault/limitation (no steering) | L3 | automated | ACP-backed session mid-turn | REST POST `delivery:"steer"` | request accepted; text queued as a follow-up (queue UI shows it, delivered after turn) — same as browser steer on ACP | acp-session-queue.spec.ts |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | tasks 3.1 docs accuracy | review | — | manual-only | SKILL.md Send-prompt row, `api-reference.md`, `api-reference.agent.md` | human reads steer curl example, 400 case | [judgment: docs read as correct/consistent across three files; example copy-pastes and works] |

---

## Coverage summary

- Requirements covered: 12/12 spec scenarios (DS 7, MCP 5) + design §2 order, §3 limitation/TTL
- Scenarios by class: edge 17 · perf 0 · frontend 5 · error 3 · manual 1 (=26)
- Scenarios by level: L1 21 · L2 0 · L3 4 · manual 1
- Scenarios by disposition: automated 25 · manual-only 1

## New infra needed

- none (REST bridge-message capture reuses the real-bridge-WS pattern of plugin-ctx-session-mutations.test.ts; if too heavy, spy on `piGateway.sendToSession`).
- L2: none — no rendered-UI-free runtime behaviour beyond L1 coverage.
