# Proposal

## Why

The retry banner shows made-up countdowns, for example "Retry 10 · 1377s", while pi actually retries about 60 s later. pi (via pi-ai ≥1.3.0, the extension's peer floor) caps the agent-level delay at `retry.maxAgentDelayMs` (default `60000`) through pi-ai's `retryDelayMs`. The dashboard keeps its own copy of the formula, `baseDelayMs · 2^(attempt-1)`, without the cap. Each new attempt then shows an even larger countdown, and the user loses trust in the surface. The same uncapped formula drives the Retry settings preview, and that page never shows the cap. A user who raises `baseDelayMs` therefore sees nothing change once the cap applies, so their edits look ignored.

## What Changes

- The bridge computes `delayMs` with pi's own capped formula. It imports `retryDelayMs` from `@earendil-works/pi-ai` when that export exists. Otherwise it falls back to a local copy that mirrors pi-ai exactly: `min(safe(baseDelayMs · 2^max(0, n-1)), maxAgentDelayMs ?? 60000)`.
- `readPiRetrySettings` also reads `retry.maxAgentDelayMs` (global → project precedence, the same as the other retry keys).
- The Retry settings surface adds a seventh native field, `retry.maxAgentDelayMs` (default `60000`, non-negative integer), with server-side validation and a merge-preserving write.
- The schedule preview and the total-wait / long-tail warning use the capped delay. When the cap clamps the curve, the surface says so.
- Out of scope: "settings not applied". Saving already reloads every connected session (`PUT /api/pi-retry` → `reloadConnectedSessions`), so nothing needs to change there. The apparent "no effect" came from the hidden cap, which this change exposes.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `bridge-retry-observability`: the synthesized `delayMs` follows pi's capped formula (`maxAgentDelayMs`) instead of an uncapped `2^n`.
- `pi-retry-settings`: the native field set grows from six to seven (`retry.maxAgentDelayMs`), with a validation rule, and the delay-curve disclosure follows the cap.

## Discipline Skills

- `review-code`: a non-trivial change across extension, server, and client; run it before commit.
- No `security-hardening`, `performance-optimization`, or `observability-instrumentation` trigger. The change adds no new endpoint, auth path, or untrusted-input path, only a new field on an existing validated, authenticated route. `maxAgentDelayMs: 0` (no wait) is a legal pi value, and `maxRetries` still bounds the number of attempts, so it cannot cause an unbounded loop.

## Impact

- `packages/extension/src/retry-tracker.ts`: `delayFor` delegates to the capped formula. `RetrySettings` gains `maxAgentDelayMs`.
- `packages/extension/src/pi-retry-settings.ts`: reads `retry.maxAgentDelayMs`.
- `packages/extension/src/bridge.ts`: no structural change. The tracker is still built once per activation, and the reload-on-save path refreshes it.
- `packages/server/src/routes/pi-retry-routes.ts` and its validator/writer: accept, validate, and persist `maxAgentDelayMs`.
- `packages/client/src/lib/api/pi-retry-api.ts`: adds `maxAgentDelayMs` to the policy type and defaults.
- `packages/client/src/components/settings/RetrySettingsSection.tsx`: new field, capped `computeSchedule`, cap disclosure.
- Dependency: optional runtime use of `retryDelayMs` from the `@earendil-works/pi-ai` peer. There is no version bump, and older pi-ai versions use the fallback.
