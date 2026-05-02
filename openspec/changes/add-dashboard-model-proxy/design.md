## Context

The pi-agent-dashboard is a long-lived daemon that already aggregates pi sessions, hosts a Fastify HTTP server with WebSocket gateways, and reads `~/.pi/agent/{auth,providers,models}.json` for its provider-config surface (`packages/server/src/routes/provider-routes.ts`). It does **not** currently speak any LLM provider directly — its only LLM-facing logic is `provider-probe.ts`, which sends 2-token credential probes to verify reachability.

External services (Honcho, LangChain, CI runners, custom apps) routinely need an OpenAI-compatible HTTP endpoint that fronts whatever models the user has authenticated. The upstream extension `@blackbelt-technology/pi-model-proxy` does this but its lifecycle is bound to a single pi session: its HTTP server boots on `extension default()` and closes on `session_shutdown`. Multiple sessions race for `:9876`; zero sessions means zero proxy. That mismatch with "always available while the dashboard runs" is the motivating gap.

**Pre-conditions verified during exploration (2026-05-01):**

- `@mariozechner/pi-coding-agent` exports `ModelRegistry.create(authStorage, modelsJsonPath?)` and `AuthStorage.create(authPath?)` as standalone factories — the dashboard can construct them outside any pi session. Confirmed via `dist/core/model-registry.d.ts` and `dist/core/auth-storage.d.ts`.
- `ModelRegistry` provides `getAvailable()` (filtered to credentialed models), `getApiKeyAndHeaders(model)` (OAuth refresh handled), `find(provider, modelId)`, and `refresh()` (re-read disk).
- `@mariozechner/pi-ai` exports `streamSimple` as the canonical stream entry point; abortable via `AbortSignal`.
- The upstream `pi-model-proxy/src/convert/` code is MIT-licensed pure functions — eligible for lift with attribution.
- The dashboard's auth plugin (`packages/server/src/auth-plugin.ts`) already gates routes; extending it to recognize proxy API keys is additive, not replacement.

## Goals / Non-Goals

**Goals:**

- Mount OpenAI-compatible (`/v1/chat/completions`) and Anthropic-compatible (`/v1/messages`) endpoints on the dashboard server, plus `GET /v1/models`.
- Reuse the dashboard's effective model catalog — the same set the `/model` dropdown shows, sourced from `ModelRegistry.getAvailable()`.
- Authenticate external clients via dedicated **proxy API keys**, separate from the user-facing dashboard JWT.
- Stream upstream provider responses back to the client with `AbortSignal` propagation on client disconnect.
- Refresh model availability when the user logs into a new provider, edits `providers.json`, or imports `models.json` — no server restart required.
- Expose a settings UI surface for toggling, configuring default model, and managing API keys.

**Non-Goals:**

- Replacing or deprecating upstream `@blackbelt-technology/pi-model-proxy`. It continues to be the right answer for users running pi without the dashboard.
- Multi-tenant provider routing (round-robin across N keys, sticky sessions, provider pools). The proxy resolves credentials via pi's normal rules; if you have one Anthropic OAuth, you get one upstream connection.
- Supporting non-OpenAI/non-Anthropic *client* formats (no Google Generative AI–shape inputs, no Bedrock-shape inputs). Upstream providers in any of pi's supported APIs are fine — only the *client-facing* shape is restricted.
- Provider credentials owned by the dashboard. Credentials remain in `~/.pi/agent/auth.json` (managed by pi via `AuthStorage`). The dashboard reads through pi's storage abstraction.
- File uploads, audio, embeddings, image generation. Chat-completion + messages-streaming only in this phase.
- Per-API-key cost accounting / usage dashboards. A simple request log is in scope; richer telemetry is a follow-up.

## Decisions

### 1. Server-resident, not bridge-delegated

**Decision:** The dashboard server instantiates `ModelRegistry` directly and calls `pi-ai.streamSimple` itself. Requests do **not** round-trip through a connected pi session's bridge.

**Why:**

- The user's stated requirement is "always-on while the dashboard runs". Bridge-delegation needs ≥1 connected session — fails when sessions are all closed.
- `ModelRegistry.create` + `AuthStorage.create` are designed for standalone use; we are not pulling on threads that weren't already exposed.
- Avoids a new bridge protocol message and the associated WS round-trip latency.
- Makes test harnesses trivially predictable — a Fastify-only fixture.

