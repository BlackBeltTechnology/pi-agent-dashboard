## 1. Shared types

- [ ] 1.1 Add `packages/shared/src/operate-required.ts`: `OperateRemedy` (`"use-host" | "raise-tier" | "sign-in" | "request-access"`), `OPERATE_REMEDY_ORDER`, `OperateRequiredReason` (`"no-credential" | "tier-too-low"`), `OperateRequiredBody`; export from the shared barrel; add the row to `packages/shared/src/AGENTS.md`

## 2. Server helper (TDD)

- [ ] 2.1 Write failing tests `packages/server/src/__tests__/operate-required.test.ts` (sibling layout of `vault-routes.test.ts`): `hasOperateAuthority` table (device operate → true; device control/observe → false; session/principal → true; loopback no fwd → true; loopback + `x-forwarded-for` → false; LAN no credential → false; strict without proof → false); `reason` derivation; remedy order and presence for every combination of `{reason, loginAvailable, knockAvailableFor}`; `request-access` never with `tier-too-low`
- [ ] 2.2 Implement `packages/server/src/auth/operate-required.ts`: move the predicate verbatim as `hasOperateAuthority`; add `sendOperateRequired(request, reply, {message, loginAvailable, knockAvailableFor?})`
- [ ] 2.3 Locate the accessor the login page uses for its configured methods in `packages/server/src/auth/auth-plugin.ts` (OAuth provider with non-empty `clientId`, or passkeys) and expose it as `loginAvailable()` for the route deps; do not re-derive from raw config
- [ ] 2.4 Add the module row to `packages/server/src/auth/AGENTS.md`

## 3. Wire both routes

- [ ] 3.1 Extend `packages/server/src/__tests__/vault-routes.test.ts`: credential-less LAN caller → 403 body `{error:"operate_required", reason:"no-credential", remedies:["use-host"]}` and no vault data; control-tier bearer → `tier-too-low` + `raise-tier`; `loginAvailable` true → `sign-in`; operate bearer / operator session / genuine local → 200 unchanged
- [ ] 3.2 Extend the service routes test (`packages/server/src/services/__tests__/routes.test.ts`, E46 neighbour): a mutation from the same caller returns the same `reason`/`remedies` and leaves the service unchanged
- [ ] 3.3 Replace `canManageVault` and `canMutateServices` with `hasOperateAuthority`; route refusals through `sendOperateRequired` keeping each route's current `message`; thread `loginAvailable` through `VaultRoutesDeps` / `ServiceRoutesDeps` at the registration site
- [ ] 3.4 Disclosure test: with trusted networks `192.168.16.0/24`, a server host name and a paired device labelled `robson-mbp` configured, no string in a refusal body contains `192.168.`, the CIDR, the host name or the label
- [ ] 3.5 Update the `vault-routes.ts` and `routes.ts` rows in their directory `AGENTS.md` (`See change: surface-operate-required-remedy`)

## 4. Client

- [ ] 4.1 Extend `packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx` (failing first): `operate_required` + `["use-host"]` → `vault-operate-required` callout with one row and no `vault-error`; `["use-host","request-access"]` → Request access action visible; 403 without `remedies` → callout with use-host row; network error / 500 → existing `vault-error` line, no callout
- [ ] 4.2 `lib/vault/vault-api.ts`: `VaultResult` gains `code` and `remedies` from the envelope
- [ ] 4.3 Add `OperateRequiredCallout` under `components/settings/vault/` (info callout, `role="status"`, one row per remedy in received order, i18n keys `vault.operateRequired.*`); render it from `VaultSection` for `code === "operate_required"`; leave the `request-access` action as a prop the knock change supplies
- [ ] 4.4 Update `components/settings/vault/AGENTS.md` rows

## 5. Verify

- [ ] 5.1 Run the touched suites and `npm run quality:changed`; restart the server (`POST /api/restart`) and build the client
- [ ] 5.2 Manual: open Settings → Vault from a second machine on a trusted network — callout with "open on the host" guidance; on the host — vault loads
- [ ] 5.3 `Audit` subagent pass on the diff (refusal body on an auth boundary; disclosure rule)
