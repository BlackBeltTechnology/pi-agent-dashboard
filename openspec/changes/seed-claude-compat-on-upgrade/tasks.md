## 1. Seed the compat switch from existing credentials

- [ ] 1.1 Add optional `deps.hasAnthropicCredential?: () => boolean | undefined` to `createPreferencesStore` in `packages/server/src/persistence/preferences-store.ts`: when the stored `claudeSubscriptionCompat` is not a boolean, call it once; a boolean result becomes the value and marks the store dirty so it is written on this load; `undefined` or no dependency keeps the value off and unstored (design D1, D3); verify with tasks 1.2 and 1.3.
- [ ] 1.2 Test (test-plan #S1), harness exemplar `packages/server/src/__tests__/preferences-store.test.ts` (`describe("claudeSubscriptionCompat")`): field absent / `true` / `false` / `"yes"` × dependency returns true / false / undefined / not provided, store loads then flushes → absent+true reads true and stores true; absent+false reads false and stores false; absent+undefined and absent+no dependency read false with no stored field; stored booleans unchanged and the dependency is never called; `"yes"` behaves as absent.
- [ ] 1.3 Test (test-plan #S2), same exemplar: file without the field, dependency returns true, load + flush, then `setClaudeSubscriptionCompat(false)` + flush, reload with the dependency still true → reads false and the dependency is not called on the second load.
- [ ] 1.4 Add an exported helper `hasAnthropicCredential()` beside `tryReadAuthJson` in `packages/server/src/auth/provider-auth-storage.ts` returning `true`/`false` for parsed `auth.json` (missing file = `{}`) and `undefined` when unparseable, never reading the credential value; wire it into `createPreferencesStore` at `packages/server/src/server.ts:730` (design D2); verify with task 1.5.
- [ ] 1.5 Test (test-plan #S3), harness exemplar the nearest `packages/server/src/__tests__/provider-auth-storage*.test.ts`: `auth.json` missing / `{}` / anthropic oauth / anthropic api_key / openai only / unparseable → false / false / true / true / false / undefined, and no credential value in the output.
- [ ] 1.6 Update the `AGENTS.md` rows (or sidecars) for `preferences-store.ts`, `provider-auth-storage.ts` and `server.ts` with `See change: seed-claude-compat-on-upgrade`; verify each touched file has a current row.

## 2. Docs and release notes

- [ ] 2.1 Delegate to DocScribe: `docs/faq.md` "Claude subscription requests billed as extra usage?" — note that upgrades with an existing Anthropic sign-in get the switch on automatically; new installs are prompted at sign-in.
- [ ] 2.2 Add a CHANGELOG `[Unreleased]` entry.

## 3. Manual verification

- [ ] 3.1 Upgrade path end to end on a machine with an anthropic sign-in (test-plan: manual-only, #M1).
