## 1. Protocol + shared types

- [x] 1.1 Extend the retry event payloads in `packages/shared/src/` — `auto_retry_start` gains real `maxAttempts`/`delayMs` (drop the `-1` sentinel contract), plus a waiting signal carrying `attempt`, `delayMs`, `errorMessage`, and `nextAttemptAt`
- [x] 1.2 Add the retry-settings payload type (`enabled`, `maxRetries`, `baseDelayMs`) shared by the config REST surface and the client

## 2. Bridge — fix the tracker, emit the waiting signal

- [x] 2.1 Write a failing REGRESSION test in `packages/extension/src/__tests__/retry-tracker.test.ts` pinning pi's REAL observed order — `agent_start → message_end(error) → agent_end` ×3 then `agent_settled` — and asserting ≥1 `auto_retry_start` and exactly 1 `auto_retry_end`. It fails today (0 events); it is the proof the defect is fixed
- [x] 2.2 Write failing tests: error `agent_end` emits a waiting signal with `nextAttemptAt = agent_end ts + delayMs`; `delayMs = baseDelayMs · 2^(attempt-1)`; `maxAttempts` from pi settings; unreadable settings yield `delayMs: 0`; no waiting signal once `attempt >= maxAttempts`
- [x] 2.3 Read pi's retry settings read-only in the bridge (defaults `maxRetries: 3`, `baseDelayMs: 2000`); never write them
- [x] 2.4 Rework `packages/extension/src/retry-tracker.ts`: `observeAgentEnd` no longer clears the chain and now emits `auto_retry_start` + the waiting signal; add `observeAgentSettled` as the sole terminal path emitting `auto_retry_end`
- [x] 2.5 Rewire `packages/extension/src/bridge.ts` — move the chain-terminating call from the `agent_end` arm to the `agent_settled` arm; keep `abortLatch.clear` on settle
- [x] 2.6 Verify the wire-ordering invariant still holds (synth events precede the terminal event) with the new waiting signal in the sequence

## 3. Server — pi retry settings

- [x] 3.1 Write failing tests: read returns pi's defaults when no `retry` block exists; write is merge-preserving (unrelated keys and `retry.provider.*` byte-identical); `.pi/settings.json` never touched
- [x] 3.2 Write failing validation tests: `maxRetries` non-negative integer, `baseDelayMs` positive integer, invalid input is not written; `maxRetries: 100` is accepted
- [x] 3.3 Implement read/write of the `retry` block in `~/.pi/agent/settings.json` behind the existing config REST surface
- [x] 3.4 Write a failing test for apply-on-save: a successful save reloads every connected session; a failed write reloads none
- [x] 3.5 Implement the reload fan-out using the existing `{type:"reload"}` command arm

## 4. Client — reducer state

- [x] 4.1 Write failing tests in the event-reducer suite: waiting signal sets `waiting: true` + `nextAttemptAt`; `auto_retry_start` sets `waiting: false`; `agent_end` PRESERVES `retryState`; `agent_settled` clears it
- [x] 4.2 Extend `retryState` (attempt, maxAttempts, delayMs, nextAttemptAt, waiting, reason, startedAt) and the reduce arms in `packages/client/src/lib/chat/event-reducer.ts`; remove the `agent_end` clear
- [x] 4.3 Write failing tests for `deriveBannerState`: propagates waiting + nextAttemptAt; still hides on empty; still never marks limit-exceeded
- [x] 4.4 Extend `deriveBannerState` accordingly (collapse stays out of the selector)

## 5. Client — banner surface

- [x] 5.1 Write failing tests in `packages/client/src/components/__tests__/SessionBanner.test.tsx`: dismiss collapses (does not clear) while a retry is pending; collapsed pill carries error + bare attempt + countdown + Stop + expand; clearing dismiss appears only once no retry sub-status is carried
- [x] 5.2 Write failing tests for the sticky collapse: stays collapsed across attempts of the same chain; a new chain renders expanded
- [x] 5.3 Write failing tests for the status line: bare "attempt N" with no "of N"; exact countdown from `nextAttemptAt`; computed countdown from `startedAt + delayMs`; degrade to "still waiting… (N s elapsed)" on overrun; elapsed-only when `delayMs` is 0
- [x] 5.4 Write failing tests for the controls: Stop retrying present in both retry sub-states and aborts; no second session-abort pill; NO Retry control on the settled surface
- [x] 5.5 Implement collapse/expand + the collapsed pill in `packages/client/src/components/session/SessionBanner.tsx` using MDI icons only (`mdiChevronUp`/`mdiChevronDown`, `mdiStop`, `mdiContentCopy`, `mdiClose`) and `InlineMessage` severity tokens
- [x] 5.6 Implement the status line (attempt, countdown/elapsed) and the per-chain sticky-collapse state
- [x] 5.7 Wire `packages/client/src/App.tsx`: Stop retrying → abort; dismiss handler no longer clears while a retry is pending

## 6. Client — session card + settings UI

- [x] 6.1 Card mark: amber working-token in both waiting and in-flight sub-states; red error mark wins — already satisfied + tested (`SessionCard.test.tsx`). Attempt+countdown-on-card TRIMMED to the banner per re-scope (avoids per-card timers in a render-hot component); `provider-retry-state` spec amended to match.
- [x] 6.2 No SessionList change needed — the boolean `isRetrying` already drives the amber mark; detail lives on the banner.
- [x] 6.3 Write failing tests for the Retry settings section: shows pi's defaults when unset; rejects invalid input; previews the delay progression and total; discloses global scope; offers no `retry.provider.*` control; warns (non-blocking) above ~20 attempts; the enabled toggle greys out the numeric controls
- [x] 6.4 Implement the Retry settings section in the client settings surface (enabled toggle + maxRetries + baseDelayMs, schedule preview, long-tail warning)

