## 1. Spike — resolve the API surface (do first; gates the rest)

- [ ] 1.1 Create a Google Cloud project with a **Desktop** OAuth client ID and an **Internal** consent screen (Workspace org); record client_id (+ client_secret if required).
- [ ] 1.2 Prototype `login()` from `anthropic.ts` swapped to `google-auth-library` `OAuth2Client` (generateAuthUrl + PKCE S256 + loopback `127.0.0.1:<port>/oauth2callback` + getToken) → obtain `{refresh, access, expires}`.
- [ ] 1.3 Make one authenticated Gemini call per candidate surface (Code Assist, Vertex, Developer-API-direct) with the access token as Bearer; record which succeed for a Workspace account.
- [ ] 1.4 Decide the default surface + exact OAuth scopes + `modifyModels` baseUrl; update design.md Open Questions 1–2 with the answer.

## 2. Provider module

- [ ] 2.1 Add `googleOAuthProvider: OAuthProviderInterface` module in `packages/extension` (template: pi's `anthropic.ts`) implementing `id`, `name`, `login`, `usesCallbackServer`, `refreshToken`, `getApiKey`, `modifyModels`.
- [ ] 2.2 Implement PKCE + `state` generation and validate `state` on callback; reject on mismatch (no token exchange, no persist).
- [ ] 2.3 Implement `onManualCodeInput` paste path (parse redirect URL / raw code, validate state) and honor `PI_OAUTH_CALLBACK_HOST` for container binding.
- [ ] 2.4 Implement `refreshToken` (silent renew) and `getApiKey` (→ access token); ensure `expires` is set with a safety margin.

## 3. Registration + wiring

- [ ] 3.1 Register the provider via the extension's existing `registerProvider({ name, api, baseUrl, models, oauth: googleOAuthProvider })` path.
- [ ] 3.2 Confirm the provider appears in pi `/login` and `list_models` reports `hasOAuth: true` + `expires` once authenticated.
- [ ] 3.3 Confirm `google-auth-library` resolves at runtime (reuse pi's bundled copy or add a direct dep per Open Question 3).

## 4. Tests

- [ ] 4.1 Unit: PKCE/state generation; `state` mismatch rejects login (spec: State/PKCE mismatch).
- [ ] 4.2 Unit: `refreshToken` returns renewed `{access, expires}` from a refresh token; expired-access path triggers refresh (spec: Automatic token refresh).
- [ ] 4.3 Unit: manual-code parsing accepts a full redirect URL and a bare code, rejects mismatched state (spec: Remote/tunnel manual-code fallback).
- [ ] 4.4 Integration: `getApiKey` output used as Bearer on a mocked Gemini request hits the `modifyModels` baseUrl (spec: Bearer-token Gemini requests).
- [ ] 4.5 Integration: registration surfaces the provider in `list_models` with `hasOAuth`/`expires` (spec: Registration through the existing provider path).

## 5. Docs + security review

- [ ] 5.1 Document operator setup: enable API, create Desktop OAuth client, Internal consent screen (Workspace = skip verification), env overrides — route via `docs/` delegation (caveman style) + a `packages/extension` AGENTS.md row.
- [ ] 5.2 Run `security-hardening` skill over the flow: PKCE + state validation, no secret logging, refresh-failure → interactive re-login (not hard error), token storage handled by pi's `authStorage`.
- [ ] 5.3 Manual QA: full login in the running dashboard (local loopback) and one remote/tunnel run using the manual-code paste path.
