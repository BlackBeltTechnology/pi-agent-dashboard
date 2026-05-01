## Context

The reported bug (#13) is "clicking a link opens a webview with no close/back control and the user is stuck." Investigation showed the word "webview" is a symptom-level description — there is no embedded `<webview>` tag in the codebase. The real failure surface is three environments sharing one root cause:

```
                  Click URL in chat message
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │  Browser │  │   PWA    │  │ Electron │
       │   tab    │  │standalone│  │  window  │
       └──────────┘  └──────────┘  └──────────┘
             │             │             │
             ▼             ▼             ▼
       Navigates      Navigates     Navigates the
       away. Browser  away. No      ONLY window.
       back works —   URL bar,      No back menu —
       annoying but   no back —     STUCK until
       recoverable.   STUCK.        force-quit.
```

Root cause: `packages/client/src/components/MarkdownContent.tsx` never overrides the `a` component in its `ReactMarkdown` config, so every URL the LLM emits is rendered as a bare `<a href>` with no `target`. Every other link surface in the app already gets it right (`InlineMarkdown.tsx`, `SessionCard.tsx`, `ProviderAuthSection.tsx`, `ZrokInstallGuide.tsx`), which makes this an isolated oversight in the renderer used for chat bodies, thinking blocks, flow agent details, package READMEs, and markdown previews.

## Goals / Non-Goals

### Goals
- A URL clicked in any dashboard-rendered markdown content SHALL NOT strand the user, in any of the three environments (browser, PWA, Electron).
- In Electron, external URLs SHALL open in the user's real system browser (desktop-native UX), not in a secondary Electron window.
- Same-origin navigation SHALL continue to work (e.g. `/auth/login?return=...` redirect in `App.tsx:673`).
- The fix SHALL be observable by unit test without spinning up Electron.

### Non-Goals
- Full Electron security review (CSP, permission handler, `webSecurity`, `allowRunningInsecureContent`). Out of scope here; can be a separate proposal if we want it.
- Changing `contextIsolation: true` or `nodeIntegration: false` (both already correct).
- A global click-delegation handler on `document`. Tempting as Layer 2 but introduces subtle behavior with modifier keys, middle-click, and in-app anchors. Dropped — see Alternatives.
- Handling `file://` or `data:` URLs specially. Dashboard never emits those from agents; if they appear, the same-origin check will treat them as external and route through `shell.openExternal`, which is safe on all platforms.

## Decisions

### Decision 1: Fix at two layers (renderer + Electron), not one

**Chosen**: Layer 1 (MarkdownContent `a` override) + Layer 3 (Electron `setWindowOpenHandler` + `will-navigate`).

**Why**:
- Layer 1 alone leaves Electron showing links in a secondary Electron window instead of the user's real browser — technically "unstuck" but not the desktop UX we want.
- Layer 3 alone doesn't help browser / PWA users at all, because those environments never reach the Electron main process.
- Together they are additive and independent: the markdown fix covers the universal case, Electron hardening upgrades the Electron UX and acts as defense-in-depth against future renderers that forget to set `target="_blank"`.

**Alternative considered — global click delegation (Layer 2)**: a `document.addEventListener("click", ...)` that intercepts every `<a>` with an external href and calls `window.open`. Rejected because:
- Modifier keys (Ctrl/Cmd+click, middle-click, right-click "Open in new tab") already have correct browser behavior; we'd need to replicate it all.
- In-app fragment links (`#heading`) need to stay same-document — extra branching.
- One more global listener to reason about at test time.
- The codebase already has a working pattern (`InlineMarkdown`). Doing the same thing in `MarkdownContent` is the low-surprise move.

### Decision 2: Same-origin check is URL-parse-based, not substring

**Chosen**: `isSameOriginUrl(href, serverOrigin)` — parses `href` as a URL with a base, then compares `origin`.

```ts
// packages/electron/src/lib/link-handling.ts  (new, pure, no electron import)
export function isSameOriginUrl(href: string, serverOrigin: string): boolean {
  try {
    const resolved = new URL(href, serverOrigin);
    return resolved.origin === new URL(serverOrigin).origin;
  } catch {
    return false; // malformed → treat as external (route through openExternal)
  }
}
```

**Why**:
- Handles relative URLs (`/settings`) — they resolve to `serverOrigin` and stay in-window.
- Handles `#fragment` — relative to `serverOrigin`, same-origin, stays in-window.
- Handles absolute URLs (`https://example.com`) — different origin, opens externally.
- Handles `javascript:` URLs — they parse with origin `null`, fail the check, and get `shell.openExternal`'d. On modern Electron `shell.openExternal` refuses `javascript:` schemes by default, so this is safe. Non-`http(s)` schemes can additionally be filtered if we want to be strict — see Risks.
- Handles malformed URLs — try/catch falls through to "external" → `shell.openExternal` is the safe default (system handles it or refuses).

**Alternative considered — substring match on `http://localhost:<port>`**: rejected. Doesn't handle `127.0.0.1` vs `localhost`, doesn't handle IPv6 `[::1]`, doesn't handle different ports when dev mode proxies to Vite. The `URL` constructor already does this correctly.

### Decision 3: Extract `isSameOriginUrl` as a pure helper

**Chosen**: one ~10-line pure function in `packages/electron/src/lib/link-handling.ts`, tested directly without Electron.

**Why**:
- The behavior we actually care about is "does this URL match the server's origin?" That's pure input/output.
- The Electron `BrowserWindow`, `shell.openExternal`, and event plumbing are thin wiring around this decision. We don't need to test that Electron's event system works.
- Mirrors the project's established pattern (e.g. `buildOrchestratorScript` in `restart-helper.ts`, `parseOfflineManifest` in `offline-packages.ts`): pure decision logic extracted, thin side-effecting caller left untested in unit land.

### Decision 4: No behavior change in the client for `App.tsx:673`

The auth-login redirect uses `<a href={apiBase}/auth/login?...>` without `target="_blank"`. This is **intentional** — the user should be redirected in the current tab so the return flow lands back on the dashboard. Both layers of the fix preserve this:
- The `MarkdownContent` change is scoped to the markdown renderer, not `App.tsx`.
- The Electron `will-navigate` handler checks `isSameOriginUrl` — `apiBase/auth/login` resolves to the server origin, same-origin, passes through untouched.

### Decision 5: `new-window` is deprecated; only use `setWindowOpenHandler`

Electron 32 deprecates the `new-window` event in favor of `webContents.setWindowOpenHandler`. Use the new API only. Returning `{ action: "deny" }` fully suppresses the secondary `BrowserWindow` — no need for additional `new-window` listeners.

## Data Flow

```
USER CLICKS <a href="https://example.com"> in chat markdown
│
├── react-markdown renders <a target="_blank" rel="noopener noreferrer">  ← Layer 1
│                                                                         (MarkdownContent fix)
│
└── Click bubbles to browser/Electron:
    │
    ├── In browser tab / PWA:
    │     target="_blank" → new tab / system browser.
    │     Dashboard untouched. ✓
    │
    └── In Electron:
          target="_blank" → webContents.setWindowOpenHandler fires:     ← Layer 3
            │                                                             (Electron fix)
            ├── shell.openExternal("https://example.com")
            └── return { action: "deny" }  (no secondary BrowserWindow)
          Dashboard untouched. ✓


DEFENSE IN DEPTH — a future component forgets target="_blank":

USER CLICKS <a href="https://evil.example"> (no target)
│
└── In Electron:
      will-navigate event fires on main BrowserWindow:
        │
        ├── isSameOriginUrl(href, serverOrigin) → false
        ├── event.preventDefault()
        ├── shell.openExternal(href)
        └── Dashboard untouched. ✓


SAME-ORIGIN NAVIGATION (auth login, internal routing):

USER CLICKS <a href="/auth/login?return=/">  (App.tsx:673)
│
└── In Electron:
      will-navigate event fires:
        │
        ├── isSameOriginUrl("/auth/login?return=/", "http://localhost:8000") → true
        └── (no preventDefault) → navigation proceeds normally. ✓
```

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Same-origin check misclassifies a valid internal URL as external | Low | `isSameOriginUrl` is unit-tested with ≥8 cases (relative, absolute-same, absolute-different, fragment, query-only, malformed, `javascript:`, empty). `App.tsx:673` redirect covered by an explicit case. |
| `shell.openExternal` on `javascript:` / `file:` / `data:` is unsafe | Very low | Modern Electron refuses `javascript:` in `openExternal`. If we want to be stricter, add a scheme allowlist (`http:` + `https:` + `mailto:`) in the helper — documented as a follow-up but not blocking. |
| Breaking the auth-login redirect | Low | Covered by same-origin check + dedicated test case. Also preserved implicitly because the redirect URL shares the server's origin. |
| PWA behavior varies by OS | Medium | On iOS/Android, `target="_blank"` from a standalone PWA usually opens the system browser, which is what we want. If any OS still consumes the navigation internally, we'd need a follow-up (explicit confirmation dialog or scheme trickery). Not gating this change — today's situation is strictly worse. |
| Adding `will-navigate` breaks same-origin client-side routing (React Router, etc.) | Very low | React Router uses `history.pushState`, which does NOT fire `will-navigate`. The event only fires on full navigations. Our same-origin check is belt-and-suspenders — client-side routing never reaches it. Tested with an explicit "same-origin href" case. |
| Second-origin dev tooling (Vite HMR port, external CDNs) | Low | Dev mode proxies through the dashboard server origin. External CDN calls are XHR/fetch, not `<a>` clicks. No impact. |

## Migration Plan

This is a pure feature flip — no data migration, no config changes. Release notes mention "External links from chat now open in your real browser."

## Open Questions

None blocking. Two optional follow-ups that can live in separate proposals:
1. Should we filter `shell.openExternal` to an allowlist of safe schemes (`http:`, `https:`, `mailto:`)? Strictly hardening — not required by the bug report.
2. Should the rest of the Electron security review (CSP, permission handler) get its own proposal? Yes, but not here.
