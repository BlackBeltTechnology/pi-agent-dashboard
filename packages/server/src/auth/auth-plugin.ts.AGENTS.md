# auth-plugin.ts — index

`registerAuthPlugin` now returns `{hasUsableOAuthProvider}` (live, non-empty `clientId`; exists even on the provider-less early return); exports `buildLoginAvailable(oauth|null, passkeys, identity)` for the `sign-in` remedy. See change: surface-operate-required-remedy. Fastify plugin registers OAuth routes + `onRequest` JWT gate. → see `auth-plugin.ts.AGENTS.md` Adds `pi_dash_oauth_state` signed state cookie verified before `exchangeCode`, `sanitizeReturnUrl`, `localTrust` threading. See change: harden-trust-and-credential-boundaries. `/auth/login` renders the `pi-dashboard open` remedy and skips the single-provider auto-redirect when `needsLocalProof`; a valid session cookie is tagged BEFORE the strict observe early-return; `sanitizeReturnUrl` now delegates to shared `isSafeLocalPath`. See change: close-container-loopback-impersonation (D3, D4).

OAuth `onRequest` gate skips exactly `POST` on `/__pi/csp-report/{baseline,strict,trusted-types}` (query ignored, no prefix match) so signed-out pages can report. See change: harden-cors-and-csp-reporting.

## harden-auth-credentials (B16r)

`issueState(request, reply)` + `setSessionCookie(request, reply, token)` key `secure` on `isSecureOrigin(request, base is https)` (`secure-origin.ts`); passkey `issueSession` passes `reply.request`. `trustProxy` stays off. See change: harden-auth-credentials.
