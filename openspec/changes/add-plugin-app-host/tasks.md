> Land after `extract-standalone-app-kit` carries the `AppHost` contract (design D3). Consumers: `add-voice-wall-plugin`, `add-team-plugin`, `add-voice-assistant-dashboard-plugin`.

## 1. Contract (in `app-kit`, coordinated with `extract-standalone-app-kit`)

- [ ] 1.1 `AppHost`, `AppAction`, `DashboardAppDefinition`, `defineDashboardApp`, `AppHostProvider`, `useAppHost` (D3).
- [ ] 1.2 `createStandaloneHost` on the kit's endpoint config, identity and `authedFetch`; `capabilities.dashboard = false`; navigation no-ops.
- [ ] 1.3 `<StandaloneBar>`: title, `HeaderContext`, actions, sign-in, language.

## 2. `presentation: "content"`

- [ ] 2.1 Shared types + `manifest-validator.ts`: accept `"content"`; `depth` required.
- [ ] 2.2 Vite generator emits `presentation: "content"`.
- [ ] 2.3 `App.tsx` / `ShellContent`: render matched `"content"` claims in the OpenSpec-board branch position (live only, never in a frozen underlay); `useShellOverlayRoutePresentation` returns `"content"`.
- [ ] 2.4 Mobile: `MobileShell` detail panel at the claim's `depth`; back via `parentPath`.

## 3. `<EmbeddedApp>`

- [ ] 3.1 Embedded host: `api` via dashboard transport, identity/theme/i18n from dashboard contexts, `folder` from `folderParam`, `setTitle`, `setActions`.
- [ ] 3.2 Board-style top bar (Back · breadcrumb · `HeaderContext` · ≤ 2 actions + overflow · Open standalone); narrow fold with 44 px targets.
- [ ] 3.3 Router based at `basePath`; error boundary (Reload app, Back); `Suspense`.
- [ ] 3.4 Navigation: `openSession`, `openFolder`, `navigateDashboard` validation, return pill (`history.state.fromApp`), `openStandalone` named window, `requestFullscreen`.
- [ ] 3.5 Dev-mode embedding-rule warnings (D7).

## 4. Tests

- [ ] 4.1 [L1] Validator: `"content"` accepted; `"content"` without `depth` rejected; unknown value still fatal.
- [ ] 4.2 [L1] Shell: `"content"` claim renders in the content area with the sidebar mounted; no Dialog/scrim/underlay; not rendered in a frozen underlay.
- [ ] 4.3 [L1] `<EmbeddedApp>`: host fields; top bar zones; `HeaderContext` placement; ≤ 2 inline actions; crash boundary.
- [ ] 4.4 [L1] `navigateDashboard` accepts `/session/x`, rejects `//x`, `javascript:`, `https://…`, `/apps/…`.
- [ ] 4.5 [L1] Standalone host: `capabilities.dashboard` false; navigation no-ops.
- [ ] 4.6 [L3] Fixture plugin: folder entry → content-area app with sidebar visible; deep-link reload; Back to folder; return pill round trip; mobile detail panel.

## 5. Docs

- [ ] 5.1 DocScribe: `docs/plugin-apps.md` (slots recipe, contract, two builds, embedding rules); `shell-overlay-route` presentation table in architecture docs.
- [ ] 5.2 DOX rows for touched runtime/client files.
