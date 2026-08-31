## 0. Read first

- [x] 0.1 Read `test-plan.md` — it is the manifest and the source of truth for automated-vs-manual. Every test task below carries its scenario id; do not add or drop tests without updating the manifest. All 17 rows are automated; there are no manual-only rows and nothing to defer post-merge
- [x] 0.2 Read `ProviderAuthSection.tsx:100-111` before writing any dispatch. `refresh` and `handleChanged` are deliberately separate, and the comment at `:104-106` is explicit: "a mount must not look like a credential write". The dispatch belongs in `handleChanged` ONLY — putting it in `refresh` fires on every section mount, which the mount-is-not-a-write task in section 2 exists to catch
- [x] 0.3 Note that `handleChanged` is already the single funnel for five write paths (API-key save `:482`, removal `:493`, OAuth sign-out `:259`, auth-code poll `:189`, device-code poll `:231`). Five paths, ONE dispatch site. Do not add five
- [x] 0.4 Read `proposal.md` "Over-dispatch is accepted; under-dispatch is not" before writing #E4 — a base-URL-only save legitimately dispatches without writing a credential, and that is the specified behaviour, not a bug to suppress

## 1. Shared event-name constant

- [x] 1.1 Export a `PROVIDER_AUTH_EVENT` constant from `packages/client/src/hooks/useProvidersReady.ts` and have the existing listener register under it instead of the string literal. Implementation choice, NOT a spec requirement — no test asserts the absence of literals (test-plan HARD-gate decision 2)
- [x] 1.2 Update `packages/client/src/hooks/__tests__/useProvidersReady.test.ts:138` to dispatch via the constant instead of its literal (test-plan #R2)
- [x] 1.3 Verify: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`

## 2. `ProviderAuthSection` dispatch (TDD — write these RED first)

Harness exemplar for every task in this section: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (fetch mocking + row interaction), with `packages/client/src/__tests__/ProviderAuthSection.peer-hint.test.tsx` for the polling/async glue.

- [x] 2.1 Write the failing API-key save test — see `packages/client/src/__tests__/ProviderAuthSection.test.tsx`. Triple: section mounted with `PUT /api/provider-auth/api-key` mocked `res.ok` · the user submits the save once · exactly one `provider-auth-event` dispatched on `window` (test-plan #D1)
- [x] 2.2 Write the failing OAuth sign-in completion test — see `packages/client/src/__tests__/ProviderAuthSection.peer-hint.test.tsx` for the poll harness. Triple: auth-code status poll mocked to report `authenticated` · the poll observes completion · one `provider-auth-event` dispatched (test-plan #D2)
- [x] 2.3 Write the failing device-code completion test — see `packages/client/src/__tests__/ProviderAuthSection.peer-hint.test.tsx`. Triple: `/device-status/<flowId>` mocked to report `complete` · the poll observes completion · one `provider-auth-event` dispatched (test-plan #D3)
- [x] 2.4 Write the failing no-payload test — see `packages/client/src/__tests__/ProviderAuthSection.test.tsx`. Triple: any dispatching path from #D1–#D4 · the event captured by a `window` listener · the `CustomEvent` has no `detail`, and no key, provider id, or credential string is present (test-plan #D6)
- [x] 2.5 Write the failing API-key removal test — see `packages/client/src/__tests__/ProviderAuthSection.test.tsx`. Triple: exactly one keyed provider, no OAuth provider authenticated and no `/api/providers` entry with a non-empty `apiKey`, removal mocked to succeed · the user removes the key · `provider-auth-event` dispatched AND `useProvidersReady()` subsequently reports `ready=false` (test-plan #E1)
- [x] 2.6 Write the failing OAuth sign-out test — see `packages/client/src/__tests__/ProviderAuthSection.test.tsx`. Triple: one authenticated OAuth provider, sign-out mocked to succeed · the user signs out · `provider-auth-event` dispatched (test-plan #E2)
- [x] 2.7 Write the failing transport-failure test — see `packages/client/src/__tests__/ProviderAuthSection.test.tsx`. Triple: API-key `PUT` mocked non-2xx · the user saves the key · no `provider-auth-event` dispatched and the existing error message still renders (test-plan #X1)
- [x] 2.8 Write the failing mount-is-not-a-write test — see `packages/client/src/__tests__/ProviderAuthSection.test.tsx`. Triple: section newly mounted with no user action, status fetch mocked to resolve · the initial `refresh()` completes · no `provider-auth-event` dispatched (test-plan #X3)
- [x] 2.9 Write the failing owner-callback regression test — see `packages/client/src/__tests__/ProviderAuthSection.test.tsx`. Triple: section mounted with an `onCredentialsChanged` spy · any dispatching write from #D1–#D3, #E1–#E2 · `onCredentialsChanged` still fires exactly as before and the section's own `refresh()` still runs (test-plan #R1)
- [x] 2.10 Implement: one `window.dispatchEvent(new CustomEvent(PROVIDER_AUTH_EVENT))` inside `handleChanged` (`ProviderAuthSection.tsx:107-111`). No new success gate — `handleChanged` is only ever called from an existing success branch
- [x] 2.11 Verify tests pass per the command in 1.3

## 3. `SettingsPanel` custom-provider dispatch (TDD — write these RED first)

Harness exemplar for every task in this section: `packages/client/src/components/settings/__tests__/settings-persistence.test.tsx` (fetch-call capture + PUT assertion glue).

- [x] 3.1 Write the failing custom-provider save test — see `packages/client/src/components/settings/__tests__/settings-persistence.test.tsx`. Triple: dirty LLM-provider list with `PUT /api/providers` mocked `{ success: true }` · the save is submitted · one `provider-auth-event` dispatched (test-plan #D4)
- [x] 3.2 Write the failing custom-provider deletion test — see `packages/client/src/components/settings/__tests__/settings-persistence.test.tsx`. Triple: an existing custom provider, the `PUT /api/providers` that omits it mocked `{ success: true }` · the save is submitted · `provider-auth-event` dispatched (test-plan #E3)
- [x] 3.3 Write the failing no-op-write test — see `packages/client/src/components/settings/__tests__/settings-persistence.test.tsx`. Triple: existing custom provider whose API key is unchanged and round-trips as the redaction sentinel, only base URL or api type edited, `PUT` mocked `{ success: true }` · the save succeeds · `provider-auth-event` dispatched AND the resulting readiness is unchanged (test-plan #E4)
- [x] 3.4 Write the failing body-level-failure test — see `packages/client/src/components/settings/__tests__/settings-persistence.test.tsx`. Triple: `PUT /api/providers` mocked 200 with `{ success: false, error: "…" }` · the save is submitted · no `provider-auth-event` dispatched (test-plan #X2)
- [x] 3.5 Implement the dispatch in `SettingsPanel.tsx` on the `/api/providers` `PUT` path, placed AFTER the `if (!data.success) throw` guard at `:829` so a body-level failure cannot reach it
- [x] 3.6 Verify tests pass

## 4. Hook wiring proof (TDD — write these RED first)

Harness exemplar for every task in this section: `packages/client/src/hooks/__tests__/useProvidersReady.test.ts`.

- [x] 4.1 Write the failing end-to-end wiring test — see `packages/client/src/hooks/__tests__/useProvidersReady.test.ts`. Triple: hook mounted with both endpoints mocked unconfigured then re-mocked to report one authenticated provider · a save path dispatches `provider-auth-event` and no `focus` event is fired · both endpoints refetched and the hook converges to `ready=true` (test-plan #D5)
- [x] 4.2 Write the failing idempotence test — see `packages/client/src/hooks/__tests__/useProvidersReady.test.ts`. Triple: hook mounted with endpoints mocked to a fixed configured state · the event dispatched 3× in succession · the hook converges to the same `ready`/`count` as a single dispatch, with no state oscillation and no error (test-plan #E5)
- [x] 4.3 Write the failing endpoint-failure test — see `packages/client/src/hooks/__tests__/useProvidersReady.test.ts`. Triple: `/api/providers` mocked to reject while `/api/provider-auth/status` resolves with one authenticated entry · `provider-auth-event` dispatched · the hook still derives `ready=true` from the surviving endpoint and reports `loading=false` (test-plan #X4)
- [x] 4.4 Verify #D5 FAILS on a revert of sections 2–3 — it is the only row that proves the defect is fixed rather than that a `dispatchEvent` line exists. A #D5 that passes without the dispatch is vacuous
- [x] 4.5 Verify the full suite passes per the command in 1.3

## 5. Land

- [x] 5.1 Rebuild + restart per the `implement` skill — client change: `npm run build && curl -X POST http://localhost:8000/api/restart`
- [x] 5.2 Manual smoke (not a manifest row — an author sanity check): open Settings from the landing route on desktop, save a provider credential, dismiss the dialog; the onboarding checklist behind the overlay shows ① as done with no page reload and no window refocus
- [x] 5.3 Update the directory `AGENTS.md` rows for `ProviderAuthSection.tsx`, `SettingsPanel.tsx`, and the `useProvidersReady.ts` row in `packages/client/src/hooks/AGENTS.md:43`, which currently documents a listener with no dispatcher
- [x] 5.4 Run the `review-code` discipline skill on the diff (named in `proposal.md` → Discipline Skills)
- [x] 5.5 Ship per the `ship-change` skill
