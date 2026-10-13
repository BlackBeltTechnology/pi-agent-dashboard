## 1. Shared types

- [ ] 1.1 Add `packages/shared/src/operate-required.ts`: `OperateRemedy` (`"use-host" | "re-pair" | "sign-in"`), `OPERATE_REMEDY_ORDER` (canonical relative order), `OperateRequiredReason` (`"no-credential" | "tier-too-low"`), `OperateRequiredBody` (exact keys `success`, `error`, `message`, `reason`, `remedies`); export from the shared barrel; add the row to `packages/shared/src/AGENTS.md`

## 2. Server helper

- [ ] 2.1 Implement `packages/server/src/auth/operate-required.ts`: move the predicate verbatim as `hasOperateAuthority`; add `sendOperateRequired(request, reply, { route: "vault" | "services", loginAvailable: () => boolean })` calling `loginAvailable()` per refusal — reads ip/headers/auth markers only to derive `reason` and `use-host`, emits none of them; messages from the spec table
- [ ] 2.2 In `packages/server/src/auth/auth-plugin.ts`, create a live OAuth accessor (reads `authState.providerRegistry` at call time, counts providers with non-empty `clientId`) **before** the early return at `:208-211` and expose it to the caller; export `buildLoginAvailable(oauthAccessor | null, passkeyService, identity)` and compose it in `packages/server/src/server.ts` from that accessor, `passkeyService`, and `identityEnforced()` + `browserLoginConfigRegistry.list()`
- [ ] 2.3 Add rows for `operate-required.ts` and the OAuth accessor / `buildLoginAvailable` to `packages/server/src/auth/AGENTS.md`

## 3. Wire both routes

- [ ] 3.1 Replace `canManageVault` and `canMutateServices` with `hasOperateAuthority`; route both refusals through `sendOperateRequired`; pass the composed `loginAvailable` into `VaultRoutesDeps` / `ServiceRoutesDeps` in `packages/server/src/server.ts`
- [ ] 3.2 Update rows: `vault-routes.ts` (`packages/server/src/vault/AGENTS.md`), `routes.ts` (`packages/server/src/services/AGENTS.md`), and the vault and managed-services wiring lines in `packages/server/src/server.ts.AGENTS.md` (`See change: surface-operate-required-remedy`)

## 4. Client

- [ ] 4.1 `lib/vault/vault-api.ts`: `Envelope` gains `remedies?`; `VaultResult` gains `code?` (from `error`) and `remedies?`
- [ ] 4.2 Add `OperateRequiredCallout` under `components/settings/vault/` per `mockups/ui-plan.md` (info callout, `role="status"`, labelled list in received order, unknown remedies dropped, sign-in link to `/auth/login`, single-flight Try again with `disabled` + `aria-busy`, test ids and i18n keys `vault.operateRequired.*` from the ui-plan copy table); render it from `VaultSection` when `code === "operate_required"` and `remedies` is an array
- [ ] 4.3 Update `packages/client/src/components/settings/vault/AGENTS.md` and `packages/client/src/lib/vault/AGENTS.md` rows

## 5. Verify

- [ ] 5.1 Run the touched suites and `npm run quality:changed`; restart the server (`POST /api/restart`) and build the client
- [ ] 5.2 `Audit` subagent pass on the diff (refusal body on an auth boundary; disclosure rule)

<!-- Folded from test-plan.md by plan-proposal. One task per manifest row; write each failing before its implementation task. -->
## 6. L1 — server helper (vitest)

