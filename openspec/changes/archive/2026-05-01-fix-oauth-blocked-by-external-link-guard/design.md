## Context

`harden-external-link-handling` (archived) added two layers of protection in `packages/electron/src/main.ts`:

1. `webContents.setWindowOpenHandler` — denies every child BrowserWindow and routes external `target="_blank"` / `window.open` to `shell.openExternal`.
2. `webContents.on("will-navigate", (event, url) => { if (!isSameOriginUrl(url, serverUrl)) { event.preventDefault(); shell.openExternal(url); } })` — defense-in-depth for bare `<a href>` clicks.

Layer 2's predicate is **target-only**: it asks "is the destination of this navigation same-origin as the dashboard?" It does not ask "is the BrowserWindow currently showing the dashboard?" That distinction matters for OAuth/OIDC flows.

### OAuth / OIDC flow analyzed

The dashboard's `/auth/start/:provider` (in `packages/server/src/auth-plugin.ts:164`) does `reply.redirect(provider.authorizeUrl)`. In Electron a server-side 302 fires `webContents.on("will-redirect", ...)`, **not** `will-navigate`. So the first hop into the provider proceeds. The Google login page then loads inside the BrowserWindow.

Once the user is on `accounts.google.com`, Google performs multiple top-level navigations during sign-in (initial form → password challenge → 2FA challenge → consent screen). Per Electron's documented event semantics, those fire `will-navigate` with `targetUrl` = `https://accounts.google.com/signin/v2/challenge/...`. Layer 2's predicate evaluates `isSameOriginUrl("https://accounts.google.com/signin/...", "http://localhost:8000")` → `false` → guard fires → user is bounced to the OS browser.

This is straightforwardly broken. It is also surprisingly hard to detect by code review of `harden-external-link-handling` alone — you have to trace through a real OAuth provider's runtime behavior to see the regression.

### The fix is small and obvious in hindsight

The asymmetry the guard wanted is "dashboard → external is a trap; external → external is just normal page activity." Encode that asymmetry by reading `webContents.getURL()` at the moment `will-navigate` fires:

```
function decideWillNavigate(serverOrigin, currentUrl, targetUrl):
  if !parseable(serverOrigin): return "cancel"        // fail closed
  if currentOrigin && currentOrigin != serverOrigin:
    return "allow"                                     // mid-flight, leave alone
  if isSameOriginUrl(targetUrl, serverOrigin):
    return "allow"                                     // SPA-internal full-page nav
  return "open-external"                               // the trap guard
```

Same external-link protection on the dashboard, OAuth flows preserved.

## Goals / Non-Goals

**Goals**
- Restore dashboard OIDC login (Google, GitHub, generic OIDC) on the Electron build.
- Preserve the trap-guard for the primary failure mode (external link clicked from chat content).
- Pure helper, dependency-free, unit-testable without booting Electron.
- Single source of truth: extend the existing `lib/link-handling.ts` rather than introducing a parallel module.

**Non-Goals**
- Touching `setWindowOpenHandler`. It correctly handles `target="_blank"` and `window.open` for both dashboard and provider pages.
- Touching `MarkdownContent.tsx`. The `harden-external-link-handling` design (relative hrefs stay in-document, only external hrefs add `target=_blank`) is a deliberate UX choice for SPA-internal markdown links.
- Fixing the `MarkdownContent.tsx` rel-spread ordering quirk (where `{...props}` after `rel="noopener noreferrer"` lets a user-supplied `rel="nofollow"` clobber our security tokens). Real but rare; deserves its own change.
- Adding `will-redirect` instrumentation. The current behavior — `will-redirect` proceeds without inspection — is correct for OAuth (the dashboard's own 302 to the provider must be followed). Tightening that path would risk reintroducing the OIDC bug from a different angle.
- Schema-aware filtering of `targetUrl` (e.g. dropping `javascript:` / `data:` in `will-navigate`). `shell.openExternal` already refuses dangerous schemes; the existing flow has shipped this way since `harden-external-link-handling` and we don't want to expand scope.

## Decisions

### Decision 1: Extend `lib/link-handling.ts`, do not introduce a new module

The first sketch of this fix lived in `packages/electron/src/lib/external-navigation.ts`, paralleling `lib/link-handling.ts`. Two helpers in two files for one decision is a maintainability hazard. `link-handling.ts` is the established home; `decideWillNavigate` is added as a sibling export and reuses `isSameOriginUrl` for its same-origin sub-check.

### Decision 2: Read `webContents.getURL()` at the callsite, not via a state machine

We do not maintain a "current navigation context" object in `main.ts`. The Electron API exposes `webContents.getURL()` synchronously inside the `will-navigate` callback, which returns the URL of the currently-displayed page (i.e. the page that initiated the navigation). That's exactly what we need. No state machine, no race conditions.

### Decision 3: `currentUrl === ""` (or unparseable) falls back to leaving-dashboard rules

There is one corner where `webContents.getURL()` returns the empty string: immediately after `loadURL` fires, before the first navigation completes. To minimize surprise we treat unknown current URL as "we're on the dashboard" so the trap guard still fires defensively. Practically this branch is unreachable in production because `loadURL(serverUrl)` is the very last thing in `createMainWindow` and any `will-navigate` after it has a known current URL.

### Decision 4: `setWindowOpenHandler` is unchanged

The `setWindowOpenHandler` callback runs for every `target="_blank"` / `window.open` regardless of which page issued it. Provider device-code flows in `ProviderAuthSection.tsx` rely on this — `window.open(verificationUri, "_blank")` correctly routes to the OS default browser. OAuth providers themselves never use `target="_blank"` for their multi-step login (it's all top-level navigation), so there's no regression on the provider side either.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| A malicious page hosted on a non-dashboard origin (e.g. compromised provider) could now navigate the dashboard window to an arbitrary external URL without intercept. | Acceptable: once the user is off the dashboard, the dashboard SPA is already not running and the user is in the OS browser's trust model anyway. The page can already do anything it wants with `window.location` until the user comes back to the dashboard origin. |
| `webContents.getURL()` returns the URL of the page that initiated the navigation, but in some Electron versions the value during `will-navigate` may be the destination URL, not the source. | Verified against Electron 32 (the dashboard's pinned major). The `webContents.getURL()` accessor returns the URL of the **currently committed** document, which is the source page. The `will-navigate` event fires before commit. |
| Future refactor that loses the `currentUrl` argument or always passes `""` could silently regress to the old broken behavior. | Helper is pure and unit-tested with explicit "unparseable current URL" cases. A test failure on that line would catch the regression. |
| OAuth callback URL has a different origin than the dashboard (e.g. dashboard at `http://localhost:8000`, callback registered as `http://localhost:9000/auth/callback`). | Not a real configuration the dashboard supports — `buildRedirectUri` in `packages/server/src/auth.ts:215` constructs the callback URL from the dashboard's own host:port, so they always match. |

## Migration Plan

None. Pure-additive helper export; runtime behavior changes only for the previously-broken case. No persisted state, no protocol fields, no config keys.

## Open Questions

- Should we also instrument `webContents.on("did-fail-load", ...)` so an OAuth provider returning an error page (e.g. `error=access_denied`) does not leave the BrowserWindow on a stale Google error page indefinitely? Default answer: out of scope. The existing `auth-plugin.ts` callback handler already redirects to `/auth/login?error=...` on token-exchange failure, which lands the user back in the dashboard. Provider-side errors that prevent reaching the callback at all are rare and don't have a well-defined recovery path even in browser-based OAuth.