**Alternatives considered:**

- **C2: bridge-delegated.** Pick any connected session, forward the request via WS, stream back. Rejected because of the "no sessions = 503" failure mode and because it couples request latency to whichever pi session got picked.
- **B: spawn a hidden pi as the proxy.** Daemon would `pi --headless` internally, capture its registry. Rejected because we'd be paying for a full pi runtime to do what `ModelRegistry.create` already does cheaply.
- **A: singleton-host pattern (first session wins).** Rejected because the lifetime is still session-scoped; closing the host session breaks the proxy.

**Cost:** Promotes `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` from transitive to direct server deps. Both are already on disk via the bridge extension — no install-size delta in practice. **Risk:** version-coupling tightens (see Risks §1).

### 2. Authentication: uniform proxy API key, no JWT, no bypass inheritance

**Decision:** `/v1/*` routes SHALL require a valid proxy API key on every request. The dashboard's existing bypass rules (loopback, `bypassHosts`, `bypassUrls`) DO NOT apply to `/v1/*`. Dashboard JWT is NOT accepted for `/v1/*`. Keys carry scopes (`models:list`, `chat`, `messages`, or `all`), an optional `expiresAt`, a soft-delete `revokedAt`, and a `createdBy` user attribution. Failed auth attempts are subject to per-source-IP exponential backoff.

**Why uniform (no source-based exceptions):**

- The dashboard's existing bypass rules were designed for "a human in a browser using the UI" — the threat model is different from "a programmatic LLM client". Inheriting them silently grants programmatic access to anyone the dashboard considers UI-trusted.
- The most dangerous bypass for `/v1/*` is `bypassHosts` (trusted LAN). A user who configured `192.168.0.0/16` as trusted because they trust their home network for the dashboard UI did not necessarily mean to grant LLM-spend authority to every device on the network.
- A uniform rule eliminates the entire class of "I forgot a tunnel was up" or "I forgot LAN was trusted" exposure bugs.

**Why no JWT:**

- Dashboard JWT is OAuth-bound to a human; pasting it into Honcho's config gives Honcho human-equivalent access — the same coupling we set out to avoid. Better to never accept it on `/v1/*` so the only thing a user can paste into a non-human client is a key designed for non-human clients.
- The dashboard UI's own "Test" button (the one use case JWT-on-loopback was meant to serve) instead uses a user-issued API key cached in browser `sessionStorage` after first creation. Setup wizard prompts for one. See Decision 9.

**Why scopes:**

- Real-world precedent (OpenAI, Anthropic, GitHub) supports scoped keys. Default `["all"]` is invisible to users who don't care; available when they do (e.g. issue a `models:list`-only key to a discovery service that doesn't need to spend tokens).

**Why soft-delete:**

- `revokedAt` (vs hard splice) keeps request-log entries attributable. The settings UI shows revoked keys in a collapsed section; user can purge for real via a separate action.

**Why per-user ownership:**

- Multi-user dashboards (`auth.allowedUsers` size ≥ 2) need this to prevent user A from seeing/revoking user B's keys. Default install is single-user, so the rule is invisible until the second user joins. Adds one filter on list/delete; cheap. An optional `auth.admin: <email>` flag grants override (admin sees and manages every user's keys).

**Why backoff (and not hard lockout):**

- API keys are 288 bits and unguessable in absolute terms. The threat is misconfigured-client noise (retry-storms with a wrong key) and prefix-pattern attacks (`pi-proxy-test...`, common-leak prefixes). Exponential delay (10ms → cap 10s) absorbs both without ever locking out a legitimate user.

**Storage:** `~/.pi/dashboard/config.json#modelProxy.apiKeys[]` with entries `{id, label, createdBy, scopes, createdAt, lastUsedAt?, expiresAt?, revokedAt?, hash}`. Hash is `sha256(key)`; cleartext keys are reveal-once in the UI, never persisted.

**Format on the wire:** `Authorization: Bearer pi-proxy-<48-char-base64url>`. Prefix is a sentinel — the auth gate detects "this is a proxy key" before any verification, so JWT rejection is `O(prefix-check)` not `O(JWT-decode)`.

**Alternatives considered:**

