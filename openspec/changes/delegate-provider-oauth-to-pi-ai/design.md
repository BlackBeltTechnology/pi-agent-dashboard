## Context

pi-ai (`@earendil-works/pi-ai` ≥ 0.85) exposes every OAuth provider as an `OAuthAuth`:

```ts
interface OAuthAuth {
  name: string; loginLabel?: string; isSubscription?: boolean;
  login(interaction: ProviderAuthInteraction): Promise<OAuthCredential>;
  refresh(credential, signal): Promise<OAuthCredential>;
  toAuth(credential): Promise<ModelAuth>;
}
interface AuthInteraction {
  signal?: AbortSignal;
  prompt(p: AuthPrompt): Promise<string>;   // text | secret | select | manual_code ; rejects on cancel
  notify(e: AuthEvent): void;               // info | auth_url | device_code | progress
}
```

`login()` is the whole flow — it opens its own `node:http` callback server for auth_code providers, polls for device_code providers, and returns the credential to persist. The dashboard's job reduces to: be an `AuthInteraction`, then `writeCredential()`, then `notifyBridges()`.

**Where the flows are reachable from.** pi-ai's `exports` map exposes `.`, `./compat`, `./providers/*`, `./api/*`, `./utils/*`, `./oauth` (types only), `./bedrock-provider`, `./bun-oauth` — **not** `./dist/auth/oauth/*`. `registerBundledOAuthFlowLoaders` is a *setter* for Bun binaries (returns `void`, keys are camelCase function names), not a discovery API. The supported surface is the provider definition: each built-in provider carries `auth.oauth = lazyOAuth({ name, load })` (`providers/anthropic.js:46`). pi-coding-agent's public index exports `ModelRuntime`; `ModelRuntime.create()` builds every built-in provider and `getProviders()` returns them with `id`, `name`, `auth.oauth`.

Measured on 0.86.1: `import("@earendil-works/pi-coding-agent")` **373 ms** (the index re-exports the whole SDK incl. TUI + WASM); `ModelRuntime.create({ modelsPath: null, credentials: <empty store> })` **~300 ms** 
— `create()` awaits an offline availability pass (`checkAuth` per built-in provider) that reads the credential store; with an empty read-only store it reads no credentials and never opens the network; some ambient-auth providers (e.g. google-vertex) still `stat` well-known credential files during that pass — harmless, but it is not zero I/O.

