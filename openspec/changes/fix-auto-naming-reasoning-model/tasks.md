## 1. Constants and pure parse layer

- [x] 1.1 Define the normative constants in `packages/extension/src/auto-session-namer.ts`: attempt budget 3, base cap 1024, escalated cap 2048, and export them for tests.
- [x] 1.2 Widen `generateTitle`'s return shape to carry the stream's normalized stop reason read from the `done` event's `reason` field (NOT `stopReason`), alongside the accumulated text.
- [x] 1.3 Make `parseTitle` verdict-based (`title` | `waiting` | `starved`), keying on the stop reason BEFORE inspecting text.
- [x] 1.4 Test — truncated text is never applied. see `packages/extension/src/__tests__/auto-session-namer.test.ts`. Triple: `done.reason="length"` with text `"Working On"` (passes 40-char and 6-word guards) · parse the result · verdict is `starved` and `setSessionName` is not called (test-plan #E4).
- [x] 1.5 Test — a `toolUse` stop is never applied. see `auto-session-namer.test.ts`. Triple: `done.reason="toolUse"` with text `"Bridge Fix"` · parse · verdict `starved`, `setSessionName` not called (test-plan #E5).
- [x] 1.6 Test — empty is not NULL. see `auto-session-namer.test.ts`. Triple: `done.reason="stop"` with text `""` · parse · verdict is `starved`, never `waiting` (test-plan #E6).
- [x] 1.7 Test — the NULL sentinel stays benign. see `auto-session-namer.test.ts`. Triple: `done.reason="stop"` with text `"NULL"` · parse · verdict `waiting` and no stop while budget remains (test-plan #E7).
- [x] 1.8 Test — title character boundary. see `auto-session-namer.test.ts`. Triple: titles of 39, 40 and 41 characters with `reason="stop"` · parse each · 39 and 40 applied, 41 yields `waiting` (test-plan #E8).
- [x] 1.9 Test — title word boundary. see `auto-session-namer.test.ts`. Triple: titles of 5, 6 and 7 words · parse each · 5 and 6 applied, 7 yields `waiting` (test-plan #E9).
- [x] 1.10 Test — uncooperative prose reply. see `auto-session-namer.test.ts`. Triple: a 900-character chat reply with `reason="stop"` · parse · verdict `waiting` carrying a rejection reason, not applied (test-plan #E10).

## 2. Adaptive output cap

- [x] 2.1 Implement the adaptive cap in `generateTitle`: 1024 on a session's first attempt, 2048 on any attempt after that session recorded a `starved` verdict.
- [x] 2.2 Test — first attempt uses the base cap. see `auto-session-namer.test.ts`. Triple: fresh session with no prior verdict · first naming attempt · injected `streamSimple` receives `maxTokens: 1024` (test-plan #E1).
- [x] 2.3 Test — a starved verdict escalates the cap. see `auto-session-namer.test.ts`. Triple: session with one recorded `starved` verdict · next attempt · injected `streamSimple` receives `maxTokens: 2048` (test-plan #E2).
- [x] 2.4 Test — a waiting verdict does not escalate. see `auto-session-namer.test.ts`. Triple: session whose last verdict was `waiting` on an untruncated stream · next attempt · `maxTokens` remains 1024 (test-plan #E3).
- [x] 2.5 Test — null header markers are forwarded unchanged. see `auto-session-namer.test.ts`. Triple: headers map containing a `null` value · model call · marker forwarded unchanged and no literal `"null"` header value emitted (test-plan #X17).
- [x] 2.6 Test — a null-only header map counts as empty. see `auto-session-namer.test.ts`. Triple: headers map whose every value is `null` · credential check · treated as carrying no usable headers despite a non-zero key count (test-plan #X18).

## 3. Attempt budget and cause-matched remedy

- [x] 3.1 Implement the single per-session attempt budget (3), spent by `starved` and `waiting` verdicts only; transient errors and aborts spend nothing.
- [x] 3.2 Implement the stop on exhaustion, emitting exactly one `auto_name_error` whose reason names the role slot, the resolved model reference, and the dominant cause — starved wins a tie.
- [x] 3.3 Test — reaching the bound stops. see `auto-session-namer.test.ts`. Triple: session with 2 spent attempts · third attempt yields `starved` · naming stops permanently and exactly one `auto_name_error` is emitted (test-plan #E11).
- [x] 3.4 Test — below the bound does not stop. see `auto-session-namer.test.ts`. Triple: session with 1 spent attempt · second attempt yields `starved` · no stop, retry allowed on a later turn (test-plan #E12).
- [x] 3.5 Test — waiting verdicts spend the same budget. see `auto-session-namer.test.ts`. Triple: three consecutive `waiting` verdicts · third attempt · stop plus one error (test-plan #E13).
- [x] 3.6 Test — transient errors spend nothing. see `auto-session-namer.test.ts`. Triple: five consecutive transient errors · each attempt · spent count stays 0 and no `auto_name_error` is emitted (test-plan #E14).
- [x] 3.7 Test — starved-dominant remedy text. see `auto-session-namer.test.ts`. Triple: exhaustion from 3 `starved` verdicts · error emission · reason directs the operator to change the naming model (test-plan #E15).
- [x] 3.8 Test — waiting-dominant remedy text. see `auto-session-namer.test.ts`. Triple: exhaustion from 3 `waiting` verdicts · error emission · reason reports no nameable topic and does not blame the model (test-plan #E16).
- [x] 3.9 Test — tie-break favours starved. see `auto-session-namer.test.ts`. Triple: exhaustion from 2 `starved` plus 2 `waiting` with a raised fixture budget · error emission · the starved remedy is chosen (test-plan #E17).
- [x] 3.10 Test — per-session cost is bounded. see `auto-session-namer.test.ts`. Triple: a session that never yields a title driven through 50 terminal turns · run to completion · model completions for that session are at most 3 (test-plan #P1).
- [x] 3.11 Test — cost does not grow with turns. see `auto-session-namer.test.ts`. Triple: the same session driven through 50 turns and then 500 turns · compare · completion count is identical in both runs (test-plan #P2).

## 4. Advancing transcript window and pre-filter

- [x] 4.1 Implement window selection in `packages/extension/src/bridge-context.ts`: the most recent user entry carrying non-empty text, skipping tool-result-only entries, paired with that turn's assistant reply. Preserve the existing slice bounds exactly (user 200 chars, assistant 2000).
- [x] 4.2 Route the pre-filter through the same advancing window, selecting the most recent SUBSTANTIVE user message.
- [x] 4.3 Test — latest substantive selection. see `packages/extension/src/__tests__/auto-session-namer.test.ts` (and the bridge-context sibling suite). Triple: entries comprising a substantive user message, a tool-result-only entry and an empty user entry · build the window · the most recent NON-EMPTY user entry is selected and tool-result-only entries are skipped (test-plan #E18).
- [x] 4.4 Test — slice bounds preserved. see `auto-session-namer.test.ts`. Triple: a 5000-character user message and a 5000-character assistant reply · build the window · user slice is 200 characters, assistant slice is 2000, exactly two slices leave the process (test-plan #E19).
- [x] 4.5 Test — a trivial latest message does not mask a substantive session. see `auto-session-namer.test.ts`. Triple: a substantive earlier message with latest message `"ok"` · pre-filter · the substantive message is selected and the attempt is not skipped (test-plan #E20).
- [x] 4.6 Test — a genuine greeting is still skipped. see `auto-session-namer.test.ts`. Triple: the only message is `"hi"` · pre-filter · skipped with no model call and outcome `skipped-prefilter` (test-plan #E21).

## 5. In-flight safety

- [x] 5.1 Latch the re-entrancy guard BEFORE the first await in the attempt path.
- [x] 5.2 Re-check eligibility AFTER the model call returns and before applying a title; never apply when the session became locked out, stopped, or already named while the call was in flight.
- [x] 5.3 Test — a rename during the model call wins. see `auto-session-namer.test.ts`. Triple: an external rename observed while the model call is in flight · the call returns a valid title · the title is not applied, provenance stays `user`, and the external name is not overwritten (test-plan #X6).
- [x] 5.4 Test — two adjacent turns start one call. see `auto-session-namer.test.ts`. Triple: two `agent_end` events before the first attempt's call resolves · both attempts · exactly one model call is started and exactly one budget unit is spent (test-plan #X7).

## 6. Naming role and default role names

- [x] 6.1 Add `naming` to `DEFAULT_ROLE_NAMES` in `packages/extension/src/role-manager.ts`.
- [x] 6.2 Implement the resolution chain `@naming` → `@fast` in the namer's role-resolution hook and its `bridge.ts` wiring; hard-stop only when both are unset, naming both slots in the reason.
- [x] 6.3 Test — `@naming` wins when assigned. see `packages/extension/src/__tests__/role-manager.test.ts`. Triple: both `roles.naming` and `roles.fast` assigned · resolve · the `naming` assignment is used (test-plan #E22).
- [x] 6.4 Test — fallback to `@fast`. see `role-manager.test.ts`. Triple: `roles.naming` unassigned with `roles.fast` assigned · resolve · `fast` is used and the reference equals the pre-change resolution (test-plan #E23).
- [x] 6.5 Test — neither role configured. see `role-manager.test.ts`. Triple: both unassigned · resolve · stop plus one error naming BOTH slots (test-plan #E24).
- [x] 6.6 Test — no write on read. see `role-manager.test.ts`. Triple: `providers.json` absent · call `roles:get-all` · the response includes `naming` and the file is not created (test-plan #E25).
- [x] 6.7 Test — removal marker respected. see `role-manager.test.ts`. Triple: a removal marker for `naming` · call `roles:get-all` · `naming` is not re-injected (test-plan #E26).
- [x] 6.8 Test — pre-existing custom `naming` role preserved. see `role-manager.test.ts`. Triple: a user-created `naming` role with an assigned model · call `roles:get-all` · the assignment is preserved and the role is classified built-in (test-plan #E27).

## 7. Durable stop and clearing

- [x] 7.1 Persist the stop state (stop flag, error-emitted flag, attempts spent, stopped model reference) in the session's `.meta.json` alongside `nameSource`.
- [x] 7.2 Carry the enumerated namer state across reload via the existing bridge `prev` state — the value set, never the namer object (its closures would reference a stale connection, session id and context).
- [x] 7.3 Implement clearing by re-resolution, evaluated at the next attempt BEFORE the stop short-circuits it: clear when the resolved reference changes or the blocking cause (credentials, registry) resolves; clearing resets the spent budget AND re-arms error emission.
- [x] 7.4 Test — stop survives extension reload. see `auto-session-namer.test.ts`. Triple: a stopped session · the bridge extension reloads · no further attempt and no second `auto_name_error` (test-plan #X9).
- [x] 7.5 Test — spent budget survives reload. see `auto-session-namer.test.ts`. Triple: a session with 2 spent attempts · reload · spent count is still 2 and does not reset to 0 (test-plan #X10).
- [x] 7.6 Test — same-reference reassignment does not clear. see `auto-session-namer.test.ts`. Triple: stopped on reference R · assign a model that resolves to R · the stop remains in force (test-plan #X13).
- [x] 7.7 Test — clearing resets budget and re-arms the error. see `auto-session-namer.test.ts`. Triple: stopped with budget exhausted and error already emitted · the resolved reference changes, then 3 further failures · budget resets on clear, a NEW `auto_name_error` is emitted on re-exhaustion, and the session does not re-stop after a single attempt (test-plan #X14).
- [x] 7.8 Test — a credential fix clears the stop. see `auto-session-namer.test.ts`. Triple: stopped for unresolvable credentials with the reference unchanged · credentials configured · the stop clears at the next attempt (test-plan #X15).
- [x] 7.9 Test — clearing never overrides a user lockout. see `auto-session-namer.test.ts`. Triple: a session locked out with provenance `user` · the naming model is reassigned · the lockout remains in force (test-plan #X16).

## 8. Outcome reporting

- [x] 8.1 Add the attempt-outcome message to `packages/shared/src/protocol.ts` (bridge→server) and `browser-protocol.ts` (server→client), additive and optional: session id, outcome, reason, model reference, timestamp.
- [x] 8.2 Add a `reportOutcome` hook and emit exactly one outcome from every attempt exit path; move the auto-name toggle check inside the namer so `disabled` is reachable; exempt the in-flight guard.
- [x] 8.3 Implement wire deduplication: send an outcome only when it or its reason differs from the last one sent for that session.
- [x] 8.4 Test — dependencies not ready. see `auto-session-namer.test.ts`. Triple: registry or `streamSimple` unavailable · attempt · outcome `not-ready`, no budget spent, no error (test-plan #X8).
- [x] 8.5 Test — a transient network error reports `retrying`. see `auto-session-namer.test.ts`. Triple: the stream throws a network error · attempt · outcome `retrying`, no error emitted, no budget spent (test-plan #X3).
- [x] 8.6 Test — a user abort is not starvation. see `auto-session-namer.test.ts`. Triple: an `error` event with `reason: "aborted"` · attempt · treated as soft, not counted as starvation, no budget spent (test-plan #X4).
- [x] 8.7 Test — soft-error reason extraction. see `auto-session-namer.test.ts`. Triple: an `error` event carrying its message inside the payload object · attempt · the reason is read from the event's message payload rather than a non-existent top-level field (test-plan #X5).
- [x] 8.8 Test — unchanged outcomes are not resent. see `auto-session-namer.test.ts`. Triple: five terminal turns all yielding `already-named` · turns 2 through 5 · no further outcome message is sent (test-plan #E33).
- [x] 8.9 Test — a changed outcome is sent. see `auto-session-namer.test.ts`. Triple: `waiting` followed by `starved` · the second attempt · a new outcome message is sent (test-plan #E34).
- [x] 8.10 Test — wire cost bounded by dedupe. see `auto-session-namer.test.ts`. Triple: 100 terminal turns on an `already-named` session · run to completion · at most 1 outcome message is sent (test-plan #P3).

## 9. Server retention

- [x] 9.1 Handle the outcome message in `packages/server/src/event-wiring.ts`: retain the last outcome per session in a bounded in-memory map (bound 500) that evicts non-`stopped` entries before `stopped` entries, and the oldest `stopped` entry when `stopped` entries alone reach the bound.
- [x] 9.2 Expose the retained map over the existing browser-protocol request/response channel so a late-mounting client can fetch it; no new REST route.
- [x] 9.3 Test — the bound is absolute. see `packages/server/src/__tests__/event-wiring-queue-state.test.ts`. Triple: 501 sessions report outcomes with a bound of 500 · the 501st report · the map holds at most 500 entries (test-plan #E28).
- [x] 9.4 Test — stopped entries are protected. see `event-wiring-queue-state.test.ts`. Triple: one `stopped` entry plus 500 routine outcomes · eviction · the `stopped` entry is retained and a routine entry is evicted (test-plan #E29).
- [x] 9.5 Test — stopped-only overflow tie-break. see `event-wiring-queue-state.test.ts`. Triple: 501 `stopped` outcomes · the 501st report · the map holds at most 500 entries and the OLDEST stopped entry is evicted (test-plan #E30).
- [x] 9.6 Test — replaced on second report. see `event-wiring-queue-state.test.ts`. Triple: the same session reports `waiting` then `starved` · the second report · only the latest outcome is retained (test-plan #E31).
- [x] 9.7 Test — never persisted. see `event-wiring-queue-state.test.ts`. Triple: outcomes are reported · inspect disk · no new file is written (test-plan #E32).
- [x] 9.8 Test — retention memory bound under load. see `event-wiring-queue-state.test.ts`. Triple: 5000 sessions reporting outcomes · run to completion · retained entries never exceed 500 (test-plan #P4).

## 10. Client — naming role discoverability and diagnostics

> AMENDED 2026-08-21: the inline-beneath-the-toggle row is not achievable
> (`claim.tab` inert since `plugin-settings-pages`; `usePluginConfig` throws
> outside a plugin slot), and the diagnostics carrier moved to a REST route
> because the Diagnostics surface has no send path. See design.md D1/D9.

- [x] 10.1 Confirm the `naming` role renders in the Roles panel Built-in group, driven by the existing `roles:get-all` / `roles:set` handlers in `packages/roles-plugin/`; no new preference field.
- [x] 10.2 Add a pointer beneath the auto-name toggle in `packages/client/src/components/settings/SettingsPanel.tsx` naming where the naming model is configured and stating the `@fast` fallback.
- [x] 10.3 Add the read-only `GET /api/auto-name-outcomes` route serving the retained map, and render it in Settings → Diagnostics fetched on mount, presenting `starved` distinctly from `waiting`.
- [x] 10.4 Test — the naming row reflects the roles map. see `packages/roles-plugin/src/__tests__/RolesSettingsSection.test.tsx`. Triple: `roles.naming` assigned · render the Roles panel · the `naming` row shows that model (test-plan #F1).
- [x] 10.5 Test — the row writes through `roles:set`. see `RolesSettingsSection.test.tsx`. Triple: the operator picks a model in the `naming` row · save · a `role_set` for `naming` is dispatched and no new preference field is written (test-plan #F2).
- [x] 10.6 Test — unassigned shows the fallback. see `RolesSettingsSection.test.tsx`. Triple: `roles.naming` unassigned · render · the row indicates the `fast` fallback (test-plan #F3).
- [x] 10.7 Test — removed role state. see `RolesSettingsSection.test.tsx`. Triple: a removal marker in effect for `naming` · render · no assignable `naming` slot, distinct from unassigned (test-plan #F4).
- [x] 10.8 Test — the toggle points to the naming model. see `packages/client/src/components/settings/__tests__/`. Triple: render the sessions settings page · inspect the auto-name toggle hint · it names the Roles panel and states the `@fast` fallback (test-plan #F5).
- [x] 10.9 Test — a preset load is reflected. see `RolesSettingsSection.test.tsx`. Triple: `roles.naming` assigned, then load a preset lacking `naming` · after the load · the row shows unassigned with the fallback indication (test-plan #F6).
- [x] 10.10 Test — the naming role renders built-in. see `RolesSettingsSection.test.tsx`. Triple: a default install · render the Roles panel · `naming` appears in the Built-in group (test-plan #F11).
- [x] 10.11 Test — diagnostics shows a waiting state. see `packages/client/src/components/settings/__tests__/`. Triple: a session whose last outcome is `waiting` · render Diagnostics · the outcome and its reason are rendered for that session (test-plan #F7).
- [x] 10.12 Test — diagnostics on late mount. see the same suite. Triple: an outcome retained BEFORE the surface is opened · render Diagnostics · the retained outcome is rendered without depending on the live broadcast (test-plan #F8).
- [x] 10.13 Test — starved is distinguishable. see the same suite. Triple: a session whose last outcome is `starved` · render Diagnostics · it is presented distinctly from `waiting` and conveys truncation (test-plan #F9).
- [x] 10.14 Test — an unwatched stop is discoverable. see `packages/server/src/__tests__/`. Triple: an outcome recorded with no subscribed client · `GET /api/auto-name-outcomes` · the stop is served from retention rather than only reaching `server.log` (test-plan #F10).

## 11. Live verification against real models

- [ ] 11.1 Test — a reasoning model starves and stops loudly. see `qa/tests/02-server-start.sh` for the process-smoke harness shape. Triple: `@naming` set to a reasoning model that truncates · three terminal turns on a fresh session · exactly one `auto_name_error`, no name applied, and no fourth completion (test-plan #X1).
- [ ] 11.2 Test — a non-reasoning model names the session. see `qa/tests/02-server-start.sh`. Triple: `@naming` set to a non-reasoning model · one substantive terminal turn · the session is named and `.meta.json` records `nameSource: "auto"` (test-plan #X2).
- [ ] 11.3 Test — the stop survives a process restart. see `tests/e2e/bridge-contention-health.spec.ts` for harness restart glue; read the harness port from `.pi-test-harness.json#dashboardPort`, never hardcode it. Triple: a stopped session persisted in `.meta.json` · the dashboard/pi process restarts · no further naming attempt, no re-emitted error, and the budget is not re-spent (test-plan #X11).
- [ ] 11.4 Test — cross-bridge stop clearing. see `tests/e2e/roles-custom.spec.ts`. Triple: two stopped sessions on separate bridges · reassign `naming` via ONE of them · BOTH clear at their next attempt (test-plan #X12).
- [ ] 11.5 Test — provenance masking hazard is recorded. see `tests/e2e/bridge-contention-health.spec.ts`. Triple: a session auto-named by this change · bridge reload, then read `.meta.json` · the observed provenance is recorded so the separate relabel bug cannot be misread as a failure of this change (test-plan #X19).

## 12. Verification and documentation

- [ ] 12.1 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`. All green.
- [ ] 12.2 Rebuild and restart per the `implement` matrix: `npm run reload` for the extension, `curl -X POST http://localhost:8000/api/restart` for server/shared, `npm run build` plus restart for the client.
- [x] 12.3 Update the purpose rows for every touched source file in the nearest directory `AGENTS.md` (`auto-session-namer.ts.AGENTS.md`, `bridge.ts.AGENTS.md`, `bridge-context.ts.AGENTS.md`, the `role-manager.ts` row, the server `event-wiring.ts` row, the roles-plugin and client settings rows), each carrying `See change: fix-auto-naming-reasoning-model`.
- [x] 12.4 Delegate to DocScribe (caveman style) any `docs/` prose covering the naming-model role, the adaptive cap, and the starvation failure mode; apply the returned tree rows.
- [x] 12.5 Run `kb dox lint` and clear any `stale` or `missing` rows this change introduced.
- [x] 12.6 File the follow-up investigation for the auto→`user` provenance relabel on reload, carrying the evidence gathered here (`seed()` never called in production, `lastSelfApplied` not carried, 174 persisted `user` rows of unknown provenance).
