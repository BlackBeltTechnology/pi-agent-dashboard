## 1. Shared contracts

- [x] 1.1 Add `QuestionRow`, `QuestionDetail`, `BriefStatus`, `QuestionAnswerRequest` and the `questions_update` browser message to `packages/shared`; protocol contract test covers the message
- [x] 1.2 Move `prompt-answer-encoder.ts` to `packages/shared` (client re-imports; existing tests stay green) and add a per-type answer-string validator; failing tests first incl. an encoder→validator round-trip for confirm (`"true"`/`"false"`), select, multiselect (incl. `"[]"`), input/editor (incl. empty), batch
- [x] 1.3 Add the three routes to `route-tiers.ts` (GET `observe`, POST `control`), the `questions` family to `http-road-classification.ts`, and MCP denylist entries with reason; completeness tests pass

## 2. Bridge

- [x] 2.1 Verification tests: `ask_user` `message` reaches prompt metadata for confirm, select, input, editor and batch top-level; add carriage only where a test fails (D3)
- [x] 2.2 Failing tests for the MODIFIED timeout requirement: override `0` → infinite; positive override narrows `-1` config; invalid → warning + config; absent → config (default 300 s); implement in `lifecycle.ts` (D11)

## 3. Server question store

- [x] 3.1 Failing tests: tracked prompt → record; notify-shaped → none; re-send maps to the same id; prompt tracked again after removal → new id; ids unguessable; `hasPendingPromptRequests` unchanged
- [x] 3.2 Failing tests: every removal path (clear, reconcile, `clearPendingRequestsForSession`, session death, cancel/timeout) removes the record, deletes its file and broadcasts immediately; transmitted answer hides the row immediately
- [x] 3.3 Implement `question-store.ts` and hook it from the registry (D1)
- [x] 3.4 Failing tests: snapshot bounded, absent reasons `none`/`evicted`, immutable, each `REDACTION_PATTERNS_V1` pattern redacted and the version stored; implement (D2)
- [x] 3.4a `Audit` subagent reviews the redaction set and the snapshot→model data flow before task 4.3 lands
- [x] 3.5 Failing tests: per-recipient visibility filter of `questions_update` (no resolver → all; resolver → owner equality, ownerless hidden); implement with add/brief debounce and immediate removals (D7)

## 4. Brief generation + store

- [x] 4.1 Failing tests for server-side `@fast` resolution via `parseRoleConfig` + `resolveModelRef` + registry lookup: bound → model; unbound/unknown/no registry → `unavailable`, no call (D5)
- [x] 4.2 Failing tests: long message → `provided`, no call; short → one call → `ready`; no assistant text → brief labelled limited context; input/editor brief has no per-option section; failure/timeout → `failed`, not retried; cap 2 queues; `autoBrief=false` → no call; Summarize generates for a `provided` brief
- [x] 4.3 Implement generator + policy (D4)
- [x] 4.4 Failing tests: per-question file 0600 + atomic write; snapshot/brief/`failed` reused when the prompt is re-sent after a simulated restart even after a 5-min quarantine delay; boot deletes files only for unknown or ended sessions
- [x] 4.5 Implement durable store (D6)
- [x] 4.5a Failing tests for the `shared-config` question fields (defaults, clamp, invalid → default, not written by init); implement (D12)
- [x] 4.6 Log brief outcome and latency; count fallbacks

## 5. REST API

- [x] 5.1 Failing tests: list rows without context; visibility (list filter, detail/answer 404); detail 404 unknown; valid answer → `{transmitted:true}`; transmit failure → `{transmitted:false}`, claim released, retry succeeds; invalid → 400; answer+cancel → 400; concurrent REST+browser → exactly one transmitted, other 409 naming `answered`; 409 window then 404, and 404 for an old id after a restart; transmit hides the row while the registry entry stays until the echo; image-carrying answers not expressible (text-only); file-access 403; chat-gateway session prompt answerable under chat rules; observe-tier answer rejected
- [x] 5.2 Implement routes + claim shared with browser `prompt_response` (D8, D9)
- [x] 5.3 Document routes in the pi-dashboard skill `api-reference.md`

## 6. Unattended spawns

- [x] 6.1 Failing test: automation run spawn passes `extensionConfig: { "pi-dashboard": { askUserPromptTimeoutSeconds: "0" } }` alongside its existing fields (model resolution unchanged); implement in the automation engine spawn
- [x] 6.2 Failing test: reaped run terminates its session and its question leaves the stack
- [x] 6.3 Failing test: goal driver spawn and respawn pass the override; implement in `spawnDriver`

