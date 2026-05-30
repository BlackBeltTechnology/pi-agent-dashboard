## Why

Clicking the **Changed Files** button in the SessionHeader on desktop navigates to `/session/:id/diff` but the URL change collapses the entire content pane into the global `<LandingPage>` ("Pick a session on the left to continue") instead of rendering `<FileDiffView>`. The session list stays visible on the left; the right pane shows the empty home state. The button is visibly *broken* on desktop, where it ships as the only entry point to the diff view.

Mobile is unaffected — `MobileShell`'s `detailPanel` chain (App.tsx ~1492-1544) handles `diffMatch && diffSessionId` at the top level, before falling back to `sessionDetail`.

Root cause is a route-handling asymmetry in `packages/client/src/App.tsx`:

- `useRoute("/session/:id")` (line 289) is exact-match in wouter — it does NOT match `/session/:id/diff`. So `selectedId = match ? params?.id : undefined` (line 334) becomes `undefined` on the diff sub-route.
- `sessionDetail = selectedId ? (...) : null` (line 1057) collapses to `null` — and the `diffMatch && diffSessionId ? <FileDiffView /> : ...` branch (line 1190) is rendered **inside** `sessionDetail`, so it never runs.
- The desktop fallthrough chain (~1574-1660) lists `archiveMatch`, `specsMatch`, `piResourceFileMatch`, `readmeMatch`, `piResourcesMatch && !selectedId`, `openspecPreviewMatch && !selectedId` at top level — but **omits** `diffMatch`. So nothing handles `/session/:id/diff` outside `sessionDetail`, and the chain falls through to `?? sessionDetail ?? <LandingPage>`.

Fix is one-line: widen `selectedId` to also be set when on the diff sub-route. That makes `sessionDetail` render, and the existing `diffMatch && diffSessionId` branch inside it correctly produces `<FileDiffView>`. As a bonus, `SessionHeader` is rendered above the diff view, matching the mobile UX and giving the user the normal session controls (rename, refresh, attach, etc.) while in the diff view.

## What Changes

- `packages/client/src/App.tsx` line 334: change
  ```ts
  const selectedId = match ? params?.id : undefined;
  ```
  to
  ```ts
  const selectedId = match ? params?.id : (diffMatch ? diffParams?.id : undefined);
  ```
  (`diffMatch` / `diffParams` are already declared 29 lines above at line 305.)
- No other `App.tsx` changes. The existing `diffMatch && diffSessionId ? <FileDiffView />` branch inside `sessionDetail` already does the right thing once `sessionDetail` renders.
- Add a regression test under `packages/client/src/components/__tests__/` (or `src/__tests__/` if App-level fixtures live there) that asserts: render `<App>` at URL `/session/<id>/diff` with a session present in `sessionStates`, verify `<FileDiffView>` is in the document and `<LandingPage>` is not.
- No protocol changes, no server changes, no API changes, no persistence migration. Pure client routing fix.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `file-diff-view`: Strengthen the existing **Content-area integration and button visibility → Activation** scenario so the contract holds on the desktop content-area render path, not just the mobile shell. Add an explicit scenario asserting the diff view renders when the URL is `/session/:id/diff` regardless of viewport size.

## Impact

- **Affected code**:
  - `packages/client/src/App.tsx` — one-line change at line 334. ~1 line modified.
  - `packages/client/src/__tests__/App.diff-route.test.tsx` (new) — regression coverage. Mirrors existing App-level routing tests if any; otherwise minimal smoke test using existing mocks.
- **No server / API / protocol changes**.
- **No persistence migration**.
- **Docs**:
  - `docs/file-index-client.md` — update the `packages/client/src/App.tsx` row purpose to note that `selectedId` derives from both `/session/:id` and `/session/:id/diff` matches. `See change: fix-changed-files-desktop-route`.
  - `AGENTS.md`: no change (this is a per-file detail, lives in the split per the Documentation Update Protocol).
