## Why

Plugins that wrap a third-party API with a server-held secret (the eight Hungarian connectors in the separate `itlinekft/pi-hu-connectors` repo are the first users) each need the same four pieces: namespaced codemode tools in the bridge, a confirmation before every write, a private call from the tool to the plugin server, and a settings page that stores the secret and never shows it again. `pi-hu-connectors/packages/core` built these once outside the dashboard. Every connector then ships its own client bundle (`src/client/settings-form.js`), so every connector needs operator bundle trust, and every connector re-implements secret storage. The generic parts belong in the host.

The spike also found a host bug. A tool that stops waiting for `ctx.ui.confirm` leaves the dashboard card open. The bridge's patched `ctx.ui.confirm` drops `opts.timeout` and `opts.signal` (`packages/extension/src/bridge-handlers/ui-prompt-patch.ts:123-125`), so the card stays open until the PromptBus default (`askUserPromptTimeoutSeconds`, 300 s, or never when set to `-1`). A late click on that card answers a question the tool has already given up on.

## What Changes

- **Connector kit subpath** `@blackbelt-technology/dashboard-plugin-runtime/connector`. It holds pure, erasable TypeScript only (no React, no host internals), so runtime-installed plugins can import it as source.
  - `registerConnectorTools(pi, spec)` (bridge). Registers one tool per operation, named `<connectorId>_<tool>`, with `exposure: "codemode"`, a shared `namespace`, and read/write/destructive `annotations`. Every write asks `ctx.ui.confirm` with `{timeout, signal}` and `pluginMeta`, showing the full parameters; parameters over 4 KiB are refused (`invalid_input`) rather than truncated. A `false` after the effective timeout (the smaller of the kit and session prompt timeouts) is `confirmation_timeout`, earlier it is `declined`. The tool calls the plugin server through `requestPluginServer` and maps every outcome to a stable error code.
  - `registerConnectorServer(ctx, spec)` (server). Binds to the host-supplied `ctx.pluginId` (new) and refuses a mismatching `spec.pluginId` or a host without the request lane at activation. Registers `GET`/`PUT`/`DELETE /api/plugins/<id>/config`. GET returns which secrets are set, never their values. An empty secret on PUT keeps the stored value. Secrets go to `ctx.credentials`, never to `config.json`. The helper registers one lane handler per operation (`<connectorId>/<op>`). The server re-checks a "writes enabled" switch (`writes_disabled`), returns `missing_credential` when config is missing, enforces a deadline shorter than the lane timeout (a write that hits it is `lane_timeout`, outcome unknown), and redacts secret values from every result. A locked credential store (`store_locked` from `encrypt-credentials-at-rest`) or a record from a newer kit is reported, never overwritten. It broadcasts a `settings-section` intent so the host renders the settings page.
- **Stable error contract** `ConnectorErrorCode` + `OpResult` in `packages/shared/src/dashboard-plugin/connector.ts`, re-exported by the subpath. This adds `lane_timeout` to the reference union (outcome unknown: a write may have been applied). `ConnectorField` has kinds `text|secret|select|boolean` and a 4 KiB per-value cap.
- **Host-rendered settings primitive** `ui:connector-settings`. It renders the field list with the shared settings kit and saves through the host Save bar. Connectors ship no client bundle, so they need no bundle sha256 trust.
- **Bug fix (bridge):** the patched `ctx.ui.select/input/confirm/editor/multiselect/inputWithImages/batch` honour `opts.timeout` and `opts.signal`. Either one cancels the PromptBus prompt, and the existing `prompt_cancel` path removes the card on every surface. An already-aborted signal dispatches nothing. No protocol field is added. The bridge also exposes the session prompt timeout as read-only `ctx.ui.promptTimeoutMs`, because a patched `confirm` returns `false` for both a decline and a bus cancel.
- **Lane fix:** a request frame the bridge could not send resolves `unavailable` (nothing left the bridge) instead of `disconnected`, which now means only an in-flight close (outcome unknown).
- Route protection: a connector's concrete `/api/plugins/<id>/config` routes rely on the fail-closed `operate` default and on MCP advertising only reviewed manifest rows. Generic `:id` rows would never match a concrete plugin path, so none are added. The fixture plugin adds concrete tier rows and a denylist prefix.
- `PLUGIN_HOST_API_VERSION` minor bump `1.3.0` → `1.4.0`: new primitive key, the `./connector` subpath (its export signatures recorded in the surface snapshot) and `ctx.pluginId` on the server context.
- A first-party fixture plugin proves the kit end to end. It has no real provider and is fixture-gated.

Non-goals: provider code, XML helpers, the OpenAPI catalog or gateway (`add-connector-layer`), agent bash sandboxing, and a countdown on the dashboard card.

