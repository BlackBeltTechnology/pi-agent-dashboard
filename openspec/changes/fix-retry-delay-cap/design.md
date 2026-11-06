# Design

## Context

- pi `AgentSession._prepareRetry` (`pi-coding-agent/dist/core/agent-session.js:3101`) → `retryDelayMs(settings, attempt)` (pi-ai `dist/utils/retry.js`): `delay = base · 2^max(0, n-1)`; non-safe-integer → `MAX_SAFE_INTEGER`; result `min(delay, maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS /* 60000 */)`. Present in pi-ai 1.3.0 (repo `node_modules`) and 1.4.0 (global install), so the cap covers every pi-ai version the peer floor `>=1.3.0` admits. `settings` = `SettingsManager.getRetrySettings()` = `{enabled, maxRetries, baseDelayMs, maxAgentDelayMs}`.
- The dashboard copies the formula in three places, none of them capped:
  - `packages/extension/src/retry-tracker.ts` `delayFor()`: banner countdown.
  - `packages/client/src/components/settings/RetrySettingsSection.tsx` `computeSchedule()`: settings preview and long-tail warning.
  - (`pi-retry-settings.ts` reads only `enabled/maxRetries/baseDelayMs`.)
- Example from a live session: `baseDelayMs 2700`, attempt 10 → the dashboard shows 1382 s, while pi waits 60 s.
- The repo-installed `@earendil-works/pi-ai@1.3.0` already exports `retryDelayMs` and `DEFAULT_MAX_AGENT_RETRY_DELAY_MS` from its main entry. Static TS imports from pi-ai don't resolve (`.ts`-extension re-exports; see `provider-register.ts.AGENTS.md`). The established pattern is a runtime `await import("@earendil-works/pi-ai")` (`bridge.ts` `loadStreamSimple`).
- Server `packages/server/src/pi-agent-settings.ts` already has a `maxAgentDelayMs` validation rule for the raw-JSON editor (line ~240). The typed retry policy path (`PI_RETRY_DEFAULTS`, policy reader ~445, `validate` ~469, writer ~534) does not include it.
- `PUT /api/pi-retry` already reloads connected sessions: `pi-retry-routes.ts:69` → `server.ts:2812` `reloadConnectedSessions` → `dispatchReload(id)` → pi `AgentSession.reload()` (`agent-session.js:2998`), which calls `settingsManager.reload()`, invalidates the old extension runner and calls `_resourceLoader.reload()` (`agent-session.js:2998-3010`), re-loading extensions and re-running bridge activation (`bridge.ts:379`) and rebuilding `RetryTracker`. No staleness fix is needed.
- Typed writer `pi-agent-settings.ts:515-536` spreads `existingRetry` and then sets `enabled/maxRetries/baseDelayMs/provider` explicitly, so unknown retry keys survive and a missing block is created.

## Goals / Non-Goals

**Goals:**
- The bridge's emitted `delayMs` matches pi's actual sleep for every attempt.
- The preview's per-attempt delays and total match pi's.
- Users can see and edit `retry.maxAgentDelayMs`.

**Non-Goals:**
- Server-requested delays (`retry-after`) in the provider layer. That wait is invisible by spec and stays that way.
- Changing the reload-on-save behaviour.
- Any client reducer or banner rendering change. The banner already renders whatever `delayMs`/`nextAttemptAt` it receives.

## Decisions

### D1: Prefer pi-ai's `retryDelayMs` at runtime, with a local capped fallback

The `RetryTracker` constructor gains an optional injected `delayFn: (policy, attempt) => number`. `bridge.ts` constructs the tracker synchronously as it does today, then kicks off `import("@earendil-works/pi-ai").then(install, () => {})`. The rejection is always swallowed, so a missing optional peer never surfaces as an unhandled rejection. When the import exposes a `retryDelayMs` function, it is installed on the tracker (`tracker.setDelayFn(fn)`). Otherwise the tracker keeps its local `cappedDelay`, a line-for-line mirror of pi-ai `retryDelayMs`: the `Math.max(0, n-1)` exponent clamp, the `Number.isSafeInteger` → `MAX_SAFE_INTEGER` guard, then `min(·, maxAgentDelayMs ?? 60000)`.

Every call goes through one guarded wrapper in `delayFor`, which keeps the existing dashboard guards around pi's arithmetic:
1. Pre-guard (unchanged from today, `retry-tracker.ts:109`): `baseDelayMs <= 0` (including the parse-failure sentinel `0`) or `attempt < 1` → `0` (elapsed-only). pi's function is never consulted for these.
2. `try { v = fn(policy, n) } catch { v = cappedDelay(policy, n) }`; a non-number `v` → `cappedDelay(policy, n)`.
3. Post-guard: `!Number.isFinite(v) || v < 0` → `0`. A negative cap (pi sleeps ≈ 0) therefore renders elapsed-only rather than a negative countdown.

`setDelayFn` stores the raw function, and the wrapper alone guarantees safety.

