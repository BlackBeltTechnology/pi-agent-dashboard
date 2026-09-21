## 1. Shared compat seam (pin still `^0.75.5`)

- [x] 1.1 Move `PiAiModule` + `PiAiOAuthModule` type declarations from `packages/server/src/model-proxy/internal-registry.ts` / `internal-auth-storage.ts` into `packages/shared/src/piai-compat/types.ts`, re-exporting from the old locations. Verify: `npx tsc --noEmit` clean across workspaces, no import churn in route files.
- [x] 1.2 Write failing tests for shape detection in `packages/shared/src/piai-compat/__tests__/detect.test.ts`: all-seven-members fake → legacy; `createModels`+`createProvider` fake → factory; partial fake (has `getModels`, lacks `streamSimple`) → rejected naming the missing members; empty object → rejected. Verify: `npx vitest run piai-compat` fails before implementation.
- [x] 1.3 Implement detection + legacy passthrough in `packages/shared/src/piai-compat/index.ts` exporting `adaptPiAi(module, resolvedPath?)` (design D1/D2). Verify: 1.2 tests pass; legacy branch returns the input object identity.
- [x] 1.4 Implement path-safe subpath derivation (design D5) using `path` operations on the resolved module directory, asserting the expected basename, probing before use, erroring with the resolved path. Verify: unit test with a POSIX path, a Windows-style path, and a non-matching path (must error, not no-op).
- [x] 1.5 Implement the factory branch's registry surface: build and cache one `builtinModels()` collection from the derived `providers/all.js`; **project `getProviders()` from `Provider` objects to id strings** (the legacy contract is `() => string[]`, and feeding objects into `getModels()` returns zero models silently); map `getModels`/`getModel`; `registerApiProvider`/`unregisterApiProviders` are no-ops (no repo callers), `registerBuiltInApiProviders` is a no-op on the factory branch but IS still called by the `InternalRegistry` constructor. Verify: against the real ≥0.85 module, `getProviders()` returns **strings**, and the total model count summed over those ids exceeds 1000 (measured 1443) — a count assertion, not a non-empty-list assertion.
- [x] 1.5b Add the silent-empty guard test: adapt the real ≥0.85 module and assert `getModel("anthropic","claude-opus-5")` resolves AND the built-in model total is non-trivial. Verify: the test fails if `getProviders()` is passed through unprojected.
- [x] 1.6 Implement the `model.api` → `{module, exportName}` lazy-api table (design D4) with memoized `ProviderStreams`, and an unmapped-api error naming the api and model with no credential material. Verify: unit test asserts an unmapped api errors and that the error body contains no key material.
- [x] 1.7 Add the drift guard: a test diffing the D4 table against the **text-streaming** `*.lazy.js` factories the resolved runtime ships, explicitly excluding `openrouter-images.lazy.js` (returns `{generateImages}`, not a `ProviderStreams`). `Api` is an open union, so no compile-time exhaustiveness is possible. Verify: test fails if a text factory exists with no table entry, and does NOT false-fail on the images factory.
- [x] 1.8 Implement factory `streamSimple` per design D3: obtain `normalizeContext` **from the resolved module** (root export, else the derived `utils/transcript` subpath — note: no `.js`; and 0.75.5 ships neither, so this is factory-branch-only), then dispatch **api-first** via the D4 table with the owning built-in provider as fallback, forwarding the caller's whole options object with `apiKey`/`headers` applied last. Never `Models.streamSimple`. Verify: tests assert `systemPrompt`+`tools` appear in the normalized transcript, `getAuth` is never invoked, `signal` is forwarded, and the legacy branch does NOT normalize.
- [x] 1.8b Add the misroute regression test: a custom model authored under a **built-in provider name** with a different `model.api` dispatches through its own api, not the built-in provider's. Verify: test fails under provider-first dispatch.
- [x] 1.9 Add the regression test for the cycle-2 defect: an OAuth-only provider (`openai-codex`, no `provider.auth.apiKey`) streams with a caller-supplied `apiKey` without a "Provider is not configured" failure. Verify: test passes on the factory branch.
- [x] 1.10 Implement the OAuth capability facade (design D7) with **per-provider** `isAvailable(providerId)`: legacy `oauth.js` only when it exports the expected functions; else pre-load the async `dist/auth/oauth/*` loaders during `adaptPiAi` behind a provider-id → loader map, translating `refresh(credential, signal)`/`{access,refresh,expires}` to `refreshToken(creds, signal)`/`{accessToken,refreshToken,expiresAt}` and preserving the storage's synchronous `getOAuthProvider(id)` call shape; else report that provider unavailable. Verify: tests cover all three cases, including an `export {}`-shaped stub reporting unavailable rather than raising `TypeError`.
- [x] 1.11 Check `providers/cloudflare-*.js` for `options.env` / injected auth-header dependence and record whether provider-level dispatch is parity with 0.75.5 or a regression for that class (design Risks). Verify: finding written into the design's risk entry; if it is a regression, a follow-up task is added before step 3.