## Capabilities

### New Capabilities

- `plugin-connector-kit`: bridge tool registration, write confirmation, lane call and error mapping; server config routes, secret handling, operation handlers, redaction and deadline; the error-code contract; the `./connector` subpath; route tiers and MCP denylist.

### Modified Capabilities

- `bridge-extension`: ADDED requirements. Patched dialog methods honour a per-call `timeout` and an abort `signal`; an already-aborted signal dispatches nothing; `ctx.ui.promptTimeoutMs` exposes the session prompt timeout.
- `ask-user-tool`: MODIFIED "Configurable PromptBus timeout for ask_user". The bus timeout becomes an upper bound that a per-call timeout or signal may shorten. The previous text said every method "inherits the same" timeout. The method list gains `inputWithImages` and `batch`, which already route through the bus.
- `plugin-bridge-request-lane`: MODIFIED "Bounded waiting and payloads". A frame that could not be sent is `unavailable`; `disconnected` means a close after sending.
- `plugin-host-api`: MODIFIED "Host API surface snapshot gate". The snapshot records `./connector` export names and printed types.
- `plugin-ui-primitive-registry`: ADDED requirements. `ui:connector-settings` key and contract, page binding, field rendering, Save-bar saving.

## Impact

- `packages/extension/src/bridge-handlers/ui-prompt-patch.ts`, `packages/extension/src/prompt-bus.ts` (per-request timeout and abort, `promptTimeoutMs`), `packages/extension/src/plugin-request-client.ts` (not-sent → `unavailable`).
- `packages/dashboard-plugin-runtime/src/server/server-context.ts` (`pluginId`), `scripts/host-api-surface.mjs` (`./connector` in the snapshot).
- `packages/shared/src/dashboard-plugin/{connector.ts,ui-primitives.ts,host-api.ts}`, `packages/shared/src/route-tiers.ts` (fixture rows only).
- `packages/dashboard-plugin-runtime/src/connector/*` (new), `package.json` exports, `host-api-surface.json`.
- `packages/client/src/components/primitives/ConnectorSettings.tsx` (new) and its registration at startup.
- `packages/mcp-server-plugin/src/server/tools.denylist.ts` (fixture prefix only).
- A new fixture plugin under `packages/` (fixture-gated, not shipped in production bundles).
- **Compatibility:** additive only. Existing plugins and manifests are unchanged. A runtime connector plugin declares `hostApi: "^1.4.0"`. On an older host it is refused with reason `host-api`, which is intended because the primitive is missing there. The dialog fix changes behaviour only for callers that pass `timeout` or `signal`. Before this change those options were ignored. The lane fix changes one error string for a request that was never sent (`disconnected` → `unavailable`); current lane callers (`flows-plugin` retry, `gmail-plugin` lease client) already treat `unavailable` as "not connected".
- **Migration:** none. `pi-hu-connectors` connectors switch from `@pi-hu/core` to the subpath. Their stored records were in their own `secure-store` envelope, so they must be entered again once (no import path; documented in that repo).
- **Rollback:** revert the change. Records written by the kit stay in `plugin-credentials.json` under the plugin's namespace and are inert without the kit. The dialog fix reverts to ignoring `timeout`/`signal`, and the lane fix reverts to `disconnected`. `ctx.pluginId` disappears; connector plugins are refused on the older host by their `hostApi` range.
- **Cross-change:** blocked by `encrypt-credentials-at-rest`. Related to `add-connector-layer`: that change uses the vault and its own invoker, with no shared invoke path, and it may reuse this kit's error union and settings primitive later. Related to `add-supervised-tool-approval`, which ignores tool annotations (its D2), so no double prompt by default. In sessions spawned by the chat gateway, spec `chat-gateway` "Hard in-session tool policy for spawned sessions" may escalate a connector write to its own `ctx.ui.confirm` approval, so the user is asked twice (note only, no mechanism here).
- **Threat model:** `writesEnabled` and the in-bridge confirm are consent gates, not a security boundary. Same-user agent bash can flip `writesEnabled` through `pi-dashboard api` (bare `curl` is refused by local proof), and another in-process extension can call the lane directly. Bash sandboxing and a server-verified approval token are follow-ups (design Risks).

## Discipline Skills

- `security-hardening` — secrets in settings and storage, redaction, untrusted provider responses rendered to the agent, plugin-supplied intent props.
- `observability-instrumentation` — new REST routes and lane handlers. Log the operation, outcome code and duration, never values.
- `doubt-driven-review` — a new public plugin API (subpath + primitive + host API bump) is hard to take back once third-party plugins depend on it.
