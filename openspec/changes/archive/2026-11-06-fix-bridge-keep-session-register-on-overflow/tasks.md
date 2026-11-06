## 1. Root cause

- [x] 1.1 Reproduce: resume/fork of a large session ends with the spawn-register watchdog firing; the gateway logs `connection closed` for the session but never `session registered`
- [x] 1.2 Run the bridge headless against the session file and capture stderr; confirm `[bridge] dropped buffered message (ring overflow) hop=bridge→server`
- [x] 1.3 Confirm in `lifecycle.ts` that `session_register` is buffered before the replay frames, so it is the oldest frame and the first evicted

## 2. Fix

- [x] 2.1 Write a failing test in `packages/extension/src/__tests__/connection-dropped-frames.test.ts`: a `session_register` buffered after another frame survives an overflow of later frames, and the newest frame is retained
- [x] 2.2 In `ConnectionManager.bufferMessage` (`packages/extension/src/connection.ts`), evict the oldest non-`session_register` frame instead of `buffer.shift()`
- [x] 2.3 Protect `session_unregister` the same way (a session switch sends it before the new register); add a test that both survive overflow in order
- [x] 2.4 Keep the dropped-frame counter and the rate-limited warning unchanged; existing tests in the same file stay green

## 3. Spec and docs

- [x] 3.1 Delta spec for `incremental-event-sync` ("Drop-site delivery instrumentation") with the lifecycle-frame exemption scenarios
- [x] 3.2 Add the behaviour to `packages/extension/src/connection.ts.AGENTS.md` with `See change: fix-bridge-keep-session-register-on-overflow`
- [x] 3.3 `openspec validate fix-bridge-keep-session-register-on-overflow --strict`

## 4. Verification

- [x] 4.1 `vitest run packages/extension/src/__tests__/connection-dropped-frames.test.ts packages/extension/src/__tests__/connection.test.ts`
- [x] 4.2 Manual: resume and fork of a large session register within the watchdog window and appear under their own cwd
