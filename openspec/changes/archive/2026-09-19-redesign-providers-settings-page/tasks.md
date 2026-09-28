## 1. Shared types and contracts

- [x] 1.1 Widen `ProviderInfo.source` in `packages/shared/src/types.ts` to the six-member pi-ai union (`stored | runtime | environment | fallback | models_json_key | models_json_command`) and verify `npm test` type-checks the server and extension against it
- [x] 1.2 Add `configured?: boolean` and `source?: ProviderSource` to `ProviderAuthStatus` in `packages/shared/src/rest-api.ts`, both optional, and verify existing consumers still compile unchanged (additive-only)
- [x] 1.3 Add route-tier entries for `PATCH /api/providers/:name`, `DELETE /api/providers/:name` and `GET /api/provider-auth/catalogue-ready` in `packages/shared/src/route-tiers.ts`, plus their MCP manifest rows or denylist entries, and verify `route-tier-gate.test.ts` + `mcp-manifest-completeness.test.ts` pass (**E20**)

## 2. Server — kind-aware `configured`

- [x] 2.1 Write the failing table-driven test for `_buildAuthStatus` covering the full derivation matrix, including the env-var-on-an-OAuth-id cell and the absent-`source` cell, and verify it fails before implementation (**E1, E2, E3, E4, E5, E6**)
- [x] 2.2 Project `configured` + `source` in `packages/server/src/auth/provider-auth-storage.ts::_buildAuthStatus` per the design D1 table — OAuth rows from their own oauth credential; every api-key row from `hasStoredKey || ambient || (entry.configured && entry.source != null && entry.source !== "stored")` — and verify 2.1 passes
- [x] 2.3 Update `packages/server/src/__tests__/build-auth-status.test.ts` (it asserts whole rows with `toEqual`, so the added fields break it) and verify the suite passes
- [x] 2.4 Verify `authenticated` is unchanged for every existing consumer and that `useProvidersReady` still derives from `authenticated` (no rewire) — run `useProvidersReady.test.ts`

## 3. Server — close the credential clobber

- [x] 3.1 Write failing tests for the cross-type refusal in both directions plus both must-not-refuse cases, asserting `409` and `code: "provider_auth.credential_type_conflict"` with `vars` naming the stored type (**X1, X3, X4, X5**)
- [x] 3.2 Make `writeCredential` throw a typed error when the stored credential's `type` differs from the incoming one, and surface it as `409` from `PUT /api/provider-auth/api-key`, as the callback-server error page for auth-code, and as `flow.status = "error"` for device-code; verify 3.1 passes
- [x] 3.3 Apply the same kind-mismatch refusal to `DELETE /api/provider-auth/:provider` so `DELETE …/anthropic-api` cannot remove a stored OAuth credential, and verify the delete-direction test passes (**X2**)
- [x] 3.4 Verify `InternalAuthStorage.refreshOAuth` still succeeds against a stored OAuth credential (same-type refresh must not regress) — **X5**

## 4. Server — single-provider provider writes

- [x] 4.1 Write failing tests for `PATCH`/`DELETE /api/providers/:name` covering upsert, field semantics, sentinel preserve, blank-name rejection, path encoding, absent-name delete, and non-provider key preservation (**E11, E12, E13, E14, E15, E16**)
- [x] 4.2 Implement both routes in `packages/server/src/routes/provider-routes.ts`, mutating the parsed `fileData` so `roles` / `rolePresets` / `activePreset` survive, with no `await` between read and tmp+rename, and verify 4.1 passes
- [x] 4.3 Inherit the masked-sentinel guard and the `RECURSIVE_PROXY` self-pointing guard on both routes, and verify the recursive-proxy rejection test passes (**X12**)
- [x] 4.4 Call `retainProviderHealth` with the **full** remaining key list on `PATCH` and drop only the deleted entry on `DELETE`, and verify another provider's cached health survives both (**"Editing one provider does not clear another's pill"**)
- [x] 4.5 Detach the probe from the response: probe only the touched provider, respond without awaiting it, and verify p95 < 300 ms against a stalled-upstream fixture (**P1, P2**)
- [x] 4.6 Add the stalled-upstream test fixture (accepts the connection, never responds) alongside the existing probe tests, and verify it is distinct from the refused-connection fixture
- [x] 4.7 Broadcast `credentials_updated` and call `refreshModelRegistry()` from both new routes, and verify the bridge-notification tests pass for `PATCH` and `DELETE`
- [x] 4.8 Verify concurrency and atomicity: two simultaneous writes to different providers both land, and an interrupted write leaves valid JSON (**X10, X11**)

## 5. Server — catalogue availability

- [x] 5.1 Add `GET /api/provider-auth/catalogue-ready` returning `{ ready }` and verify the three-state transition test passes (**E18**)
- [x] 5.2 Invalidate the catalogue cache when the last bridge disconnects (today `latest` is only ever assigned), and verify api-key rows disappear and return across a disconnect/reconnect (**E14, X14**)
- [x] 5.3 Correct the `provider-auth-bridge` catalogue expectation in the bridge tests — an env-var-credentialed provider reports `configured: true, source: "environment"` — and verify (**E19**)
- [x] 5.4 Verify `GET /api/provider-auth/status` still returns a bare array with no envelope (**"Status response shape is unchanged"**)

