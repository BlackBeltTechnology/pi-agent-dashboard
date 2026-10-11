## 1. Tests first (red)

- [ ] 1.1 Extend `packages/client/src/components/editor-pane/__tests__/LiveServerViewer.test.tsx` (exemplar: its existing D7 test) with an exact sandbox token-set assertion. Triple: `LiveServerViewer` rendered with `startLiveServer` mocked to `/live/abc12345/` · confirm `http://localhost:5173` · sandbox split on whitespace equals exactly {allow-scripts, allow-forms, allow-popups, allow-downloads}, with no `allow-same-origin`, no `allow-downloads-without-user-activation` and no duplicates (test-plan #E1)
- [ ] 1.2 Author `tests/e2e/live-server-downloads.spec.ts` (harness exemplar: `tests/e2e/canvas-declare-tool.spec.ts`, which already uses `page.route("**/live/**")`, plus a routed `/api/live-server/start`) with a user-gesture export test. Triple: `/live/**` fulfilled with fixture HTML whose `#export` button clicks a blob `<a download="tuning.json">` with body `{"k":1}` · Playwright clicks `#export` inside the `live-iframe` frame · page emits `download`, `suggestedFilename()` is `tuning.json` and the saved content is exactly `{"k":1}`. Verify it is red before the fix (test-plan #F1)
- [ ] 1.3 In `tests/e2e/live-server-downloads.spec.ts` (exemplar: `tests/e2e/canvas-declare-tool.spec.ts`), add a no-activation test. Triple: fixture HTML whose `load` handler clicks a blob `<a download="auto.json">` via `setTimeout(…,0)` with no user gesture · open the routed live-server pane and wait for iframe load · no `download` event within 3000ms and `live-iframe` still attached (test-plan #E2)
- [ ] 1.4 In `tests/e2e/live-server-downloads.spec.ts` (exemplar: `tests/e2e/canvas-declare-tool.spec.ts`), add a D7 hostile-embed test. Triple: the fixture page attempts `localStorage.getItem("x")` and records `window.origin` · iframe load · frame-evaluated results are `SecurityError` and `"null"` (test-plan #X1)

## 2. Sandbox

- [ ] 2.1 Add `allow-downloads` to the `LiveServerViewer` iframe sandbox (`packages/client/src/components/editor-pane/LiveServerViewer.tsx:141`). Leave `allow-same-origin` and `allow-downloads-without-user-activation` absent. Turns 1.1 and 1.2 green
- [ ] 2.2 Update the `LiveServerViewer.tsx` module header (`:7`) and the inline D7 comment (`:139`) to give the 4-token set and to state that `allow-downloads` grants user-initiated downloads, not an origin

## 3. Doc sync

- [ ] 3.1 Update the stale sandbox text in the `packages/server/src/live-server/live-server-proxy.ts:5` header comment (comment only, no behaviour change)
- [ ] 3.2 Update the `LiveServerViewer.tsx` row in `packages/client/src/components/editor-pane/AGENTS.md` to the 4-token set and add `See change: live-viewer-allow-downloads`
- [ ] 3.3 Update `packages/extension/.pi/skills/canvas-webapp/SKILL.md` (`:16`, `:48`, `:101`) so its self-verify harness uses the exact 4-token dashboard sandbox, and update its `SKILL.md.AGENTS.md` row
- [ ] 3.4 Add rows for `tests/e2e/live-server-downloads.spec.ts` in the nearest `tests/e2e` AGENTS record

## 4. Manual verification

- [ ] 4.1 Electron shell: in packaged `pi-dashboard.app`, open deck3d in the live-server pane and click Export. A native save dialog appears and the saved file holds the tuning (test-plan: manual-only, #M1)
- [ ] 4.2 Remote tunnel + Firefox: click Export in an embedded loopback app over the zrok tunnel (Chrome) and over localhost (Firefox). The browser download UI shows the file in both (test-plan: manual-only, #M2)