## 7. Client

- [x] 7.1 Failing component tests: hidden at 0, count, newest-first, origin markers, immediate removal
- [x] 7.2 Implement `QuestionStack`
- [x] 7.3 Failing tests: visible chat prompt → select + scroll, no dialog; visible widget-bar prompt → owning slot; hidden → dialog; filtered/collapsed visible session revealed
- [x] 7.4 Implement routing (D10)
- [x] 7.5 Implement `QuestionDialog`: lazy detail fetch, labelled brief, Summarize, collapsible snapshot with absent reasons, renderers for every type, already-answered state, read-only file-access with approval link
- [x] 7.6 Narrow viewport badge + sheet; full-screen dialog; never covers the composer
- [x] 7.7 Theme tokens only; keyboard + screen-reader pass

## 8. Orchestrator skill convention

- [x] 8.1 Add the situation-brief rule (task, why asking, per-option outcome; ≥ 240 chars) to `plan-proposal`, `ship-it`, `ship-change`
- [x] 8.2 Wiring test asserting the three skills carry the rule

## 9. Docs + verification

- [x] 9.1 DocScribe: `docs/architecture.md` question-stack section; AGENTS.md rows for new/changed files
- [x] 9.2 `Audit` subagent on the answer path, visibility scoping, redaction and brief generation
- [ ] 9.3 Full test run + client build; manual check with a hidden automation run asking a question for > 5 min

<!-- Folded from test-plan.md by plan-proposal. One task per manifest row. -->
## 10. L1 — server question store (vitest)

