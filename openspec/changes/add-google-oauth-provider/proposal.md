## Why

Gemini (Google Workspace / Google account) is currently only reachable in pi via a hand-created static API key. Users want to authenticate through the system browser ("Login with Google") and have pi call Gemini with a short-lived, revocable, user-scoped OAuth token instead of a long-lived key. pi already ships a first-class OAuth-provider plugin system (`OAuthProviderInterface`) with working reference providers (Anthropic, GitHub Copilot, OpenAI Codex) and bundles `google-auth-library` — so the missing piece is one Google provider registered through the dashboard extension's existing `registerProvider` call.

## What Changes

- Add a Google OAuth provider implementing pi's `OAuthProviderInterface` (`id`, `name`, `login`, `refreshToken`, `getApiKey`, optional `modifyModels`, `usesCallbackServer`).
- Login uses the OAuth 2.0 desktop/loopback flow: PKCE + `127.0.0.1:<port>` callback server, system browser opens the consent URL, and a manual-code-paste fallback (`onManualCodeInput`) for the remote/tunnel dashboard case.
- Register the provider through the dashboard extension's existing `pi.registerProvider({ ..., oauth })` path so pi handles `/login`, credential storage (`authStorage` `{type:"oauth"}`), automatic token refresh, and settings/`list_models` surfacing for free.
- `getApiKey(creds)` returns the OAuth access token used as `Authorization: Bearer <token>`; `modifyModels` pins the Gemini model baseUrl to the chosen API surface.
- Provide the Google Cloud setup steps (enable API, desktop OAuth client, **Internal** consent screen for Workspace orgs to skip verification) as documentation, not code.
- NON-GOAL: minting a literal Gemini API-key string via OAuth (Google exposes no such endpoint); NON-GOAL: automating the Google login form in the browser.

## Capabilities

### New Capabilities
- `google-oauth-provider`: Browser-based Google OAuth login for the Gemini provider — loopback+PKCE flow, credential persistence + refresh via pi's OAuth provider interface, Bearer-token Gemini calls, and remote-dashboard manual-code fallback.

### Modified Capabilities
<!-- None: this rides on pi's existing OAuth provider interface and the extension's existing registerProvider path; no existing dashboard spec requirement changes. -->

## Impact

- **Code**: `packages/extension/` — new Google provider module (template: pi's bundled `anthropic.ts`); wire `oauth:` into the existing `registerProvider` config path (`provider-register.ts`).
- **Dependencies**: `google-auth-library` (already bundled by `@earendil-works/pi-coding-agent` and present at repo top level — confirm no new direct dependency needed).
- **External / config**: requires a Google Cloud project with a **Desktop** OAuth client ID and an OAuth consent screen (Internal for Workspace-only avoids Google verification). Documented as an operator prerequisite.
- **Open risks (resolve in design/spike)**: (1) whether the Gemini Developer API `generativelanguage.googleapis.com` accepts a plain user OAuth Bearer or requires the Vertex `aiplatform.googleapis.com` surface — decides scopes + `modifyModels` baseUrl; (2) loopback vs manual-paste behaviour when pi runs in Docker/behind a tunnel; (3) Workspace admin app allow-listing / reauthentication-frequency policies that can shorten sessions.

## Discipline Skills

- `security-hardening` — touches auth, secrets (OAuth client_id/secret, refresh/access tokens), and untrusted redirect input; PKCE + state validation must be verified.
