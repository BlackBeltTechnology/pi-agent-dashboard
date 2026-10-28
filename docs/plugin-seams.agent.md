# plugin-seams.md — plugin seams index

Pull-only condensed map. Source: docs/plugin-seams.md. Server-entry seams on `ServerPluginContext` from `@blackbelt-technology/dashboard-plugin-runtime/server`. Example: `packages/demo-plugin`. Consumer: `packages/gmail-plugin`.

## Credential store (`ctx.credentials`)
- File `~/.pi/agent/plugin-credentials.json`, plaintext 0600. NOT `connector-auth.json`.
- Schema `{ "<pluginId>": { "<key>": <record> } }`. Own namespace only, host-bound.
- `get` clone|undefined. `list` keys. `snapshot` own namespace.
- `set`/`remove` locked atomic rewrite. `update(key, fn)` atomic RMW; `undefined` deletes.
- Shares `locked-json-file.ts` lock with `auth.json`. `get`+`set` races; use `update`.
- Keys 1–200 chars. Reject `__proto__`, `constructor`, `prototype`.
- Record ≤ 64 KiB. ≤ 256 keys/ns. ≤ 2 MiB/ns.
- Errors `PluginCredentialError`: `invalid_key`, `invalid_record`, `record_too_large`, `too_many_keys`, `namespace_too_large`.

## OAuth (`ctx.oauth.startFlow`)
- Returns `{ flowId }`, served at `/api/provider-auth/flow/:flowId`.
- Provider `plugin:<pluginId>:<key>`. Re-start same key supersedes.
- Errors `PluginFlowStartError`: `start_timeout`, `login_failed`.
- `persist(credential)` gets `login()` result untouched.
- Start timeout `FLOW_START_TIMEOUT_MS` = 15 s. TTL 10 min. Input never logged.
- `plugin:` flows skip `registryReady` wait.
- Routes: `GET` status, `DELETE` cancel, `POST .../input`.
- Client `oauthFlowClient`. Render `ui:oauth-flow`.

### Loopback (`createLoopbackCallback`)
- `{ path, timeoutMs, signal }` → `{ redirectUri, state, waitForCode, close }`.
- Binds `127.0.0.1` port 0. `state` = 32 random bytes base64url.
- Only `GET <path>` counts; else 404.
- State checked first: mismatch → 400, keep waiting (even with `error=`).
- Match + `error=` → reject. Length check before `timingSafeEqual`.
- `close()` idempotent. Local-only; remote uses `manual_code`.

## Request/reply lane (bridge ↔ server)
- Bridge: `requestPluginServer(pluginId, type, payload)` from `.../bridge`. Not `pi.events`.
- Core bridge sets `globalThis[Symbol.for("pi-dashboard.pluginRequest")]` while connected.
- Absent → `{ ok: false, error: "unavailable" }`. Always resolves; check `reply.ok`.
- Server: `ctx.registerPiRequestHandler?.(type, (payload, { sessionId }) => …)`.
- One owner per `(pluginId, type)`; duplicate throws. Separate from `registerPiHandler`.
- `sessionId` from socket key, never payload. Throw → `error` = message only.
- Caps 256 KiB request + reply. Timeout 15 s.
- Errors: `no_handler`, `timeout`, `disconnected`, `request_too_large`, `reply_too_large`, `reply_not_serializable`, `unavailable`, bridge-side `request_not_serializable`.
- Flow: `plugin_request {requestId,pluginId,messageType,payload}` → handler → `plugin_reply`.

## Editor-pane tabs (`editor-pane-tab`)
- React-only, many, no predicate. Addressed by prefix.
- Claim: `component`, `pathPrefix`, optional `labelComponent`.
- `pathPrefix` `^[a-z][a-z0-9-]{1,31}$` (`PANE_TAB_PREFIX_RE`). Reserved `diff|term|url|live`.
- Tab path `<pathPrefix>:<rest>`, viewer kind `plugin`.
- Body props `{ path, session, isActive, onClose }`; label `{ path, session }`.
- Unclaimed/disabled → `PluginTabUnavailable`. Never hits `/api/file`.
- Cross-plugin duplicate prefix fails registry gen.
- Open: `/session/<id>/editor?tab=<path>` via `openPluginTabRoute` (`editor-pane-tab.tsx`).
- Server open: `ctx.openEditorTab(sessionId, path)`, own prefix only; WS `editor_tab_open`.
- Client acts only on `/session/<id>` or `/editor` routes.
- See change: `add-browser-editor-pane-tab`.