- Why runtime delegation: if pi changes the curve again (jitter, a new cap), the dashboard follows automatically.
- Why keep a fallback: pi-ai is an optional peer, the import is async, and the tracker's API must stay synchronous. The fallback produces identical values for current pi, so the brief window before the import resolves is harmless.
- Rejected: a static import, because TS can't resolve pi-ai's `.d.ts` in this repo.
- Rejected: a local copy only. That is how this bug happened in the first place.
- Guard: whichever function is used, a non-finite or negative result maps to `0` (the existing elapsed-only contract).

### D2: `readPiRetrySettings` reads `maxAgentDelayMs`

`PiRetrySettings` gains `maxAgentDelayMs` (default `60000` when absent or non-numeric; any finite number is accepted, negatives included, because pi applies it via `??`). Negative results are neutralised by the D1 post-guard, not by the reader. The reader mirrors what pi obeys, not what the dashboard validator would accept. pi applies any number via `??`, so a hand-written `1.5` is honored for display just as pi honors it, even though the UI would refuse to save it. It follows the same global → project precedence as the other keys. On parse failure, the existing behaviour (`baseDelayMs: 0` → elapsed-only) is unchanged.

### D3: Client preview uses the same capped formula, locally

The client can't import pi-ai (browser bundle, no peer). `computeSchedule(maxRetries, baseDelayMs, maxAgentDelayMs)` applies the local cap. Iteration is bounded: the loop runs only until the delay reaches the cap or `PREVIEW_STEPS`, and the rest of the total is computed in closed form (`remaining × cap`). A legal huge `maxRetries` therefore never makes the preview O(n). Both the per-step sequence and the `… → <last>` tail step (today an uncapped `base · 2^(maxRetries-1)` at `RetrySettingsSection.tsx:65`) use the capped delay. The long-tail warning (`RetrySettingsSection.tsx:220-240`) reads the capped `totalMs`. The function also returns `capFromAttempt`, the first attempt whose uncapped delay exceeds the cap, or `null`, so the UI can render the clamp notice (spec: "Clamping is disclosed"). The formula is duplicated in two places (the extension fallback and the client), each with a comment pointing to pi-ai `retry.js`. A shared helper in `packages/shared` is not justified for one `Math.min` line, and the extension prefers pi's function anyway. **Drift guard:** the extension (pi-ai is a declared peer) has a parity unit test that dynamic-`import()`s `retryDelayMs` from the repo's hoisted `@earendil-works/pi-ai`. It asserts that the raw `cappedDelay` mirror (not the guarded `delayFor` wrapper) equals it across a grid of `(base, cap, attempt)`, including attempt 0, a huge attempt, and cap 0. The client does not import pi-ai, not even in tests. Its `computeSchedule` is checked against pinned vectors copied from that grid, so the browser package keeps no undeclared dependency. The next pi curve change turns the extension test red, and the pinned vectors are updated alongside.

### D4: Server typed policy gains `maxAgentDelayMs`

The change follows the existing field pattern: defaults, reader, validator (non-negative integer, consistent with the raw-editor rule at `pi-agent-settings.ts:240`), writer, and the `PiRetryPolicy` type in `pi-retry-api.ts`. The writer adds `maxAgentDelayMs: policy.maxAgentDelayMs` next to `baseDelayMs` inside the existing `{...existingRetry, …}` spread (`pi-agent-settings.ts:529-535`), so unknown-key preservation is unchanged. The client field uses the shared settings field kit (accessible name + description, `ms` unit chip), as `settings-panel` requires.

## Risks / Trade-offs

- [A future pi-ai changes `retryDelayMs`'s signature] → The tracker calls it with `{baseDelayMs, maxAgentDelayMs}` and `attempt`, the same shape pi itself uses. A thrown error or non-number result falls back to the local formula.
- [Project `.pi/settings.json` overrides the global cap] → pi and the bridge both honor it, while the global-only editor (an existing contract) can't show it. A project override can therefore still make a global edit look ignored. This is accepted as a trade-off: it is pre-existing for `baseDelayMs`/`maxRetries` too, and a project-scope surface is explicitly forbidden by `pi-retry-settings`.
- [Async `setDelayFn` lands mid-chain] → Earlier attempts use the fallback and later ones use pi's function. The values are identical (parity test), so the switch is invisible. A late import resolving onto a tracker discarded by reload only mutates garbage. Accepted.
- [A future pi makes `retryDelayMs` non-deterministic (jitter)] → The bridge's call and pi's sleep would then differ. The parity test fails on any non-pure curve, which forces a design revisit. Accepted.
- [Sessions not connected to the dashboard (plain terminal pi) keep their old policy until restarted] → Pre-existing, and already disclosed by the "Global scope is disclosed" scenario. Out of scope.
- [`maxAgentDelayMs: 0`] → pi retries back-to-back. This is a legal pi value, `maxRetries` still bounds it, and it is written only through the authenticated settings route. Accepted, not blocked.
- [Older pi ignores a written `maxAgentDelayMs`] → It's harmless: pi treats it as an unknown key.

## Migration Plan

Deploy-only. Extension → `npm run reload`; server → restart; client → build + restart. Rollback = revert. No persisted data changes besides an optional new key in `~/.pi/agent/settings.json`.
