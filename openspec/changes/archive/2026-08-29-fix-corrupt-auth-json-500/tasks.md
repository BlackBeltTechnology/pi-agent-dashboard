## 1. Red tests — server storage (L1, vitest)

Exemplar for all of section 1: `packages/server/src/__tests__/provider-auth-storage.test.ts`
(existing sibling — copy its tmp-`HOME` / fs setup glue). Write these before any
source change and confirm they fail.

- [x] 1.1 Empty file yields an empty credential set (test-plan #E1) — input: `auth.json` = `""` (0 bytes) · trigger: `readAuthJson()` · observable: returns `{}`, does not throw, `auth.json` bytes unchanged on disk. See `packages/server/src/__tests__/provider-auth-storage.test.ts`. (test-plan: automated)
- [x] 1.2 Truncated JSON is quarantined byte-exactly (test-plan #E2) — input: `{"anthropic":{"type":"oauth","refr` · trigger: `readAuthJson()` · observable: returns `{}`, a quarantine file exists whose bytes equal the input exactly. (test-plan: automated)
- [x] 1.3 Valid JSON of the wrong shape is corrupt (test-plan #E3) — input: `null`, `[]`, `42` (three cases) · trigger: `readAuthJson()` · observable: each returns `{}` and quarantines, no throw. (test-plan: automated)
- [x] 1.4 Legitimately empty object is NOT corrupt (test-plan #E4) — input: `auth.json` = `{}` · trigger: `readAuthJson()` · observable: returns `{}`, no quarantine file, no quarantine log line. (test-plan: automated)
- [x] 1.5 BOM-prefixed valid JSON parses (test-plan #E5) — input: `\uFEFF{"openai":{"type":"api_key","key":"sk-x"}}` · trigger: `readAuthJson()` · observable: returns the `openai` credential, no quarantine file. (test-plan: automated)
- [x] 1.6 Missing file is not a corruption (test-plan #E6) — input: `auth.json` absent · trigger: `readAuthJson()` · observable: returns `{}`, no quarantine file, no quarantine log line. (test-plan: automated)
- [x] 1.7 Quarantine filename is platform-safe (test-plan #E7) — input: any corrupt `auth.json` · trigger: quarantine runs · observable: filename matches `auth.json.corrupt-\d{8}T\d{9}Z(-\d+)?` and contains no `:`. (test-plan: automated)
- [x] 1.8 Existing backup is never overwritten (test-plan #E8) — input: corrupt bytes plus a file already at the computed quarantine name holding `PRIOR` · trigger: quarantine runs · observable: new file gets a `-1` suffix, the pre-existing file still contains `PRIOR` byte-for-byte. (test-plan: automated)
- [x] 1.9 Dedup is content-hash based, not stat based (test-plan #E9) — input: corrupt content A, then different corrupt content B forced to share `(size, mtimeMs)` · trigger: `readAuthJson()` twice · observable: two distinct quarantine files, one per content. (test-plan: automated)
- [x] 1.10 Repeated reads of identical bytes quarantine once (test-plan #E10) — input: same corrupt bytes · trigger: `readAuthJson()` 5× in one process · observable: exactly one quarantine file. (test-plan: automated)
- [x] 1.11 Quarantine file mode is 0600 (test-plan #E16) — input: corrupt `auth.json` containing a credential-shaped fragment · trigger: quarantine runs · observable: quarantine file mode is `0600`. (test-plan: automated)
- [x] 1.12 A failed quarantine copy is retried, not latched (test-plan #E17) — input: corrupt bytes, first `copyFileSync` attempt forced to throw, second allowed to succeed · trigger: `readAuthJson()` twice · observable: the second call creates the quarantine file. (test-plan: automated)
- [x] 1.13 Unreadable file still throws (test-plan #X2) — fault: `readFileSync` throws `EACCES` · trigger: `readAuthJson()` · observable: throws, and no quarantine file is created. (test-plan: automated)
- [x] 1.14 Read-path quarantine failure is swallowed (test-plan #X3) — fault: corrupt bytes and `copyFileSync` throws `ENOSPC` · trigger: `readAuthJson()` · observable: returns `{}` without throwing. (test-plan: automated)
- [x] 1.15 No secret leaks to the log line or the filename (test-plan #X4) — input: corrupt bytes containing the literal `sk-SECRET123` · trigger: quarantine runs, capture all log output and the created filename · observable: neither contains `sk-SECRET123`; the log line does contain the quarantine path. (test-plan: automated)

## 2. Red tests — server write path + routes (L1, vitest)

Exemplars: `packages/server/src/__tests__/provider-auth-storage.test.ts` (write
paths) and `packages/server/src/__tests__/provider-auth-routes.test.ts` +
`auth-provider-delete.test.ts` (route-level).

- [x] 2.1 Write refuses when the backup could not be made (test-plan #E11) — input: corrupt `auth.json` with `copyFileSync` forced to throw `EACCES` · trigger: `writeCredential("openai", …)` · observable: throws, `auth.json` byte-identical to before, nothing persisted. See `packages/server/src/__tests__/provider-auth-storage.test.ts`. (test-plan: automated)
- [x] 2.2 Write proceeds when the backup exists (test-plan #E12) — input: corrupt `auth.json`, quarantine copy succeeds · trigger: `writeCredential("openai", …)` · observable: `auth.json` contains only the `openai` credential; the quarantine file holds the pre-corruption bytes. (test-plan: automated)
- [x] 2.3 Dedup hit does not deadlock the repair flow (test-plan #E13) — input: corrupt `auth.json` already quarantined by an earlier `readAuthJson()` in the same process · trigger: `writeCredential("openai", …)` · observable: write succeeds and does not throw. (test-plan: automated)
- [x] 2.4 Healthy-path merge semantics unregressed (test-plan #E14) — input: valid `auth.json` holding an `anthropic` entry · trigger: `writeCredential("openai", …)` · observable: file contains both entries. (test-plan: automated)
- [x] 2.5 Lock placeholder create is 0600 (test-plan #E15) — input: `auth.json` absent · trigger: a locked op pre-creates the file, then a credential is saved · observable: resulting `auth.json` mode is `0600`, not `0644`. (test-plan: automated)
- [x] 2.6 Status endpoint answers 200 on corrupt content (test-plan #X1) — input: `auth.json` = `""` · trigger: `GET /api/provider-auth/status` through the route handler · observable: HTTP `200`, body is an array, every row `authenticated: false`. See `packages/server/src/__tests__/provider-auth-routes.test.ts`. (test-plan: automated)
- [x] 2.7 Refused DELETE surfaces a reason (test-plan #X5) — input: corrupt `auth.json` with quarantine forced to fail · trigger: `DELETE /api/provider-auth/anthropic` · observable: body carries an `error` string naming the reason and no credential material. See `packages/server/src/__tests__/auth-provider-delete.test.ts`. (test-plan: automated)

## 3. Red tests — client (L1, vitest + RTL)

Exemplars: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (fetch
mocking shape) and `packages/client/src/components/__tests__/ProviderAuthSection.refetch.test.tsx`.

- [x] 3.1 A 500 renders an inline error, not a white screen (test-plan #F1) — input: status fetch mocked to `500` with the Fastify envelope · trigger: `ProviderAuthSection` renders · observable: an inline error node is present, the component does not throw, no ErrorBoundary fallback. See `packages/client/src/__tests__/ProviderAuthSection.test.tsx`. (test-plan: automated)
- [x] 3.2 Non-array body does not crash the render (test-plan #F2) — input: status fetch mocked to `200` with `{"ids":[]}` · trigger: render · observable: inline error rendered, no `TypeError`. (test-plan: automated)
- [x] 3.3 Two consecutive poll failures do not abort a login (test-plan #F3) — input: auth-code flow started, polls 1–2 return `500`, poll 3 returns an array with the provider authenticated · trigger: advance the poll timer 3 ticks · observable: flow completes successfully, no error message. (test-plan: automated)
- [x] 3.4 Three consecutive poll failures end the flow (test-plan #F4) — input: auth-code flow started, polls 1–3 all return `500` · trigger: advance the poll timer 3 ticks · observable: flow stops with an error message, polling ceases before the 5-minute timeout. (test-plan: automated)
- [x] 3.5 Error state clears on a successful refetch (test-plan #F5) — input: first fetch `500`, then a user-triggered refresh returning a normal array · trigger: the refresh action · observable: inline error is replaced by the normal provider rows. See `packages/client/src/components/__tests__/ProviderAuthSection.refetch.test.tsx`. (test-plan: automated)

## 4. Implementation — server

- [x] 4.1 Add the internal `readAuthJsonChecked(): { data, corrupt, quarantined }` and reduce the exported `readAuthJson()` to its tolerant wrapper (design D2), in `packages/server/src/auth/provider-auth-storage.ts`.
- [x] 4.2 Implement parse tolerance: BOM strip, plain-object shape validation, `ENOENT` → `{}`, non-`SyntaxError` I/O errors rethrown (design D1, proposal failure taxonomy).
- [x] 4.3 Implement the quarantine: `copyFileSync` (never rename), `wx` + `-N` suffix on `EEXIST`, mode `0600`, colon-free `YYYYMMDDTHHMMSSsssZ` stamp, one log line with the path and reason (design D1/D5).
- [x] 4.4 Implement SHA-256 content dedup, recorded only after a successful copy; a dedup hit reports `quarantined: true` (design D3, and the deadlock guard in the spec).
- [x] 4.5 Wire the write-path refusal into `writeCredential()` / `removeCredential()` inside `withLock()`: `corrupt && !quarantined` → throw and persist nothing; `corrupt && quarantined` → proceed on `{}` (design D4).
- [x] 4.6 Add `mode: 0o600` to the `withLock()` placeholder create.
- [x] 4.7 Map the write refusal to `{ error: <reason> }` on `DELETE /api/provider-auth/:provider` in `packages/server/src/routes/provider-auth-routes.ts`, matching the `PUT` shape.
- [x] 4.8 Make sections 1 and 2 green; confirm no unrelated vitest regressions.

## 5. Implementation — client

- [x] 5.1 Harden `fetchStatus()` in `packages/client/src/components/settings/ProviderAuthSection.tsx` with `res.ok` + `Array.isArray`, surfacing a typed failure instead of throwing.
- [x] 5.2 Add the inline error render path to the section, keeping the section interactive so credentials can still be repaired.
- [x] 5.3 Add the consecutive-failure budget (N=3) plus `res.ok`/`Array.isArray` validation to the `startAuthCode()` poll; a transient failure keeps polling, the third consecutive one ends the flow with a message (design D6).
- [x] 5.4 Make section 3 green; confirm no unrelated client-test regressions.

## 6. Browser E2E (L3, Playwright vs the docker harness)

Exemplar for both: `tests/e2e/settings-default-model-catalogue.spec.ts` (Settings
navigation + provider surface). Read `dashboardPort` from `.pi-test-harness.json`
— never hardcode `:18000`.

- [x] 6.1 Corrupt auth.json does not kill the Settings panel (test-plan #X6) — input: harness `~/.pi/agent/auth.json` overwritten with 0 bytes out-of-band · trigger: browser opens Settings → Provider Authentication · observable: provider rows render signed-out, no ErrorBoundary fallback, `GET /api/provider-auth/status` observed `200`. (test-plan: automated)
- [x] 6.2 The repair flow works while corrupt (test-plan #F6) — input: harness `auth.json` zeroed out-of-band · trigger: open Settings, enter an API key for a provider, save · observable: save succeeds and the row shows a masked key after the section refetches. (test-plan: automated)

## 7. Verify and document

- [x] 7.1 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and confirm no regressions.
- [x] 7.2 Reproduce the original report end to end: zero out `~/.pi/agent/auth.json` against a locally built dashboard, confirm `GET /api/provider-auth/status` returns `200` and the Settings panel renders.
- [x] 7.3 Update the directory `AGENTS.md` rows for `provider-auth-storage.ts`, `provider-auth-routes.ts`, and `ProviderAuthSection.tsx` with the new behaviour and a `See change: fix-corrupt-auth-json-500` marker.
- [x] 7.4 Add a `## [Unreleased]` CHANGELOG entry describing the corrupt-`auth.json` recovery and the Settings hardening.
- [x] 7.5 Invoke the `review-code` discipline skill on the full diff before commit (credential path).