- **Inherit dashboard bypasses (Option 1 from explore-mode workshop).** Rejected: programmatic threat model differs from human-UI threat model; bypassHosts is the dangerous case; uniform rule is simpler and safer.
- **Tiered (read free on bypass, write requires key) (Option 3).** Rejected: more complex auth tree without proportional benefit; users discover the asymmetry via 401-on-completion which is a poor UX.
- **JWT-only.** Rejected: forces UI users to leak human credentials to non-human clients.
- **JWT-on-loopback carve-out for the UI.** Rejected: "loopback" can include shared-machine scenarios where `127.0.0.1` is not actually private; the UI's `sessionStorage`-cached key is cheaper and uniformly safer.
- **mTLS.** Rejected: too heavy for "Honcho on localhost". Revisit if the proxy ever needs cross-machine auth without a tunnel.
- **No auth (loopback only).** Rejected: violates defense-in-depth — a tunnel makes `:8000/v1/...` reachable from anywhere on the internet, and recursion-guard alone is insufficient.
- **Hard lockout after N failures.** Rejected: a misconfigured client could lock its owner out of their own keys. Backoff is gentler and equally effective.

### 3. Endpoint shape: `:8000/v1/...` by default, optional `:secondPort`

**Decision:** Default mount is on the existing dashboard port at `/v1/...`. A `modelProxy.secondPort` config knob (e.g. `9876`) optionally binds a second listener that proxies `/v1/*` to the same handlers — for SDKs that hardcode path-prefix-less base URLs.

**Why:**

- Most OpenAI-compatible clients accept arbitrary `base_url` values: `http://host:8000/v1` works for `openai`, `langchain`, `anthropic`, Honcho, and the OpenAI Python/Node SDKs. Confirmed via spot checks of those library docs.
- A small minority of integrations append paths past `/v1` and assume `<base>/chat/completions` (no version prefix), or assume the host alone is the base and then concatenate `/v1/chat/completions`. The optional second port covers them without forcing every user to deal with the corner case.
- Same-port-default reuses dashboard CORS, dashboard tunnel passthrough, dashboard `/api/health` discovery — significant DRY win.

**Alternatives considered:**

- **Always two ports.** Rejected: doubles the firewall surface for a feature most users won't need.
- **Path-prefix only.** Rejected: leaves the corner-case clients with no clean path.
- **Subdomain (`proxy.dashboard.local`).** Rejected: requires DNS configuration most users don't have.

### 4. Format conversion: lift from upstream pi-model-proxy

**Decision:** Copy `pi-model-proxy/src/convert/{openai-in,openai-out,anthropic-in,anthropic-out}.ts` and the SSE event-translator helpers into `packages/server/src/model-proxy/convert/` with a header-comment attribution to the MIT upstream.

**Why:**

- The conversion logic is the most subtle part of any LLM proxy: tool-call indexing, multi-tool batches, thinking/reasoning blocks, image-content arrays, system-message handling. Re-implementing it would be slower AND introduce drift from a known-working baseline.
- The upstream code is pure functions over pi-ai event types — no extension API surface, no lifecycle coupling. Lifts cleanly.
- License compatibility: pi-agent-dashboard is itself licensed under a permissive license; MIT lift with attribution is unambiguous.

**Maintenance plan:** When upstream releases bug-fixes to `convert/`, manually port them. The two trees may diverge (e.g. dashboard adds reasoning-content shape support before upstream); document divergences in `model-proxy/convert/UPSTREAM.md`.

**Alternatives considered:**

- **Depend on `@blackbelt-technology/pi-model-proxy` as a library.** Rejected: that package is structured as a pi extension (default-export expecting `ExtensionAPI`), not as a reusable converter library. Importing internal `convert/` modules is brittle and unsupported.
- **Re-implement from scratch.** Rejected: slow and error-prone for no upside.

### 5. ModelRegistry refresh policy

**Decision:** Refresh the registry on the following events, all eager (no per-request refresh, no polling):

| Trigger | Implementation site |
|---|---|
| `PUT /api/providers` (custom provider edit) | `packages/server/src/routes/provider-routes.ts` after successful write |
| `POST /api/provider-auth/...` (OAuth login completes) | `packages/server/src/routes/provider-auth-routes.ts` after token persisted |
| `POST /api/config` (dashboard config save) | `packages/server/src/config-api.ts` after merge |
| Bridge `credentials_updated` event | `packages/server/src/event-wiring.ts` after broadcasting to browsers |
| `/v1/models` request | NO — refresh is too expensive; rely on the eager triggers |

