## 1. Synthetic regression tests first

- [x] 1.1 Extend focused retry-tracker, agent-settled helper, and reducer tests with typed event sequences for automatic continuation success, repeated error, aborted completion, exhaustion, floor-pi pending settles plus expected-attempt reconciliation, and settle without a new assistant disposition (E1–E3, X1–X2, X9).
- [x] 1.2 Extend the focused bridge/command-handler retry tests with abort payload, tracker cancellation, and late-event suppression cases (X3–X4).
- [x] 1.3 Extend `packages/client/src/lib/__tests__/event-reducer.test.ts` and `event-reducer-agent-settled.test.ts` with the terminal decision table: success hides, failure settles with provider error, `finalError` establishes the second error path, missing disposition retains a dismissible error, and duplicate late retry-end stays idempotent (E4–E6, X2, X8).
- [x] 1.4 Extend `packages/client/src/components/__tests__/SessionBanner.test.tsx` with the active/settled/hidden control matrix, collapse-to-terminal convergence, automatic hide, observe-only behavior, and optional Retry callback cases (F1–F5).
- [x] 1.5 Extend focused client, server-routing, and command-handler tests with one-shot hidden retry dispatch, active-bridge non-user turn triggering, no prior-user-message dependency, and failed Retry settling again (E7–E9).
- [x] 1.6 Extend `packages/client/src/hooks/__tests__/useMessageHandler.*.test.tsx` with synthetic `session_removed`, `session_orphaned → session_removed`, and temporary disconnect cases that assert session status plus retry/error cleanup or preservation (F6, X5–X7).
- [x] 1.7 Run only the eight related Vitest targets once, capture output with `tee`, and confirm the new assertions fail for the intended lifecycle gaps before implementation.

## 2. Bridge retry lifecycle

- [x] 2.1 Update the retry tracker so an active chain closes successfully on the first non-error, non-aborted assistant completion regardless of whether a user message started the turn.
- [x] 2.2 Preserve the last provider failure through repeated attempts and terminal settle with no new assistant disposition; never infer success from missing messages.
- [x] 2.3 Make user abort clear active retry tracking and suppress synthesized retry/waiting/terminal events from the cancelled chain until settle or a new explicit run boundary.

## 3. Client terminal convergence

- [x] 3.1 Update retry/error reduction to implement the terminal outcome table: success clears both states, exhaustion/no-retry retains or establishes the provider error, and abort clears the cancelled chain.
- [x] 3.2 Add the minimum scoped cancellation marker needed to ignore delayed events after abort, and reset it on settle or the next explicit run without hiding later provider errors.
- [x] 3.3 Update confirmed `session_removed` handling to mark the session ended and clear retry/error presentation; retain state on disconnect without removal and preserve the existing orphan-process toast.

## 4. Settled error actions

- [x] 4.1 Add a settled-only Retry callback to the banner and render Retry + Copy + X when `lastError` exists without `retryState`; keep Collapse/Expand while retrying and hide on success, abort, or confirmed termination.
- [x] 4.2 Wire Retry through a hidden internal command on the existing active bridge; trigger pi's public non-user custom turn API, do not inspect/resend the previous user prompt, do not process-resume a live carrier, and do not arm a dashboard retry loop.
- [x] 4.3 Ensure local collapsed state resets when retrying stops so a retained provider error always reappears expanded with a valid X.

## 5. Focused verification

- [x] 5.1 Re-run only the ten related retry-tracker, agent-settled, command-handler, active server routing, event-reducer, SessionBanner, Retry action, and useMessageHandler Vitest targets with `set -o pipefail` and `tee`; require every E1–E9, F1–F6, and X1–X9 scenario to pass.
- [x] 5.2 Run `openspec validate fix-retry-error-lifecycle --strict` and resolve any artifact/spec mismatch.
- [x] 5.3 Update nearest source-tree `AGENTS.md` rows for changed behavior or new test files, then run the relevant documentation lint if available.
- [x] 5.4 Run the `review-code` discipline on the scoped diff, fix every blocking finding, and re-run only the affected related test target after each fix.
