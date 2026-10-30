# auth-plugin.ts — index

`registerAuthPlugin` now returns `{hasUsableOAuthProvider}` (live, non-empty `clientId`; exists even on the provider-less early return); exports `buildLoginAvailable(oauth|null, passkeys, identity)` for the `sign-in` remedy. See change: surface-operate-required-remedy. Fastify plugin registers OAuth routes + `onRequest` JWT gate. → see `auth-plugin.ts.AGENTS.md` Adds `pi_dash_oauth_state` signed state cookie verified before `exchangeCode`, `sanitizeReturnUrl`, `localTrust` threading. See change: harden-trust-and-credential-boundaries. `/auth/login` renders the `pi-dashboard open` remedy and skips the single-provider auto-redirect when `needsLocalProof`; a valid session cookie is tagged BEFORE the strict observe early-return; `sanitizeReturnUrl` now delegates to shared `isSafeLocalPath`. See change: close-container-loopback-impersonation (D3, D4).

OAuth `onRequest` gate skips exactly `POST` on `/__pi/csp-report/{baseline,strict,trusted-types}` (query ignored, no prefix match) so signed-out pages can report. See change: harden-cors-and-csp-reporting.

## harden-auth-credentials (B16r)

`issueState(request, reply)` + `setSessionCookie(request, reply, token)` key `secure` on `isSecureOrigin(request, base is https)` (`secure-origin.ts`); passkey `issueSession` passes `reply.request`. `trustProxy` stays off. See change: harden-auth-credentials.

## close-security-map-high-findings (D3)

Public IdP in open enrolment ⇒ login REFUSED: `/auth/login` (single refused provider ⇒ 403 `renderOpenEnrolmentPage`, never an IdP bounce), `/auth/start/:p` (before registry lookup, no IdP round trip), `/auth/callback/:p` (after state check, before `exchangeCode`). Each refusal audits `[oauth] login_refused provider= reason=open_enrolment ip=` (socket peer; sink failure swallowed). Picker lists refused provider as text note, no sign-in link. `authState.providers` keeps CONFIGURED providers next to `providerRegistry`. Handle gains `isSessionProviderRejected(provider)`: missing/empty/non-string claim, key absent from config, or public+open ⇒ true. `effectiveSessionTier(payload, passkeys, isSessionProviderRejected?)` returns `null` then (passkey sessions skip it). `AuthPluginOptions.onAuthReloaded` runs last in `_reloadAuth` (throw ⇒ `console.error`, reload stays applied). `_authOpenEnrolment()` fastify decoration feeds diagnostics. One warning per open-enrolment provider at register + each reload (refused line names Settings ▸ Users / Paired devices). See change: close-security-map-high-findings.