**Why:** `ModelRegistry.refresh()` re-reads disk and re-validates models.json; it's not free. Eager refresh on the four mutation sites covers every realistic credential change. Pure-on-disk edits (e.g. user manually edits `models.json` outside the dashboard) are a 30-second-staleness corner case we accept; users can hit the refresh button (REST: `POST /api/model-proxy/refresh`) if they need immediate effect.

### 6. Recursion guard

**Decision:** When `PUT /api/providers` writes a custom provider entry, validate that `provider.baseUrl` does not resolve to the dashboard's own listen origin. Reject with HTTP 400 + error body `{ code: "RECURSIVE_PROXY", message: "...", offendingBaseUrl }` if it does.

**Why:** A custom provider whose `baseUrl` points back at the dashboard creates a request loop: client → `:8000/v1` → registry resolves the model → calls `:8000/v1` → registry resolves → calls `:8000/v1` → … until the upstream timeout fires. Catching it at write time gives the user a clear error instead of a request that hangs.

**Implementation:** Compare normalized `baseUrl` (host+port, ignoring path/scheme casing) against:
- `localhost:<dashboardPort>`, `127.0.0.1:<dashboardPort>`, `[::1]:<dashboardPort>`
- The dashboard's bound address when not loopback (e.g. LAN IP from `os.networkInterfaces()`)
- The mDNS-advertised hostname, when mDNS is active

**Edge case accepted:** A user who points their custom provider at `http://10.0.0.5:8000/v1` from a different machine, where `10.0.0.5` happens to be this dashboard, evades the guard. We do not chase that — the recursion would manifest as upstream timeout on first request, and the failure mode is local rather than global (only that custom-provider record is broken). Documented in the spec scenario.

### 7. AbortSignal propagation

**Decision:** Every `/v1/chat/completions` and `/v1/messages` handler creates an `AbortController`, forwards `controller.signal` into `streamSimple`, and aborts on Fastify's `request.raw.on("close", ...)` (client disconnect during stream). Confirmed pattern from upstream pi-model-proxy.

**Why:** LLM streams cost real money. A client that disconnects mid-stream (Honcho's worker died, browser tab closed, tunnel dropped) MUST not keep paying for tokens. This is non-negotiable.

### 8. Concurrency caps

**Decision:** Three nested caps:

- **Server-wide**: `modelProxy.maxConcurrentStreams` config (default 16). 503 Retry-After when exceeded.
- **Per-API-key**: `modelProxy.perKeyConcurrentStreams` (default 4). 429 when exceeded.
- **Per-upstream-provider**: hard-coded sensible defaults (Anthropic free tier dies at ~5; default to 4 to leave headroom). Override via `modelProxy.perProviderCaps[provider]` if the user has a paid tier.

Per-key tracking is in-memory; survives daemon lifetime, not across restarts. Acceptable — restarts are rare and reset is the safe direction.

**Alternatives considered:**

- **Token-bucket rate limit (req/min) instead of concurrency cap.** Rejected: streaming requests are long-lived; concurrency is the bottleneck, not request rate. Both can coexist later if needed.

### 9. Logging

**Decision:** Optional JSONL request log at `~/.pi/dashboard/model-proxy.jsonl` (gated by `modelProxy.logRequests: true`, default `false`). Each line: `{ts, requestId, apiKeyId?, model, format, status, durationMs, inputTokens?, outputTokens?, error?}`. **Never logs request body, response body, or API keys.**

**Why:** Debugging "why is Honcho hammering me" is a real need; debugging "what did the LLM say" is not the proxy's job.

## Risks / Trade-offs

### 1. Version-coupling with pi

**Risk:** Promoting `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` to direct deps means dashboard now imports their public types and classes. A pi major version bump that changes `ModelRegistry`'s API becomes a dashboard breaking change.

**Mitigation:** The existing `pi-version-skew.ts` machinery already gates pi version compatibility via `piCompatibility` in `packages/server/package.json`. Tighten the *minimum* by one minor when this ships — add a precondition test in `packages/server/src/__tests__/model-registry-shape.test.ts` that asserts the symbols we use are present (defensive against typo / dist-shape drift).

**Accepted because:** pi's `ModelRegistry` is a stable public API (used by the bridge extension since the dashboard's first version). The upstream maintainer treats it as such.

