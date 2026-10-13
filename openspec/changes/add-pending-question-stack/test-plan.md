# Test Plan — add-pending-question-stack

Stage: design   Generated: 2026-10-12

Gate answers folded (scenario-design HARD gate, C1–C5): header pill + dropdown
panel (C1) · newest 5 + "+N more" → scroll ≤ 60vh (C2) · removal propagation
p95 ≤ 1 s (C3) · no event-loop perf scenario, concurrency cap 2 only (C4) ·
Summarize failure keeps brief + inline error + Retry (C5).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | stack lists every open question › Notify is not a question | decision-table | L1 | automated | `prompt_request` with `method:"notify"`, and a legacy notify-shaped request | event-wiring receives it | 0 question records, 0 snapshot reads, 0 model calls, no `questions_update` |
| E2 | stored brief › Short context / Sufficient context | BVA | L1 | automated | `minBriefChars=240`; context message of 0 (absent), 239, 240, 241 chars | question tracked | 239/absent → exactly 1 `@fast` call, `briefStatus` `pending`→`ready`; 240/241 → 0 calls, `briefStatus: provided`, brief === message |
| E3 | shared-config › Question brief config fields | EP+BVA | L1 | automated | `minBriefChars` = -1, 0, 4000, 4001, 100000, `"abc"`, absent | config load | -1→0, 0→0, 4000→4000, 4001→4000, 100000→4000, `"abc"`→240, absent→240; file not rewritten by init |
| E4 | shared-config › autoBrief | decision-table | L1 | automated | `autoBrief` = false, true, `"yes"`, absent; short message | question tracked | false → 0 calls + `briefStatus: unavailable`; true/`"yes"`/absent → 1 call |
| E5 | REST › ids opaque, stable across re-send | state-transition | L1 | automated | prompt `(s1, uuid1)` tracked, re-sent after reconnect; second prompt `(s1, uuid2)` | track, re-track, track | re-send yields identical id; uuid2 yields a different id; ids match `/^[A-Za-z0-9_-]{22}$/` and do not contain `s1` |
| E6 | REST › per-type answer validation | decision-table | L1 | automated | confirm `"true"`/`"yes"`; select in/out of options; multiselect `'["a","b"]'`, `'[]'`, `'["a","a"]'`, `'a'`; input `""`; editor `"x"`; batch with wrong length / wrong sub-type; body with both `answer`+`cancelled`; empty body | `POST /api/questions/:id/answer` | valid → 200 `{transmitted:true}`; `"yes"`, out-of-options, duplicate, non-JSON multiselect, wrong batch length/sub-type, both, neither → 400 and 0 `sendToSession` calls |
| E7 | REST › answer encoding equals chat | round-trip | L1 | automated | renderer results for confirm/select/multiselect/input/editor/batch | `encodePromptAnswer` → shared validator | every encoded value validates; confirm encodes `"true"`/`"false"` |
| E8 | REST › 409 window | BVA (time) | L1 | automated | question answered (transmitted) at t0 | POST again at t0+9:59, t0+10:01, and after simulated restart | 9:59 → 409 body names `answered`; 10:01 → 404; after restart → 404 |
| E9 | Questions follow session visibility | decision-table | L1 | automated | resolver off / on; caller = owner, other principal, no principal; session owned / ownerless | list, detail, answer, broadcast | resolver off → all exposed; on+owner → exposed; on+other/none → omitted from list + broadcast, detail/answer 404; ownerless → hidden from human principal |
| E10 | ask-user-tool › timeout precedence (MODIFIED) | decision-table | L1 | automated | override `"0"` + config 300; `"120"` + config -1; `"abc"` + config 300; absent + config 300; absent + config 60 | `session_start` builds PromptBus | `"0"` → no `setTimeout`; `"120"` → 120000 ms timer; `"abc"` → warning logged + 300000 ms; absent → 300000 / 60000 ms |
| E11 | REST › file-access prompts | EP | L1 | automated | prompt with `metadata.kind` `agent-path-gate` and `agent-path-gate-confirm` | list + POST answer | listed with origin `file`; POST → 403, prompt still pending, 0 `sendToSession` |
| E12 | REST › chat-gateway session prompts | EP | L1 | automated | session `pluginRef.kind === "chat-gateway"`, control-tier caller | POST valid answer | 200 `{transmitted:true}` (same rule as dashboard chat) |
| E13 | stack › Removal is immediate on every path | state-transition | L1 | automated | one tracked question per path | `clearPromptRequest`, `reconcilePromptRequests` (id missing), `clearPendingRequestsForSession`, session death, `prompt_cancel` | record removed, question file deleted, `questions_update` emitted in the same tick (no 250 ms debounce) for each path |
| E14 | stored snapshot › bounded, absent reasons, immutable | BVA | L1 | automated | assistant text 9000 chars; 7 tool calls; session with no assistant text; text evicted from LRU | question tracked; then 3 more events arrive | text = last 8192 chars; tools = last 5; absent reason `none` / `evicted`; snapshot unchanged after later events |
| E15 | stored snapshot › redaction | EP | L1 | automated | snapshot containing one sample per `REDACTION_PATTERNS_V1` pattern (Bearer, `sk-…`, `api_key=`, `password=`, PEM private key, `AKIA…`) | snapshot + generation prompt built | every sample replaced in stored file and model prompt; stored `redactionVersion: 1` |
| E16 | stack › overflow (C2) | BVA | L1 | automated | 5, 6, 8 open questions | panel opens; "+N more" activated | 5 → no more-row; 6 → "+1 more"; 8 → "+3 more", 5 rows; after expand 8 rows and list `max-height` = 60vh |
| E17 | sidebar-header › open-questions pill | BVA | L1 | automated | 0, 1, 3 open questions | header renders | 0 → no `question-pill`, row-1 testids unchanged; 1 → name "1 open question"; 3 → name "3 open questions"; pill after `yolo-pill` slot |
| E18 | stored brief › Role does not resolve | EP | L1 | automated | providers.json without `fast`; `fast` → unknown model; registry null | question tracked | `briefStatus: unavailable`, 0 `streamSimple` calls |
| E19 | stored brief › generation capped | BVA | L1 | automated | 5 questions needing generation arrive at once | tracking | at most 2 generations in flight; started in arrival order |
| E20 | automation › run sessions wait indefinitely | EP | L1 | automated | automation definition with `model: "@fast"` | engine starts a run | spawn opts include `scope.extensionConfig["pi-dashboard"].askUserPromptTimeoutSeconds === "0"` and the resolved model unchanged |
| E21 | goal-supervisor › driver waits indefinitely | state-transition | L1 | automated | active goal; driver dies with progress | initial spawn and respawn | both spawn calls carry the infinite-wait override |
| E22 | brief › context message carriage | EP | L1 | automated | `ask_user` with `message` for select, input, editor, confirm, batch (top-level) | prompt request built | `metadata.message` equals the message for every type |
| E23 | stored brief › restart durability | state-transition | L1 | automated | question file present; session in persisted store, bridge reconnects after 5 min (quarantine); second file whose session is unknown; third whose session is recorded ended | server boot, then re-send | file 1 kept and rebound by `(sessionId, promptId)`, 0 model calls; files 2 and 3 deleted at boot; files have mode 0600 |
| E24 | stack › transmit hides row, registry keeps entry | state-transition | L1 | automated | open question | answer transmitted, echo not yet received | row absent from `questions_update`; `hasPendingPromptRequests(session)` still true until `prompt_dismiss` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | stack › removal propagation (C3) | tail-latency | L3 | automated | 2 browser contexts on the harness; 20 sequential faux questions, each answered in context A | time from answer click in A until the row is gone in B: p95 ≤ 1000 ms | 20 samples |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | routing by visibility | decision-table | L1 | automated | entries for: visible chat prompt; visible widget-bar prompt; visible session filtered out by folder filter; hidden automation | entry activated | chat prompt → session selected, prompt scrolled into view, no dialog; widget-bar → owning slot focused, no chat focus; filtered → filter bypassed and session selected; hidden → `question-dialog` open |
| F2 | hidden run answered from the dialog | state-convergence | L3 | automated | hidden automation run asking a faux select | pill → panel → "Answer here" row → option click | pill count decrements to 0; run session receives the option; run finalizes |
| F3 | visible session navigation | state-convergence | L3 | automated | visible session with a pending faux select, another session selected | pill → panel → "Go to session" row | that session selected; its inline prompt visible in viewport; no dialog |
| F4 | dialog states | decision-table | L1 | automated | `briefStatus` pending / ready-generated / ready-limited / provided; answered elsewhere; file-access prompt | dialog renders | pending → "Summarizing" + context `open` + inputs enabled; generated → label "Generated · @fast"; limited → "Limited context"; provided → "From the agent" + Summarize; answered elsewhere → info callout + inputs disabled; file access → no inputs + Access link |
| F5 | Summarize failure (C5) | state-transition | L1 | automated | provided brief; on-demand generation times out, then succeeds | Summarize, then Retry | after failure: original brief shown + error + `question-brief-retry`; after Retry success: generated brief stored and shown, Summarize gone |
| F6 | keyboard + dialog semantics | state-transition | L1 | automated | panel open; dialog open | Esc; Tab past last control | Esc closes panel → focus on `question-pill`; Esc closes dialog → focus on `question-pill`; dialog has `role=dialog`, `aria-modal=true`, `aria-labelledby` resolving to the title; Tab wraps inside the dialog |
| F7 | mobile layout tier | layout invariant | L3 | automated | 375×812 viewport, 2 open questions | pill tap, row tap | pill box ≥ 44×44; list renders as bottom sheet; dialog fills viewport; composer bounding box not covered while closed |
| F8 | visual fidelity to the approved mockup in base dark, base light, nord dark | visual/subjective | — | manual-only | `mockups/question-stack.html` vs implementation | human compares | [judgment: matches approved mockup — no automatable observable] |
| F9 | pill new-arrival ring vs reduced motion | EP | L1 | automated | `prefers-reduced-motion: reduce` on / off | new question arrives | off → `arrive` animation class applied once; on → no animation class |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | brief generation fails / stays failed | fault-injection (delay) | L1 | automated | `streamSimple` never resolves | 20 s fake-timer advance; then simulated restart + re-send | `briefStatus: failed`, question answerable; after restart still `failed`, 0 additional calls |
| X2 | REST › transmission fails | fault-injection (abort) | L1 | automated | `sendToSession` returns false | POST valid answer, then POST again with bridge restored | first → `{transmitted:false}`, question still listed; second → `{transmitted:true}` |
| X3 | REST › concurrent double answer | fault-injection (race) | L1 | automated | REST answer and browser `prompt_response` in the same tick | both delivered | exactly 1 `sendToSession` call; REST loser → 409 naming `answered` |
| X4 | role resolution › malformed providers.json | fault-injection (corrupt input) | L1 | automated | providers.json is `{not json` | question needing generation | `briefStatus: unavailable`, warning logged, no throw |
| X5 | restart keeps snapshot and brief | fault-injection (restart) | L3 | automated | dashboard server restart while a headless faux session holds a pending question with a generated brief | `docker/test-up.sh` harness restart via `POST /api/restart` | after reconnect the same question id is listed with the same brief; model-call counter unchanged |
| X6 | automation › reaped run clears its question | fault-injection (timeout) | L1 | automated | run waiting on an unanswered question; `maxRunAgeMs` exceeded | reaper tick | session terminated; question removed from registry and stack |
| X7 | REST › tier and unknown id | EP | L1 | automated | `observe`-tier token; unknown id | POST answer; GET detail | observe POST → rejected by tier gate, question open; unknown id → 404 |
| X8 | MCP manifest completeness | contract | L1 | automated | three new routes registered | completeness test | every new route has a `ROUTE_TIERS` row and a denylist entry with reason |

---

## Coverage summary

- Requirements covered: 12/12 (`pending-question-stack` 7, `ask-user-tool` 1, `automation-run-lifecycle` 1, `goal-supervisor` 1, `shared-config` 1, `sidebar-header` 1)
- Scenarios by class: edge 24 · perf 1 · frontend 9 · error 8
- Scenarios by level: L1 36 · L2 0 · L3 5 · — 1
- Scenarios by disposition: automated 41 · manual-only 1

## New infra needed

- none — L3 scenarios reuse the faux-provider ask round trip (`tests/e2e/faux-ask.spec.ts`) and the harness restart path (`tests/e2e/pending-prompt-recovery.spec.ts`); P1 needs two browser contexts in one spec, which Playwright supports natively.