## Prompt metadata (`pluginMeta`)
- `ctx.ui.*` opts accept `pluginMeta` (`packages/extension/src/prompt-meta.ts`). ≤ 2048 UTF-8 bytes.
- Copied to `metadata.plugin`. Invalid → dropped with warning.
- Never overrides `message`, `toolCallId`, `kind`.
- Client → `params._pluginMeta`.

## Host read seams
- `getPiResources?(cwd?, { fresh? })` → `GetPiResourcesFn`. Absent → 501. Consumer: `packages/skill-atlas-plugin`.
- Cached → as is; stale → bg refresh; cold → await; `fresh: true` → rescan after call.
- `onPiResourcesInvalidated?(handler)` → unsubscribe. Per-subscriber try/catch.

## Lazy claim modules (`module`)
- `PluginClaim.module?` (`packages/shared/src/dashboard-plugin/manifest-types.ts`). Starts `./`, no `..`. Requires `component`.
- Gen `vite-plugin/index.ts` emits `lazyClaim(() => import(spec), "<component>")`.
- `predicate`, `shouldRender`, `labelComponent` stay static.
- Gen FAILS: module missing; no named `component`; main entry exports `component`.
- Prod build FAILS (`renderChunk`) if module in registry chunk.
- Runtime `lazyClaim` in `lazy-claim.tsx`. Failed load contained.
- Fallbacks: `renderClaim` null (`ContentClaimSkeleton` for `shell-overlay-route`, `content-view`); `renderPaneClaim` null; `ToolCallStep` null; `CustomEntryRow` → `CustomEntryCard`.
- Lazy: on-demand surfaces, ≳10 KB. Eager: badges, predicates, catalogs, composer-inline, hot sidebar.
- Rules: no lazy export from main entry; no eager import of `module`; heavy children via `lazy()`.
- Compat: adopters set engines/peer floor. Old dashboard → `does not export` build error. Rollback: remove `module`, restore barrel exports.
- First-party lazy adopters: settings-section (apple-tools, automation, blackhole, browser, chat-gateway, context-mode-settings, cost-estimator, flows, goal, grammar, quota, roles, subagents, system-one); shell-overlay-route (AutomationBoard, AutomationRunMonitor, GoalsBoardClaim, GoalDetailClaim, KbSettingsClaim, FolderMcpPage, SubagentPopoutClaim); McpSettingsClaim; PipelineDetailView; BrowserPaneTab; FlowDashboardClaim, FlowYamlPreviewClaim, FlowInputWiringClaim, FlowWriteToolRenderer.
- Follow-up: `yaml` (~98 KB) still eager.

## Trust boundary
- "Private" = not observable, not forgeable. NOT authenticated.
- `pluginId` self-claimed; unchecked vs socket. Any session can call any handler → authorize on payload.
- Malicious in-process extension out of scope. No encryption at rest.

## Fixture gate
- `PI_DASHBOARD_FIXTURE_PLUGINS=1` gates `fixture: true` plugins (server + bridge entries; fixture clients via `fixturePolicy: "included"`).
- Set only by docker test harness.
- `packages/demo-plugin`: `demo/echo`, fake login flow, `ctx.credentials`, `demo_echo` bridge tool.

## Decoupling seams (decouple-plugins-from-core)
- Shared contracts in non-plugin pkgs: `shared/dashboard-plugin/subagent-types.ts`, `shared/mcp/verb-tiers.generated.ts`, `packages/mcp-core`. Gate `npm run check:plugin-boundary`.
- Manifest `eventTypes` (exact or `prefix_*`) → one `role:"rawEvent"` group row per owned type (`ownedGroup`, payloads cap 50). Availability read at render via `pluginAvailability`, never in reducer.
- Client entry exports `sessionEventReducer` + `toolRowFinalizers`; shell registers via `./host`, gated by enabled set; heal guards; generic heals stay in core.
- `tool-renderer` claim: `expandWhileRunning`, `resultPending` (sync predicate export name).
