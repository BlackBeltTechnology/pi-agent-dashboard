## Why

External services (Honcho memory store, LangChain workers, CI test harnesses, custom apps) need a stable, always-on HTTP endpoint that exposes the same set of LLM models the dashboard's `/model` selector shows — without requiring those clients to manage their own provider credentials, OAuth tokens, or pi installations.

The upstream extension `@blackbelt-technology/pi-model-proxy` solves a similar problem but is **session-scoped**: its HTTP server starts on extension load and dies on `session_shutdown`. Two pi sessions cannot both bind `:9876` (`EADDRINUSE`); zero pi sessions means no proxy. That lifecycle is wrong for the "always available while the dashboard runs" requirement (see explore-mode discussion 2026-05-01).

Adding `/v1/...` routes to the dashboard server itself gives us:
- Lifetime tied to the dashboard daemon (already an always-on process), not to any pi session.
- Concurrent-client support gated by Fastify, not by single-process binding.
- Identity-verified auth via the existing OAuth/JWT layer plus a new API-key surface for non-browser clients.
- Tunnel passthrough — the existing zrok integration exposes `/v1/...` for free.
- A single source of truth for "which models are available": dashboard settings + `~/.pi/agent/auth.json`, exactly what the `/model` selector reads.

## What Changes

- **NEW capability**: `model-proxy` — OpenAI Chat Completions–compatible (`POST /v1/chat/completions`) and Anthropic Messages–compatible (`POST /v1/messages`) endpoints, plus `GET /v1/models`, mounted on the dashboard server.
- **NEW server module** `packages/server/src/model-proxy/` containing:
  - `registry-singleton.ts` — boot-time `ModelRegistry.create(AuthStorage.create())` instance, refreshable on credential / providers.json / models.json change.
  - `convert/` — bidirectional format translation (OpenAI ↔ pi-ai event stream ↔ Anthropic). Lifted with attribution from upstream `@blackbelt-technology/pi-model-proxy/src/convert/` (MIT).
  - `streamer.ts` — thin wrapper around `pi-ai`'s `streamSimple` with `AbortSignal` propagation on client disconnect.
  - `auth-gate.ts` — Fastify hook that accepts dashboard JWT OR a dedicated proxy API key.
- **NEW REST routes**: `POST /api/model-proxy/api-keys`, `DELETE /api/model-proxy/api-keys/:id`, `GET /api/model-proxy/api-keys` for managing proxy-scoped bearer tokens. API keys are stored hashed in `~/.pi/dashboard/config.json#modelProxy.apiKeys` (each entry: `{id, label, createdAt, lastUsedAt?, hash}`).
- **NEW config schema** in `packages/shared/src/config.ts`: `modelProxy: { enabled: boolean; defaultModel?: string; secondPort?: number; rateLimit?: number; logRequests?: boolean }`. Default `enabled: true` (loopback-only) — same default the dashboard uses for other endpoints.
- **NEW dashboard deps** in `packages/server/package.json`:
  - `@mariozechner/pi-coding-agent` — for `ModelRegistry`, `AuthStorage`. **Already a transitive dep** via the bridge extension; promoting to a direct dep clarifies the contract.
  - `@mariozechner/pi-ai` — for `streamSimple`, provider type definitions. **Already transitive**; same.
- **NEW client surface** in `packages/client/src/components/ModelProxySection.tsx` (settings panel): toggle, default-model dropdown, optional second-port input, API-keys table with create/reveal-once/revoke actions.
- **NEW recursion guard**: refuse to register a custom provider in `~/.pi/agent/providers.json` whose `baseUrl` resolves to the dashboard's own listen address. Surfaces as an error in the existing provider-routes.ts PUT handler.

## Capabilities

### New Capabilities

- `model-proxy` — defines the wire contract (`/v1/models`, `/v1/chat/completions`, `/v1/messages`), the auth model (JWT or proxy API key), the credential-resolution semantics (server-resident `ModelRegistry`), the streaming contract (SSE pass-through, AbortSignal on disconnect), and the recursion-guard requirement.

### Modified Capabilities

- `auth` (existing) — extended to accept proxy API keys for `/v1/*` routes only. Dashboard JWT continues to work everywhere; proxy API keys are scoped to the proxy surface.
- `model-selector` (existing, untouched) — clarifying note that `/v1/models` returns the same effective set as the in-session `/model` dropdown, sourced from `ModelRegistry.getAvailable()`.

## Impact

- `packages/server/package.json` — promote `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` from transitive to direct deps.
- `packages/server/src/server.ts` — register `model-proxy-routes` after auth plugin, before catch-all 404. Initialize `ModelRegistry` singleton at boot.
- `packages/server/src/routes/provider-routes.ts` — add recursion guard in `PUT /api/providers` to reject self-pointing custom providers.
- `packages/server/src/auth-plugin.ts` — extend the `onRequest` hook to recognize proxy API keys for `/v1/*` paths.
- `packages/shared/src/config.ts` — extend `DashboardConfig` with `modelProxy` block, add `parseModelProxyConfig` validator.
- `packages/shared/src/rest-api.ts` — add types for `/api/model-proxy/api-keys/*` routes.
- `packages/client/src/components/SettingsPanel.tsx` — mount new `ModelProxySection`.
- `packages/client/src/lib/model-proxy-api.ts` — fetch helpers for the new REST surface.
- `AGENTS.md` + `README.md` + `docs/architecture.md` — document the new `/v1/*` surface, the API-key model, the recursion guard, the OAuth refresh contention notes.
- **No upstream pi-model-proxy code is replaced or deprecated** — that extension continues to work for users running pi standalone without the dashboard. Users who run both will likely disable the upstream extension to avoid duplicate listeners; documented as a coexistence note, not enforced.

## References

- Explore-mode discussion: 2026-05-01 conversation that produced this proposal.
- Upstream pi-model-proxy: https://github.com/BlackBeltTechnology/pi-model-proxy (MIT) — source of `convert/` lift.
- pi-coding-agent `ModelRegistry`: `@mariozechner/pi-coding-agent/dist/core/model-registry.d.ts` (`ModelRegistry.create`, `getAvailable`, `getApiKeyAndHeaders`, `find`, `refresh`).
- pi-coding-agent `AuthStorage`: `@mariozechner/pi-coding-agent/dist/core/auth-storage.d.ts` (`AuthStorage.create`).
- pi-ai exports: `@mariozechner/pi-ai/dist/index.d.ts` (`streamSimple`, `Model<Api>`, OAuth types).
- Existing auth surface: `packages/server/src/auth-plugin.ts`, `packages/server/src/auth.ts`.
- Existing provider config: `packages/server/src/routes/provider-routes.ts` (writes `~/.pi/agent/providers.json`).
- Related but distinct capability: `model-selector` (per-session `/model` UI), `ui-proxy` (extension UI mount points — unrelated despite the name).
