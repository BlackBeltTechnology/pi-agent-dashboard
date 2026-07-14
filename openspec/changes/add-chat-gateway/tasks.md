# Tasks — add-chat-gateway (Discord first)

## 1. Package scaffold & plugin wiring
- [ ] 1.1 Create `packages/chat-gateway/` (server component + settings panel) as a dashboard plugin discovered by `dashboard-plugin-runtime`. → verify: plugin appears in `/api/health.plugins[]`.
- [ ] 1.2 Add `discord.js` as an adapter-local dependency. → verify: builds; no new dep leaks into core packages.
- [ ] 1.3 Inert-when-unconfigured guard (no token → no connection). → verify: with no token, `npm test` + dashboard start show zero gateway activity.

## 2. Vendor the Discord adapter (MIT)
- [ ] 2.1 Vendor `base.ts` (`PlatformAdapter` contract) + `discord.ts` into `src/adapters/` with a `NOTICE` attributing `@gamalan/pi-gateway` (MIT). → verify: `NOTICE` present; no `index.ts`/`sessions/store.ts`/`ask-user-rpc` copied.
- [ ] 2.2 Adapter carries no hub logic (no spawn, no `pi --mode rpc`, no HTTP/WS server). → verify: grep the adapter for `spawn`/`--mode rpc`/`createServer` returns nothing.

## 3. Headless client seam
- [ ] 3.1 Implement the client that speaks `subscribe`/`send_prompt`/`prompt_response`/`abort` and consumes `event`/`event_replay`/`prompt_request`/`prompt_dismiss` (in-process subscribe if `dashboard-plugin-runtime` exposes it, else loopback WS). → verify: gateway receives events for a subscribed session.
- [ ] 3.2 Assert zero changes to `packages/extension` (bridge) and the session event protocol. → verify: `git diff --stat` touches no bridge/protocol files.

## 4. Channel→session routing
- [ ] 4.1 Sticky routing table `(platform, channelId, threadId?) → {sessionId, cwd, boundBy, source}`, persisted to `~/.pi/dashboard/chat-gateway/bindings.json`. → verify: second message reuses the same sessionId; binding survives restart.
- [ ] 4.2 Per-thread vs per-channel granularity. → verify: new thread resolves an independent binding.
- [ ] 4.3 State machine: attach / spawn / resume(continue) / 502-unreachable handling. → verify: each transition covered by a unit test.

## 5. cwd-binding resolver (+ allowedRoots invariant)
- [ ] 5.1 Precedence resolver (persisted → fixed map → default → interactive). → verify: unit tests per precedence branch.
- [ ] 5.2 `allowedRoots` mandatory whitelist; reject any cwd outside it; refuse spawn when empty. → verify: path outside allowedRoots → no spawn + in-channel refusal.
- [ ] 5.3 Attach-to-existing via `GET /api/sessions` (choose a live session in allowedRoots). → verify: attaches without spawning.
- [ ] 5.4 Spawn correlation by cwd + recency from `session_register` (spawn returns no id). → verify: correlated sessionId matches the spawned session.

## 6. Inbound/outbound streaming
- [ ] 6.1 Inbound authorized message → `send_prompt { text, delivery }`. → verify: prompt reaches bound session.
- [ ] 6.2 Outbound: text deltas → throttled `editMessage` (single message edited in place) + typing indicator on turn activity. → verify: N deltas produce 1 edited message, not N posts.
- [ ] 6.3 Disconnected session (502) → in-channel error, not silent. → verify: unreachable session replies with an error.

## 7. Interactive via PromptBus
- [ ] 7.1 Render `prompt_request` types `select`/`confirm`/`input`/`editor` as Discord controls/modals; return `prompt_response`. → verify: select renders buttons; chosen value returned.
- [ ] 7.2 `multiselect`/`batch` composition shim. → verify: multiselect returns multiple values; batch sequences sub-prompts.
- [ ] 7.3 On `prompt_dismiss`/`prompt_cancel`, disable/remove controls. → verify: answering on the web UI first disables the Discord controls.

## 8. Authorization (L1/L2/L4)
- [ ] 8.1 L1 allowlist + pairing code; non-allowlisted messages never delivered. → verify: unlisted user → no send_prompt.
- [ ] 8.2 L2 admin-only channel→cwd binding. → verify: non-admin bind refused.
- [ ] 8.3 L4 DM isolation; group channels opt-in. → verify: group channel inert unless opted in.

