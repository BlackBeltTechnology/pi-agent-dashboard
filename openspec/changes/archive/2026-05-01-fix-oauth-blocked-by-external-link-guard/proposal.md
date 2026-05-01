## Why

The previously archived change `harden-external-link-handling` (issue #13) added an Electron `will-navigate` guard that intercepts every non-same-origin navigation and routes it through `shell.openExternal`. This correctly closes the "trapped in webview" failure mode where clicking an external link in chat content replaces the dashboard SPA with a chrome-less external page.

However, the guard is too aggressive for **dashboard OIDC login flows** (Google, GitHub, generic OIDC providers — wired through `packages/server/src/auth-plugin.ts` `/auth/start/:provider` → `/auth/callback/:provider`):

1. User clicks `Sign in with Google` → dashboard 302-redirects to `https://accounts.google.com/o/oauth2/v2/auth?...`. This first hop fires `will-redirect` (NOT `will-navigate`) and proceeds; the Google login page loads inside the BrowserWindow.
2. Google's login is multi-step: `accounts.google.com/signin/oauth` → `accounts.google.com/signin/v2/challenge/pwd` → `accounts.google.com/signin/v2/challenge/totp` → etc. Each step is a top-level navigation that fires `will-navigate`.
3. The current guard sees the target as "not same-origin as the dashboard" and `event.preventDefault()`s every provider-internal step, then opens the URL in the user's OS default browser. The user is bounced out of the Electron window mid-login and the OAuth flow can never complete.

The dashboard's own OIDC login is therefore **broken in the Electron build** under any provider that uses multi-step authentication (which is essentially all of them: Google, GitHub for org-protected accounts, Microsoft, Okta, Auth0, etc.).

## What Changes

- **Promote the `will-navigate` guard from "target-only" to "current-origin-aware."** Add a pure helper `decideWillNavigate(serverOrigin, currentUrl, targetUrl): "allow" | "open-external" | "cancel"` to the existing `packages/electron/src/lib/link-handling.ts`. Decision rule:
  - If `currentUrl`'s origin **is not** the dashboard origin → `"allow"` (we're mid-flight on an external page; whatever the page does next is the page's business).
  - If `currentUrl`'s origin **is** the dashboard origin AND `targetUrl` is same-origin → `"allow"`.
  - If `currentUrl`'s origin **is** the dashboard origin AND `targetUrl` is external → `"open-external"` (the existing trap-guard behavior).
  - If the dashboard origin itself is unparseable → `"cancel"` (fail closed).
- **Replace the `isSameOriginUrl(url, serverUrl)` call in `packages/electron/src/main.ts` `will-navigate` callback** with `decideWillNavigate(serverUrl, mainWindow.webContents.getURL(), url)` and dispatch on the three returned actions.
- **Keep `setWindowOpenHandler` exactly as-is**. `target="_blank"` / `window.open(...)` should still always route through `shell.openExternal` regardless of which page issued the call — that path is correct under `harden-external-link-handling` and changing it would defeat the original protection.
- **Keep the `MarkdownContent.tsx` anchor renderer exactly as-is**. The original change's design choice (only set `target=_blank` for external hrefs; let same-origin markdown anchors navigate in-place) is unaffected.
- **Tests**: extend `packages/electron/src/__tests__/link-handling.test.ts` with `decideWillNavigate` coverage (8 new cases). No new test files; no client tests.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `electron-shell`: refine the **External links open in the OS default browser** capability so the `will-navigate` arm is current-origin-aware. The `setWindowOpenHandler` arm is unchanged. Add a new scenario "Mid-flight OAuth / OIDC navigation is not intercepted" and tighten the existing scenario "Top-level navigation pinned to dashboard origin" to scope it to "(when on the dashboard)".

## Impact

- **Code**: `packages/electron/src/lib/link-handling.ts` (one new exported helper), `packages/electron/src/main.ts` (one callback rewritten). No new files. No client changes.
- **Tests**: `packages/electron/src/__tests__/link-handling.test.ts` (8 new cases, all pure-function unit tests).
- **Compatibility**: pure-additive on the helper (the existing `isSameOriginUrl` export is untouched). The runtime behavior of `main.ts` changes only for the case "current page is non-dashboard AND `will-navigate` fires" — previously intercepted (incorrectly), now allowed (correctly). The "current page is dashboard" case is preserved exactly.
- **Security**: the trap-guard for the primary failure mode (`<a href="https://example.com">` clicked from chat content while on the dashboard) is preserved bit-for-bit. The relaxation is scoped to navigations that originate from a non-dashboard page, which is exactly the surface where the user is in an authentication flow they explicitly initiated.
- **Rollback**: revert two files (`lib/link-handling.ts` removes the new export, `main.ts` switches the import back). No persisted state, no protocol fields.
- **Out of scope**: refining `setWindowOpenHandler`, fixing the `MarkdownContent.tsx` rel-spread ordering quirk (where a user-supplied `rel="nofollow"` on a raw HTML anchor clobbers our `noopener noreferrer`), and adding a `target="_blank"` for same-origin markdown anchors. Those are separate design decisions from `harden-external-link-handling` that this change deliberately does not touch.