## 7. Verify

- [x] 7.1 Root `npm test` RUN: 10505 passed / 94 failed / 13 skipped. ALL 94 failures are environmental on this tree and none touch changed areas: 58 × `@blackbelt-technology/dashboard-plugin-runtime` unresolvable (workspace symlink absent from `node_modules` — npm-installed tree vs pnpm-required repo) + ~47 × `jimp@0.16.13` v1-API mismatch. Reporter emits failures only; no changed-area file appears in the 262-file failure list. Tests load pi **0.80.10** (PATH pi is 0.83.0); retry code is byte-identical across those versions.
- [x] 7.2 `npm run quality:changed` clean
- [x] 7.3 Lab (fake always-503, isolated HOME, pi 0.83): 3 attempts with 4000/8000/16000 ms gaps = `baseDelayMs·2^(n-1)` from the policy MY writer wrote → the waiting window between attempts is real and measurable; tracker emits a waiting signal per `agent_end` (unit-pinned).
- [x] 7.4 Collapse-mid-chain, pill keeps error+attempt+countdown+Stop, sticky per chain: SessionBanner suite (21 tests). Session Stop ending the chain while collapsed: specced + proven by the abort trace (retry genuinely stops, provider hits frozen).
- [x] 7.5 Reload fan-out proven at the route level (successful PUT → reload dispatched to every connected session; failed write → zero reloads). Live multi-session confirmation deferred: the docker harness cannot build on this drifted tree (missing workspace symlink, see 7.1).
- [x] 7.6 PROVEN on real fs with an isolated HOME: `packages`/`extensions`/`dashboardPluginBridges`/`enabledModels`/`hideThinkingBlock` all byte-identical after save; `retry.someFutureKnob` and `retry.provider.futureProviderKnob` preserved; `provider.timeoutMs` correctly OMITTED (not 0/null) when left blank.
- [x] 7.7 PROVEN: written block reads back identical via `readPiRetryPolicy`; the only `settings.json` created anywhere under the isolated tree is the global one; project `.pi/settings.json` NOT created; the REAL `~/.pi/agent/settings.json` still has `retry: null` (untouched throughout).

## 9. Settings surface — unified-Save rewiring + Sessions placement

Found during the combined smoke: the section shipped a PRIVATE Save button and bypassed the
panel's unified-Save contract, so a retry edit produced no dirty dot, no Save bar, no leave
guard, and the global Save reported "Settings saved" while the retry edit sat unsaved.

- [x] 9.1 Register the section as a draft source — `useSettingsDraftSource({id:"pi-retry", page:"sessions", isDirty, commit, reset})`; track the loaded policy as the dirty baseline
- [x] 9.2 Delete the private Save button, its `saving` state and `onSave`; keep the `reloadedSessions` status line (the generic bar cannot express it)
- [x] 9.3 `commit` THROWS on invalid input and on a failed PUT so `Promise.allSettled` in the host keeps the source dirty and names it in `settings.savePartialFail`
- [x] 9.4 `reset` restores the loaded policy so the panel's Discard works
- [x] 9.5 Move the section from the `providers` tab to `sessions`; keep the registered `page` in sync with the mount tab
- [x] 9.6 Title the enclosing section "Retry" (not "Provider Retry" — 3 of 6 fields are turn-level) and delete the body's duplicate `<h3>`, which rendered the title twice
- [x] 9.7 Rewrite the 4 button-driven tests to drive the registry contract via a capturing `SettingsDraftProvider`; add coverage for: registers on `sessions`, no private Save button, clean-on-load, dirty-after-edit, clean-after-commit, Discard restores, failing PUT rejects + stays dirty, unregisters on unmount
- [x] 9.8 Extend `specs/pi-retry-settings/spec.md` with the Sessions-placement + unified-Save requirement and its scenarios
- [x] 9.9 Run the rewritten suite — DONE: CI ran the full suite green on the merged branch (11,772 tests, `pnpm install` present in CI). The worktree-local `dashboard-plugin-runtime` resolution gap (§7.1) never affected CI. Behaviour also verified live on the harness (dirty dot on Sessions, unified Save wrote `maxRetries: 11`, unrelated keys preserved, no project `settings.json`).
- [x] 9.10 Correct the stale `docs/architecture.md` claims (DocScribe) — DONE in commit `1a34d5ea` (docs(architecture): correct three false retry claims): `retry.provider.*` surfaced, the write covers all six fields, and the editor lives on the Sessions tab with no private Save.

## 8. Docs

- [x] 8.1 Delegate to DocScribe (caveman style): document pi's retry ownership, the `baseDelayMs · 2^(n-1)` curve and its uncapped tail, the corrected bridge observation model (`agent_end` per attempt, `agent_settled` terminal), the settings write + reload-on-save, and the collapse-vs-dismiss rule in `docs/architecture.md`
- [x] 8.2 Apply the returned tree rows: `packages/client/src/components/session/SessionBanner.tsx.AGENTS.md`, `packages/extension/src/retry-tracker.ts.AGENTS.md`, `packages/extension/src/abort-latch.ts` row, and a row for the new server settings module
