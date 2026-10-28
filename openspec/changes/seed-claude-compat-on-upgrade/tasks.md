## 0. Rewrite the outgoing request's system text

- [x] 0.1 Add `rewritePayloadSystem(payload)` and a `before_provider_request` handler to `claudeCompatExtension` in `packages/flows-plugin/src/bridge/claude-compat.ts` (design D4); verify with tasks 0.2 and 0.3.
- [x] 0.2 Test (test-plan #P1), harness exemplar `packages/flows-plugin/src/bridge/__tests__/claude-compat.test.ts`: array `system` (OAuth block + default prompt with `cache_control`) and string `system`, switch on, anthropic → docs block rewritten, other block, `cache_control` and `messages` unchanged, input not mutated; plus the real rendered pi prompt in `pi-docs-canary.test.ts`.
- [x] 0.3 Test (test-plan #P2), same exemplar: switch off / openai / no model / no anchored block / two blocks / already rewritten / no `system` / non-object payload → handler returns `undefined`.
- [x] 0.4 Update the `claude-compat.ts` row in `packages/flows-plugin/src/bridge/AGENTS.md` with `See change: seed-claude-compat-on-upgrade`.

## 0b. Every pi gets the rewrite (move out of the flows plugin)

- [x] 0.5 Move `claudeCompatExtension`/`rewritePayloadSystem`/`rewriteDocsSection` to `packages/shared/src/dashboard-plugin/claude-compat.ts`; register it in the `packages/extension/src/bridge.ts` default export (before the subagent re-entry guard) reading `getBridgeState().claudeSubscriptionCompat`, mirrored by `dispatch.ts` on `preferences_update`; delete the flows-plugin compat code, its agent factory, `compat-preference-probe.ts` and the probe channel; verify with tasks 0.6 and 0.7.
- [x] 0.6 Test (test-plan #P3), harness exemplar `packages/extension/src/__tests__/bridge-reentry-guard.test.ts`: process-global value true then false, and absent; extension runs on a subagent child `pi`; `before_provider_request` on anthropic → rewritten while true, `undefined` after false and when absent. Move the rewrite tests to `packages/extension/src/__tests__/claude-compat.test.ts` and the canary to `claude-compat-pi-docs-canary.test.ts`.
- [x] 0.7 Test (test-plan #P4), harness exemplar `packages/client/src/__tests__/ProviderAuthSection.claude-compat.test.tsx`: switch on/off × flows enabled/disabled → no `claude-compat-needs-flows` notice; drop the `claudeCompat.needsFlows` i18n key.
- [x] 0.8 Subagent end to end: fresh `pi -p` spawned a Haiku 5.5 subagent with the switch on → reply "ok", parent and child logged `state=applied` (test-plan: manual-only, #M3).

## 1. Seed the compat switch from existing credentials

- [x] 1.1 Add optional `deps.hasAnthropicCredential?: () => boolean | undefined` to `createPreferencesStore` in `packages/server/src/persistence/preferences-store.ts`: when the stored `claudeSubscriptionCompat` is not a boolean, call it once; a boolean result becomes the value and marks the store dirty so it is written on this load; `undefined` or no dependency keeps the value off and unstored (design D1, D3); verify with tasks 1.2 and 1.3.
- [x] 1.2 Test (test-plan #S1), harness exemplar `packages/server/src/__tests__/preferences-store.test.ts` (`describe("claudeSubscriptionCompat")`): field absent / `true` / `false` / `"yes"` × dependency returns true / false / undefined / not provided, store loads then flushes → absent+true reads true and stores true; absent+false reads false and stores false; absent+undefined and absent+no dependency read false with no stored field; stored booleans unchanged and the dependency is never called; `"yes"` behaves as absent.
- [x] 1.3 Test (test-plan #S2), same exemplar: file without the field, dependency returns true, load + flush, then `setClaudeSubscriptionCompat(false)` + flush, reload with the dependency still true → reads false and the dependency is not called on the second load.
- [x] 1.4 Add an exported helper `hasAnthropicCredential()` beside `tryReadAuthJson` in `packages/server/src/auth/provider-auth-storage.ts` returning `true`/`false` for parsed `auth.json` (missing file = `{}`) and `undefined` when unparseable, never reading the credential value; wire it into `createPreferencesStore` at `packages/server/src/server.ts:730` (design D2); verify with task 1.5.
- [x] 1.5 Test (test-plan #S3), harness exemplar the nearest `packages/server/src/__tests__/provider-auth-storage*.test.ts`: `auth.json` missing / `{}` / anthropic oauth / anthropic api_key / openai only / unparseable → false / false / true / true / false / undefined, and no credential value in the output.
- [x] 1.6 Update the `AGENTS.md` rows (or sidecars) for `preferences-store.ts`, `provider-auth-storage.ts` and `server.ts` with `See change: seed-claude-compat-on-upgrade`; verify each touched file has a current row.

## 2. Docs and release notes

- [x] 2.1 Update `docs/faq.md` "Claude subscription requests billed as extra usage?" — note that upgrades with an existing Anthropic sign-in get the switch on automatically; new installs are prompted at sign-in.
- [x] 2.2 Add a CHANGELOG `[Unreleased]` entry.

## 3. Manual verification

- [x] 3.2 Already-open session end to end: session 01a178f8 (started 2026-10-27) ran `bash` and its follow-up request succeeded on 2026-10-28 16:40 (test-plan: manual-only, #M2).
- [ ] 3.1 Upgrade path end to end on a machine with an anthropic sign-in (test-plan: manual-only, #M1).
