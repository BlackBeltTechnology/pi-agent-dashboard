## Why

Credentials for LLM providers, plugins, MCP servers and skills live in seven unrelated places today:
- `~/.pi/agent/auth.json`;
- `plugin-credentials.json`;
- `mcp.json` / `mcp-auth.json`;
- `system-one/auth.json`;
- three hand-rolled `.env` precedence chains (nano-banana, video-production, video-transcription);
- bare `process.env` reads (deck3d, quota, document-converter, browser-plugin).

An eighth (`connector-auth.json`) is planned by `add-connector-layer`. One key (`GEMINI_API_KEY`) is read by five or more consumers and can sit in three files at once. Nothing can be managed, rotated or scoped centrally, and nothing reaches sessions on other machines connected to the dashboard. pi's `auth.json` also holds one credential per provider id, so a second subscription account for the same provider (e.g. two Anthropic accounts) cannot be used at all.

## What Changes

- **Credential vault.** Add a vault owned by the dashboard server. Its entries are **accounts**: `oauth`, `api_key` or `secret`, several per provider allowed. An account is either:
  - stored in `~/.pi/agent/vault.json` (owner-only, locked, atomic); or
  - a **link** to the hub's existing `auth.json` login, which is never copied or moved, so no second refresher appears.
- **Bindings.** Bindings map accounts to how sessions see them: an environment variable name (`env` target) or a pi provider id (`llm` target), `single` or `pool`. A clone provider id (e.g. `anthropic-work`) lets a second account of the same provider be used side by side.
- **Per-project allowlist.** The allowlist is keyed by the git remote, or by device and path. Default deny. It provides least-privilege scoping on top of device trust.
- **Delivery to sessions on the hub and on paired devices.** The bridge extension delivers credentials, using only public pi extension APIs, and writes no credential files on the session machine:
  - `env` → set in the session's `process.env`. Consumers are unchanged and see the value from the next shell command.
  - `llm` API key → provider override with the key, held in memory.
  - `llm` OAuth, **lease** mode (default, own devices) → the hub issues a short-lived access token, delivered as the provider's key and renewed before expiry. The refresh token never leaves the hub.
  - `llm` OAuth, **proxy** mode → requests go through the hub's model-proxy. No provider token leaves the hub, and revocation is immediate.
- **Pools.** Pools are proxy-only and opt-in, with lossless failover on rate limits.
- **Local credentials take precedence.** Delivery never overrides a pre-existing environment variable, a local `auth.json` entry, a provider env var, or a `providers.json` provider. Such bindings are reported as `local-override`.
- **Redaction.** Delivered values are masked in tool output (text, structured content, full-output files) before they reach the transcript or the model.
- **Settings UI:**
  - accounts: add, link, enrol an additional OAuth account, rotate, revoke;
  - bindings, pools and project allowlists;
  - per-session binding state.
- **Plugin reads.** Plugins can read vault bindings their manifest declares and the user approves. `ctx.credentials` / `plugin-credentials.json` is unchanged.
- **Sibling re-scoping**, performed as tasks in this change:
  - `add-connector-layer` uses the vault instead of `connector-auth.json`;
  - `add-oauth-key-sync-service` (keysync) becomes the vault's standalone team deployment, proxy-only;
  - `add-cloud-sync-connector` takes OAuth from the vault.

## Capabilities

### New Capabilities
- `credential-vault`: covers
  - account-keyed storage, with `auth.json` linking and a single refresher per account;
  - bindings (env/llm, single/pool, clone ids) and the per-project allowlist;
  - additional-account enrolment, non-destructive import of service secrets;
  - declared-binding plugin reads.
- `credential-delivery`: covers
  - trusted, allowlisted delivery to sessions by target (env, llm api key, OAuth lease, OAuth proxy);
  - local-precedence rules;
  - live rotation and revocation push, proxy pool failover;
  - output redaction, graceful hub outage, clean disable, observable state.

### Modified Capabilities
- None. Each spec-collateral candidate is dispositioned in design.md D12: existing requirements stay valid because the vault writes no `auth.json`, uses no spawn-env contributor, and tracks its provider overrides separately from `providers.json` registration.

## Impact

- **Server** (`packages/server/src/`): vault store and routes, lease issuance, proxy pool selection in `model-proxy/`, device-bound proxy keys, delivery push over the bridge WebSocket.
- **Bridge** (`packages/extension/src/`): delivery module covering env set/unset (tracked set), provider overrides tracked apart from `providers.json`, lease renewal, redaction in `tool_result`, cleanup on disable or unload.
- **Client** (`packages/client/src/components/settings/`): vault, bindings, pools, allowlist and session-binding views.
- **Shared** (`packages/shared/src/protocol.ts`): delivery, push and status messages.
- **Plugin runtime** (`packages/dashboard-plugin-runtime/`): declared-binding reads.
- **Consumers that read env first** (nano-banana, video-*, deck3d, quota, system-one, document-converter): no code change. Delivered env outranks their `.env` and file fallbacks; the allowlist controls that.
- **Security surface:**
  - secrets cross the bridge WebSocket only to proof-bound paired devices;
  - lease tokens stay valid upstream until expiry after revocation, so lease mode is for own devices and proxy mode for immediate revocation;
  - redaction is exact-match.
- **Compatibility and rollback:** additive. With an empty vault, or delivery disabled, behaviour is identical to today. Disabling delivery removes every override and env var the vault created.
- **Policy note:** pool failover across subscription accounts may conflict with provider terms, so pools are opt-in and off by default.

## Discipline Skills

- `security-hardening`: secrets at rest, secrets over the bridge to paired devices, lease-token lifetime, transcript redaction, allowlist enforcement.
- `doubt-driven-review`: before fixing the vault schema and the `auth.json` link semantics, which become irreversible once users adopt them.
- `observability-instrumentation`: lease, refresh, failover, revocation and local-override events, never logging values.
- `systematic-debugging`: expected during the provider-applicability, identity and project-key spikes.
