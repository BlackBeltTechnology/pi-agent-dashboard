## Why

Clicking a URL inside the dashboard — a link in a chat message, a citation, a URL the agent emitted — can strand the user on an external page with no way back. The failure mode differs by environment, but the root cause is the same: the chat markdown renderer emits bare `<a href>` without `target="_blank"`, and the Electron shell has no `will-navigate` / `setWindowOpenHandler` guards.

- **Electron** (reported in issue #13): the only `BrowserWindow` navigates away from the dashboard. The main menu has Reload but no Back — the user has to force-quit or reload to recover.
- **PWA** with `"display": "standalone"` (`public/manifest.json`): no browser chrome, no URL bar, no back button. Same stranding.
- **Regular browser tab**: the browser back button works, but navigating away discards in-memory UI state unnecessarily.

The existing pattern is already correct in several spots (`InlineMarkdown`, `SessionCard`, `ProviderAuthSection`, `ZrokInstallGuide` all use `target="_blank" rel="noopener noreferrer"`). The main chat renderer `MarkdownContent` — used by `ChatView`, `ThinkingBlock`, `FlowAgentDetail`, `PackageReadmeDialog`, `MarkdownPreviewView`, and all interactive-renderer prompts — simply never overrode the `a` component, so every URL the agent emits inherits react-markdown's default anchor.

## What Changes

- **Client fix**: `MarkdownContent.tsx` adds an `a` component override that renders external links as `<a target="_blank" rel="noopener noreferrer">`. Internal same-origin anchor links (e.g. `#heading-id`) stay in-document. Matches the `InlineMarkdown` pattern.
- **Electron shell hardening** (`packages/electron/src/main.ts` `createMainWindow`):
  - `webContents.setWindowOpenHandler` — intercepts `target="_blank"` / `window.open` calls, routes the URL to `shell.openExternal` (the user's real system browser), and returns `{ action: "deny" }` so Electron doesn't spawn a secondary `BrowserWindow`.
  - `webContents.on("will-navigate", ...)` — allows same-origin navigation (the dashboard itself, including the auth-login redirect at `App.tsx:673`) but calls `event.preventDefault()` + `shell.openExternal(url)` for any external URL. This is a defense-in-depth layer that catches accidental `<a>` without `target="_blank"` in future components and protects against future regressions.
- **No scope creep**: this change is strictly about external link routing. `contextIsolation`, `nodeIntegration`, `webSecurity`, CSP, and permission-request-handler are out of scope and keep their current values.
- **Intentional exceptions preserved**: `App.tsx:673` (`/auth/login?return=...` redirect) stays as a same-origin navigation — both the markdown fix (different component) and the Electron guard (same-origin check) leave it untouched.

## Capabilities

### Modified Capabilities

- `markdown-rendering` — adds a requirement that the `MarkdownContent` component renders external links with `target="_blank" rel="noopener noreferrer"`, while same-document fragment links stay in-place.
- `electron-shell` — adds a requirement that the Electron main `BrowserWindow` routes external URLs through `shell.openExternal` and never allows an external URL to replace the dashboard or spawn a secondary Electron window.

### New Capabilities
_(none)_

## Impact

- **Files touched (production)**: 2
  - `packages/client/src/components/MarkdownContent.tsx` — add `a` component override (~10 lines).
  - `packages/electron/src/main.ts` — add `setWindowOpenHandler` + `will-navigate` handler in `createMainWindow` (~20 lines). Import `shell` from `electron`.
- **Files touched (tests)**: 2
  - `packages/client/src/components/__tests__/MarkdownContent.test.tsx` (new or extended) — asserts external URL in markdown renders with `target="_blank" rel="noopener noreferrer"`, fragment link stays bare.
  - `packages/electron/src/__tests__/link-handling.test.ts` (new) — pure unit test for a small helper like `isSameOriginUrl(href, serverOrigin)` used by both guards. The `BrowserWindow` integration is covered by the helper's truth table; we don't spin up a real Electron in tests.
- **Dependencies**: none added or removed.
- **Documentation**: AGENTS.md gets a one-line entry for the new helper; `docs/architecture.md` gets a short note under the Electron section. `README.md` is unchanged (no user-visible API change — just "links now open in your real browser").
- **Breaking change**: no. User-visible behavior strictly improves: external links open in the system browser (Electron) or a new tab (browser/PWA) instead of replacing the dashboard view.