**Types.** pi-coding-agent's index re-exports `ModelRuntime` but not pi-ai's `Provider` / `OAuthAuth` / `AuthInteraction` / `AuthEvent` / `AuthPrompt`; an `import type` from `@earendil-works/pi-ai` would resolve to the hoisted 0.75.5 copy, which lacks them. The server therefore declares **local structural types** for the slice it uses (`OAuthLoginFlow { name; login(i) }`, `LoginInteraction { signal; prompt; notify }`, the four prompt kinds, the four event kinds — ~40 lines). The D3 assertion only proves the *registry* surface; prompt/event-kind drift is caught by the adapter tests (which run every bundled flow's first step against the real runtime) and, at runtime, by an unknown kind surfacing as `status: "error"`, `error: "unsupported prompt: <kind>"` on that flow.

**Per-provider first interaction (verified against 0.86.1):**

| id | first interaction | then |
|---|---|---|
| anthropic | `notify auth_url` then `prompt manual_code` (synchronous back-to-back, raced; `anthropic.js:211,217`) | callback or paste |
| openrouter | `notify progress`, then `notify auth_url` + `prompt manual_code` (ephemeral `listen(0)` port) | callback or paste |
| openai-codex | `prompt select` (browser / device-code) | browser → auth_url + manual_code; device → device_code |
| github-copilot | `prompt text` ("GitHub Enterprise URL/domain") | `notify device_code` + poll |
| kimi-coding, xai, meta | `notify device_code` | poll |
| radius | `prompt select` — bundled by `builtinProviders()`, but its OAuth targets a gateway URL taken from pi's settings, which the dashboard does not manage | excluded by id |

Device-code polling rejects with `"Device flow timed out"` at the code's deadline (`device-code.js:67`); cancellation rejects with `"Login cancelled"`. Neither string is something the dashboard should match on.

## Goals / Non-Goals

**Goals**
- Every provider pi-ai bundles (minus `radius`) is sign-in-able from the dashboard with zero per-provider flow code.
- Remote dashboards (docker / zrok) can complete auth_code sign-in via the `manual_code` prompt.
- `auth.json` written by the dashboard is byte-compatible with what pi writes (same pi-ai code path produces the credential; the dashboard's existing locked / backed-up `writeCredential` persists it).

**Non-Goals**
- `radius` — needs per-gateway configuration from pi settings. Filtered out by id.
- Providers from `~/.pi/agent/models.json` or extension registration. The runtime is created with `modelsPath: null` and nothing registered, so `getProviders()` is builtin-only and the registry is the same on every machine.
- Changing `redirect_uri` / callback ports — provider-registered, immutable.
- Fixing the pre-existing `EADDRINUSE` when a pi session runs `/login` concurrently with a dashboard sign-in on the same host — but it must surface synchronously (D6).
- Moving login into the bridge extension (B2). Rejected: requires a live session; reintroduces the bridge-catalogue coupling that `redesign-providers-settings-page` just untangled.
- Using `ModelRuntime.login()` for persistence. It writes through pi's `CredentialStore`, bypassing the dashboard's backup / clobber-refusal write rule. We call `provider.auth.oauth.login()` and keep `writeCredential`. (Verified: `create({ allowModelNetwork: false })` — the default — never writes `auth.json`; the refresh path is gated on `allowNetwork`.)
- Fixing the pre-existing `custom-llm` scenario in "Server exposes registered handler ids": `_buildAuthStatus` skips `entry.custom` rows, so a catalogue-only OAuth provider was never emitted as an api-key row. The carried scenario is reworded to what this change actually guarantees (not an OAuth row; `/start` → 400).

## Decisions

### D1 — One adapter, server-side (B1)

**Registry.** Built once, at server bootstrap, from a cached promise:

```ts
const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");   // lazy; 373 ms, off the request path
const runtime = await ModelRuntime.create({ modelsPath: null, credentials: EMPTY_READONLY_STORE });   // pi never sees the dashboard's auth.json
const registry: OAuthRegistryEntry[] = runtime.getProviders()
  .filter(p => p.auth?.oauth && p.id !== "radius")
  .map(p => ({ id: p.id, name: p.auth.oauth.name, flowType: FLOW_TYPE_HINT[p.id] ?? "device_code", auth: p.auth.oauth }));
```

`OAuthRegistryEntry { id, name, flowType, auth }` replaces `ProviderHandler { providerId, displayName, flowType, … }`; `_buildAuthStatus`, `getOAuthProvidersMeta`, `resolveAuthJsonKey`, and the DELETE route's `isOAuthRow` are re-pointed at `id` / `name`. The `-api` twin rule keys on the **id set** only (`oauthIds.has(entry.id)`), never on `flowType`.

The whole thing is wrapped: any throw → `registrySnapshot = []` + the D3 health error. `FLOW_TYPE_HINT = { anthropic: "auth_code", "openai-codex": "auth_code", openrouter: "auth_code" }` and the `radius` exclusion are the **only per-provider facts left in the dashboard**. It decides which pane the Add-provider dialog opens first — nothing else. Unknown ids default to `device_code` (every provider added since 0.80 is device-code); a wrong hint only mis-picks the initial pane, because the pane follows whatever the flow actually emits (D2).

**Sync/async boundary.** `_buildAuthStatus` stays a pure function taking `oauthEntries: OAuthRegistryEntry[]` (its tests keep injecting fakes); `getAuthStatus()` passes the module-level `registrySnapshot` (empty until ready). Every provider-auth route `await oauthRegistryReady` before handling; the bootstrap kicks the build off immediately so the first request rarely waits.

**Stored OAuth credentials are OAuth rows regardless of the registry.** `_buildAuthStatus` and the DELETE route's `isOAuthRow` treat an id as OAuth when it is in the registry **or** `auth.json` holds `{ type: "oauth" }` under that id. Today a credential pi wrote for a provider the dashboard has no handler for (e.g. `kimi-coding` via `/login`) is invisible and — via `removeCredential`'s kind check — un-removable; that bug goes away, and under a D3 failure previously connected providers stay visible and sign-out-able (just not re-loginable: `/start` → 400). A stale tab holding a `-api` id across such a restart could still write an orphan `<id>-api` key through `resolveAuthJsonKey`; accepted — `/api/health` names the failure and the orphan key is removable.

**Adapter.** Each start creates a flow record (D2) and calls `auth.login(interaction)` with `interaction.signal = flow.abort.signal`:

| pi-ai call | adapter effect on the flow record |
|---|---|
| `notify({type:"auth_url", url})` | `authUrl = url` (sticky; never cleared); `openInBrowser(url)` on the first one |
| `notify({type:"device_code", …})` | `pending = { kind:"device_code", userCode, verificationUri, intervalSeconds?, expiresInSeconds? }`; `deviceCodeDeadline` + TTL per D7 |
| `notify({type:"progress"\|"info", message})` | `message = …` (does not touch `pending`) |
| `prompt({type:"manual_code", message, placeholder, signal?})` | `pending = { kind:"manual_code", … }`; `resolveInput` set; resolved by `POST flow/:id/input`. If the prompt carries its own `signal`, its abort also clears `pending` and rejects — applies to every prompt kind below |
| `prompt({type:"select", message, options})` | `pending = { kind:"select", … }`; same path; value must be an option `id` (the flow rejects otherwise) |
| `prompt({type:"text", message, placeholder})` | if this is the flow's **first** prompt and `preAnswers` is non-empty → resolve with it immediately (never becomes `pending`); else `pending = { kind:"text", … }`; same path. `preAnswers` is discarded after the first prompt of any kind |
| any answerable prompt resolves (via `/input`) | clear `pending`, `resolveInput`, `rejectInput` before handing the value to the flow |
| `prompt({type:"secret"})` | reject `Error("unsupported prompt: secret")` — no bundled provider issues it |
| flow's `AbortController` fires | reject any pending prompt with `Error("Cancelled")`, clear `pending` |
| `login()` resolves | if `flow.cancelled` → discard the credential, `status="error"`, `error="Cancelled"` (cancel raced a late resolve). Else `await writeCredential(id, credential)` → `notifyBridges()` → `status="complete"`. If `writeCredential` throws (`CredentialTypeConflictError`, un-backed-up refusal) → `status="error"`, `error = write error message` |
| `login()` rejects | `status = flow.cancelled ? "error" : deadlinePassed ? "expired" : "error"`; `error = flow.cancelled ? "Cancelled" : message` (D7) |
| any terminal status | `pending`, `resolveInput`, `rejectInput` cleared; `abort` listeners removed |

**The abort row is load-bearing.** In `anthropic.js:190-276` (same shape in `openai-codex.js`; openrouter's listener instead finishes with `"Login cancelled"`, equivalent outcome) the outer `signal` only calls `server.cancelWait()`; the code then `await manualPromise`, whose own signal is aborted in the `finally` block — reached only once `manualPromise` settles. If the adapter waited solely on the prompt-level signal, cancel would deadlock and the callback port would stay bound. Rejecting *every* pending prompt on the flow's controller settles `manualPromise` → `throw manualError` → `finally` closes the server.

**Race note.** `auth_url` notify and `manual_code` prompt are issued back-to-back. The record holds *both* — `authUrl` (sticky string) + `pending` (current prompt) — so the UI shows the link and the paste field simultaneously. Never a single-slot union.

### D2 — Flow record

```ts
interface OAuthFlow {
  id: string;                             // crypto.randomUUID() — replaces the Math.random()-based makeFlowId
  provider: string;
  status: "pending" | "complete" | "error" | "expired";
  createdAt: number; expiresAt: number;   // D7
  deviceCodeDeadline?: number;            // D7
  cancelled: boolean;                     // set by DELETE / prune / shutdown before abort()
  authUrl?: string;                       // sticky from the auth_url notify
  message?: string;                       // last progress/info
  pending?:                               // what the UI must render / answer
    | { kind: "device_code"; userCode; verificationUri; intervalSeconds?; expiresInSeconds? }   // render-only
    | { kind: "manual_code"; message; placeholder? }
    | { kind: "text";        message; placeholder? }
    | { kind: "select";      message; options: { id; label; description? }[] };
  error?: string;
  // server-only, never serialised:
  resolveInput?: (v: string) => void; rejectInput?: (e: Error) => void;   // set only for answerable kinds
  preAnswers: string[];                   // D6 — consumed only while promptCount === 0
  promptCount: number;
  abort: AbortController;
}
```

Shared type `OAuthFlowStatus` in `packages/shared/src/rest-api.ts` = `{ flowId, provider, status, authUrl?, message?, pending?, error? }`. Routes and exact strings:

| route | behaviour |
|---|---|
| `POST /api/provider-auth/start { provider, enterpriseDomain? }` | D6 handshake → 200 `OAuthFlowStatus`; 400 `Unknown OAuth provider: <id>`; 500 `{ error }` if `login()` rejects before any event; 504 `Provider did not respond` |
| `GET /api/provider-auth/flow/:flowId` | `OAuthFlowStatus`; 404 `Invalid or expired flow` |
| `POST /api/provider-auth/flow/:flowId/input { value }` | 202 `{ ok: true }` when `resolveInput` is set; 409 `No input pending for this flow` otherwise (including `pending.kind === "device_code"`); 404 as above. `value` is never logged / echoed |
| `DELETE /api/provider-auth/flow/:flowId` | `cancelled = true; abort.abort()` → 204; 404 as above |

`POST /authorize`, `POST /device-code`, `GET /device-status/:flowId` are **removed** (client is the only caller). `packages/shared/src/route-tiers.ts` drops the three entries (`:142`, `:230`, `:231`) and gains the four new ones. `DELETE /api/provider-auth/:provider` (2 segments) and `DELETE /api/provider-auth/flow/:flowId` (3 segments) do not collide in Fastify's router.

### D3 — Which pi-ai the server uses

Three copies exist: hoisted `@earendil-works/pi-ai` **0.75.5** (extension peer floor; no `providers/*` OAuth), nested under `@earendil-works/pi-coding-agent` **0.85.1**, and the global pi runtime **0.86.1**. Both `import "@earendil-works/pi-ai/providers/all"` from `packages/server` (`ERR_PACKAGE_PATH_NOT_EXPORTED` on the hoisted 0.75.5) and any `dist/…` deep import (exports map) fail — verified by execution.

Decision: the server never imports pi-ai. It dynamically imports **`ModelRuntime` from `@earendil-works/pi-coding-agent`** (public index export), which binds to the pi-ai copy pi-coding-agent was built against. Version parity by construction; no resolver tricks. The import is `await import(...)` inside the registry builder, kicked off at bootstrap — the server has no static pi-coding-agent import today and this keeps the 373 ms off the request path and out of module-load order.

**Bump to 0.86.1** (`meta` is new there). `scripts/verify-release-deps.mjs` `checkPiPinCoherence` governs **six** pins that must all move together: `packages/server/package.json` dependency (`^0.86.1`), `piCompatibility.minimum`, `piCompatibility.recommended`, `pnpm-workspace.yaml:50` override, `docker/Dockerfile` install pin, and the checker's own `minVersion`. Then `pnpm install` refreshes the lockfile; the nested copy becomes 0.86.1.

**Startup assertion**: after `create()`, require `typeof runtime.getProviders === "function"` and ≥ 1 entry with `auth.oauth`. On failure (including a throw from `import()` or `create()`): `registrySnapshot = []`, log, and `/api/health` carries `providerAuth: { error: "<message> (pi-coding-agent <VERSION>)" }` using the index's exported `VERSION`; if the `import()` itself is what failed, fall back to reading `package.json` from the directory of `import.meta.resolve("@earendil-works/pi-coding-agent")`, else `unknown` (the package's `package.json` is not in its exports map) beside the existing `piRuntime` block — the version is in the error string, not only the log. All other routes keep serving; `/handlers` returns `{ ids: [] }`.

### D4 — `expires` for openrouter

`openrouter` stores `{ type:"oauth", access:<api key>, refresh:"", expires:<number> }`. Server: `_buildAuthStatus` emits `expires: null` when `!refresh` (empty or absent). This widens `ProviderAuthStatus.expires?: number` → `number | null` in `packages/shared/src/rest-api.ts`. The client's `provider.expires && relativeExpiry(...)` (`ProviderAuthSection.tsx:768`) already short-circuits `null`; the type widening makes that intentional rather than incidental. Client rule is a null check, not provider knowledge.

### D5 — Delete, don't shim — and the blast radius

Removed in the same change: the three hand-ported handlers, `generatePKCE`, `postJson`, `AuthCodeHandler` / `DeviceCodeHandler` / `ProviderHandler`, and `oauth-callback-server.ts`. Keeping them "as fallback" would leave two code paths writing the same `auth.json` keys with different token metadata.

Every consumer of the deleted surface (verified by grep):

| site | change |
|---|---|
| `server.ts:3380` — shutdown imports `closeAllCallbackServers` | replace with `abortAllFlows()` (sets `cancelled`, aborts, clears) |
| `provider-auth-storage.ts:23,355-410,463-491` — `getAllHandlers`, `ProviderHandler`, `_buildAuthStatus`, `getOAuthProvidersMeta`, `resolveAuthJsonKey` | consume `OAuthRegistryEntry { id, name, flowType }` from the sync snapshot |
| `provider-auth-routes.ts` (all) | rewritten per D2; `isOAuthRow` at `:276` reads the snapshot |
| `shared/src/route-tiers.ts:142,230,231` | swap routes |
| `shared/src/rest-api.ts` | `OAuthFlowStatus`, `ProviderAuthStatus.expires: number \| null` |
| **client** `ProviderAuthSection.tsx:380-503` | not a call-site swap: replace the two start paths + `/status` / `/device-status` polling with `/start` + `/flow/:id` polling and a prompt renderer (`manual_code` / `text` / `select` / `device_code`) + `/input` + cancel. This is the largest single piece of the change |
| server tests: `provider-auth-routes.test.ts:78`, `provider-auth-storage.test.ts:80`, `build-auth-status.test.ts:8`, `provider-auth-handlers.test.ts`, `oauth-callback-server.test.ts`, `provider-auth-credential-conflict.test.ts:29`, `provider-auth-device-code-conflict.test.ts`, `provider-auth-device-code-await.test.ts` | rewrite against the registry / flow store; delete the two that test deleted files |
| client tests: `ProviderAddDialog.test.tsx:55-62`, `ProviderAuthSection.refetch.test.tsx:34`, `ProviderAuthSection.poll-budget.test.tsx:76` | mock `/start` + `/flow/:id` |
| e2e: `tests/e2e/redesign-provider-add-flow.spec.ts:44,238` | mock `/start` |

**Id set grows 3 → 7**, so the `-api` twin now applies to `openrouter`, `kimi-coding`, `meta`, `xai`: an `openrouter` API key stored today surfaces as the `openrouter-api` row after this change. Logic untouched; input set changed. The picker's existing cross-type suppression keeps a user with a stored `openrouter` key from being offered the OAuth sign-in that `writeCredential` would refuse.

### D6 — Start handshake

`POST /start` must answer synchronously with something the UI can render, and must surface a listener bind failure as 500 rather than a later `status: "error"` (anthropic binds inside `startCallbackServer` at `anthropic.js:190`, *before* the `auth_url` notify).

```
cancel any pending flow for the same provider (its fixed callback port would otherwise EADDRINUSE)
create flow (randomUUID)
preAnswers = typeof enterpriseDomain === "string" ? [enterpriseDomain] : []     // null / non-string → no pre-answer
login(interaction) — not awaited
await Promise.race([ firstEvent, loginSettled, timeout(15 s) ])      // timer cleared whichever branch wins
  ├ first auth_url / device_code / answerable prompt → 200 OAuthFlowStatus   (progress/info are not first events)
  ├ login rejected before any event                  → 500 { error: <message> }   (EADDRINUSE names the port); flow deleted
  ├ login resolved before any event                  → normal resolve row (write + notify) → 200 status: "complete"
  └ timeout                                          → 504 { error: "Provider did not respond" }; flow cancelled + deleted
```

`preAnswers` feed the adapter's `text` row: github-copilot's enterprise-domain prompt is answered from the request body (empty string = github.com) without ever becoming `pending`. A start with no `enterpriseDomain` leaves the prompt pending, so a future text-prompting provider degrades to "render the field" rather than failing.

### D7 — Flow lifecycle

- `expiresAt = createdAt + 10 min`. On a `device_code` event with a **numeric** `expiresInSeconds`: `deviceCodeDeadline = now + expiresInSeconds·1000`, `expiresAt = max(expiresAt, deviceCodeDeadline + 60 s)`. Missing/non-numeric `expiresInSeconds` (optional in `AuthEvent`) leaves both unchanged — such a flow can only end `"error"`, never `"expired"`; every bundled device flow today supplies a number.
- **`expired` derivation**: `login()` rejects, `!cancelled`, `deviceCodeDeadline` is set and `now ≥ deviceCodeDeadline` → `status = "expired"`. Otherwise `"error"`. No matching on pi-ai's message strings.
- **`Cancelled` derivation**: `DELETE`, prune, and shutdown set `cancelled = true` *before* `abort.abort()`; a rejection while `cancelled` stores `error = "Cancelled"` regardless of pi-ai's own message (`"Login cancelled"`).
- `pruneFlows()` runs on every provider-auth request **and** on a 60 s timer; a pruned pending flow is cancelled (as above) before deletion — never dropped live. A flow whose device code expired reports `status: "expired"` until pruned.
- Flow ids are `crypto.randomUUID()`; the previous `Math.random().toString(36)` id is not unguessable and `/input` accepts a secret keyed by it.

## Risks / Trade-offs

- **Port collision** with a pi session's own `/login` (53692 / 1455). Pre-existing; now a synchronous 500 from D6 naming the port.
- **`ModelRuntime` is a public export but its `create()` options and `Provider.auth.oauth` shape are pi-coding-agent internals.** Mitigation: D3 assertion + `/api/health`; the bridge already depends on the same class.
- **373 ms dynamic import at bootstrap.** Off the request path; the first `/status` after a cold start may wait for it. Acceptable vs. a static import that would put the whole SDK (TUI, WASM) in module-load order.
- **Behavioural drift on the 3 existing providers.** pi-ai may write extra credential fields (Copilot `enterpriseUrl`, Codex `accountId`). 0.85.1 → 0.86.1 field sets verified identical; the fork's fields were a subset. `test-plan.md` re-logins each and diffs `auth.json`.
- **`manual_code` / `text` input may be a secret.** Never logged, never echoed by `GET flow/:id`; ids are UUIDs.
- **Empty registry on D3 failure** degrades every OAuth-capable provider to an api-key row under its bare id. Self-consistent (no twins → no `-api` ids in flight), and `/api/health` says why.
- **Server/bridge provider-set skew.** The registry follows the server's pinned pi-coding-agent; a connected session on an older pi may not know `meta` / `kimi-coding` / `xai`. The dashboard would still offer sign-in and write a valid credential that session cannot use until it upgrades. The existing `piRuntime` health block already flags version divergence; no further mitigation.
- **Sibling changes.** `add-google-oauth-provider` registers its provider from the *extension* via `pi.registerProvider({ oauth })`; this registry is builtin-only, so that provider will show in the catalogue but not be sign-in-able from the dashboard (the existing `custom-llm` scenario) until a follow-up feeds extension-registered providers into the registry. `add-mid-turn-tool-oauth` cites `oauth-callback-server.ts` as a *template* for connector OAuth (no import); its design should point at git history once this lands. The `oauth-callback-server` capability spec is removed by this change (all five requirements describe the deleted file).

## Migration Plan

No data migration — `auth.json` keys and shapes unchanged. Rollout: six-pin bump → `pnpm install` → server restart. Rollback: `git revert` + restart; credentials written by the new path remain valid for the old path (superset of fields).

## Open Questions

None. Earlier questions resolved on evidence: pi-coding-agent does not re-export the OAuth loaders (and they are not the right surface anyway — D1/D3); the two flowType-gated start routes are replaced by one `POST /start` because `flowType` is now a hint, not a fact the server can enforce (D1, D6).
