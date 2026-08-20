# Test Plan — fix-auto-naming-reasoning-model

Stage: design   Generated: 2026-08-20

Resolved constants (HARD gate answered — no open clarifications):
attempt budget **3** · output cap **1024 base / 2048 after a starved verdict** ·
retention bound **500** · stop persisted in the session **`.meta.json`** ·
window = **most recent non-empty user entry (skipping tool-result-only) + that turn's assistant reply** ·
dominant-cause tie → **starved wins**.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Adaptive cap — base | BVA | L1 | automated | fresh session, no prior verdict | first naming attempt | `streamSimple` receives `maxTokens: 1024` |
| E2 | Adaptive cap — escalation | state-transition | L1 | automated | session with one recorded `starved` verdict | next attempt | `streamSimple` receives `maxTokens: 2048` |
| E3 | Adaptive cap — no escalation on wait | state-transition | L1 | automated | session whose last verdict was `waiting` (untruncated) | next attempt | `streamSimple` receives `maxTokens: 1024` |
| E4 | Parse — truncation never applied | decision-table | L1 | automated | `done.reason="length"`, text `"Working On"` (passes 40-char + 6-word guards) | parse | verdict `starved`; `setSessionName` NOT called |
| E5 | Parse — toolUse never applied | decision-table | L1 | automated | `done.reason="toolUse"`, text `"Bridge Fix"` | parse | verdict `starved`; `setSessionName` NOT called |
| E6 | Parse — empty ≠ NULL | EP | L1 | automated | `done.reason="stop"`, text `""` | parse | verdict `starved` (NOT `waiting`) |
| E7 | Parse — NULL stays benign | EP | L1 | automated | `done.reason="stop"`, text `"NULL"` | parse | verdict `waiting`; no stop while budget remains |
| E8 | Parse — title boundary 40 chars | BVA | L1 | automated | titles of 39 / 40 / 41 chars, `reason="stop"` | parse | 39 and 40 → applied; 41 → `waiting` |
| E9 | Parse — word boundary 6 words | BVA | L1 | automated | titles of 5 / 6 / 7 words | parse | 5 and 6 → applied; 7 → `waiting` |
| E10 | Parse — uncooperative prose | EP | L1 | automated | 900-char chat reply, `reason="stop"` | parse | verdict `waiting` with rejection reason; not applied |
| E11 | Budget — below bound | BVA | L1 | automated | session with 2 spent attempts (budget 3) | third attempt yields `starved` | budget exhausted → stop + exactly one `auto_name_error` |
| E12 | Budget — just below | BVA | L1 | automated | session with 1 spent attempt | second attempt yields `starved` | no stop; retry allowed on a later turn |
| E13 | Budget — waiting spends it too | BVA | L1 | automated | 3 consecutive `waiting` verdicts | third attempt | stop + one error (waiting alone can exhaust) |
| E14 | Budget — transient spends nothing | decision-table | L1 | automated | 5 consecutive transient errors | each attempt | spent count stays 0; no `auto_name_error` |
| E15 | Remedy — starved-dominant text | decision-table | L1 | automated | exhaustion from 3 `starved` | error emission | reason directs operator to change the naming model |
| E16 | Remedy — waiting-dominant text | decision-table | L1 | automated | exhaustion from 3 `waiting` | error emission | reason reports no nameable topic; does NOT blame the model |
| E17 | Remedy — tie-break | decision-table | L1 | automated | exhaustion from 2 `starved` + 2 `waiting` (budget raised in fixture) | error emission | starved remedy wins the tie |
| E18 | Window — latest substantive selection | EP | L1 | automated | entries: substantive user msg, tool-result-only entry, empty user entry | build window | selects the most recent NON-EMPTY user entry, skipping tool-result-only |
| E19 | Window — slice bounds preserved | BVA | L1 | automated | user msg 5000 chars, assistant reply 5000 chars | build window | user slice = 200 chars, assistant slice = 2000 chars, exactly 2 slices |
| E20 | Pre-filter — trivial latest does not mask | EP | L1 | automated | substantive earlier msg, latest msg `"ok"` | pre-filter | selects the substantive message; attempt NOT skipped |
| E21 | Pre-filter — genuine greeting still skipped | EP | L1 | automated | only message is `"hi"` | pre-filter | skipped, no model call, outcome `skipped-prefilter` |
| E22 | Role resolution — `@naming` wins | decision-table | L1 | automated | `roles.naming` assigned, `roles.fast` assigned | resolve | uses the `naming` assignment |
| E23 | Role resolution — fallback | decision-table | L1 | automated | `roles.naming` unassigned, `roles.fast` assigned | resolve | uses `fast`; reference equals pre-change resolution |
| E24 | Role resolution — neither set | decision-table | L1 | automated | both unassigned | resolve | stop + one error naming BOTH slots |
| E25 | Defaults overlay — no write on read | EP | L1 | automated | `providers.json` absent | `roles:get-all` | response includes `naming`; file NOT created |
| E26 | Defaults overlay — removal marker respected | EP | L1 | automated | removal marker for `naming` | `roles:get-all` | `naming` NOT re-injected |
| E27 | Defaults overlay — pre-existing custom `naming` | EP | L1 | automated | user-created `naming` role with an assigned model | `roles:get-all` | assignment preserved; classified built-in |
| E28 | Retention — bound is absolute | BVA | L1 | automated | 501 sessions report outcomes (bound 500) | 501st report | map size ≤ 500 |
| E29 | Retention — stopped protected | decision-table | L1 | automated | 1 `stopped` + 500 routine outcomes | eviction | `stopped` retained; a routine entry evicted |
| E30 | Retention — stopped-only overflow tie-break | BVA | L1 | automated | 501 `stopped` outcomes | 501st report | map size ≤ 500; OLDEST stopped evicted |
| E31 | Retention — replaced on second report | EP | L1 | automated | same session reports `waiting` then `starved` | second report | only the latest retained |
| E32 | Retention — never persisted | EP | L1 | automated | outcomes reported | inspect disk | no new file written |
| E33 | Outcome dedupe — unchanged suppressed | state-transition | L1 | automated | 5 turns all yielding `already-named` | turns 2..5 | no further outcome message sent |
| E34 | Outcome dedupe — change sent | state-transition | L1 | automated | `waiting` then `starved` | second attempt | new outcome message sent |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Bounded per-session cost | threshold | L1 | automated | a session that never yields a title, driven through 50 terminal turns | model completions for that session ≤ 3 | whole run |
| P2 | Cost does not grow with turns | threshold | L1 | automated | same session, 50 vs 500 terminal turns | completion count identical in both runs | whole run |
| P3 | Wire cost bounded by dedupe | threshold | L1 | automated | 100 terminal turns on an `already-named` session | outcome messages sent ≤ 1 | whole run |
| P4 | Retention memory bound | threshold | L1 | automated | 5000 sessions reporting outcomes | retained entries ≤ 500 | whole run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Inline row reflects roles map | state-convergence | L3 | automated | `roles.naming` assigned | open Settings | inline row beneath the auto-name toggle shows that model |
| F2 | Inline row writes via `roles:set` | state-transition | L3 | automated | operator picks a model in the inline row | save | Roles panel converges to the same assignment; no new preference field written |
| F3 | Unassigned shows fallback | state-transition | L3 | automated | `roles.naming` unassigned | open Settings | row indicates the `fast` fallback |
| F4 | Removed role state | decision-table | L3 | automated | removal marker in effect for `naming` | open Settings | row presents REMOVED, distinct from unassigned; no assignable slot the Roles panel lacks |
| F5 | No connected session degrades row | state-transition | L3 | automated | zero connected pi sessions | open Settings | row presents unavailable, not an editable control that silently fails |
| F6 | Preset load reflected | state-transition | L3 | automated | `roles.naming` assigned, then load a preset lacking `naming` | after load | row shows unassigned + fallback indication |
| F7 | Diagnostics shows a waiting state | state-convergence | L3 | automated | session whose last outcome is `waiting` | open Settings → Diagnostics | outcome and reason rendered for that session |
| F8 | Diagnostics late mount | state-convergence | L3 | automated | outcome reported BEFORE the surface is opened | open Diagnostics afterwards | retained outcome still rendered (not broadcast-dependent) |
| F9 | Diagnostics distinguishes starved | state-convergence | L3 | automated | session whose last outcome is `starved` | open Diagnostics | presented distinctly from `waiting`; conveys truncation |
| F10 | Unwatched stop discoverable | state-convergence | L3 | automated | session stops with no subscribed client | operator opens dashboard later | stop discoverable via retained diagnostics, not only `server.log` |
| F11 | Naming role renders built-in | state-transition | L3 | automated | default install | open Roles panel | `@naming` appears in the Built-in group |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Reasoning model starves | fault-injection (real model) | L2 | automated | `@naming` set to a reasoning model that truncates | 3 terminal turns on a fresh session | exactly one `auto_name_error`; no name applied; no 4th completion |
| X2 | Non-reasoning model succeeds | fault-injection (real model) | L2 | automated | `@naming` set to a non-reasoning model | one substantive terminal turn | session named; `nameSource` = `auto` in `.meta.json` |
| X3 | Transient network error | fault-injection (abort) | L1 | automated | stream throws a network error | attempt | soft: outcome `retrying`, no error emitted, no budget spent |
| X4 | User abort mid-stream | fault-injection (abort) | L1 | automated | `error` event with `reason: "aborted"` | attempt | treated as soft; NOT counted as starvation; no budget spent |
| X5 | Soft-error reason extraction | fault-injection | L1 | automated | `error` event carrying its message in the payload object | attempt | reason read from the event's message payload, not a non-existent top-level field |
| X6 | Rename lands mid-stream | fault-injection (race) | L1 | automated | external rename observed while the model call is in flight | call returns a valid title | title NOT applied; provenance stays `user`; external name preserved |
| X7 | Two adjacent terminal turns | fault-injection (race) | L1 | automated | two `agent_end` events before the first call resolves | both attempts | exactly one model call; exactly one budget unit spent |
| X8 | Dependencies not ready | fault-injection | L1 | automated | registry / `streamSimple` unavailable | attempt | outcome `not-ready`; no budget spent; no error |
| X9 | Stop survives extension reload | state-transition | L1 | automated | stopped session | bridge extension reloads | no further attempt; no second `auto_name_error` |
| X10 | Spent budget survives reload | state-transition | L1 | automated | session with 2 spent attempts | reload | spent count still 2; not reset to 0 |
| X11 | Stop survives process restart | state-transition | L3 | automated | stopped session persisted in `.meta.json` | dashboard/pi process restarts (docker harness) | no further naming attempt; no re-emitted error; budget not re-spent |
| X12 | Cross-bridge stop clear | state-transition | L3 | automated | two stopped sessions on separate bridges | reassign `naming` via ONE of them | BOTH clear at their next attempt |
| X13 | Same-ref reassignment does not clear | decision-table | L1 | automated | stopped on ref R | assign a model resolving to R | stop remains in force |
| X14 | Clear resets budget and re-arms error | state-transition | L1 | automated | stopped with budget exhausted and error emitted | resolved ref changes, then 3 more failures | budget reset to 0 on clear; a NEW `auto_name_error` on re-exhaustion; no single-attempt re-stop |
| X15 | Credential fix clears the stop | state-transition | L1 | automated | stopped for unresolvable credentials, ref unchanged | credentials configured | stop clears at next attempt |
| X16 | Clear never overrides a user lockout | decision-table | L1 | automated | session locked out with provenance `user` | naming model reassigned | lockout remains in force |
| X17 | Null header markers forwarded | fault-injection | L1 | automated | headers map containing a `null` value | model call | marker forwarded unchanged; no literal `"null"` header |
| X18 | Null-only header map is empty | fault-injection | L1 | automated | headers map whose every value is `null` | credential check | treated as no usable headers despite non-zero key count |
| X19 | Provenance masking hazard | state-transition | L3 | automated | session auto-named by this change | bridge reload, then read `.meta.json` | records the OBSERVED provenance — documents whether the separate relabel bug fires; this row exists to prevent misreading the masking bug as a failure of this change |

---

## Coverage summary

- Requirements covered: 16/16 (all requirements across the 6 spec deltas)
- Scenarios by class: edge 34 · perf 4 · frontend 11 · error 19 — **68 total**
- Scenarios by level: L1 51 · L2 2 · L3 15
- Scenarios by disposition: automated 68 · manual-only 0

## New infra needed

- **none.** L1 extends existing `packages/extension/src/__tests__/auto-session-namer.test.ts`
  and sibling suites; L2 uses the existing `qa/` process-smoke tier with a real model
  configured; L3 uses the existing Playwright + docker harness (port read from
  `.pi-test-harness.json#dashboardPort`, never hardcoded).

## Notes

- **X1/X2 are L2, not L1**, because their value is exercising a REAL model — the original bug
  was invisible to every mock. A mocked "reasoning model" would have passed the old code too.
- **X19 is a guard against misdiagnosis**, not a fix: the auto→`user` relabel is a separate
  investigation, and without this row a verifier could see `nameSource: "user"` after a reload
  and wrongly conclude this change failed.
- No `manual-only` rows: every observable here is a value, a call argument, a file field, a
  message count, or a rendered assertion. Nothing rests on human judgment.