- [ ] 6.1 Test `hasOperateAuthority` keeps today's decisions — see packages/server/src/__tests__/vault-routes.test.ts (X12 table) for the harness glue; new file `packages/server/src/__tests__/operate-required.test.ts` — device operate/control/observe, session, principal, loopback, loopback + `x-forwarded-for`, LAN no credential, strict loopback no proof · predicate call · true, false, false, true, true, true, false, false, false (test-plan #E1)
- [ ] 6.2 Test refusal reason/remedies over every reachable combination — see packages/server/src/__tests__/vault-routes.test.ts; in `operate-required.test.ts` — (`no-credential`, not local), (`tier-too-low`, not local / local) × `loginAvailable` · `sendOperateRequired` on a stub reply · exact remedies per combination, five body keys, spec-table message per route family (test-plan #E2)
- [ ] 6.3 Test `buildLoginAvailable` composition matrix — see packages/server/src/__tests__/auth-plugin.test.ts — each source alone, empty-`clientId` only, identity not enforced, all absent, `null` accessor · call the composed function · true/false per spec, always a function (test-plan #E3)
- [ ] 6.4 Test boot-inert auth plugin stays false — see packages/server/src/__tests__/auth-plugin.test.ts — plugin with no providers and passkeys off · read, write config adding a provider, read · false then false (test-plan #E4)
- [ ] 6.5 Test refusal builder latency budget — see packages/server/src/__tests__/vault-routes.test.ts for setup; in `operate-required.test.ts` — 1000 sequential `sendOperateRequired` calls with all three login sources composed · timed loop · total ≤ 1000 ms (test-plan #P1)

## 7. L1 — vault and service routes (vitest)

- [ ] 7.1 Test trusted-network no-credential vault refusal — see packages/server/src/__tests__/vault-routes.test.ts (X12) — `GET /api/vault` from `192.168.16.220`, `192.168.16.0/24` trusted, no credential, no login · inject · 403 `no-credential`, `["use-host"]`, vault `no-credential` message, no `data` (test-plan #E5)
- [ ] 7.2 Test trusted-network low-tier vault refusal — see packages/server/src/__tests__/vault-routes.test.ts (X12) — `control` bearer from `192.168.16.220` · inject `GET /api/vault` · 403 `tier-too-low`, `["use-host","re-pair"]`, vault `tier-too-low` message (test-plan #E6)
- [ ] 7.3 Test low-tier bearer on the host — see packages/server/src/__tests__/vault-routes.test.ts (X12 row "observe bearer on loopback") — `observe` bearer from `127.0.0.1`, strict off · inject `GET /api/vault` · 403 `tier-too-low`, `["re-pair"]` (test-plan #E7)
- [ ] 7.4 Test revoked bearer counts as no credential — see packages/server/src/__tests__/vault-routes.test.ts (X12) — revoked bearer from `192.168.16.220` · inject `GET /api/vault` · 403 `no-credential`, `["use-host"]` (test-plan #E8)
- [ ] 7.5 Test off-network low tier keeps `insufficient_scope` — see packages/server/src/__tests__/vault-routes.test.ts (X12 row "observe bearer, off-host") — `observe`/`control` bearers from `203.0.113.5` · inject `GET /api/vault` · byte-equal pre-change `insufficient_scope` body (test-plan #E9)
- [ ] 7.6 Test sign-in through the real composition — see packages/server/src/__tests__/vault-routes.test.ts — deps from `buildLoginAvailable` over an empty-`clientId` accessor, then a non-empty one · inject from trusted LAN, no credential · no `sign-in`, then `["use-host","sign-in"]` (test-plan #E10)
- [ ] 7.7 Test admission unchanged — see packages/server/src/__tests__/vault-routes.test.ts (X12) — operate bearer, `operate` session JWT, claim-less session JWT (`signToken`; register the auth plugin in `mkApp` or stamp markers), principal, loopback strict off · inject `GET /api/vault` · 200 with the overview (test-plan #E11)
- [ ] 7.8 Test services return the same body — see packages/server/src/services/__tests__/routes.test.ts (E46) — trusted-LAN no credential; loopback `observe` bearer · inject a `/api/services*` mutation · `["use-host"]` + services `no-credential` message; `["re-pair"]` + services `tier-too-low` message; service unchanged (test-plan #E12)
- [ ] 7.9 Test guard coverage of every family — see packages/server/src/__tests__/vault-routes.test.ts and packages/server/src/services/__tests__/routes.test.ts — trusted-LAN no credential · one inject per vault family (accounts, bindings, grants, confirmations, plugin approvals, import candidates/propose/confirm) and per service mutation family, plus `GET /api/session/:id/vault-bindings` · `operate_required` with `remedies` for every family; session read unaffected (test-plan #E13)
- [ ] 7.10 Test the refusal discloses nothing else — see packages/server/src/__tests__/vault-routes.test.ts — trusted `192.168.16.0/24`, host name, device `dev-1` labelled `robson-mbp`, vault with one account, binding and grant · refuse a credential-less LAN caller and `dev-1` at `control` · five keys only; no `192.168.`, CIDR, host name, `dev-1`, `robson-mbp`, account/binding/grant names (test-plan #X1)

## 8. L1 — client (vitest + Testing Library)

- [ ] 8.1 Test vault envelope parsing — see packages/client/src/lib/pairing/__tests__/paired-devices-api.test.ts; new `packages/client/src/lib/vault/__tests__/vault-api.test.ts` — 403 with `remedies`, 403 without, 500 · `fetchVault()` with mocked `fetch` · `code` + `remedies`; `remedies` undefined; no `code` (test-plan #E14)
- [ ] 8.2 Test callout rows follow the server — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx — `["use-host"]`, `["use-host","re-pair","sign-in"]`, `["re-pair"]`, `["use-host","request-access"]` · render · 1 / 3 in order / 1 / 1 `vault-operate-remedy` rows, no `vault-error` (test-plan #F1)
- [ ] 8.3 Test callout semantics — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx — `["use-host","sign-in"]` · render · `role="status"`, list labelled "What you can do", `vault-operate-signin` `href="/auth/login"` (test-plan #F2)
- [ ] 8.4 Test fallbacks keep today's line — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx — 403 `operate_required` without `remedies`, network error, 500 · render · existing `vault-error` text, no callout (test-plan #F3)
- [ ] 8.5 Test retry success replaces the callout — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx — callout shown, next load 200 · click `vault-operate-retry` · vault content shown, callout gone (test-plan #F4)
- [ ] 8.6 Test retry is single-flight — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx — next load held pending · click retry twice, then resolve · 1 `fetchVault` call; retry `disabled` and callout `aria-busy="true"` while pending, cleared after (test-plan #F5)
- [ ] 8.7 Test retry failure falls back — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx — retry's load rejects with a network error · click retry · callout replaced by the existing `vault-error` line (test-plan #X2)

## 9. Manual verification

- [ ] 9.1 Compare the implementation with the approved board `mockups/operate-callout.html` in base dark, base light, nord dark and at 375 px (test-plan: manual-only, test-plan #F6)
- [ ] 9.2 From a second machine on a trusted network over plain http with no credential, open Settings → Vault — callout with the use-host row only; on the host — vault loads (test-plan: manual-only, test-plan #X3)