## 9. L3 hard tool guard (companion extension)
- [ ] 9.1 Companion in-session `tool_call` interceptor loaded into gateway-**spawned** sessions; deny-first policy → `{block:true}`. → verify: denied tool blocked before execution.
- [ ] 9.2 Approval escalation via `ctx.ui.confirm` → PromptBus → Discord yes/no; tool proceeds only on approval. → verify: risky tool prompts in-channel; deny blocks, allow runs.
- [ ] 9.3 Attach-to-existing (source a) sessions are ungated. → verify: no guard loaded for attached sessions.

## 10. Settings surface
- [ ] 10.1 Settings panel: Discord token, `allowedRoots`, fixed map, allowlist/admins, bindings view. → verify: panel renders in Settings; edits persist.
- [ ] 10.2 Token stored with restrictive perms; never returned in plaintext or logged. → verify: config read-back omits the token.

## 11. Docs
- [ ] 11.1 `packages/chat-gateway/AGENTS.md` + a `docs/` pointer for setup (Discord bot creation, token, allowedRoots). → verify: follows Documentation Update Protocol.
- [ ] 11.2 Threat-model note in `design.md` kept in sync with implemented controls. → verify: L1–L4 + allowedRoots + guard all present.

## Tests

Authored from `test-plan.md` (stable ids E#/P#/F#/X#). Falsify-don't-confirm: each row asserts a boundary or failure, not just the happy path.

### 12. L1 unit (vitest — `packages/chat-gateway/src/**/__tests__/*.test.ts`)
- [ ] 12.1 allowedRoots containment: in-range accepted, out-range rejected, empty-set refused, **real-path symlink/`..` escape rejected**. → E1, E2, E3, E4.
- [ ] 12.2 Binding sources & resolver precedence (persisted > fixedMap > default > interactive); attach in-range vs out-range. → E5, E6, E7.
- [ ] 12.3 Spawn correlation via token; concurrent same-cwd spawns never cross-bind. → E8, E9.
- [ ] 12.4 Sticky routing: 2nd message reuses sessionId; new thread → independent binding. → E10, E11.
- [ ] 12.5 Auth decision table (allowlisted × admin × action); pairing TTL 15m / lockout 10. → E12, E13, X10.
- [ ] 12.6 Config secrecy: token absent from read-back. → E14.
- [ ] 12.7 Guard: denied tool `{block:true}`; attached session ungated; unanswered approval **fails closed**. → X2, X5, X4(logic).
- [ ] 12.8 Mid-stream delivery mapping: plain → `followUp`, `!`-prefix → `steer`. → X6.
- [ ] 12.9 Spawn 500 → in-channel error, no dangling binding. → X8.

### 13. L2 smoke (`qa/tests/` — process/perf, NO rendered-UI asserts)
- [ ] 13.1 Binding persistence across gateway restart (attach/resume, no re-create). → X7.
- [ ] 13.2 Perf: edit throttle ≥1000ms, zero Discord 429, p95 edit latency < 1.5s over 5 min. → P1.
- [ ] 13.3 Perf: 20 concurrent bound channels, p95 chat-delivery < 2s, RSS flat, 10 min. → P2.
- [ ] 13.4 Adapter drop mid-session → reconnect, no duplicate delivery. → X9.

### 14. L3 e2e (Discord bot harness — adapter-level fake in CI; one real-guild smoke)
- [ ] 14.1 `select` renders controls, chosen value → `prompt_response`; multiselect/batch. → F1, F3, F4.
- [ ] 14.2 Cross-surface dismiss: web answers first → Discord controls disabled. → F2.
- [ ] 14.3 Interaction ack: round-trip > 3s → deferred-ack then edit, no "interaction failed". → F5.
- [ ] 14.4 Streaming invariants: single edited message (not N posts); >2000 chars chunks to a new message. → F7, F6.
- [ ] 14.5 Unreachable session (502) → in-channel error. → X1.
- [ ] 14.6 Approval flow over chat: deny blocks, allow runs. → X3.
- [ ] 14.7 New infra: build the Discord bot test harness (adapter-level fake recording `sendMessage`/`editMessage`/`sendInteractive`; one real-guild smoke reserved for X9). → verify: harness drives F/X rows deterministically in CI.

## Validation
- [ ] V.1 `openspec validate add-chat-gateway --strict` passes.
- [ ] V.2 Security review (`security-hardening`): allowedRoots non-bypassable, guard hard-blocks, secrets not leaked.
- [ ] V.3 Manual E2E: bind a Discord channel to a repo in allowedRoots, drive a session, answer an `ask_user` prompt from Discord, trigger + approve a gated tool.
