# Tasks

> MVP vertical slice: vault (API-key) → invoker → OpenAPI registry → gateway tool → REST → settings UI → 3 seed connectors. OAuth (Phase 2) and code-execution façade (Phase 3) are out of scope for this change.

## 1. Credential store (the credential vault)

- [ ] 1.1 Reference vault `key` accounts: a connector's `credential_id` is a vault account id (`add-credential-vault`). Do NOT add a connector-specific secret file or crypto.
- [ ] 1.2 Resolve the value server-side through the vault's delivery-only reader (`VaultStore.getKeyValue`, `packages/server/src/vault/vault-store.ts`); only accounts of kind `key` resolve.
- [ ] 1.3 Connector store API: `list` shows the vault account's id, provider and label only (never a value); `get` of a revoked or unknown account fails.
- [ ] 1.4 Settings: adding an API-key connector credential is done in Settings → Vault (add or import), then picked by id in the connector form.
- [ ] 1.5 Tests: `list` never emits secret material; `get` of a revoked id fails and the connector becomes non-invocable; a non-`key` account does not resolve.
- [ ] 1.6 (Phase 2 stub only — not built here) OAuth connectors follow the vault's OAuth accounts (`add-vault-llm-delivery`); document, don't implement.

## 2. Connector Registry (OpenAPI loader)

- [ ] 2.1 Add the OpenAPI→operations loader (`mcp-from-openapi` Apache-2.0 or equivalent). Verify license before adding to deps.
- [ ] 2.2 Define connector definition shape `{ id, kind, ...descriptor, credentialId }` with a `kind` discriminator (`http` | `openapi` | `graphql`). MVP implements `http` + `openapi` descriptors only; reserve `graphql` in the type so Phase C adds it without migration. OpenAPI descriptor = `{ openapiSpecRef, operationId }`. Include a per-spec **curation manifest** (NOT just hide/patch) expressive enough for Phase A: operation **allowlist** (default-deny so a 587-op spec exposes ~6), per-op rename + search-summary override, `baseServer` with variable substitution (e.g. `{store}.myshopify.com`), and `securityScheme → credentialType + injection location` mapping. This is what makes Phase A "data, not code."
- [ ] 2.3 Loader produces, per operation: `id`, `summary` (for search), `paramSchema` (for get_schema), and an invoke descriptor (method, path, param mapping, auth location).
- [ ] 2.4 Bundle 3 seed specs/connectors: Slack `chat.postMessage`, GitHub `issues.create`, and a generic-HTTP connector. Map each to a credential type.
- [ ] 2.5 Tests: loading a seed spec yields the expected operation ids + param schema; an overrides file hides/patches an operation.

## 3. Connector Invoker (core)

- [ ] 3.1 Implement `invoke(InvokeRequest { connectorId, params }) → InvokeResult` as a backend-dispatched core: resolve connector from registry → read credential from store → dispatch on `kind` to a backend (MVP: `http`/`openapi`; backend interface shaped so `graphql` slots in later) → inject auth in the descriptor's location → execute → return normalized result.
- [ ] 3.2 Auth never enters logs, errors, or returned definitions. Redact marked fields in results (best-effort).
- [ ] 3.3 Error normalization: provider 4xx/5xx → structured error with status + provider message, no secret leakage.
- [ ] 3.4 Tests (mocked HTTP): successful invoke injects correct auth header; missing credential → typed error; provider error surfaces without secrets.

## 4. Gateway tool (LLM seam — token invariant)

- [ ] 4.1 Expose exactly three tools: `search_connectors(query)`, `get_connector_schema(id)`, `call_connector(id, params)`. No per-operation tools.
- [ ] 4.2 `search_connectors` ranks enabled connectors only (the settings enable-set bounds results); returns top ~5 `{id, summary}`.
- [ ] 4.3 `get_connector_schema` returns one operation's param schema. `call_connector` delegates to the Invoker.
- [ ] 4.4 Wire the gateway into the pi MCP surface so pi-flows agents can call it.
- [ ] 4.5 Token-budget guard test: the gateway registers exactly 3 tool schemas regardless of catalog size (assert count is constant for 3 and 50 connectors).

## 5. REST routes (programmatic seam)

- [ ] 5.1 `GET /api/connectors` (enabled list, no secrets), `GET /api/connectors/:id/schema`, `POST /api/connectors/:id/invoke`. All delegate to the same Invoker.
- [ ] 5.2 AuthZ: attach the existing `networkGuard` (`localhost-guard.ts`, `createNetworkGuard(trustedNetworks)`) as a `preHandler` on the invoke route — identical wiring to `openspec-group-routes.ts`. Do NOT add a new auth scheme; the global `auth-plugin` onRequest gate + loopback bypass already applies.
- [ ] 5.3 Tests: invoke route returns Invoker result; list/schema routes never emit secrets; non-loopback request without trust is rejected by `networkGuard`.

## 6. Settings UI

- [ ] 6.1 Settings-section slot panel: add/list/revoke credentials (paste API key/bearer), shown via the existing plugin settings host.
- [ ] 6.2 Enable/disable connectors; the enabled set bounds `search_connectors` and `GET /api/connectors`.
- [ ] 6.3 Never render stored secret values back (write-only field; show masked indicator only).
- [ ] 6.4 Tests: enabling a connector makes it searchable; revoking a credential disables dependent connectors.

## 7. Documentation

- [ ] 7.1 Delegate to a general-purpose subagent (caveman style): add rows to the matching `docs/file-index-<area>.md` split(s) for every new file (vault, registry, invoker, gateway, routes, settings panel).
- [ ] 7.2 Delegate a `docs/connector-layer.md` topic doc: architecture (one core / three façades), the token invariant, the OpenAPI catalog model, the vault threat model, and the Phase 2 (OAuth) / Phase 3 (code-execution façade) roadmap.
- [ ] 7.3 Add a `connector-layer` pointer line in AGENTS.md (≤ 200 chars), per the Documentation Update Protocol.

## 8. Validate

- [ ] 8.1 `openspec validate add-connector-layer --strict` passes.
- [ ] 8.2 Manual smoke: add a Slack API key in settings → agent calls `search_connectors("slack post")` → `call_connector` posts a message → same via `POST /api/connectors/:id/invoke`.