- [ ] 10.1 Test notify-shaped requests create nothing — see packages/server/src/__tests__/browser-gateway-owner-gate.test.ts — `prompt_request` notify + legacy notify-shaped · event-wiring receives it · 0 records, 0 snapshot reads, 0 model calls, no `questions_update` (test-plan #E1)
- [ ] 10.2 Test ids opaque and stable across re-send — see packages/server/src/__tests__/pending-attach-registry.test.ts — `(s1,uuid1)` tracked + re-sent, `(s1,uuid2)` tracked · track/re-track · same id on re-send, new id for uuid2, ids match `/^[A-Za-z0-9_-]{22}$/` without `s1` (test-plan #E5)
- [ ] 10.3 Test every removal path removes immediately — see packages/server/src/__tests__/browser-gateway-owner-gate.test.ts — one question per path · clear / reconcile / `clearPendingRequestsForSession` / session death / `prompt_cancel` · record removed, file deleted, `questions_update` in the same tick (test-plan #E13)
- [ ] 10.4 Test snapshot bounded, absent reasons, immutable — see packages/server/src/__tests__/pending-attach-registry.test.ts — 9000-char assistant text, 7 tool calls, no-text session, evicted text · tracked then 3 more events · last 8192 chars, last 5 tools, `none`/`evicted`, unchanged after events (test-plan #E14)
- [ ] 10.5 Test redaction of every `REDACTION_PATTERNS_V1` pattern — see packages/server/src/__tests__/pending-attach-registry.test.ts — one sample per pattern · snapshot + generation prompt built · all replaced in file and prompt, `redactionVersion: 1` stored (test-plan #E15)
- [ ] 10.6 Test restart durability of question files — see packages/server/src/__tests__/pending-attach-registry.test.ts — file for persisted session reconnecting after 5 min, file for unknown session, file for ended session · boot then re-send · first kept + rebound with 0 model calls, others deleted, mode 0600 (test-plan #E23)
- [ ] 10.7 Test transmit hides row while registry keeps entry — see packages/server/src/__tests__/browser-gateway-owner-gate.test.ts — open question · answer transmitted before echo · row absent from `questions_update`, `hasPendingPromptRequests` true until `prompt_dismiss` (test-plan #E24)
- [ ] 10.8 Test visibility decision table on every road — see packages/server/src/__tests__/browser-gateway-broadcast-owner-filter.test.ts — resolver off/on × owner/other/none × owned/ownerless · list, detail, answer, broadcast · exposure matches the session-list predicate; mismatch → omitted / 404 (test-plan #E9)

## 11. L1 — brief generation (vitest)

- [ ] 11.1 Test brief length boundary — see packages/server/src/model-proxy/__tests__/concurrency.test.ts — `minBriefChars=240`, message 0/239/240/241 chars · tracked · 239/absent → 1 `@fast` call `pending`→`ready`; 240/241 → 0 calls, `provided` (test-plan #E2)
- [ ] 11.2 Test role does not resolve — see packages/server/src/model-proxy/__tests__/concurrency.test.ts — no `fast` role / unknown model / null registry · tracked · `unavailable`, 0 `streamSimple` calls (test-plan #E18)
- [ ] 11.3 Test generation concurrency cap — see packages/server/src/model-proxy/__tests__/concurrency.test.ts — 5 questions needing generation at once · tracking · ≤ 2 in flight, FIFO start order (test-plan #E19)
- [ ] 11.4 Test generation timeout stays failed across restart — see packages/server/src/model-proxy/__tests__/concurrency.test.ts — `streamSimple` never resolves · 20 s fake timers, then restart + re-send · `failed`, answerable, 0 extra calls (test-plan #X1)
- [ ] 11.5 Test malformed providers.json — see packages/server/src/model-proxy/__tests__/concurrency.test.ts — providers.json `{not json` · question needing generation · `unavailable`, warning logged, no throw (test-plan #X4)

## 12. L1 — config (vitest)

- [ ] 12.1 Test `minBriefChars` partitions and clamp — see packages/shared/src/__tests__/config-push.test.ts — -1/0/4000/4001/100000/`"abc"`/absent · config load · 0/0/4000/4000/4000/240/240, not written by init (test-plan #E3)
- [ ] 12.2 Test `autoBrief` decision table — see packages/shared/src/__tests__/config-push.test.ts — false/true/`"yes"`/absent with short message · tracked · false → 0 calls + `unavailable`; others → 1 call (test-plan #E4)

## 13. L1 — REST + shared answer contract (vitest)

- [ ] 13.1 Test per-type answer validation — see packages/server/src/__tests__/access-prompt-routes.test.ts — confirm/select/multiselect/input/editor/batch valid + invalid bodies, both/neither · POST answer · valid → 200 `{transmitted:true}`; invalid → 400 and 0 `sendToSession` (test-plan #E6)
- [ ] 13.2 Test encoder → validator round trip — see packages/shared/src/__tests__/role-schema.test.ts — renderer results for every type · `encodePromptAnswer` → shared validator · all validate; confirm encodes `"true"`/`"false"` (test-plan #E7)
- [ ] 13.3 Test 409 window boundary — see packages/server/src/__tests__/access-prompt-routes.test.ts — answered at t0 · POST at t0+9:59, t0+10:01, after restart · 409 naming `answered` / 404 / 404 (test-plan #E8)
- [ ] 13.4 Test file-access prompts are listed but not answerable — see packages/server/src/__tests__/access-prompt-routes.test.ts — `metadata.kind` `agent-path-gate` + `-confirm` · list + POST · origin `file`; POST 403, still pending, 0 `sendToSession` (test-plan #E11)
- [ ] 13.5 Test chat-gateway session prompts follow chat rules — see packages/server/src/__tests__/access-prompt-routes.test.ts — `pluginRef.kind === "chat-gateway"`, control caller · POST valid answer · 200 `{transmitted:true}` (test-plan #E12)
- [ ] 13.6 Test transmission failure releases the claim — see packages/server/src/__tests__/access-prompt-routes.test.ts — `sendToSession` returns false · POST, then POST with bridge restored · `{transmitted:false}` + still listed, then `{transmitted:true}` (test-plan #X2)
- [ ] 13.7 Test concurrent double answer — see packages/server/src/__tests__/access-prompt-routes.test.ts — REST answer + browser `prompt_response` same tick · both delivered · exactly 1 `sendToSession`, REST loser 409 `answered` (test-plan #X3)
- [ ] 13.8 Test tier gate and unknown id — see packages/server/src/__tests__/access-prompt-routes.test.ts — observe-tier token; unknown id · POST answer; GET detail · tier rejection with question open; 404 (test-plan #X7)
- [ ] 13.9 Test MCP manifest completeness covers the new routes — see packages/server/src/__tests__/mcp-manifest-completeness.test.ts — three new routes registered · completeness test · `ROUTE_TIERS` rows + denylist entries with reason (test-plan #X8)

## 14. L1 — bridge (vitest)

- [ ] 14.1 Test timeout override precedence — see packages/extension/src/__tests__/prompt-bus-wiring.test.ts — override `"0"`/`"120"`/`"abc"`/absent × config 300/-1/60 · `session_start` · no `setTimeout` / 120000 / warning + 300000 / 300000 / 60000 ms (test-plan #E10)
- [ ] 14.2 Test `ask_user` message carriage — see packages/extension/src/__tests__/ask-user-tool.test.ts — `message` on select/input/editor/confirm/batch top-level · prompt request built · `metadata.message` equals it for every type (test-plan #E22)

## 15. L1 — automation + goal (vitest)

- [ ] 15.1 Test automation run spawn carries the infinite-wait override — see packages/automation-plugin/src/__tests__/engine.test.ts — definition with `model: "@fast"` · engine starts run · `scope.extensionConfig["pi-dashboard"].askUserPromptTimeoutSeconds === "0"`, resolved model unchanged (test-plan #E20)
- [ ] 15.2 Test reaped run clears its question — see packages/automation-plugin/src/__tests__/engine.test.ts — run waiting on an unanswered question past `maxRunAgeMs` · reaper tick · session terminated, question removed from registry and stack (test-plan #X6)
- [ ] 15.3 Test goal driver spawn and respawn carry the override — see packages/goal-plugin/src/server/__tests__/goal-supervisor.test.ts — active goal, driver dies with progress · spawn + respawn · both carry the override (test-plan #E21)

## 16. L1 — client (vitest + Testing Library)

- [ ] 16.1 Test header pill presence and accessible name — see packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx — 0/1/3 open questions · header renders · 0 → no `question-pill`, row-1 testids unchanged; 1 → "1 open question"; 3 → "3 open questions"; placed after the YOLO slot (test-plan #E17)
- [ ] 16.2 Test panel overflow — see packages/client/src/components/__tests__/SessionList.card-spawn-worktree.test.tsx — 5/6/8 open questions · panel open, "+N more" activated · none / "+1 more" / "+3 more" with 5 rows; expanded 8 rows, list max-height 60vh (test-plan #E16)
- [ ] 16.3 Test routing by visibility — see packages/client/src/components/__tests__/SessionList.card-spawn-worktree.test.tsx — visible chat prompt / visible widget-bar prompt / filtered-out visible session / hidden automation · row activated · select+scroll no dialog / owning slot / filter bypassed + selected / dialog open (test-plan #F1)
- [ ] 16.4 Test dialog states — see packages/client/src/components/access-grant/__tests__/GrantPromptDialog.test.tsx — `briefStatus` pending, generated, limited, provided; answered elsewhere; file access · dialog renders · labels, open context, disabled inputs + info callout, read-only + Access link as specified (test-plan #F4)
- [ ] 16.5 Test Summarize failure then Retry — see packages/client/src/components/access-grant/__tests__/GrantPromptDialog.test.tsx — provided brief, on-demand generation times out then succeeds · Summarize, Retry · original brief + error + `question-brief-retry`; then generated brief shown, Summarize gone (test-plan #F5)
- [ ] 16.6 Test keyboard and dialog semantics — see packages/client/src/components/access-grant/__tests__/GrantPromptDialog.test.tsx — panel open / dialog open · Esc, Tab past last control · focus back on `question-pill`; `role=dialog`, `aria-modal`, labelled; Tab wraps (test-plan #F6)
- [ ] 16.7 Test new-arrival ring vs reduced motion — see packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx — `prefers-reduced-motion` on/off · new question arrives · off → `arrive` class once; on → none (test-plan #F9)

## 17. L3 — Playwright against the docker harness

- [x] 17.1 Test hidden run answered from the dialog — see tests/e2e/faux-ask.spec.ts — hidden automation run with faux select · pill → panel → "Answer here" → option · count 0, run session receives option, run finalizes (test-plan #F2)
- [x] 17.2 Test visible session navigation — see tests/e2e/faux-ask.spec.ts — visible session with pending faux select, other session selected · pill → "Go to session" · session selected, inline prompt in viewport, no dialog (test-plan #F3)
- [x] 17.3 Test mobile layout tier — see tests/e2e/faux-ask.spec.ts — 375×812, 2 open questions · pill tap, row tap · pill ≥ 44×44, bottom sheet, full-viewport dialog, composer not covered (test-plan #F7)
- [x] 17.4 Test removal propagation p95 ≤ 1 s — see tests/e2e/faux-ask.spec.ts — 2 browser contexts, 20 faux questions answered in A · answer click → row gone in B · p95 ≤ 1000 ms over 20 samples (test-plan #P1)
- [x] 17.5 Test restart keeps snapshot and brief — see tests/e2e/pending-prompt-recovery.spec.ts — headless faux session with pending question + generated brief · `POST /api/restart` · same id listed with same brief, model-call counter unchanged (test-plan #X5)

## 18. Manual verification

- [ ] 18.1 Compare the implementation with the approved mockup `mockups/question-stack.html` in base dark, base light and nord dark (test-plan: manual-only, test-plan #F8)
