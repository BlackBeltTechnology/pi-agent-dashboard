## 1. Reproduce

- [x] 1.1 Start `pi-dashboard --dev` (or rely on running instance). Open a session that has called Write/Edit (so `hasFileChanges` is true and the **Changed Files** button is visible in the SessionHeader). Click the button. Verify the URL changes to `/session/<id>/diff` and the right pane collapses to the `<LandingPage>` ("Pick a session on the left to continue") empty state. Capture screenshot for the change folder if useful.

## 2. Add failing regression test

- [x] 2.1 Add `packages/client/src/__tests__/App.diff-route.test.tsx` (create the `__tests__` directory under `src/` if it doesn't exist; otherwise nest under an existing App-level test location). Test setup:
  - Mock `useWebSocket` / `useMessageHandler` / any plugin loader the way other App-level tests do.
  - Seed `sessions` with one session id `S1` and a corresponding `sessionStates` entry where `hasFileChanges = true`.
  - Render `<App>` inside a wouter `<Router base="">` with initial location `/session/S1/diff`.
- [x] 2.2 Assertion: `screen.queryByText(/Pick a session on the left/i)` is `null` AND a `FileDiffView`-identifying element is present (e.g. `data-testid="diff-base-label"` or the literal text `"Changed Files"` from the FileDiffView header). Run; verify it FAILS on `main`.

## 3. Implement the fix

- [x] 3.1 In `packages/client/src/App.tsx`, change line 334 from
  ```ts
  const selectedId = match ? params?.id : undefined;
  ```
  to
  ```ts
  const selectedId = match ? params?.id : (diffMatch ? diffParams?.id : undefined);
  ```
  No other lines touched. `diffMatch` / `diffParams` are already in scope (declared at line 305).
- [x] 3.2 Run the test from 2.2 — verify it now passes.
- [x] 3.3 Run full `npm test` — verify no other tests regress. In particular, scan for tests that assert behavior when `selectedId` is `undefined` on a session route; the diff sub-route is the only newly-covered case.

## 4. Manual verification

- [x] 4.1 `npm run build && curl -X POST http://localhost:8000/api/restart` (or `npm run dev` for HMR). In a session with file changes, click **Changed Files**. Verify the SessionHeader stays visible at the top and `<FileDiffView>` renders below it. Click **Back** in the FileDiffView header — verify return to the chat view in the same session.
- [x] 4.2 Repeat in mobile viewport (Chrome devtools responsive mode, width ≤ 640). Verify mobile behavior is unchanged — diff view still renders correctly via the `MobileShell` path.
- [x] 4.3 Verify other session sub-views (none currently exist, but defensive): navigate manually to `/session/<id>` and confirm chat view still renders normally.

## 5. Update spec + docs

- [x] 5.1 Update `openspec/changes/fix-changed-files-desktop-route/specs/file-diff-view/spec.md` (delta) to reflect the strengthened activation requirement. The delta is already drafted in this change folder during proposal — just verify it matches the implemented behavior.
- [x] 5.2 Update `docs/file-index-client.md` row for `packages/client/src/App.tsx`: append to the purpose field — `selectedId derives from both /session/:id and /session/:id/diff matches. See change: fix-changed-files-desktop-route.` Use caveman style. Delegate this edit to a general-purpose subagent per the Documentation Update Protocol.

## 6. Validate + archive

- [x] 6.1 `openspec validate fix-changed-files-desktop-route --strict` — verify clean.
- [x] 6.2 Commit. PR title: `fix(client): /session/:id/diff route now renders FileDiffView on desktop`. Body: link to this change folder.
- [x] 6.3 After merge, run `openspec archive fix-changed-files-desktop-route` (or use the openspec-archive-change skill).
