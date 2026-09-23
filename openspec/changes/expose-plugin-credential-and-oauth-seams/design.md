## Context

See proposal.md — Why. Relevant current state (verified against source):

- **Storage.** `provider-auth-storage.ts` implements the following, all bound to the module constant `AUTH_PATH`:
  - `acquireAuthLock()`: `proper-lockfile`, `{stale:10_000, realpath:false}`, retries only on `ELOCKED` within a 2 s budget.
  - `withLock()`: creates the file with `wx` + `0o600`, and awaits `release()` in a guarded `finally`.
  - `readAuthJsonChecked()`, plus quarantine of a corrupt file to `*.corrupt-<stamp>`, deduplicated by a module-global `quarantinedBackups: Set<sha256>`.
  - `writeAuthJson()`.
- **Flows.**
  - `provider-auth-adapter.ts` `startFlow()` drives any `OAuthLoginFlow` and takes `writeCredential` as a dependency. It resolves `firstEvent` only on a user-facing step.
  - The **route** (`provider-auth-routes.ts`) adds the robustness: `awaitStartOutcome` (race `firstEvent` / `settled` / `FLOW_START_TIMEOUT_MS`), per-provider `queueStart` + `supersedePendingFlows`, `forgetFlow` on early failure, and `openInBrowser`.
- **UI.** `SignInPane` (`ProviderAddDialog.tsx`) takes `provider: ProviderAuthStatus` and has Copilot-specific pre-prompt logic inside `PaneShell` dialog chrome. UI primitive keys use the `ui:` namespace. `useUiPrimitive` throws outside a provider or for unregistered keys.
- **Types.** `OAuthLoginFlow` / `LoginInteraction` / `LoginPrompt` / `LoginEvent` live in `server/src/auth/pi-oauth-types.ts` and are not public. The runtime already mirrors server types structurally (`PluginAuthCredential`, `PluginModelRegistry`).
- **Bridge lanes.**
  - `pi.events.emit("dashboard:plugin-message", {pluginId, messageType, payload})` → server `dispatchPluginPiMessage`, which is keyed by `messageType` only (fan-out, return values discarded; `pluginId` is self-declared and unused).
  - Server→bridge private messages use `sendExtensionMessage`, gated to `priority ≤ 100`. The only consumer is special-cased in `bridge.ts` (`mcp_token_minted`).
- **Neighbouring change.** `add-connector-layer` already claims `~/.pi/agent/connector-auth.json` with a different schema and a "list never returns secrets" rule.

## Goals / Non-Goals

**Goals**
- One lock/quarantine implementation for `auth.json` and the plugin store, with `auth.json` behaviour unchanged.
- A plugin can persist, sign in, and serve its bridge without importing server internals.
- The request lane's replies are unobservable and unforgeable by *passive or other* extensions, and there is exactly one handler owner per `(pluginId, type)`.

**Non-Goals**
- Encryption at rest or an OS keychain (plaintext 0600, as with `auth.json`).
- Defending against a *malicious in-process* pi extension. It shares the process and the user's filesystem, can read any `~/.pi` file, and can impersonate a plugin id on the request lane. Stated here explicitly as the trust boundary.
- A connector catalog (`add-connector-layer`). That change may later adopt this store.

## Decisions

### D1 — Path-parameterised lock module; quarantine dedup keyed by path
Extract `withLockedJsonFile(path, fn)`, `readJsonChecked(path)` and `writeJsonAtomic(path, data, mode)` into `locked-json-file.ts`. Keep `LOCK_OPTIONS`, the `ELOCKED`-only retry, the backoff and async release verbatim.

The quarantine dedup set becomes `Map<path, Set<sha256>>`. A dedup hit for one file must never vouch for a backup of another (a shared set would let identical corrupt bytes in two files skip the refusal guard).

`provider-auth-storage.ts` calls the module with `AUTH_PATH`, and its exports and behaviour stay unchanged. A new test corrupts both files with identical bytes and asserts that each gets its own backup.