## 6. Client — the connected list

- [x] 6.1 Rewrite the failing tests for `ProviderAuthSection` against the new structure first — list projection, badge mapping, the `configured ?? authenticated` fallback, and the custom-endpoint predicate — and verify they fail before implementation (**E7, E8, E9, P3**)
- [x] 6.2 Restructure `ProviderAuthSection.tsx` into a configured-only list with the four badge kinds, merging `/api/provider-auth/status` and `/api/providers` keyed by `(source, id)`, and verify 6.1 passes
- [x] 6.3 Preserve the relocated invariants explicitly: the `handleChanged` single dispatch funnel, the 3-consecutive-failure auth-code abort, the `AnthropicPeerHint` post-install latch, and the inline-status-error-with-Retry that must not reach an ErrorBoundary — verify by running the peer-hint, poll-budget and corrupt-status suites (**F4, F9, X9**)
- [x] 6.4 Render per-source inline errors so a failure of either fetch never hides the other source's rows, and verify both directions (**X7, X8**)
- [x] 6.5 Render the catalogue-unavailable notice scoped beside the list, keeping the Add control visible and suppressing the empty state, and verify (**F7**)
- [x] 6.6 Scope health pills to custom-endpoint rows only, with a pending state reconciled by exactly one health read ~2 s after a write, and verify (**E17, F10**)
- [x] 6.7 Drop `fetchHandlerIds` and the `supported` gating (the endpoint stays server-side), and verify no client code references `/api/provider-auth/handlers`

## 7. Client — the Add-provider dialog

- [x] 7.1 Write failing tests for the picker: unconfigured-only membership, the selectable count, cross-type suppression in both directions, and keyboard-only selection (**E10, F5, F6**)
- [x] 7.2 Build the dialog on the existing `SearchableSelectDialog` + `DialogPortal`, grouped `Subscriptions / API keys / Custom endpoint` per `mockups/add-dialog.html`, and verify 7.1 passes
- [x] 7.3 Implement the four panes (`auth_code`, `device_code` with the Enterprise-domain prompt and explicit "Open Registration Page", `api_key` with the `envVar` hint, custom endpoint with Test), and verify each branch renders from its `flowType`
- [x] 7.4 Validate before writing — empty key and blank/whitespace custom-endpoint name are refused at the dialog with a visible message and no request issued — and verify
- [x] 7.5 Keep poll state in the section, keyed per provider, reading the unfiltered status array, so dialog dismissal never ends a flow and two flows never share a timer — verify (**F1, F2, F3**)
- [x] 7.6 Render a late refusal (flow completes after dismissal) inline on the section, and verify the provider is not shown connected (**X6**)
- [x] 7.7 Make the name immutable in the Edit surface (no delete+create rename path), and verify (**"Name is not editable in place"**)

## 8. Client — leave the Save-bar draft model

- [x] 8.1 Remove the LLM-providers draft source and its baseline wiring from `SettingsPanel.tsx`, moving the `PROVIDER_AUTH_EVENT` dispatch, `refetchCatalogue()` and post-write health refetch from the deleted save task onto the new write paths, and verify `settings-persistence.test.tsx` + `SettingsPanel.test.tsx` pass after rewrite
- [x] 8.2 Verify a provider write never opens the Save Bar and is unaffected by Discard, while the Providers page keeps its dirty chip for the API-Proxy (`modelProxy`) source (**F8**)
- [x] 8.3 Verify exactly one `provider-auth-event` per successful write from any control (**F9**)

## 9. Theme, i18n and accessibility

- [x] 9.1 Add `--accent-primary-strong: #2563eb` to `packages/client/src/index.css` (root + light) and verify the `themes.ts`↔`index.css` parity test passes
- [x] 9.2 Verify every badge's text clears 4.5:1 on its surface across all 18 palettes and that no badge conveys kind by hue alone (**F12**)
- [x] 9.3 Add i18n keys for every new string plus `err.provider_auth.credential_type_conflict` in every shipped locale, and verify the i18n key-coverage check passes (**X15**)

## 10. Validation

- [x] 10.1 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and verify zero failures
- [x] 10.2 Author and run the L3 Playwright specs against the docker harness port from `.pi-test-harness.json` (**F1, F5, F6, F7, F8, F9, F10, F11, F13, X6, X7, X8**) and verify they pass
- [x] 10.3 Verify the corrupt-`auth.json` and malformed-status degradations still hold end to end (**X13, X9**)
- [x] 10.4 Run the `review-code`, `security-hardening` and `performance-optimization` discipline passes named in the proposal, and verify each produces no unaddressed severe finding
- [ ] 10.5 Manual-only, deferred to post-merge: compare the built list and dialog against `mockups/index.html` and `mockups/add-dialog.html` for spacing and rhythm (**F14** — no automatable observable) (test-plan: manual-only)
- [x] 10.6 Update the nearest `AGENTS.md` rows for every touched file and verify `node scripts/check-conventions.mjs` reports no violations