## 2. Wire the seam

- [x] 2.1 Route `registry-singleton.getModelRegistry()` through `await adaptPiAi(module, resolvedPath)`, assign the **adapted** surface to `cachedPiAi` (not the raw module, or `getStreamSimpleFn()` returns undefined on a factory runtime), and preserve existing `lastError` / `ModuleResolutionError` handling. Verify: existing `registry-singleton` + `internal-registry` tests stay green; a test asserts `getStreamSimpleFn()` is defined after adapting a factory module.
- [x] 2.2 Switch `bridge.ts` to stream through pi's own `ctx.modelRegistry.streamSimple` (design D6 — module-only mode withdrawn). Verify: auto-namer tests green and the namer produces a title against a ≥0.85 runtime.
- [x] 2.3 Gate `InternalAuthStorage` on the facade's per-provider `isAvailable(providerId)` instead of truthiness, and make its refresh path async-aware. Update `internal-auth-storage-refresh.test.ts`, which constructs `PiAiOAuthModule` directly and will break on the new member. Verify: test that an unavailable provider yields a diagnosable OAuth error while api-key models still route.
- [x] 2.4 Surface OAuth capability in `/api/health` as **`proxy.oauthProviders: { <providerId>: boolean }`** (clarification C2), not by flipping `proxy.status` to `degraded`, which stays reserved for a dead registry. Verify: health response carries the per-provider map, and `proxy.status` stays `ready` when only OAuth is unavailable.
- [x] 2.5 Rewrite `packages/server/src/__tests__/pi-ai-shape.test.ts` to assert the *seam's* contract across both generations instead of the seven raw members + six OAuth symbols. Verify: the rewritten test passes on 0.75.5 and expresses the factory expectations.
- [x] 2.6 Add the deferral guard: a test asserting this change does NOT alter whether the proxy route's `system:` key reaches the provider (design Non-Goals). Verify: test pins current behavior.
- [x] 2.7 Run the full suite on the unchanged pin. Verify: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log` shows no failures.

## 3. Move the pin

- [x] 3.1 Bump root `package.json` devDependency `@earendil-works/pi-ai` to `^0.86.1`, update the pi-ai `peerDependencies` range to state the supported window, and run `pnpm install`. Leave `piCompatibility` untouched (design D9 — it is a pi-coding-agent range). Verify: installed version prints `0.86.x`; `pi-version-skew.test.ts` still passes.
- [x] 3.2 Amend `docs/architecture.md`'s "no conditional code paths" statement to record the two-generation **pi-ai** window served by one declared seam — leaving the `piCompatibility`/pi-coding-agent lockstep statements alone. Delegate the prose to the `DocScribe` subagent per the repo's docs rule; do not edit `docs/` directly. Verify: the doc names the seam path and the supported pi-ai range, and `pi-version-skew.test.ts` still passes.
- [x] 3.3 Run the full suite on the new pin, with the previously-skipped factory integration tests now active. Verify: same command as 2.7, no failures.

## 4. Runtime verification

- [x] 4.1 Restart the server (`curl -X POST http://localhost:8000/api/restart`). Verify: `/api/health` reports `proxy.status: "ready"` and an OAuth capability value.
- [x] 4.2 Verify the catalogue tracks the installed runtime. Verify: `GET /api/models` returns `200` and `data` contains `anthropic/claude-opus-5`, `zai/glm-5.3`, `deepseek/deepseek-flash`.
- [x] 4.3 Verify the original symptom is gone. Verify: Settings → Sessions → Default model ★Favs lists the server-persisted favorites instead of "No models match".
- [ ] 4.4 (test-plan: manual-only, #M2) Smoke a completion carrying both a system prompt and a tool definition through `/v1/chat/completions`. Verify: upstream receives both, and an abort mid-stream terminates the upstream request.
- [ ] 4.5 (test-plan: manual-only, #M1) Smoke an OAuth-credentialed provider and an OAuth-only provider (`openai-codex`). Verify: token refresh succeeds and the completion streams.

## 5. Close out

- [x] 5.1 Invoke `review-code` on the diff and resolve findings at or above the project's fix threshold. Verify: review loop reaches no actionable findings.
- [x] 5.2 Invoke `security-hardening` scoped to the streaming + OAuth paths. Verify: no credential reaches a log, an error message, or the runtime's own credential store.
- [x] 5.3 Update DOX rows: `packages/shared/src/piai-compat/AGENTS.md` (new), amended purposes for `registry-singleton.ts`, `internal-auth-storage.ts`, `bridge.ts`. Verify: each touched file has a row naming its purpose and `See change: adopt-piai-factory-api-registry`.


## 6. Scenario fold (from `test-plan.md`)

One task per manifest row. Groups 1–5 implement; these author the tests. Each carries a harness exemplar to copy glue from, the scenario Triple, and its manifest id.

### L1 — vitest (`packages/shared/src/piai-compat/__tests__/`, `packages/server/src/model-proxy/__tests__/`)

- [x] 6.1 Legacy passthrough: all-7-member fake module · `adaptPiAi(mod, path)` · returns input identity, no subpath import attempted (test-plan #E1) — see `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`
- [x] 6.2 Factory adaptation: real ≥0.85 module + path · `adaptPiAi(...)` · surface `getProviders()` non-empty (test-plan #E2) — see `internal-registry.test.ts`
- [x] 6.3 Partial module: fake with `getModels` but no `streamSimple` · adapt · rejects naming `streamSimple`, not classified legacy (test-plan #E3) — see `internal-registry.test.ts`
- [x] 6.4 Unrecognized module: `{}` · adapt · rejects with diagnosable reason (test-plan #E4) — see `internal-registry.test.ts`
- [x] 6.5 getProviders projection: real ≥0.85 module · adapt then sum `getModels(id)` · returns **strings**, summed count > 1000 (test-plan #E5) — see `internal-registry.test.ts`
- [x] 6.6 api-first dispatch: custom model under built-in provider name with a different `api` · stream dispatch · routed by its own `model.api` (test-plan #E6) — see `packages/server/src/model-proxy/__tests__/streamer.test.ts`
- [x] 6.7 Undispatchable model: `api: "nope-api"`, unknown provider, caller `apiKey: "SECRET"` · dispatch · throws naming api+model, no `SECRET` in the message (test-plan #E7) — see `streamer.test.ts`
- [x] 6.8 Table drift guard: runtime's shipped `dist/api/*.lazy.js` set · diff vs the D4 table · every text factory mapped, images factory excluded without false-fail (test-plan #E8) — see `packages/server/src/model-proxy/__tests__/oauth-compat.test.ts` for runtime-introspection glue
- [x] 6.9 Subpath derivation: resolved path not ending in the expected entry file · derive · errors with the resolved path, never a silent no-op (test-plan #E9) — see `packages/shared/src/__tests__/binary-lookup.test.ts`
- [x] 6.10 Dedup precedence: custom entry declaring an existing built-in `provider/id` · compose · built-in retained (test-plan #E10) — see `internal-registry-native-merge.test.ts`
- [x] 6.11 First-use cost: adapt the real ≥0.85 module 5× cold · time it · p95 < 1500ms (test-plan #P2) — see `packages/server/src/model-proxy/__tests__/concurrency.test.ts` for timing glue
- [x] 6.12 Unrecognized → 503: registry resolution rejects · `GET /api/models` · `503 MODEL_PROXY_RUNTIME_MISSING`, health degraded with the reason (test-plan #X1) — see `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`
- [x] 6.13 OAuth stub: entry point exports `{}` · refresh an OAuth provider · reported unavailable, no `TypeError` (test-plan #X2) — see `internal-auth-storage-refresh.test.ts`
- [x] 6.14 Relocated loaders: async loaders only, stored `{access,refresh,expires}` · refresh · succeeds, storage receives `{accessToken,refreshToken,expiresAt}` (test-plan #X3) — see `internal-auth-storage-refresh.test.ts`
- [x] 6.15 Partial OAuth degradation: no reachable OAuth impl · route an api-key model and an OAuth model · api-key routes, OAuth fails diagnosably, `proxy.oauthProviders` per-provider booleans (test-plan #X4) — see `internal-auth-storage-refresh.test.ts`
- [x] 6.16 OAuth-only provider: `openai-codex` model, caller `apiKey`, empty credential store · dispatch · reaches the api impl, no `Provider is not configured` (test-plan #X5) — see `streamer.test.ts`
- [x] 6.17 Transcript preserved: context with `systemPrompt` + 1 tool · factory-branch stream · leading message carries the prompt, `toolsAdded` length 1, `getAuth` never invoked (test-plan #X6) — see `streamer.test.ts`
- [x] 6.18 Legacy not normalized: same context, legacy module · legacy-branch stream · context passed through unnormalized (test-plan #X7) — see `streamer.test.ts`
- [x] 6.19 Caller credentials win: caller `apiKey`+headers, runtime store holds a different key · dispatch · caller's values sent upstream (test-plan #X8) — see `streamer.test.ts`
- [x] 6.20 Abort propagation: in-flight stream with an `AbortSignal` · abort · `signal` reaches provider options, upstream terminates (test-plan #X9) — see `streamer.test.ts`
- [x] 6.21 Async-iterable: any factory-branch stream · `for await` · iterates runtime events (test-plan #X10) — see `streamer.test.ts`
- [x] 6.22 Deferral guard: proxy route supplying its prompt under today's `system:` key · completion · prompt-reaching behavior identical to pre-change (test-plan #X11) — see `streamer.test.ts`
- [x] 6.23 Context keys not reinterpreted: prompt under a key normalization does not read · dispatch · seam does not remap it (test-plan #X14) — see `streamer.test.ts`

### L2 — qa VM smoke (`qa/tests/*.sh` | `*.ps1`)

- [x] 6.24 Boot stays O(1): cold server start, no model request · poll `/api/health` · model registry reported uninitialized for the first 10s (test-plan #P1) — extend `qa/tests/02-server-start.sh`
- [x] 6.25 Credential-independent catalogue: ≥0.85 runtime, no provider credentials · `GET /api/models?annotated=1` · `data` contains `anthropic/claude-opus-5`, `zai/glm-5.3`, `deepseek/deepseek-flash` (test-plan #X12) — extend `qa/tests/02-server-start.sh`
- [x] 6.26 Windows path derivation: Windows runner, native-separator resolved path · registry init · derivation succeeds, registry reaches ready (test-plan #X13) — extend `qa/tests/02-server-start.ps1`

### L3 — Playwright e2e (`tests/e2e/*.spec.ts`, docker harness port from `.pi-test-harness.json`)

- [x] 6.27 Favorites reachable: favorites naming models only the ≥0.85 catalogue has · open Settings → Sessions → Default model, toggle ★Favs · list converges to those favorites, never "No models match" (test-plan #F1) — see `tests/e2e/model-favorites-cross-surface.spec.ts`
- [x] 6.28 Picker tracks runtime: ≥0.85 runtime resolved · open the Default Model picker · options include `claude-opus-5` (test-plan #F2) — see `tests/e2e/settings-default-model-catalogue.spec.ts`

### Manual (deferred post-merge by `ship-change`)

- [ ] 6.29 Live OAuth refresh against a real OAuth-credentialed provider (test-plan: manual-only)
- [ ] 6.30 Live `/v1/chat/completions` carrying a system prompt and a tool against a real provider (test-plan: manual-only)
