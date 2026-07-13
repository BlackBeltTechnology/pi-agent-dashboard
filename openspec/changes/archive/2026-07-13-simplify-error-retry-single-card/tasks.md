## 1. Reducer + selector (client)

- [x] 1.1 Write failing tests in `event-reducer.test.ts`: `deriveBannerState` returns `error.kind: "error"` (never `"limit-exceeded"`) for a `usage_limit_reached` message; composes `{ error, retry }` when both set; `hidden` when neither.
- [x] 1.2 Edit `deriveBannerState` in `packages/client/src/lib/event-reducer.ts`: remove the `USAGE_LIMIT_PATTERN` import + test; `error.kind` is always `"error"`; drop the `limit-exceeded` branch. Verify 1.1 passes.
- [x] 1.3 Confirm `error-detection` clear-on-confirmed-good logic (`message_end` success / clean `agent_end`) still clears `lastError` — no change needed; add/keep a regression test for the auto-clear happy path.

## 2. Observe-based retry tracker (extension/bridge)

- [x] 2.1 Write failing tests in `retry-tracker.test.ts`: an error `message_end` alone emits NOTHING; a following assistant `message_start` (same turn, no user prompt) emits `auto_retry_start { attempt, maxAttempts:-1, delayMs:-1, errorMessage }`; a non-error `message_end` emits `auto_retry_end { success:true }`; a terminal error `agent_end` emits `auto_retry_end { success:false, finalError }`. Include a non-retryable string (context-overflow) that pi does NOT re-attempt → NO `auto_retry_start`.
- [x] 2.2 Rewrite `RetryTracker` in `packages/extension/src/retry-tracker.ts`: delete `RETRYABLE_PATTERN`; record a pending failure on error `message_end`; emit `auto_retry_start` on the next observed assistant `message_start` for the same turn; keep `observeAgentEnd` / `noteAbort`. Verify 2.1 passes.
- [x] 2.3 Update `packages/extension/src/bridge.ts` to drive the tracker from observed `message_start` (add the hook) and remove the `RETRYABLE_PATTERN` code path.

## 3. Remove usage-limit regex + auto-abort (shared/bridge)

- [x] 3.1 Delete the usage-limit auto-abort branch and the `usage-limit-orderer` billing path from `packages/extension/src/bridge.ts` + `packages/extension/src/usage-limit-orderer.ts` (remove the billing `maybeSynthesize`; keep any generic terminal-error ordering the observe-based path still needs).
- [x] 3.2 Remove `USAGE_LIMIT_PATTERN` from `packages/shared/src/error-patterns.ts`; delete the module if no importer remains (grep `USAGE_LIMIT_PATTERN` across `packages/` → zero hits).
- [x] 3.3 Delete/adjust `error-patterns.test.ts` and the usage-limit fixtures (`usage-limit-error-strings.ts`) that only exercise the removed pattern.

## 4. Single-card SessionBanner (client)

- [x] 4.1 Update `SessionBanner.test.ts` (and add cases): asserts ONE card element for error+retry (not two sibling cards); ✕ is clear-only and does NOT call `onAbort` in any state; "Stop (ends the session)" is the only control that calls `onAbort` and is present only while retrying; "Try again" appears only on settled error.
- [x] 4.2 Refactor `packages/client/src/components/SessionBanner.tsx`: merge `ErrorBlock` + `RetryBlock` into one card body (header = error message, sub-line = retry status, thin animated top strip while retrying); remove the `limit-exceeded`/💳 branch + hint; remove `dismissAborts` (✕ = `onDismiss` only); label the Stop button "Stop (ends the session)". Verify 4.1 passes.
- [x] 4.3 Update `SessionBanner.tsx.AGENTS.md` row to describe the single card + clear-only ✕ + `See change: simplify-error-retry-single-card`.

## 5. Wiring: dismiss decoupled, retry via continue (client)

- [x] 5.1 In `packages/client/src/App.tsx`, change the `SessionBanner` `onDismiss` handler to clear `lastError`/`retryState` only (drop the `onAbort` call and the "dismiss also fired onAbort" comment).
- [x] 5.2 Removed the `onRetry` handler entirely (manual retry dropped per apply-time decision; continue-resume infeasible on live idle session): instead of `findLastUserPrompt` + `handleSendPromptToSession`, dispatch `resume mode:"continue"` for the session (gate on `session.status === "ended"`). Confirm no `send_prompt` and no duplicate user message.
- [x] 5.3 Removed the orphaned `findLastUserPrompt` import from App.tsx (function retained — still tested/referenced) (grep first); otherwise leave it.

## 6. Integration + gates

- [x] 6.1 Ran full `npm test` — 9393 passed / 21 skipped, 0 failures.
- [x] 6.2 N/A in worktree: build+restart+reload is a **deploy to the local running instance** step (AGENTS.md: "worktree / Docker-isolated work does not run it"). Integration verified instead via the Docker harness + system-browser Playwright (image build runs `npm run build`; server boots; `error-lifecycle.spec.ts` 3/3 change-relevant tests green). Live deploy happens post-merge on `develop`.
- [x] 6.3 Biome clean on authored files (0 errors) + `tsc --noEmit` exit 0 + full test suite green. (`quality:changed` needs a committed git base; ran the equivalent explicitly.)
- [x] 6.4 CodeRabbit `code-review` gate run on the uncommitted diff (`review-changes.ts`): 0 Critical/Warning (one non-blocking nit, non-reproducing). Nothing blocks commit.

## 7. Verification (Playwright e2e + QA)

- [x] 7.1 Single settled card e2e: `[[faux:model-error]]` → ONE `error-banner`, NO `error-banner-retry`, NO `error-banner-stop`, NO `retry-banner` (`tests/e2e/error-lifecycle.spec.ts` Test 1, system-browser `PW_CHANNEL=chrome`, GREEN). **Retry-sub-line (auto-retry) full-pipeline e2e is INFEASIBLE with the faux harness** — SPIKE finding: a thrown/returned faux error becomes a terminal `stopReason=error` (verified in container log); pi-ai's faux stream never propagates it as the transport-layer exception pi's `_handleRetryableError` re-attempts, so no observed `message_start` retry fires. The retry sub-line + "attempt N" + Stop-while-retrying + clear-only-during-retry are covered by UNIT tests (`SessionBanner.test.tsx`, `retry-tracker.test.ts`, `event-reducer.test.ts`). Driving a real retry would need transport-layer faux-provider surgery (out of scope).
- [x] 7.2 Clear-only ✕ e2e: `[[faux:model-error]]` → click `error-banner-dismiss` → card hidden + session STILL alive (`[[faux:plain-text]]` round-trips in the same session, proving ✕ did NOT abort). `tests/e2e/error-lifecycle.spec.ts` Test 2, GREEN. "Stop aborts" needs the retry state (see 7.1 infeasibility); Stop callback wiring is unit-tested.
- [x] 7.3 OBSOLETE under design D5: manual "Try again" was removed entirely, so a duplicated user message is impossible by construction (no re-send path exists). No e2e needed.

Note: pre-existing `error-lifecycle.spec.ts` Test 3 (deferred-clear across an `ask_user` turn) fails in the local Docker harness because the interactive `ask_user` select widget does not mount (`faux-ask.spec.ts` fails standalone; `faux-tool`/`faux-text` pass) — an environmental interactive-UI issue unrelated to this change (which never touches the ask_user/PromptBus path).
