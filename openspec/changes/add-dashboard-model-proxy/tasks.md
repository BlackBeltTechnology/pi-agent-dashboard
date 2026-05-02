## 1. Shared types and config schema

- [ ] 1.1 Extend `DashboardConfig` in `packages/shared/src/config.ts` with `modelProxy: { enabled: boolean; defaultModel?: string; secondPort?: number; maxConcurrentStreams: number; perKeyConcurrentStreams: number; perProviderCaps?: Record<string, number>; logRequests: boolean; apiKeys: ProxyApiKey[] }`. Defaults: `enabled: true`, `maxConcurrentStreams: 16`, `perKeyConcurrentStreams: 4`, `logRequests: false`, `apiKeys: []`. Add `parseModelProxyConfig(raw)` validator with clamping.
- [ ] 1.2 Add `ProxyApiKey` interface to `packages/shared/src/config.ts`: `{ id: string; label: string; createdAt: number; lastUsedAt?: number; hash: string }`. `id` is a UUID, `hash` is `sha256(key)` hex.
- [ ] 1.3 Add wire-protocol types to `packages/shared/src/rest-api.ts`: `OpenAIChatCompletionRequest`, `OpenAIChatCompletionResponse`, `OpenAIChatCompletionStreamChunk`, `AnthropicMessagesRequest`, `AnthropicMessagesResponse`, `AnthropicMessagesStreamEvent`, `OpenAIModelsResponse`. Re-use `@mariozechner/pi-ai` types where they exist; add minimal own types for the OpenAI/Anthropic surfaces.
- [ ] 1.4 Add `ModelProxyApiKeysListResponse`, `ModelProxyApiKeysCreateResponse` (carries the cleartext `key` ONCE), `ModelProxyApiKeysCreateRequest` (`{label}`) types to `packages/shared/src/rest-api.ts`.
- [ ] 1.5 Add unit tests in `packages/shared/src/__tests__/model-proxy-config.test.ts` covering: defaults populate when missing; clamping (`maxConcurrentStreams` floor 1, ceiling 256); `perProviderCaps` accepts arbitrary string keys; `apiKeys` shape validation rejects entries missing `hash`.

## 2. Server: registry singleton and refresh wiring

- [ ] 2.1 Promote `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` from transitive to direct deps in `packages/server/package.json`. Update lockfile.
- [ ] 2.2 Add a precondition test `packages/server/src/__tests__/model-registry-shape.test.ts` that imports `ModelRegistry`, `AuthStorage` from `@mariozechner/pi-coding-agent` and asserts the methods used in this change exist (`getAvailable`, `getApiKeyAndHeaders`, `find`, `refresh`, `getAll`). Fails the build on dist-shape drift.
- [ ] 2.3 Create `packages/server/src/model-proxy/registry-singleton.ts` exporting `getModelRegistry(): ModelRegistry`, `refreshModelRegistry(): void`, `disposeModelRegistry(): void`. Lazy-init on first call via `ModelRegistry.create(AuthStorage.create())`.
- [ ] 2.4 Wire eager refresh into `packages/server/src/routes/provider-routes.ts` (after successful `PUT /api/providers` write) and `packages/server/src/routes/provider-auth-routes.ts` (after every successful OAuth callback / device-code completion). Verified by tests in 2.5.
- [ ] 2.5 Wire eager refresh into `packages/server/src/config-api.ts`'s `writeConfigPartial` (after merge) and into `packages/server/src/event-wiring.ts`'s `credentials_updated` arm. Add unit tests in `packages/server/src/__tests__/registry-refresh-wiring.test.ts` using a mock `ModelRegistry` (only `refresh` instrumented) — assert one refresh call per trigger.
- [ ] 2.6 Add `POST /api/model-proxy/refresh` route (auth-gated, 200 on success). Test in `model-proxy-refresh-route.test.ts`.

## 3. Server: API key storage and auth gate

