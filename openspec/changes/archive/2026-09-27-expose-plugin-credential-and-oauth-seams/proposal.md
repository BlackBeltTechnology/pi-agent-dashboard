## Why

Dashboard plugins that talk to third-party services (first consumer: the Gmail plugin, `add-gmail-plugin`) need three things the host already implements but does not expose:

1. **Locked credential persistence.** `packages/server/src/auth/provider-auth-storage.ts` has a hardened `proper-lockfile` lock, a lock-held-only retry window, 0600 creates, and corrupt-file quarantine. All of it is hard-wired to `~/.pi/agent/auth.json` and is internal to the server package. Plugins may import only `dashboard-plugin-runtime`, so today each plugin would re-invent unlocked storage.
2. **The OAuth sign-in flow machinery.** `provider-auth-adapter.ts` (`startFlow`, the flow store, `/api/provider-auth/flow/:flowId` status / input / cancel, the `manual_code` paste fallback for remote dashboards) already drives any `OAuthLoginFlow`, and it takes `writeCredential` as an injected dependency. It is reachable only for pi-ai LLM providers.
3. **A private bridge→server request/reply lane.** Plugin bridge entries can send to their server entry (`pi.events.emit("dashboard:plugin-message", …)`). The only private server→bridge reply exists as a hard-coded special case (`mcp_token_minted` in `packages/extension/src/bridge.ts`). A plugin that leases short-lived tokens to its tools has no generic, private way to get an answer back.

Adding these seams once turns every future connector plugin into plugin-local code.

## What Changes

- Extract the lock + atomic-write + quarantine helpers from `provider-auth-storage.ts` into a path-parameterised module. `auth.json` behaviour stays byte-for-byte identical (refactor; existing tests are the guard).
- Add a **plugin credential store**: `~/.pi/agent/plugin-credentials.json` (0600), partitioned by plugin id. Exposed as `ServerPluginContext.credentials` with `get` / `list` (keys only) / `snapshot` / `set` / `remove` / atomic `update`, scoped to the calling plugin's own namespace. It deliberately does not use `connector-auth.json`, which `add-connector-layer` claims with a different schema.
- Add **plugin OAuth flows**: `ServerPluginContext.oauth.startFlow({ key, loginFlow, persist })`. The route-only start robustness (start timeout race, supersede, cleanup) moves into a shared `beginFlow()` used by both the existing provider route and plugins. Flows are served by the existing `/api/provider-auth/flow/:flowId` status / input / cancel routes, including the `manual_code` paste fallback. Structural OAuth types are mirrored into the runtime. A `createLoopbackCallback()` helper is exported from `dashboard-plugin-runtime/server`.
- Extract the generic flow-rendering body of the sign-in pane into `OAuthFlowView` and register it as UI primitive `ui:oauth-flow`. The provider dialog keeps its provider-specific wrapper.
- Add a **plugin bridge request/reply lane**:
  - Bridge side: the core bridge exposes a Promise-returning function at `globalThis[Symbol.for("pi-dashboard.pluginRequest")]`.
  - Server side: `ServerPluginContext.registerPiRequestHandler(type, handler)`, with a single owner per `(pluginId, type)`.
  - New protocol messages `plugin_request` / `plugin_reply` carry the traffic. `pi.events` is not used in either direction, so other extensions can neither observe nor forge replies.

No breaking changes. All additions are optional on `ServerPluginContext`, so older hosts and test contexts stay valid.

## Capabilities

### New Capabilities
- `plugin-credential-store`: namespaced, locked, 0600 credential persistence for dashboard plugins.
- `plugin-oauth-flow`: plugins start OAuth sign-in flows through the host flow store, routes, sign-in UI, and loopback helper.
- `plugin-bridge-request-lane`: private request/reply between a plugin's bridge entry and its server entry.

### Modified Capabilities
- `provider-auth-server`: the flow status / input / cancel routes also serve plugin-started flows, without waiting for the provider registry. Plugin flow completion goes to the plugin's persist callback, not `auth.json`. Provider flow behaviour is unchanged. Storage internals and the start robustness (`beginFlow`) move behind shared modules.

## Impact

- **Server:**
  - `packages/server/src/auth/provider-auth-storage.ts`: extraction only.
  - New `packages/server/src/auth/locked-json-file.ts`.
  - New plugin-credential module.
  - `provider-auth-adapter.ts`: flows gain an owner tag (`provider` = `plugin:<id>:<key>`).
  - `server.ts`: context wiring.
- **Runtime:** `packages/dashboard-plugin-runtime/src/server/server-context.ts` gains `credentials`, `oauth`, `registerPiRequestHandler` (all optional) and the mirrored OAuth types. New `createLoopbackCallback` export.
- **Extension:** `packages/extension/src/bridge.ts` installs the `pluginRequest` symbol and dispatches `plugin_reply`.
- **Client:** `OAuthFlowView` is extracted from `SignInPane` and registered as `ui:oauth-flow`. The Provider dialog's behaviour is unchanged.
- **Shared:** `ui-primitives.ts` key `ui:oauth-flow`; protocol messages `plugin_request` / `plugin_reply`.
- **Dependencies:** none new (`proper-lockfile` is already a server dependency).
- **Migration / rollback:**
  - The new file is created lazily and nothing reads it unless a plugin uses the seam.
  - Rollback = revert. `plugin-credentials.json` is left on disk and is harmless.

## Discipline Skills

- `security-hardening`:
  - The store holds live refresh tokens.
  - Namespace isolation must hold.
  - Flow input carries auth codes, which must never be logged.
  - The reply lane must not be observable or forgeable by other extensions.
  - A malicious in-process extension is out of scope and documented as the trust boundary.
- `doubt-driven-review`: extracting the `auth.json` lock is the irreversible-feeling step. Every pi session and the model proxy depend on it. Review before the extraction stands.
- `review-code`: before commit.
