## 1. Protocol

- [x] 1.1 Widen `BrowserRelayTabStatus.reason` to `"devtools" | "no-session"` in `packages/shared/src/browser-protocol.ts` (update the doc comment); verify `npx tsc --noEmit -p packages/shared` passes.

## 2. Relay server (TDD)

- [x] 2.1 Add failing tests in `relay/__tests__/relay-instance.test.ts`: a known tab without a session is listed `detached/no-session`; devtools reason wins over no-session; verify they fail, then implement the `tabList()` precedence (D1) and verify they pass.
- [x] 2.2 Add a failing test: attaching the agent to a `no-session` tab (via fake CDP client + `FakeExtension`) triggers exactly one `onStatusChange` with the new state; implement `lastViewableSig` recompute (D2) and verify it passes.
- [x] 2.3 Add a failing test: subscribe to a `no-session` tab sends no `Page.startScreencast` and appends a `viewer-subscribe-refused` audit row with `reason:no-session`; add the `AuditKind`, implement (D4), verify it passes.
- [x] 2.4 Update `packages/browser-plugin/src/server/relay/AGENTS.md` rows for `relay-instance.ts` (+ `server/AGENTS.md` for `audit.ts`) with `See change: fix-browser-live-view-subscribe-and-reopen`.

## 3. Plugin client (TDD)

- [x] 3.1 Add failing tests in `LiveViewTile.test.tsx`: `no-session` status renders the no-session overlay (not "Waiting for frames…") and blocks input; a `detached/no-session → live` transition sends exactly one new `browser_relay_subscribe`; implement (D3) and verify they pass.
- [x] 3.2 Add failing tests in `BrowserRelayBadge.test.tsx` + a `relay-store` test: after `dismissLiveView()`, clicking (and Enter/Space on) the badge button makes `isLiveViewActive()` true again and does not stop click propagation; implement `reopenLiveView()` + button (D5) and verify they pass.
- [x] 3.3 Add i18n keys (`noSessionOverlay`, `reopenLiveView`) with `zh-CN`/`hu` parity; verify `i18n.test.ts` passes.
- [x] 3.4 Update `packages/browser-plugin/src/client/AGENTS.md` rows (`relay-store.ts`, `LiveViewTile.tsx`, `BrowserRelayBadge.tsx`).

## 4. Shell gate

- [x] 4.1 Add a failing client test: with an idle selected session, a `bumpSlotClaimsVersion()` after a predicate flips true renders the content-view claim instead of chat; extract `SessionContentGate` using `useSlotClaimsVersion()` (D6) and verify it passes.
- [x] 4.2 Update the `App.tsx` row in `packages/client/src/App.tsx.AGENTS.md` (and add a row for the new component file in its directory `AGENTS.md`).

## 5. Verification

- [x] 5.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify no failures.
- [x] 5.2 `npm run build && curl -X POST http://localhost:8000/api/restart`; with the relay connected to only the extension connect page, verify at ≥768×600 the tile shows the no-session overlay, and after the agent navigates a tab, frames stream without reload.
- [x] 5.3 Press Close, then click the "N browser tabs" badge; verify the live view re-opens and the session stays selected.
- [x] 5.4 Run `review-code` on the diff before commit.
