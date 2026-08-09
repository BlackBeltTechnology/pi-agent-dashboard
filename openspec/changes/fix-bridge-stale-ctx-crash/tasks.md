# Tasks — fix-bridge-stale-ctx-crash

## 1. Ground truth

- [x] 1.1 Confirm the four `ctx.ui` touch points reachable from `autoStartServer` in `packages/extension/src/bridge.ts`: `notify:` (~2559), `onLaunchStart` → `ctx.ui.setWidget` (~2566), `onLaunchEnd` → `stopSpinner` (~2589), and the terminal `.then()` (~2605) / `.catch()` (~2610) → `stopSpinner` (~2547).
- [x] 1.2 Confirm staleness is NOT observable on the public pi surface: `ExtensionRunner.assertActive()` throws, `staleMessage` is internal, and there is no `isActive`/`isStale` predicate. This is why the guard must attempt-and-swallow rather than test-then-call.
- [x] 1.3 Confirm the invalidation origin: `AgentSession.dispose()` → `_extensionRunner.invalidate(...)` in `dist/core/agent-session.js`, so ANY session replacement/reload/dispose arms the throw.
- [x] 1.4 Record the package's unit-test idiom for `bridge.ts` (pure mirror, no bridge import — see `packages/extension/src/__tests__/bridge-system-followup.test.ts`), since it dictates where the guard must live to be testable.

## 2. Tests first (red) — folded from test-plan.md

Author these before the fix and verify each fails. Extend `packages/extension/src/__tests__/` (see `bridge-system-followup.test.ts` for the pure-mirror harness glue).

- [x] 2.1 Stale ctx, spinner teardown in a promise continuation: teardown returns normally, no throw, and no unhandled rejection after flushing ~20 setImmediate cycles (test-plan #E1)
- [x] 2.2 Stale ctx, `notify` invoked with a failure message: returns normally, message dropped (test-plan #E2)
- [x] 2.3 Stale ctx, spinner mount runs: mount skipped without throwing (test-plan #E3)
- [x] 2.4 Live ctx parity: mount → notify → teardown each reach `ctx.ui` with unchanged arguments, teardown calls `setWidget` with `undefined` (test-plan #E4)
- [x] 2.5 Non-invalidation error from auto-start logic is NOT swallowed by the UI guard — it reaches the caller (test-plan #E5)
- [x] 2.6 Teardown invoked twice with the ctx stale on the second call: interval cleared exactly once, second call is a safe no-op (test-plan #E6)
- [x] 2.7 Verify every test in section 2 fails before the fix is applied.

## 3. Implement

- [x] 3.1 Add a small guard helper in `packages/extension/src/bridge.ts` that runs a `ctx.ui` thunk and swallows ONLY the invalidation throw. Document why attempt-and-swallow is the only option (1.2) and why dropping the UI work is correct (the session it targeted is gone).
- [x] 3.2 Apply it at the `notify:` callback.
- [x] 3.3 Apply it at `onLaunchStart`'s `ctx.ui.setWidget` mount.
- [x] 3.4 Apply it inside `stopSpinner`, so both `onLaunchEnd` and the `.then()`/`.catch()` safety net are covered. Clear `spinnerTimer` BEFORE the guarded `ctx.ui` call so the interval is released even when the ctx is stale.
- [x] 3.5 Confirm the guard wraps ONLY `ctx.ui` access — auto-start's own errors must still reach the existing `.catch()`.

## 4. Verify

- [x] 4.1 Prove the teeth: temporarily revert 3.1's guard, confirm 2.1 goes RED, restore, and confirm `git diff --name-only | grep -v __tests__` is empty afterwards.
- [x] 4.2 `HOME=$(mktemp -d) npx vitest run packages/extension` — green.
- [ ] 4.3 Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`; diff the failure set against the pre-change baseline — zero new failures.
- [ ] 4.4 Docker harness: `tests/e2e/faux-text.spec.ts` transitions RED → GREEN (test-plan #F1).
- [ ] 4.5 Docker harness: `tests/e2e/faux-ask.spec.ts` transitions RED → GREEN (test-plan #F2).
- [x] 4.6 `npm run quality:changed`.
- [x] 4.7 `npx openspec validate --changes fix-bridge-stale-ctx-crash --strict`.
- [x] 4.8 Update `packages/extension/src/bridge.ts.AGENTS.md` (or the nearest directory `AGENTS.md`) with the guard's purpose and the pi>=0.84 invalidation contract.
- [ ] 4.9 Run `review-code` on the diff before commit.
