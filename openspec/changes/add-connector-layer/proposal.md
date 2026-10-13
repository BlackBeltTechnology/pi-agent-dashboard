# Add a token-aware connector layer (managed auth + OpenAPI catalog + gateway exposure)

## Why

pi-flows orchestrates AI agents, but those agents cannot call third-party services (Slack, GitHub, Notion, …) without each flow author hand-rolling an HTTP client and pasting raw tokens into prompts. The team reached for n8n's ~400 connectors as the obvious source.

Two hard constraints kill the obvious paths:

1. **License.** The connector engine must be **bundled** into pi-dashboard (Electron + npm packages). n8n is fair-code (Sustainable Use License) and Nango is Elastic License 2.0 — **both forbid bundling/redistribution**. Composio is MIT but its self-host story is immature and it is a platform, not an embeddable library. So no off-the-shelf connector mega-platform can ship inside the product.

2. **Token budget.** Registering one MCP tool per connector operation is fatal: real measurements show 200+ tools consume ~150K of a 200K context window *before the user types anything* (GitHub's MCP alone ≈ 18K tokens for 27 tools). A naive "expose every connector as an MCP tool" design would make every pi-flows agent unusable.

The capability the team actually wants — **manageable auth tokens in settings + connectors callable by the LLM and via API** — is small and buildable from permissive (MIT/Apache) building blocks, *if* the design is token-aware from day one. This change defines that connector layer.

## What Changes

Introduce a **connector layer**: one execution core, three façades, fed by an OpenAPI-driven catalog, with managed credentials.

- **Credential store** — **uses the credential vault (`add-credential-vault`)**: an API-key connector references a vault `key` account (`credential_id` = vault account id). No second secret file: the vault owns storage (0600, locked, corrupt-safe), rotation, revocation and the never-return-a-value rule. MVP supports **API-key** credentials (paste-a-token, or import). OAuth is a later phase that follows the vault's OAuth work (`add-vault-llm-delivery`). Connectors read values server-side through the vault; values are never delivered to sessions for connector calls.
- **Connector Registry** — a connector is `{ id, kind, ...descriptor, credential_id }` where `kind ∈ {http, openapi, graphql}`. MVP ships `http` (generic) + `openapi`. The OpenAPI loader (pattern of `mcp-from-openapi`, Apache-2.0) turns provider specs into invocable operations + JSON-schema metadata. Adding an OpenAPI provider = drop in its spec + map the credential. No per-connector hand-coding. The `kind` discriminator is the seam that lets Google (Discovery→OpenAPI converter) and GraphQL (separate invoke backend) land in later phases without reworking the core.
- **Connector Invoker (core)** — single execution path: resolve operation → read credential from vault → inject auth → HTTP call → return result. Shared by all three façades and the REST API.
- **Gateway tool (token-aware LLM seam)** — instead of N tools, expose **three constant tools**: `search_connectors(query)`, `get_connector_schema(id)`, `call_connector(id, params)`. Progressive disclosure keeps per-turn context cost flat (~2K tokens) regardless of catalog size. This is the **default** seam for pi-flows agents and is model-agnostic.
- **REST routes** — `GET /api/connectors`, `GET /api/connectors/:id/schema`, `POST /api/connectors/:id/invoke` for external/programmatic callers. Same Invoker core. Invoke routes **reuse the existing `networkGuard` preHandler** (`localhost-guard.ts`) exactly like `openspec-group-routes.ts` — loopback bypass for local single-user, gated when the dashboard is exposed.
- **Settings UI** — a settings-section slot panel to add/list/revoke credentials and enable/disable connectors (the enable-set bounds what `search_connectors` returns).

**Committed catalog roadmap** (full reach is the goal; MVP stays a thin vertical slice, later phases slot into the `kind` seam without core rework):
- **MVP (this change):** generic-HTTP + Tier-1 OpenAPI, 3 seed connectors.
- **Phase A:** Tier-1 OpenAPI scale-out (GitHub, Stripe, Twilio, Slack, Notion, … APIs.guru's ~2,500) — register specs + credential maps, no new code.
- **Phase B:** Google suite (Gmail/Calendar/Drive/Sheets) — add a Discovery→OpenAPI ingest converter; reuses the `openapi` invoke path.
- **Phase C:** GraphQL services (Linear, Shopify Admin) — add a `graphql` invoke backend + introspection-based registry.

**Deliberately out of scope for this change** (follow-ups):
- OAuth 2.0 credential flows — **reuse the existing `ProviderHandler` registry + `oauth-callback-server.ts` (127.0.0.1 loopback) + `buildRedirectUri` tunnel support + refresh machinery**; implement a handler per OAuth connector provider. No redirect spike needed (the mechanism already ships for LLM providers). **Phase 2** (pairs with Phases A/B/C as each provider is onboarded).
- Code-execution façade (connectors as an importable code library, beats the result-payload tax too). Designed-for but not built here. **Phase 3.**
- Static "pin connector to context" mode (skip the search round-trip for hot connectors).

## Capabilities

### Added Capabilities

- `connector-layer`: managed-credential storage, an OpenAPI-driven connector registry, a single invocation core, and a token-aware gateway tool + REST exposure that lets pi-flows agents and external callers invoke third-party APIs without per-connector context cost.

## Impact

- **New code, no behavior change to existing features.** pi-flows, the server, and the Electron app are unaffected unless a connector is configured.
- **New dependencies (all permissive, bundle-safe):** `mcp-from-openapi` (Apache-2.0) or equivalent OpenAPI→tool loader. No new crypto/keychain dep (credential store reuses existing machinery). `arctic` (MIT) is **optional, Phase 2 only** — the OAuth dance already exists in-repo, so Arctic would contribute provider presets at most. No fair-code / ELv2 code enters the product.
- **Token budget:** gateway seam holds per-turn tool context flat (~3 tool schemas) no matter how large the catalog grows. This is the core design invariant.
- **Security surface:** the store holds live third-party credentials at 0600 (same posture as existing provider creds); invoke routes gated by `networkGuard`. Threat model documented in `design.md`.
- **MVP scope estimate:** credential store (thin wrapper over existing machinery) + invoker + registry loader + gateway tool + REST routes + settings panel + 3 seed connectors (Slack post-message, GitHub create-issue, generic-HTTP). Small-to-medium — the OpenAPI loader is the only substantive new piece; credential storage, OAuth refresh, route authZ, and (Phase 2) the OAuth flow all reuse existing server code.
- **Sequencing:** standalone. Phase 2 (OAuth) and Phase 3 (code-execution façade) build on this change's Invoker core and registry without reworking them.

## Discipline Skills

- `security-hardening`: the connector layer reads live third-party secrets (now from the credential vault) and must never return a value through a tool, façade or REST response.
