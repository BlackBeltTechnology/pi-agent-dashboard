## 1. Stabilize ChatView props in App

- [ ] 1.1 Add a module-level frozen `EMPTY_STEERING` constant in `packages/client/src/App.tsx` (mirror the existing `EMPTY_IMAGES` pattern) and use it for `pendingSteering` instead of `... ?? []`.
- [ ] 1.2 Convert the `onCollapseStreamingThinking` inline arrow to a `useCallback` with deps `[selectedId, setSessionStates]`.
- [ ] 1.3 Convert the `onForkFromMessage` inline arrow to a `useCallback` with deps `[selectedId, handleResumeSession]`.
- [ ] 1.4 Convert the `onCloseInlineTerminal` inline arrow to a `useCallback` with deps `[selectedId, handleCloseInlineTerminal]`.

## 2. Memoize ChatView

- [ ] 2.1 Wrap the `ChatView` export in `packages/client/src/components/ChatView.tsx` as `React.memo(forwardRef(...))`, preserving the `ChatViewHandle` ref contract and the `displayName`.

## 3. Tests

- [ ] 3.1 Add a render-count test proving `ChatView` does not re-render when only `App`-level draft state changes (props referentially unchanged), and DOES re-render when `state` changes. (Spy on render count or use a memo-aware harness.)
- [ ] 3.2 Verify existing `ChatView`, `InputRenderer`, and chat-input tests still pass (`npm test 2>&1 | tee /tmp/pi-test.log`; grep for FAIL).

## 4. Validate

- [ ] 4.1 Type-check: `npm run reload:check` (or `tsc --noEmit`) passes.
- [ ] 4.2 Manual/Profiler check in a long session: React DevTools Profiler shows `ChatView` "Did not render" while typing in the command input; command input no longer lags. (Tested later during ship.)
- [ ] 4.3 Confirm the `ChatViewHandle` ref-driven behavior (auto-scroll / imperative calls) still works after memoization.
