## 1. ModelSelector refresh control

- [x] 1.1 Add optional `onRefresh?: () => void` to `ModelSelector` props (`packages/client/src/components/ModelSelector.tsx`).
- [x] 1.2 Add a `refreshing` local state; set true on refresh click, disable the control while true.
- [x] 1.3 Clear `refreshing` when the `models` prop reference changes (new `models_list`) and via a short safety timeout, mirroring the existing `pendingModel` timeout pattern.
- [x] 1.4 Render a footer refresh button (`mdiRefresh`, spins while `refreshing`) in the dropdown, only when `onRefresh` is provided.

## 2. Wire through StatusBar and App

- [x] 2.1 Add `onRefresh?: () => void` to `StatusBar` props and forward it to `ModelSelector` (`packages/client/src/components/StatusBar.tsx`).
- [x] 2.2 In `App.tsx`, pass `onRefresh={() => selectedId && send({ type: "request_models", sessionId: selectedId })}` to `StatusBar` — bypassing the `!modelsMap.has(sid)` guard by design.

## 3. Tests

- [x] 3.1 Unit test (`ModelSelector.test.tsx`): activating the footer control calls `onRefresh`, disables while busy, and the control is absent when `onRefresh` is undefined.
- [x] 3.2 Test that busy state clears on new `models` prop identity and on safety timeout.
- [x] 3.3 Test the App-level handler sends `request_models` for the selected session even when `modelsMap` already has that session.

## 4. Verify

- [x] 4.1 `npm test 2>&1 | tee /tmp/pi-test.log` — new specs pass, no regressions.
  (23 web specs pass incl. new refresh tests; only pre-existing `pi-image-fit-extension` Jimp env failures remain — untouched package.)
- [x] 4.2 Client rebuild + restart (`npm run build` → `POST /api/restart`); manually confirm a live session's dropdown updates after authenticating a provider and clicking refresh. — verified: refresh footer button renders, dropdown updates after provider auth without session restart.
