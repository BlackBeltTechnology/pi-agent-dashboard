# DOX — packages/client/src/lib/identity

Files in this directory. One row per source file. See change: add-multi-user-identity-plane.

| File | Purpose |
|------|---------|
| `dashboard-login.ts` | D22 dashboard-UI login seam: `startSignIn` (PKCE verifier in sessionStorage → `loginUrl?returnTo&challenge`), `readLoginReturn`/`stripLoginReturn` (`#pi_handoff`/`#pi_login_error`), `completeHandoff` (POST `tokenUrl` → in-memory bearer), `signOutTarget`. No cookies. D25/login page: `LOGIN_PATH`, `loginPathFor(target)`, `startSignIn(provider, {silent})` (`prompt=none`; stores `PROVIDER_KEY`), `silentProviderFor(config, lastId)` (`LAST_PROVIDER_KEY` localStorage), `signOutTarget(provider)` → `/login?pi_signed_out=1`. |
| `gate.ts` | Same-origin redirect guards `safeReturnTo`/`providerRedirect`, component-provider selection, D19 gate redirects. |
| `login-config.ts` | `fetchLoginConfig()` → pre-auth `GET /api/identity/login-config` descriptor (incl. D22 `tokenUrl`/`postLogoutUrl`/`label`/`endsProviderSession`); never throws. D25: `providers: LoginProvider[]` (older server ⇒ one), top-level mirrors the first; `providerById`. |
| `login-session.ts` | Page-lifetime login store; `bootLoginSession` (main.tsx, before `<App/>`) consumes + strips the plugin's return markers, runs the handoff; `useLoginSession` (`phase`, `hadToken`, `signedOut`, `error`). Login page: phase starts `checking`; enforced + no token ⇒ `navigate(/login?returnTo)`; `login_required` ⇒ `silentMissed` (not an error); handoff redeemed at the STARTING provider's `tokenUrl`, `providerId` kept; `loginRedirectFor(status, …)` for mid-page loss. |
| `signed-in-user.ts` | `loadSignedInUser`/`useSignedInUser`: `/auth/status` principal (bearer sent explicitly — outside `/api/`) + descriptor, for the user line. |
