## 1. Override table + helper

- [x] 1.1 Create `packages/server/src/model-proxy/oauth-compat.ts` exporting `OAUTH_INCOMPATIBLE: Record<string, ReadonlySet<string>>` and `isOauthIncompatible(provider, modelId): boolean`.
- [x] 1.2 Populate Anthropic entry with the legacy snapshots currently failing on OAuth: `claude-3-5-haiku-20241022`, `claude-3-5-haiku-latest`, `claude-3-5-sonnet-20240620`, `claude-3-5-sonnet-20241022`, `claude-3-5-sonnet-latest`, `claude-3-7-sonnet-20250219`, `claude-3-7-sonnet-latest`, `claude-3-opus-20240229`, `claude-3-opus-latest`, `claude-3-haiku-20240307`, `claude-3-sonnet-20240229`. Leave `openai` slot empty for now (commented).
- [x] 1.3 Add `oauth-compat.test.ts` covering: known incompat id returns true; unknown id returns false; unknown provider returns false; case-sensitive id match.

## 2. Registry filter

- [x] 2.1 Extend `CustomModelEntry` (and the model-shape JSDoc in `internal-registry.ts`) with optional `oauthCompatible?: boolean`.
- [x] 2.2 In `getAllModels()`, when pushing built-in pi-ai models, set `oauthCompatible = !isOauthIncompatible(provider, model.id)`.
- [x] 2.3 In `getAllModels()`, when materializing custom models, propagate `cm.oauthCompatible` (default `true` when absent).
- [x] 2.4 Add private `canRouteModel(model, cred): boolean` implementing rules from design D1 (api_key true; oauth iff `oauthCompatible !== false`; otherwise false).
- [x] 2.5 Replace `hasAuth(provider, auth)` call in `getAvailable()` with `canRouteModel(model, auth[model.provider])`. Keep result caching semantics.

## 3. Diagnostic surface

- [x] 3.1 Add `getAllAnnotated(): Array<{ model, excludedReason: null | "no-credential" | "oauth-incompatible" }>` to `InternalRegistry`. Reuse `getAllModels()` + same auth check; do not bypass cache invalidation.
- [x] 3.2 Create a new `GET /api/model-proxy/diagnostics` route returning `getAllAnnotated()` output (`{ id, provider, excludedReason }` per entry). Placed in a **sibling file** `packages/server/src/routes/model-proxy-diagnostics-routes.ts` (mirrors `model-proxy-refresh-routes.ts`) and registered on the main JWT-gated instance only — NOT in `model-proxy-routes.ts`, whose `registerModelProxyRoutes` is also mounted on the optional second `/v1` proxy port, which would wrongly expose + double-register the admin route.

## 4. Tests

- [x] 4.1 Create `packages/server/src/model-proxy/__tests__/internal-registry.test.ts` (new file — does not exist yet) with cases mirroring spec scenarios: OAuth-only excludes legacy, OAuth-only includes current, api_key includes everything, no-credential excludes provider, custom model `oauthCompatible: false` honored.
- [x] 4.2 Add a regression case pinning the current Claude-Code allowlist (`claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5`, plus `*-4-6` family if present in pi-ai) as `oauthCompatible !== false` so they never get accidentally added to `OAUTH_INCOMPATIBLE`.
- [x] 4.3 Add a route-level test against the diagnostics endpoint asserting `excludedReason` shape.

## 5. Documentation

- [x] 5.1 Update `docs/architecture.md` model-proxy section: document the credential-routing filter, the override table location, and the "review when Anthropic ships a new model" note.
- [x] 5.2 Add a CHANGELOG entry under `## [Unreleased]` → "Fixed" describing the listing change for OAuth-only setups.
- [x] 5.3 Add row(s) for `oauth-compat.ts` and the diagnostic helper to `docs/file-index-server.md` (path-alphabetical, caveman style).

## 6. Verify

- [x] 6.1 `npm test` green. (8474 passed, 21 skipped, 0 failures; Biome on changed files exits 0.)
- [x] 6.2 Automated as E2E (was manual): `tests/e2e/model-proxy-oauth-filter.spec.ts` test “6.2” asserts `GET /v1/models` excludes `anthropic/claude-3-5-haiku-20241022` (+ all `claude-3-*`) and includes `anthropic/claude-haiku-4-5`, against the Docker harness whose `PI_E2E_SEED` seeds Anthropic-OAuth-only `auth.json`. Also unit-covered in `internal-registry.test.ts`. Run: `npm run test:e2e` (needs Docker + chromium; not executed in this worktree).
- [x] 6.3 Automated as E2E (was manual): `tests/e2e/model-proxy-oauth-filter.spec.ts` test “6.3” asserts `POST /v1/chat/completions {model:"anthropic/claude-3-5-haiku-20241022"}` returns proxy `404`. Also unit-covered (`find(...) === null`). Run: `npm run test:e2e` (needs Docker + chromium; not executed in this worktree).

## 7. E2E automation (tasks 6.2/6.3)

- [x] 7.1 Seed model proxy in the Docker harness: `docker/test-entrypoint.sh` `PI_E2E_SEED` block writes `config.json#modelProxy` = `enabled:true` + one apiKey (`hash = sha256(E2E_PROXY_KEY)`, scopes `["all"]`) so `/v1/*` is reachable. Precondition `auth.json` (Anthropic-OAuth-only) already seeded there.
- [x] 7.2 Add `tests/e2e/model-proxy-oauth-filter.spec.ts` (Playwright `request` fixture, no page): 6.2 `/v1/models` filter, 6.3 `/v1/chat/completions` 404, plus `/api/model-proxy/diagnostics` asserting `excludedReason` (`oauth-incompatible` for legacy, `null` for current) — proves the filter fired, not mere absence.
- [x] 7.3 Executed green against Docker via **system Chrome** (no bundled-chromium download). Rebuilt image from worktree source (`test-up.sh -d --build` — warm `pi-dashboard:local` reuse otherwise serves stale server code), then attached with `PW_E2E_USE_RUNNING=1 <system-chrome-env> PW_E2E_PORT=18000 npx playwright test model-proxy-oauth-filter` → **3 passed**. Also curl-verified directly: `/v1/models` 23→15 models (8 `claude-3-*` snapshots dropped), legacy chat → 404, diagnostics legacy `oauth-incompatible` / current `null`.
- [x] 7.4 System-browser E2E path: verified via a temporary `PW_SYSTEM_CHROME` flag, then on merge adopted develop's equivalent-and-more-general `PW_CHANNEL` (change `adopt-pi-071-072-073-features`) — `PW_CHANNEL=chrome` sets the project `channel` + skips the bundled-binary preflight. My duplicate `PW_SYSTEM_CHROME` dropped at merge (DRY). Run: `PW_CHANNEL=chrome PW_E2E_USE_RUNNING=1 npx playwright test model-proxy-oauth-filter`.
