## Why

The dashboard can leave a retry/error banner visible after pi automatically resumes and completes successfully because the observed retry lifecycle does not treat pi-owned continuation as recovery. The same surface can also survive a user abort, implying that retry work remains active when the user explicitly stopped it.

## What Changes

- Recognize pi's automatic post-retry continuation without requiring a new user message.
- Clear retry state and the associated error after the first confirmed non-error assistant completion in the resumed attempt.
- Keep retry/error state active across failed attempts and expose a settled error only after retries stop or are unavailable.
- Offer Retry on every settled provider error by triggering a new non-user turn on the active session without replaying or duplicating the prior user message.
- Show Retry plus the trailing X only for settled errors; while retrying, use the existing collapse affordance instead of a dismiss action.
- Hide the retry/error banner after user abort and ignore late retry lifecycle events that would reopen it.
- Enforce a terminal-state invariant: once retrying stops, a provider error is settled with Retry + X, while success, abort, or confirmed session termination auto-hides; no visible banner can become stuck without a valid closing path.
- Clear retry/error presentation on confirmed clean shutdown or force-kill (`session_removed`) while preserving it across a temporary bridge/network disconnect that can reconnect. Existing orphan-process reporting remains separate.
- Add synthetic event tests for both dashboard error-entry channels and every terminal transition: automatic resume success, retry exhaustion, non-retried error, missing disposition, manual Retry success/failure, abort, late-event races, confirmed process termination, orphan notification followed by removal, and temporary disconnect. Tests emit typed events directly and never inspect session JSON.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `provider-retry-state`: Define successful pi-owned continuation, retry-chain completion, and abort suppression across observed bridge events.
- `error-detection`: Clear errors only on confirmed automatic or user-started recovery, retain terminal errors after exhaustion or no-retry outcomes, and offer one-shot Retry on every settled provider error.
- `session-status-banner`: Restrict X to settled errors, use collapse while retrying, and hide the surface after user abort.

## Discipline Skills

- `systematic-debugging`: Preserve the event-channel root cause and verify the fix with synthetic lifecycle sequences.
- `scenario-design`: Derive state-transition and error-channel scenarios before authoring tests.
- `review-code`: Review the non-trivial extension/client lifecycle diff after related tests pass.

## Impact

- Bridge retry observation and active-session retry dispatch in `packages/extension/src/retry-tracker.ts`, `packages/extension/src/bridge.ts`, and `packages/extension/src/command-handler.ts`.
- Client retry/error reduction in `packages/client/src/lib/chat/event-reducer.ts` and confirmed-termination handling in `packages/client/src/hooks/useMessageHandler.ts`.
- Banner state and controls in `packages/client/src/components/session/SessionBanner.tsx`, `packages/client/src/hooks/useSessionActions.ts`, and `packages/client/src/App.tsx`.
- Focused Vitest coverage in the existing extension and client retry/banner test files.
- No protocol expansion, transcript parsing, provider-error regex duplication, dependency change, or live-dashboard test.