### D2 — Store file, schema and gate
- **File:** `~/.pi/agent/plugin-credentials.json`, not `connector-auth.json`, to avoid the `add-connector-layer` collision. Schema `{ "<pluginId>": { "<key>": <record> } }`, parsed into null-prototype objects.
- **Namespace:** the manifest id, bound by the host.
- **Keys:** 1–200 characters. `__proto__`, `constructor` and `prototype` are rejected.
- **Records:** plain JSON objects ≤ 64 KiB serialized. `get` returns a `structuredClone`.
- **Limits:** 256 keys and 2 MiB per namespace.
- **API:**
  - `get(key) → record|undefined`;
  - `list() → string[]` (keys only, for UI listings);
  - `snapshot() → Record<key, record>` (a clone of the caller's **own** namespace from one read);
  - `set(key, record)`, `remove(key)`;
  - `update(key, fn: (prev|undefined) → next|undefined)`, where `fn` runs **inside** the lock for atomic read-modify-write (return `undefined` to delete).
- **Locking:** writes (`set` / `remove` / `update`) are locked and do a whole-file atomic rewrite. Reads (`get` / `list` / `snapshot`) are unlocked, which is safe because the file is only ever replaced atomically, and a read never creates the file.
- **Gate:** every plugin, own namespace only. There is no cross-namespace surface. Denying third-party plugins would push them to unlocked ad-hoc files. `providerAuth` keeps its stricter first-party gate because it exposes LLM credentials.

### D3 — Shared `beginFlow()` for the route and the plugin seam
Move the route-only robustness into `beginFlow({ provider, loginFlow, preAnswers, writeCredential, notifyBridges })` in the adapter layer:
- per-provider `queueStart` + supersede;
- the `awaitStartOutcome` race with `FLOW_START_TIMEOUT_MS`;
- `forgetFlow` on early failure;
- `openInBrowser` when the server is local, keeping its `VITEST` suppression (`test-env-guard.ts`) so tests never spawn a real browser.

The existing `POST /api/provider-auth/start` calls it, with unchanged behaviour guarded by the existing route tests.

`ctx.oauth.startFlow({ key, loginFlow, persist })` calls `beginFlow` with:
- `provider = "plugin:<pluginId>:<key>"` (so two flows for the same plugin key supersede each other);
- `writeCredential = (_, c) => persist(c)`;
- no-op `notifyBridges`.

It returns `{ flowId }` or rejects with `PluginFlowStartError { code: "start_timeout" | "login_failed", message }`, exported from the runtime. The route keeps mapping the same outcomes to HTTP 504/500. Flows are then served by the existing `/api/provider-auth/flow/:flowId` status / input / cancel routes.

- **Registry independence.** The flow status / input / cancel routes currently `await registryReady` (the pi-ai provider registry). For flows whose `provider` starts with `plugin:`, the routes skip that wait, so plugin sign-in works even when the LLM provider registry is slow or failed to build.
- **Credential pass-through.** `persist` receives the object the plugin's `login()` resolved with, untouched: no normalisation, and extra fields such as `sub` / `email` / `grantedScopes` are preserved. Each flow has its own `persist` closure, so concurrent flows don't race.

Flow input is never logged. This already holds for provider flows and gets a test for plugin flows.

**Plugin client access.** The runtime exports a small client helper, `oauthFlowClient`, with `status(flowId)`, `input(flowId, value)` and `cancel(flowId)` over the existing routes, so plugin clients never hard-code paths. Paired with the `ui:oauth-flow` view.

### D4 — Public structural OAuth types in the runtime
Mirror `PluginOAuthLoginFlow`, `PluginLoginInteraction`, `PluginLoginPrompt`, `PluginLoginEvent` and `PluginOAuthCredential` into `dashboard-plugin-runtime/src/server/server-context.ts` (the same precedent as `PluginAuthCredential`). A compile-time test asserts the server's `pi-oauth-types` remain assignable to the mirrors in both directions.

### D5 — `createLoopbackCallback`
`createLoopbackCallback({ path = "/callback", timeoutMs = 300_000, signal }) → { redirectUri, state, waitForCode(): Promise<{code}>, close() }`:
- Binds `127.0.0.1` on port 0 and generates `state` itself (32 random bytes, base64url). This avoids a late-registered state.
- Only `GET <path>` counts; other paths get a 404 and the helper keeps waiting.
- On `<path>`, the **state check comes first**:
  - a missing or mismatched `state` gets a 400 and the helper keeps waiting (a stray or hostile local request cannot kill the flow, including one carrying `error=`);
  - with a matching `state`, an `error=` parameter rejects with `error` / `error_description`;
  - the comparison is length-checked before `timingSafeEqual`;
  - a match answers with a static completion page, resolves with the code, and closes.
- `close()` is idempotent. Timeout and abort reject and close.

It is pure `node:http` and lives in `dashboard-plugin-runtime/server`.

### D6 — Generic flow view as a UI primitive
Extract the flow-rendering body of `SignInPane` into `OAuthFlowView({ flow, onSendInput, onCancel })`:
- the auth-URL link;
- device code;
- `manual_code` paste;
- `select` / `text` prompts;
- status.

It has no provider-specific logic and no dialog chrome. `SignInPane` keeps its `provider` prop, the Copilot pre-prompt and `PaneShell`, and imports `OAuthFlowView` **directly** (not via `useUiPrimitive`), so existing dialog tests are unaffected.

`OAuthFlowView` is also registered under `ui:oauth-flow` for plugin slot components. `useUiPrimitive` is marked deprecated for plugin use in favour of server intents, but interactive settings sections already use it (`automation-plugin`, `blackhole-plugin`). A sign-in flow is interactive client state, so direct use follows that precedent.

### D7 — Request/reply lane (no `pi.events`)
```mermaid
sequenceDiagram
  participant T as plugin bridge (tool)
  participant X as core bridge (extension)
  participant S as host server
  participant P as plugin server handler
  T->>X: globalThis[Symbol.for("pi-dashboard.pluginRequest")](pluginId,type,payload) → Promise
  X->>X: size check ≤256KiB; requestId=uuid; pending.set(requestId,{resolve,timer 15s})
  X->>S: {type:"plugin_request",requestId,pluginId,messageType,payload}
  S->>S: lookup requestHandlers[(pluginId,type)] (single owner)
  S->>P: handler(payload,{sessionId})  (sessionId from socket key)
  P-->>S: result | throw
  S->>S: serialize + size check
  S->>X: host sends {type:"plugin_reply",requestId,ok,result|error}  (host-internal, not the gated plugin hook)
  X->>T: resolve({ok,result|error})
```
- **Bridge API.** The core bridge installs a function at `Symbol.for("pi-dashboard.pluginRequest")` on `globalThis` while it is connected. Plugin bridge entries call it and get a Promise; no `pi.events` is involved in either direction. When the symbol is absent (old extension, or not running under the dashboard), the call resolves `{ok:false,error:"unavailable"}`.
- **Server API.** `ctx.registerPiRequestHandler(type, handler)` registers under `(manifest pluginId, type)`. A duplicate registration for the same pair throws. The registry is separate from `registerPiHandler`, so `mcp_token_minted` and other fire-and-forget handlers are untouched.
- **Error codes.** `no_handler`, `timeout` (15 s), `disconnected`, `request_too_large`, `reply_too_large`, `reply_not_serializable`, `unavailable`. A handler throw → `error` = message only.
- **Trust.** "Private" means *not observable and not forgeable*, not *authenticated*:
  - The wire `pluginId` is claimed by the requesting code, and any code in any of the user's pi sessions can call any plugin's handler. Handlers MUST treat the request as coming from "some session of this user" and authorize on the payload. The Gmail lease authorizes by account level, for example.
  - A malicious in-process extension can impersonate a plugin (Non-Goal).
  - Passive or other extensions can neither observe nor forge replies, because replies resolve a Promise held only by the caller.
- **Priority gate.** `sendExtensionMessage`'s `priority ≤ 100` gate protects against plugins *pushing unsolicited* data into sessions. A `plugin_reply` only answers a request the same session's bridge made, on that session's socket, so it is sent host-internally for plugins of any priority.
- **Coordination.**
  - `harden-trust-and-credential-boundaries` allowlists `plugin_emit_event` names. This lane uses new protocol messages, not event names; task 4.4 adds a note to that change's `tasks.md`.
  - `add-connector-layer` task 1.2 plans the same lock-primitive extraction. It should consume `locked-json-file.ts` from this change; task 4.5 adds that note.

### D8 — End-to-end fixture: demo-plugin
`packages/demo-plugin` (client-only today) gains:
- a `server` entry that registers `demo/echo` via `registerPiRequestHandler` and exposes a route that starts a fake login flow via `ctx.oauth.startFlow`. The fake flow emits an `auth_url` plus a `manual_code` prompt, and resolves with a dummy credential when it receives the input `ok`;
- a `bridge` entry that registers a `demo_echo` tool calling the request lane.

Its settings section renders the flow through `ui:oauth-flow`. This exercises store → flow → UI → lane end-to-end in the docker harness without any real provider.

## Risks / Trade-offs

- **[Lock extraction regresses `auth.json`]** → Existing storage tests unchanged as the gate, plus a cross-file quarantine test. Doubt-review done at planning; re-review the diff.
- **[`beginFlow` refactor changes provider sign-in]** → Existing provider-auth route and adapter tests must pass unchanged.
- **[globalThis symbol is a new convention]** → Documented in the plugin-authoring docs, and namespaced via `Symbol.for("pi-dashboard.…")`.
- **[Whole-file rewrite per `set`]** → Bounded by the namespace caps; the write volume (sign-ins, refreshes) is low.
- **[Remote bridges]** → The lane rides the bridge WebSocket, so it works remotely. The loopback is local-only; `manual_code` paste covers remote.

## Migration Plan

Additive. Deploy = server restart + extension reload + client build. Rollback = revert; `plugin-credentials.json` stays inert on disk.

## Open Questions

None blocking.
