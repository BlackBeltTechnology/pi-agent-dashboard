# UI plan: dashboard login page / logout seam (D22, tasks 18.20) — v3

Mockup: `login-logout.html` (state switcher, dark + light, 375 px). Tokens: `packages/client/src/index.css` vars only.
Grounded on: `SessionList.tsx` `header-app-bar` (logo · theme | install · gateway · server · Discord · settings).

## Surfaces (v3, user-directed 2026-09-23 — supersedes the v2 dialog)

Rule: signed out = the tab is sent to the core **login page `/login`**, a FULL page. Nothing of the dashboard renders behind it (no sidebar, no sessions, no Settings). The requested page rides along as `?returnTo=`. Buttons go to the descriptor's `loginUrl`; sign-out goes to its `logoutUrl`. Every login plugin gets this page for free. Nothing is added to the top header.

| # | State | URL | Surface |
|---|---|---|---|
| 1 | Enforced, no bearer | `/login?returnTo=<page>` | Login page: brand, "Sign in to pi-dashboard", `Sign in with <label>` → `loginUrl?returnTo&challenge` → IdP. |
| 2 | Returning user, IdP session alive | `/login` → IdP `prompt=none` → back | **No click**: spinner "Signing you in · Checking your Keycloak session…", then the dashboard at `returnTo`. IdP has no session ⇒ `#pi_login_error=login_required` ⇒ state 1. Only when the descriptor sets `silentSignIn`. |
| 3 | At the IdP | external | Provider's own page, reached only after a click. |
| 4 | Back with `#pi_handoff` | `<returnTo>#pi_handoff=…` (stripped) | Spinner page (`role=status`) while exchanging at `tokenUrl`. |
| 5 | Signed in | `<returnTo>` | Dashboard. User line pinned to the BOTTOM of the session stream: avatar · name · email · provider · `Sign out`. |
| 6 | Bearer expired mid-use | `/login?returnTo=<page>` | Dashboard replaced by the login page; silent attempt first (state 2). Page variant "Your session has expired" only if the IdP needs the password. |
| 7 | After Sign out | `logoutUrl` → `/login?pi_signed_out=1` | "You're signed out", copy by `endsProviderSession`. **No** silent sign-in here. |
| 8 | Plugin/IdP error | `/login?returnTo=…` | "Couldn't reach the sign-in service", Try again, D23 break-glass hint. No silent retry loop. |
| 9 | Several providers, no pin (later) | `/login` | Primary + secondary button. |

Shown ONLY while identity is enforced (D21). Inert dashboard: `/login` is never entered.

Plugin contract: `loginUrl` redirects to the IdP at once (302); with `silentSignIn: true` it honours `prompt=none` and maps "no IdP session" (`login_required` / `interaction_required` …) to `#pi_login_error=login_required`; `postLogoutUrl` = `/login?pi_signed_out=1`.

## Seam: what the UI needs from the login plugin

Descriptor (`registerBrowserLoginConfig`), same-origin paths:
- `loginUrl`, `logoutUrl`, `tokenUrl`, `postLogoutUrl` (D22).
- NEW `label`: short provider name for the button + menu ("Keycloak", "GitHub"). Plain text, length-capped.
- NEW `endsProviderSession: boolean`: logout copy ("Keycloak session ended too" vs "You're still signed in to GitHub").
- NEW `silentSignIn: boolean`: `loginUrl` supports OIDC `prompt=none` (state 2).

Identity for the menu: `/auth/status` returns `principal { sub, name?, email? }` when authenticated. The resolver already supplies them. Avatar = initials of `name`, else of `email`, else a generic icon.

## Rules cited
- Who is signed in is always visible (bottom-left user line, the sidebar-footer pattern used by Slack / VS Code accounts): Nielsen #1 (visibility of system status).
- One primary action per screen; recovery in plain words, detail secondary: Nielsen #9 (help users recover from errors).
- Keep the user's place on expiry (`returnTo`) and don't ask again while the IdP session lives (silent `prompt=none`): Nielsen #3 (user control), #6 (recognition over recall), #7 (efficiency).
- Respect an explicit sign-out: no silent sign-in on the signed-out page (user control, Nielsen #3).
- Few, ranked choices in the chooser: Hick's law.
- Signing out needs no confirm dialog (reversible). The status page confirms the result: Nielsen #1 (system status).
- a11y: page `role=main` with one `h1`, `role=alert` for expiry/error, `role=status` + reduced-motion spinner, focus ring from `--accent-text`, primary button focused on load.