- [ ] 3.1 Create `packages/server/src/model-proxy/api-key-store.ts` with pure helpers `hashKey(key)`, `verifyKey(key, hash)`, `generateKey()` (returns `pi-proxy-<48 base64url chars>`). Unit tests in `api-key-store.test.ts`.
- [ ] 3.2 Add `findApiKey(token, config)` and `recordKeyUsage(id, config)` to the same module — pure look-up over `config.modelProxy.apiKeys`. `findApiKey` returns the entry only when `revokedAt == null && (expiresAt == null || expiresAt > Date.now())`; otherwise returns `{kind: "revoked" | "expired"}` discriminator so the gate can distinguish 401 reasons. `recordKeyUsage` returns the mutated `apiKeys` array; caller persists it. Unit tests cover hit/miss/revoked/expired branches and `lastUsedAt` debounce.
- [ ] 3.3 Add scope-check helper `keyHasScope(entry, requiredScope: "models:list" | "chat" | "messages")` to the same module. `"all"` in `entry.scopes` matches every required scope. Unit tests cover allow/deny and the `"all"` shortcut.
- [ ] 3.4 Create `packages/server/src/model-proxy/failed-auth-backoff.ts` with `FailedAuthBackoff` class: `record(ip)` increments and returns the next delay; `reset(ip)` clears on success; `getDelayMs(ip)` returns current delay without mutation. In-memory `Map<ip, {count, lastFailureAt}>`. Doubles starting 10ms, caps 10s. Unit tests cover increment/reset/cap/concurrent-IP isolation.
- [ ] 3.5 Create `packages/server/src/model-proxy/auth-gate.ts` exporting a Fastify `onRequest` hook factory `createModelProxyAuthGate(deps)`. Hook logic:
  - if path doesn't match `/v1/*` → next hook,
  - extract `Authorization: Bearer <token>`,
  - if backoff is active for `request.ip` → `await sleep(delayMs)` BEFORE any verification,
  - if `token.startsWith("pi-proxy-")` → look up via `findApiKey`; on revoked → 401 `AUTH_REVOKED`; on expired → 401 `AUTH_EXPIRED`; on miss → 401 `AUTH_REQUIRED` + record failure; on hit → resolve required scope from path (`/v1/models` → `models:list`, `/v1/chat/completions` → `chat`, `/v1/messages` → `messages`), check via `keyHasScope`; insufficient → 403 `SCOPE_INSUFFICIENT`; sufficient → call `recordKeyUsage` (debounced) + reset backoff + next,
  - if `token` is anything else (JWT or arbitrary) → 401 `PROXY_KEY_REQUIRED` + record failure (regardless of source — no JWT-on-loopback carve-out),
  - if no `Authorization` header at all → 401 `AUTH_REQUIRED` + record failure.
- [ ] 3.6 Register the hook in `packages/server/src/auth-plugin.ts` BEFORE the existing JWT hook AND BEFORE any bypass logic, scoped to `/v1/*`. Existing routes unaffected; their bypass rules continue to apply.
- [ ] 3.7 Confirm via `auth-plugin.ts` integration test that `/v1/*` paths bypass `isLoopback`, `isBypassedHost`, `isBypassedUrl`. Add an explicit assertion for each.
- [ ] 3.8 Add `auth.admin?: string` field to the dashboard auth config (`packages/server/src/auth.ts`). Default `undefined` (no admin override; everyone is per-user-scoped). When set to an email matching `request.user.email`, the user can list/delete every API key regardless of `createdBy`. Update `parseAuthConfig` validator.
- [ ] 3.9 Add integration tests in `packages/server/src/__tests__/model-proxy-auth-gate.test.ts` covering every scenario from `spec.md`: valid key from loopback / LAN / tunnel; JWT rejected uniformly; loopback without key rejected; scope insufficient → 403; expired → 401; revoked → 401; missing → 401; malformed → 401; backoff increments and caps; backoff resets on success; per-IP isolation.
- [ ] 3.10 Add tests in `model-proxy-multi-user.test.ts` covering per-user key visibility and admin override (3.8): alice cannot see bob's keys; admin sees all; admin can revoke any.

## 4. Server: API key REST routes

- [ ] 4.1 Create `packages/server/src/routes/model-proxy-api-key-routes.ts` with handlers:
  - `GET /api/model-proxy/api-keys` → returns `apiKeys[]` filtered to `createdBy === currentUser.email` (or all entries if `currentUser.email === auth.admin`), with `hash` redacted (`***`). Each entry exposes `id`, `label`, `createdBy`, `scopes`, `createdAt`, `lastUsedAt?`, `expiresAt?`, `revokedAt?`. Revoked entries grouped under a separate `revoked: ApiKey[]` field so the UI can render them in a collapsed section.
  - `POST /api/model-proxy/api-keys` → body `{label, scopes?, expiresAt?}`. `scopes` defaults to `["all"]`. `expiresAt` optional epoch ms (must be future; reject with 400 if past). Generates key via `generateKey`, stamps `createdBy: currentUser.email`, persists hashed entry, returns `{id, label, createdBy, scopes, createdAt, expiresAt?, key}` (cleartext `key` revealed ONCE).
  - `POST /api/model-proxy/api-keys/:id/revoke` → soft-delete: stamps `revokedAt: Date.now()`. 404 if not found. 403 if the caller is neither `createdBy` nor admin. On success 204.
  - `DELETE /api/model-proxy/api-keys/:id` → hard-delete (purge). Same auth rules as revoke. On success 204. UI uses this only on the "Revoked keys" section's purge action.