### 2. OAuth refresh contention

**Risk:** A pi session AND the dashboard server both call `getApiKeyAndHeaders` at the same moment, both notice the OAuth token expired, both attempt refresh, both write to `auth.json` → lock contention or token churn.

**Mitigation:** `AuthStorage` already uses `proper-lockfile` (verified in `dist/core/auth-storage.d.ts` — `acquireLockSyncWithRetry`). Concurrent refreshes serialize. The losing side picks up the winning side's freshly-written token. **Acceptance test required**: simulate concurrent refresh from two `AuthStorage` instances (one in-process for the dashboard, one in-process for a stub session) and assert no token corruption.

### 3. Streaming inside Fastify

**Risk:** Fastify SSE has gotchas — `reply.raw.write` interactions with compression middleware, default keep-alive timeouts, header flush timing. The dashboard already streams via WS (terminals) but not SSE.

**Mitigation:** Use the upstream pi-model-proxy's exact SSE pattern (`reply.raw.writeHead(200, sseHeaders); for await (const event of stream) reply.raw.write(formatEvent(event)); reply.raw.end()`). Disable compression on `/v1/*` routes via Fastify's per-route `compress: false`. Set `request.raw.setTimeout(0)` so streams aren't killed by the dashboard's default request timeout.

### 4. Bundle weight on the server

**Risk:** Pulling pi-coding-agent into the server bundle increases install size. Quick measurement in `node_modules/@mariozechner/pi-coding-agent/dist/`: ~10MB. pi-ai: ~5MB. Negligible compared to the existing `node_modules` footprint, but worth tracking.

**Mitigation:** None needed. Documented in the impact section.

### 5. Coexistence with upstream pi-model-proxy

**Risk:** A user runs both: dashboard with this proxy on `:8000/v1`, AND `@blackbelt-technology/pi-model-proxy` extension on `:9876` inside one of the pi sessions. Both work; nothing breaks; user sees two endpoints with potentially-different auth and slightly-different model-availability semantics.

**Mitigation:** Document the coexistence in `docs/architecture.md`. **Don't enforce mutual exclusion** — it's a legitimate setup if the user wants both. The recommendation in the docs will be: pick one, disable the other.

### 6. API key reveal-once UX

**Risk:** Reveal-once is the standard pattern but users *will* lose keys, then complain. Recovery is "revoke and create new".

**Mitigation:** UI copy explicitly says "Save this now — you cannot view it again." Console-warn pattern in tests. Standard industry behavior.

## Migration Plan

This is a new capability. No migration of existing data.

For users currently running upstream pi-model-proxy:

1. Continue running it. The dashboard proxy coexists silently as long as ports differ.
2. Optionally: edit `~/.pi/agent/settings.json` to remove `npm:@blackbelt-technology/pi-model-proxy` from `packages[]`, restart pi sessions. This stops the upstream extension from binding `:9876`.
3. Update any external service's `base_url` from `http://localhost:9876/v1` to `http://localhost:8000/v1` (and replace the (currently-optional) upstream `apiKey` config with a dashboard-issued proxy API key).

Documented in `docs/migration/from-pi-model-proxy.md` (created as part of this change).

## Open Questions

1. **Should `/v1/models` enrich the response with reasoning/cost/context-window metadata** (mirroring `provider-register.ts`'s `enrichModelMetadata`)? Useful for clients that want to pick the cheapest model dynamically. Tilts toward yes — adds ~200 lines, no downside. **Resolution before tasks.md is written:** yes, include the enrichment fields under an `x-pi` namespace per OpenAI's extension convention so we don't break strict OpenAI clients.

2. **Should we expose a streaming-only flag (`stream: true` mandatory) for tighter resource control?** No, the OpenAI shape allows non-streaming and breaking that breaks compatibility. Keep both.

3. **Allowing extensions in pi sessions to talk to the dashboard proxy** (creating a "shared cache" of OAuth refreshes)? Probably yes eventually — but out-of-scope for this change. Capture as a follow-up: `add-extension-model-proxy-client`.

4. **Cost/usage tracking surface in the settings panel?** Captured as out-of-scope above. Re-visit when there's enough request volume to make the data interesting.

5. ~~**Tunnel-aware default**~~ — subsumed by Decision 2's uniform-API-key rule. With JWT rejected on every source, there is nothing to gate further on the tunnel side.
