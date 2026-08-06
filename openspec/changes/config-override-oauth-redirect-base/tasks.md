# Tasks — config-override-oauth-redirect-base

PR #409 already implements items 1.x. They are listed so the change is a complete
record of what ships, and so a reviewer can tick them against the diff.

## 1. Land PR #409 (already implemented upstream)

- [x] 1.1 `AuthConfig.redirectBaseUrl?: string` + trim/blank/type normalization in `parseAuthConfig` — `packages/shared/src/config.ts`
- [x] 1.2 `buildRedirectUri(provider, port, baseOverride?)` precedence + trailing-slash strip — `packages/server/src/auth/auth.ts`
- [x] 1.3 Thread `authState.redirectBaseUrl` through `/auth/login`, `/auth/start/:provider`, `/auth/callback/:provider` + `_reloadAuth` — `packages/server/src/auth/auth-plugin.ts`
- [x] 1.4 Preserve `auth.redirectBaseUrl` in `writeConfigPartial` — `packages/server/src/config-api.ts`
- [x] 1.5 Doc rows: `auth.ts.AGENTS.md`, `auth-plugin.ts.AGENTS.md`, `shared/src/AGENTS.md`

## 2. Close the test gap (blocking merge)

- [x] 2.1 **Write the failing test first**: `override beats an active tunnel` with `vi.mock("../tunnel/tunnel.js")` — test-plan E1b/E2. This is the behaviour the feature exists for and is currently unproven → `packages/server/src/__tests__/auth-redirect-base.test.ts`
- [x] 2.2 Full precedence decision table (6 rows) — E1
- [x] 2.3 Route-level `inject()` assertions on the `Location` header for `/auth/login` (single-provider auto-redirect) and `/auth/start/:provider` — E13
- [x] 2.4 Token-exchange echo assertion: stub `fetch`, assert the form-encoded `redirect_uri` equals the authorize-time value — E14
- [x] 2.5 Hot-reload assertions via `_reloadAuth` (change + clear) — E15/E16
- [x] 2.6 Partial-write preservation / clear — E11/E12
- [x] 2.7 Browser E2E `tests/e2e/oauth-redirect-base.spec.ts` (F1/F2) with the harness-safety restore — see test-plan harness note
- [x] 2.8 Add the `tests/e2e/AGENTS.md` row for the new spec

## 3. Close the observability gap

- [x] 3.1 Validate `redirectBaseUrl` at plugin registration and at every reload: absolute `http(s)` origin, no query, no fragment
- [x] 3.2 On failure log ONE warning naming `auth.redirectBaseUrl` + the value; still use the value (design D4) — X1/X2/X3
- [x] 3.3 Assert the happy path stays silent — X4
- [ ] 3.4 (DEFERRED) Surface the effective redirect base in the doctor output so an operator can read what the server actually resolved

## 4. Close the docs gap

- [x] 4.1 `docs/architecture.md` — add `auth.redirectBaseUrl` to the auth/config reference, state the precedence chain, and state explicitly that pairing/QR/`/api/tunnel/endpoints` still use the tunnel URL (design D5) — **delegate to DocScribe, caveman style**
- [x] 4.2 `docs/architecture.md` — record the D6 limitation (no providers at boot ⇒ no `_reloadAuth`, restart required) — **DocScribe**
- [x] 4.3 `CHANGELOG.md [Unreleased] → Added` — one entry; PR #409 has none, so the feature would ship invisible in the release notes
- [x] 4.4 Note in the docs that the operator must register the same URI with the OAuth provider

## 5. Verify

- [x] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` — green, and 2.1 is red before the PR is merged (proves the test is not vacuous)
- [ ] 5.2 (PENDING — needs Docker) `npm run test:e2e -- oauth-redirect-base` — green, and the harness is left un-gated for the following specs
- [x] 5.3 `npm run quality:changed`
- [x] 5.4 `openspec validate config-override-oauth-redirect-base --strict`

## 6. Deferred (do NOT do here — named so they are not lost)

- [ ] 6.1 Top-level `publicBaseUrl` feeding pairing QR, `/api/tunnel/endpoints`, "Accessible at", with `auth.redirectBaseUrl` demoted to a narrower override
- [ ] 6.2 Settings ▸ Security input for the field (the `writeConfigPartial` half already exists)
- [ ] 6.3 Removing an OAuth provider via `PUT /api/config` — the providers merge is additive-only today, so a provider can be blanked but never deleted
