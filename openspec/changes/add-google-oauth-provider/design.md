## Context

pi exposes a first-class OAuth-provider plugin interface (`OAuthProviderInterface` from `@earendil-works/pi-ai`), consumed by `ModelRegistry.registerProvider({ oauth })`. Three built-in providers already implement it:

- **anthropic.ts** — authorization-code + PKCE + loopback callback server (`127.0.0.1:53692/callback`), `usesCallbackServer: true`, with a manual-code-paste fallback. **This is the closest template for Google.**
- **github-copilot.ts** — device-code flow.
- **openai-codex.ts** — authorization-code flow.

pi handles everything downstream of `login()`: credential persistence (`authStorage` `{type:"oauth", refresh, access, expires}`, file-locked), automatic refresh via `refreshToken()`, `/login` UI, `list_models` (`hasOAuth`, `expires`), and settings surfacing. `google-auth-library` is already bundled (top-level `node_modules` and inside `@earendil-works/pi-coding-agent`). This repo's `packages/extension` already calls `registerProvider` from `providers.json`.

Interface contract (confirmed from pi source):

```
OAuthProviderInterface {
  id; name;
  login(callbacks): Promise<{refresh, access, expires}>
  usesCallbackServer?: boolean
  refreshToken(creds): Promise<{refresh, access, expires}>
  getApiKey(creds): string            // → Bearer <access>
  modifyModels?(models, creds): Model[]   // pin baseUrl
}
OAuthLoginCallbacks {
  onAuth({url, instructions}); onDeviceCode; onPrompt; onProgress?;
  onManualCodeInput?; onSelect; signal?
}
```

## Goals / Non-Goals

**Goals:**
- One `googleOAuthProvider: OAuthProviderInterface` module, modeled on `anthropic.ts`, using `google-auth-library`'s `OAuth2Client`.
- System-browser login (loopback+PKCE) with manual-code fallback for remote/tunnel dashboards.
- Gemini calls authenticated by user OAuth access token (Bearer); silent refresh.
- Registered through the extension's existing `registerProvider({ oauth })` path — zero new storage/UI.

**Non-Goals:**
- Automating the Google login form in a headless/driven browser.
- Minting a literal Gemini API-key string (no Google endpoint does this via OAuth).
- Auto-provisioning the Google Cloud project / consent screen (operator prerequisite, documented).

## Decisions

### D1 — Implement pi's `OAuthProviderInterface`, not a bespoke flow
Reuse pi's storage + refresh + `/login` + settings. **Alternative rejected:** a standalone loopback server owned by the dashboard server — duplicates pi's auth store, refresh loop, and UI; loses `list_models`/settings integration.

### D2 — Template on `anthropic.ts`, back the token exchange with `google-auth-library`
`OAuth2Client.generateAuthUrl` (access_type `offline`, PKCE S256, `state`) → open browser via `onAuth` → loopback catches `code` → `client.getToken({code, codeVerifier, redirect_uri})` → `{refresh, access, expires}`. **Alternative rejected:** hand-rolled `fetch` token exchange — `google-auth-library` is already bundled and handles token/refresh nuances.

### D3 — API surface: default to the **Gemini Code Assist** path (mirrors gemini-cli), Vertex as enterprise option
gemini-cli's proven user-OAuth path uses scopes `cloud-platform` + `userinfo.email` + `userinfo.profile` against the Code Assist endpoint — verified to work for both personal Google and Workspace accounts without an API key. `modifyModels` pins the Gemini model baseUrl accordingly.
- **Alternative A (Vertex `aiplatform.googleapis.com`)**: most Workspace-native/enterprise, same OAuth Bearer, but forces a billed GCP project + region config.
- **Alternative B (Gemini Developer API `generativelanguage.googleapis.com` with direct user OAuth)**: simplest surface, but whether it accepts a *plain user* OAuth Bearer (vs API key / service-account) for full model calls is unconfirmed — **the spike resolves this** (see Open Questions). The scope + baseUrl in `modifyModels` are the only things that differ between the three, so switching later is a localized change.

### D4 — Remote/tunnel handling via `usesCallbackServer: true` + `onManualCodeInput`
Loopback works when browser and pi share a host (Electron/local). For Docker/tunnel dashboards, the user pastes the redirect URL/code (exactly as `anthropic.ts` does). `PI_OAUTH_CALLBACK_HOST` env allows binding `0.0.0.0` in containers.

### D5 — Baked public client credentials, PKCE-protected
Desktop OAuth clients ship a non-secret "client secret"; security rests on PKCE + loopback + `state`. Follow the Anthropic/Copilot precedent of a bundled `CLIENT_ID` (+ desktop `client_secret` if the client type requires it). Operators may override via env for their own Cloud project.

## Risks / Trade-offs

- **Developer-API-direct-OAuth may be unsupported** → default to the Code Assist scopes/endpoint (proven) and let the spike confirm before committing a surface. Localized to scope + `modifyModels` baseUrl.
- **Workspace admin blocks the app or shortens sessions** (app allow-listing, reauth-frequency policy) → document Internal consent screen + admin trust; surface refresh failures as a clear "re-login" prompt.
- **Testing-status consent screen expires refresh tokens in 7 days** → document publishing to Internal/Production; `refreshToken` failure path must fall back to interactive re-login, not a hard error.
- **Loopback unreachable in containers** → `onManualCodeInput` paste path + `PI_OAUTH_CALLBACK_HOST`.
- **Bundled client_id rate/abuse limits** if widely shared → allow operator override via env/config for their own Cloud project.

## Migration Plan

Additive; no rollback of existing behavior. Users keep static-API-key config unchanged. Deploy = register the new provider; users opt in via `/login` → Google. Removing the provider registration fully reverts.

## Open Questions

1. **Which API surface ships as default** — Code Assist (recommended) vs Vertex vs Developer-API-direct? Spike must make one authenticated Gemini call per candidate and pick the one that works with a plain user OAuth Bearer for a Workspace account.
2. **Exact OAuth scopes** for the chosen surface (Code Assist: `cloud-platform` + userinfo.*; Developer API: TBD).
3. **Does this repo need a direct `google-auth-library` dependency**, or is re-exporting pi's bundled copy sufficient/allowed?
4. **Operator setup**: assume the user creates the Desktop OAuth client + Internal consent screen, or ship a `doctor`/guided flow that walks the console steps?