- [ ] 4.2 All four routes auth-gated by dashboard JWT (NOT proxy keys — key-management surface). Atomic config write via existing `writeConfigPartial`.
- [ ] 4.3 Tests in `packages/server/src/__tests__/model-proxy-api-key-routes.test.ts` covering: list redaction; list filters by `createdBy`; admin sees all; create returns cleartext once; create persists hashed + `createdBy` + default `scopes: ["all"]`; create with custom scopes; create with past `expiresAt` → 400; revoke sets `revokedAt`; revoke unknown id → 404; revoke other-user's key as non-admin → 403; revoke other-user's key as admin → 204; purge after revoke removes entry; list excludes purged.

## 5. Server: convert/ lift from upstream pi-model-proxy

- [ ] 5.1 Create directory `packages/server/src/model-proxy/convert/` with files mirroring upstream layout: `openai-in.ts`, `openai-out.ts`, `anthropic-in.ts`, `anthropic-out.ts`, `stream-translator.ts`, `index.ts`.
- [ ] 5.2 Lift the upstream MIT-licensed contents from `@blackbelt-technology/pi-model-proxy/src/convert/` (resolved via the registry-installed copy at `/Users/robson/.nvm/versions/node/v25.8.1/lib/node_modules/@blackbelt-technology/pi-model-proxy/src/convert/` — verify path on the implementer's machine). Each file MUST start with a header comment: `/* Lifted from BlackBeltTechnology/pi-model-proxy@<commit-sha>, MIT licensed. See model-proxy/convert/UPSTREAM.md for divergences. */`.
- [ ] 5.3 Create `packages/server/src/model-proxy/convert/UPSTREAM.md` recording: lift commit SHA, lift date, list of any local edits required (path imports, type-only changes for the dashboard's stricter `tsconfig`), version of upstream `pi-ai` types the lift was tested against.
- [ ] 5.4 Adapt imports — upstream uses `import ... from "@mariozechner/pi-ai"`; preserve. Upstream uses `import ... from "../types.js"`; replace with relative paths under `model-proxy/`.
- [ ] 5.5 Port upstream's unit tests to `packages/server/src/model-proxy/convert/__tests__/`. Identical assertions; only import paths change.
- [ ] 5.6 Run the ported test suite; confirm 100% pass before proceeding.

## 6. Server: streamer wrapper

- [ ] 6.1 Create `packages/server/src/model-proxy/streamer.ts` with `streamCompletion({ model, messages, system?, tools?, signal, ...streamOpts }): AsyncIterable<piAi.StreamEvent>`. Internally calls `getModelRegistry().getApiKeyAndHeaders(model)` then `streamSimple({ model, ..., signal })`.
- [ ] 6.2 Unit test in `streamer.test.ts` using pi-ai's `faux` provider (already exported per `pi-ai/dist/index.d.ts`) — exercises one full stream end-to-end without touching real upstreams.
- [ ] 6.3 Validate that aborting the `signal` mid-stream propagates to the underlying provider call and the returned iterable terminates promptly. Test asserts iteration ends within 100ms of abort.

## 7. Server: concurrency caps

- [ ] 7.1 Create `packages/server/src/model-proxy/concurrency.ts` exporting `ConcurrencyTracker` with `acquire({apiKeyId, provider})` returning a `release()` callback OR throwing `ConcurrencyError({code: "SERVER_FULL" | "KEY_FULL" | "PROVIDER_FULL", retryAfterMs?})`.
- [ ] 7.2 Implement nested counters: server-wide, per-key (in-memory `Map<keyId, count>`), per-provider (in-memory `Map<provider, count>`). Caps read from config at acquire time so live config updates take effect for new requests.
- [ ] 7.3 Unit tests in `concurrency.test.ts` covering: server cap exhausts → `SERVER_FULL`; per-key cap exhausts → `KEY_FULL`; per-provider cap exhausts → `PROVIDER_FULL`; release decrements; concurrent acquire/release thread-safety (Promise.all sweep).

## 8. Server: route handlers

- [ ] 8.1 Create `packages/server/src/routes/model-proxy-routes.ts` with three handlers:
  - `GET /v1/models` — calls `getModelRegistry().getAvailable()`, maps each `Model<Api>` to OpenAI's `/v1/models` shape, attaches enriched metadata under `x-pi: {contextWindow, maxTokens, reasoning, cost, input}`.
  - `POST /v1/chat/completions` — converts OpenAI request via `convert/openai-in.ts`; opens stream via `streamer.ts`; if `stream: true`, write SSE via `reply.raw.write`; if `stream: false`, accumulate then return JSON; abort on `request.raw.on("close")`.
  - `POST /v1/messages` — same shape but via `convert/anthropic-in.ts` and `convert/anthropic-out.ts`. Preserves `max_tokens` semantics.
- [ ] 8.2 Each handler MUST acquire concurrency before opening the stream and release on completion/error/abort. Handle `ConcurrencyError` → 429 (KEY_FULL/PROVIDER_FULL) or 503 (SERVER_FULL) with `Retry-After` header.
- [ ] 8.3 Set per-route `compress: false` and `request.raw.setTimeout(0)` for the streaming routes.
- [ ] 8.4 Integration tests in `packages/server/src/__tests__/model-proxy-routes.test.ts` using pi-ai's faux provider and an in-memory `ModelRegistry` fixture: list-models returns shape; OpenAI streaming round-trip; OpenAI non-streaming round-trip; Anthropic streaming round-trip; client-disconnect aborts upstream; auth missing → 401; concurrency cap exhaust → 429/503.

## 9. Server: optional second port

- [ ] 9.1 In `packages/server/src/server.ts`, after main Fastify instance is listening, if `config.modelProxy.secondPort` is set, create a second Fastify instance, register only `model-proxy-routes` and `model-proxy-auth-gate` on it, listen on the configured port (loopback by default).
- [ ] 9.2 Second-instance lifecycle: starts after main server, stops before it. Errors on bind (e.g., port in use) log a warning but do not block main server startup.
- [ ] 9.3 Test in `packages/server/src/__tests__/model-proxy-second-port.test.ts`: configure `secondPort: 9876`, assert both `:8000/v1/models` and `:9876/v1/models` return identical responses.

## 10. Server: recursion guard

- [ ] 10.1 Create pure helper `packages/server/src/model-proxy/recursion-guard.ts` exporting `isSelfPointing(baseUrl, dashboardOrigins): boolean`. `dashboardOrigins` is `string[]` covering `localhost:port`, `127.0.0.1:port`, `[::1]:port`, plus LAN IPs from `os.networkInterfaces()`, plus active mDNS hostname when set.
- [ ] 10.2 Wire the guard into `packages/server/src/routes/provider-routes.ts`'s `PUT /api/providers` handler: for each entry in the incoming providers map, validate `baseUrl` against `isSelfPointing`. On hit → 400 with `{code: "RECURSIVE_PROXY", message, offendingBaseUrl}`.
- [ ] 10.3 Unit tests in `recursion-guard.test.ts` covering: localhost variants caught; LAN-IP self caught; tunnel-host self caught; legitimate external URL passes; case/scheme normalization correctness.
- [ ] 10.4 Integration test in `provider-routes.recursion-guard.test.ts`: `PUT /api/providers` with self-pointing baseUrl returns 400 + correct error code; existing providers untouched on validation failure.

## 11. Server: optional request log

- [ ] 11.1 Create `packages/server/src/model-proxy/request-log.ts` with `logRequest(entry: RequestLogEntry)`. Append-mode `fs.appendFile` to `~/.pi/dashboard/model-proxy.jsonl`. Never logs body or API keys.
- [ ] 11.2 Skip logging entirely when `config.modelProxy.logRequests === false`. Verify via `vi.spyOn(fs, "appendFile")` in test — zero calls when disabled.
- [ ] 11.3 Each route handler emits one log line on completion (success or error) with `{ts, requestId: crypto.randomUUID(), apiKeyId, model, format: "openai"|"anthropic", status, durationMs, inputTokens?, outputTokens?, error?}`.
- [ ] 11.4 Add daily rotation via simple size check (>50MB → rename to `.jsonl.<date>`, start fresh). Tests in `request-log.test.ts`.

## 12. Client: API surface helpers

- [ ] 12.1 Create `packages/client/src/lib/model-proxy-api.ts` with `listApiKeys()`, `createApiKey({label})`, `deleteApiKey(id)`, `refreshRegistry()`. All thin `fetch` wrappers returning typed responses.
- [ ] 12.2 Unit tests in `model-proxy-api.test.ts` using `msw` (already a client devDep if used elsewhere; otherwise mock `fetch`).

## 13. Client: settings panel section

- [ ] 13.1 Create `packages/client/src/components/ModelProxySection.tsx` rendering:
  - Header: "API Proxy" + master toggle (binds to `modelProxy.enabled`).
  - Default model dropdown (sourced from existing models list).
  - Optional second port input (numeric, validated 1024–65535).
  - Subsection: "API keys" — table of `{label, createdAt, lastUsedAt, [reveal-once token if just created], revoke button}`. "+ New API key" button opens an inline form (label input → POST → display key in a one-shot reveal banner with copy button + dismiss).
- [ ] 13.2 Mount the section in `packages/client/src/components/SettingsPanel.tsx` between existing "LLM Providers" and "Trusted Networks" sections.
- [ ] 13.3 Reveal-once banner UX: large copy button, prominent "save this now" warning, dismiss-only (no re-show), persist a tiny "key created — see logs" trail in component-local state in case the user dismisses by accident.
- [ ] 13.4 Component tests in `ModelProxySection.test.tsx` using React Testing Library: master toggle persists, new-key flow shows banner, revoke removes row, second-port validation rejects out-of-range values.

## 14. Mutual-exclusion notes (NOT enforced)

- [ ] 14.1 Add a non-blocking warning in `ModelProxySection.tsx` if the bridge reports the upstream `@blackbelt-technology/pi-model-proxy` package is installed in `~/.pi/agent/settings.json` packages: "Upstream pi-model-proxy is also active in your pi sessions. Both will work; consider disabling the upstream extension to avoid duplicate listeners." Includes a link to the disable instructions.
- [ ] 14.2 No automatic disable. User-initiated only. Documented in the migration guide.

## 15. Documentation

- [ ] 15.1 Update `AGENTS.md`:
  - New entry under "Key Files" for each new file in `packages/server/src/model-proxy/`, `packages/server/src/routes/model-proxy-*-routes.ts`, `packages/client/src/components/ModelProxySection.tsx`, `packages/client/src/lib/model-proxy-api.ts`.
  - New section "Model proxy" describing the auth model, the API-key lifecycle, the recursion guard, the OAuth refresh contention notes.
- [ ] 15.2 Update `README.md` with a "Using the model proxy" section: one-line summary, example `OPENAI_BASE_URL`, link to settings.
- [ ] 15.3 Update `docs/architecture.md` with a sequence diagram showing external client → dashboard `/v1/...` → ModelRegistry → upstream provider; data flow for API-key auth; refresh trigger map.
- [ ] 15.4 Create `docs/migration/from-pi-model-proxy.md` covering: differences in URL/port, key migration, coexistence option, decision matrix.
- [ ] 15.5 Add a CHANGELOG.md entry under `## [Unreleased]` describing the new capability and the deps promotion.

## 16. End-to-end smoke test

- [ ] 16.1 Add `packages/server/src/__tests__/e2e/model-proxy-google-flash.test.ts` (skipped in CI by default, enabled via `E2E_MODEL_PROXY=1` env var). Steps:
  - boot dashboard server on a random port,
  - POST `/api/model-proxy/api-keys` to get a key,
  - GET `/v1/models` with the key — expect ≥1 model,
  - if any `google/gemini-2.5-flash*` model present: POST `/v1/chat/completions` with that model and `{messages:[{role:"user", content:"reply ok"}], stream:false, max_tokens:20}` → expect 200 + non-empty assistant text,
  - same model + `stream:true` → expect SSE chunks including at least one `delta.content`,
  - same model via `/v1/messages` (Anthropic shape) → expect 200,
  - delete the API key, attempt re-use → expect 401,
  - shutdown.
- [ ] 16.2 Document in the test header how to run locally: `GEMINI_API_KEY=… E2E_MODEL_PROXY=1 npm test -- model-proxy-google-flash`.

## 17. Validation

- [ ] 17.1 Run `openspec validate add-dashboard-model-proxy --strict` — fix any structural issues.
- [ ] 17.2 Verify `npm test` passes (all new + existing tests).
- [ ] 17.3 Verify `npm run build` succeeds and the new server module is included.
- [ ] 17.4 Verify the bundle-size delta is ≤ 1MB on the client side (the new section component should be small).
