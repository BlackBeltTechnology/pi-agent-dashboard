# Tasks

## 1. Reproduce & baseline (systematic-debugging)
- [x] 1.1 Reproduce the stuck modal: load the dashboard on a mobile browser (or throttle + background the tab) with no seeded `displayPrefs`; confirm Skip/Continue do not dismiss → verify: modal remains, PATCH persisted server-side.
- [x] 1.2 Confirm the reload-repro: full page reload dismisses the stuck modal → verify: the PATCH persisted, only the live notification was lost (proves RC1/RC2, rules out RC3 auth-denial for this client).

## 2. RC2 — optimistic local close (client) — PRIMARY, sufficient fix
- [x] 2.1 In `FirstLaunchDisplayModal.tsx`, make `seed(key)` apply `DISPLAY_PRESETS[key]` locally and call `onClose(prefs)` on EVERY path (PATCH 200 / non-2xx / thrown fetch); when the 200 body `{ displayPrefs }` is readable, use it to refine the passed value. Remove the misleading `catch { /* broadcast will reconcile */ }` comment → verify: unit test asserts `onClose` is called with preset prefs even when `fetch` rejects / returns non-2xx.
- [x] 2.2 In `App.tsx`, change the `FirstLaunchDisplayModal` `onClose` from a no-op to `setDisplayPrefs(prefs)` → verify: modal unmounts from local state with no WS message; existing `FirstLaunchDisplayModal.test.tsx` still passes.
- [x] 2.3 Regression guard: a Skip/Continue tap while the PATCH is failing (mock 500 / network error) still closes the modal → verify: test — modal unmounts, `onClose` fired (prevents the strict regression the doubt-review flagged, where reading-response-before-close would strand a failed PATCH).

## 3. RC3 — distinguish failed GET from empty prefs (client)
- [x] 3.1 In `App.tsx` mount fetch, add a distinct `displayPrefsSeedless` flag set true ONLY when `r.ok && body.displayPrefs === undefined` (do NOT rely on `loaded && undefined` — `setDisplayPrefsLoaded(true)` is in `finally` and runs on failed GETs too). Set the modal render gate (App.tsx:1890) to **`displayPrefsSeedless && displayPrefs === undefined`** — NOT the seedless flag alone (cross-model doubt-review: a seedless-only gate would never close on `onClose`/broadcast/snapshot, which all close by defining `displayPrefs`) → verify: unit tests — (a) mocked 403/thrown GET leaves modal unmounted; (b) 200-with-undefined mounts it; (c) after mount, calling `onClose(prefs)` unmounts it; (d) a `display_prefs_updated` WS message unmounts it.
- [x] 3.2 Desktop render parity (IN SCOPE): the modal currently renders at ONE site — `App.tsx:1891`, inside `if (isMobile)`; desktop (`App.tsx:2006+`) has none. Extract a single `firstLaunchModal` element from the shared gate `displayPrefsSeedless && displayPrefs === undefined` (DRY — one `onClose` wiring) and render it in BOTH the mobile return and the desktop return → verify: unit/integration test — with seedless prefs, the modal mounts in the desktop layout AND the mobile layout; the render is NOT gated on `isMobile`.

## 4. RC1 — connect-time snapshot (server)
- [x] 4.1 In `browser-gateway.ts` `wss.on("connection")`, send `display_prefs_updated { prefs }` alongside the `pinned_dirs_updated` / `favorite_models_updated` sends, guarded by `typeof preferencesStore.getDisplayPrefs === "function"` (matching the adjacent `getFavoriteModels`/`getWorkspaces` stub guards) AND only when `getDisplayPrefs()` returns defined → verify: server test asserts a connecting socket with seeded prefs receives the snapshot; a stub PreferencesStore lacking `getDisplayPrefs` does not crash the handshake.
- [x] 4.2 Assert the seedless guard: a connecting socket with `undefined` prefs receives NO `display_prefs_updated` snapshot → verify: server test; first-launch path preserved.

## 5. Verify the full chain (doubt-driven-review)
- [x] 5.1 Re-run 1.1 with the fix: Skip and Continue both close the modal instantly on mobile / non-OPEN socket → verify: modal unmounts without reload.
- [x] 5.2 Simulate a missed broadcast then reconnect (seeded prefs): the connect snapshot flips a stuck client's `displayPrefs` and closes any lingering modal → verify: integration test.
- [x] 5.3 Genuine fresh install: modal opens exactly once, PATCH seeds, no snapshot before seeding → verify: no regression to first-launch.

## 6. Docs & gates
- [x] 6.1 Delegate (Rule 6, caveman style) a `docs/architecture.md` update: `chat-display-preferences` connect-snapshot parity + optimistic-close contract → verify: section present, caveman style.
- [x] 6.2 Run `openspec validate fix-first-launch-display-modal-stuck-on-mobile --strict` → verify: passes.
- [x] 6.3 Code-review + code-quality gates (`review-changes.ts`, `npm run quality:changed`) → verify: clean; `npm test` green.
