# Test Plan — surface-operate-required-remedy

Stage: design   Generated: 2026-10-13

Gate answers folded (scenario-design HARD gate): G1 retry is single-flight
(disabled + `aria-busy`) · G2 no harness change — callout is L1 + one manual
cross-machine check · G3 L1 latency budget for `sendOperateRequired`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | reason/remedies › predicate unchanged | decision-table | L1 | automated | device operate / control / observe; session; principal; loopback no fwd; loopback + `x-forwarded-for`; LAN no credential; strict loopback no proof | `hasOperateAuthority` | true, false, false, true, true, true, false, false, false |
| E2 | reason/remedies › reachable combinations | decision-table | L1 | automated | (`no-credential`, not local), (`tier-too-low`, not local), (`tier-too-low`, local) × `loginAvailable` true/false | `sendOperateRequired` | remedies `[use-host]`/`[use-host,sign-in]`, `[use-host,re-pair]`/`[use-host,re-pair,sign-in]`, `[re-pair]`/`[re-pair,sign-in]`; body keys exactly `success,error,message,reason,remedies`; message per spec table for `vault` and `services` |
| E3 | usable login › composition | decision-table | L1 | automated | OAuth non-empty `clientId` only; empty-`clientId` only; passkeys only; identity enforced + 1 browser-login config; identity not enforced + config; all absent; `null` accessor | `buildLoginAvailable(...)()` | true, false, true, true, false, false, false; return value is always a function |
| E4 | usable login › boot-inert plugin | state-transition | L1 | automated | auth plugin registered with no providers, passkeys off | read accessor; write config adding a provider; read again | false, then still false |
| E5 | vault route › trusted-network no credential | EP | L1 | automated | `GET /api/vault` from `192.168.16.220` with `192.168.16.0/24` trusted, no credential, `loginAvailable` false | inject | 403 `{error:"operate_required", reason:"no-credential", remedies:["use-host"]}`, vault `no-credential` message, no `data` key |
| E6 | vault route › trusted-network low tier | EP | L1 | automated | `control` bearer from `192.168.16.220` | inject `GET /api/vault` | 403 `reason:"tier-too-low"`, `["use-host","re-pair"]`, vault `tier-too-low` message |
| E7 | vault route › low tier on the host | EP | L1 | automated | `observe` bearer from `127.0.0.1`, strict off | inject `GET /api/vault` | 403 `reason:"tier-too-low"`, `["re-pair"]` |
| E8 | vault route › revoked bearer | EP | L1 | automated | revoked bearer from `192.168.16.220` | inject `GET /api/vault` | 403 `reason:"no-credential"`, `["use-host"]` |
| E9 | vault route › off-network low tier untouched | EP | L1 | automated | `observe` and `control` bearers from `203.0.113.5` | inject `GET /api/vault` | existing `insufficient_scope` body, byte-equal to the pre-change body |
| E10 | vault route › sign-in through real composition | EP | L1 | automated | route deps built with `buildLoginAvailable` over an empty-`clientId`-only accessor; then over a non-empty one | inject `GET /api/vault` from trusted LAN, no credential | first: no `sign-in`; second: `["use-host","sign-in"]` |
| E11 | admission unchanged | EP | L1 | automated | operate bearer; `operate` session JWT; claim-less session JWT; principal; loopback strict off | inject `GET /api/vault` | 200 with the vault overview for each |
| E12 | services › same body | EP | L1 | automated | trusted-LAN no credential; loopback `observe` bearer (strict off) | inject a `/api/services*` mutation | `no-credential` `["use-host"]` + services `no-credential` message; `tier-too-low` `["re-pair"]` + services `tier-too-low` message; service state unchanged |
| E13 | guard coverage | EP | L1 | automated | trusted-LAN no credential | one inject per vault family (accounts, bindings, grants, confirmations, plugin approvals, import candidates / propose / confirm) and per service mutation family; plus `GET /api/session/:id/vault-bindings` | every family → `operate_required` with `remedies`; session binding read unaffected |
| E14 | client › envelope parsing | EP | L1 | automated | 403 body with `remedies`; 403 `operate_required` without `remedies`; 500 | `fetchVault()` with mocked `fetch` | `{ok:false, code:"operate_required", remedies:[…]}`; `remedies` undefined; no `code` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | refusal builder budget (G3) | throughput | L1 | automated | 1000 sequential `sendOperateRequired` calls on a stub reply, `loginAvailable` composed from all three sources | total wall time ≤ 1000 ms (≤ 1 ms per call on average) | 1000 calls |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | callout › rows follow the server | decision-table | L1 | automated | `["use-host"]`; `["use-host","re-pair","sign-in"]`; `["re-pair"]`; `["use-host","request-access"]` | `VaultSection` renders | `vault-operate-required` with 1 / 3 (in order) / 1 / 1 `vault-operate-remedy` rows by `data-remedy`; no `vault-error` |
| F2 | callout › semantics | EP | L1 | automated | `["use-host","sign-in"]` | render | callout `role="status"`; list labelled "What you can do"; `vault-operate-signin` has `href="/auth/login"` |
| F3 | callout › fallbacks unchanged | EP | L1 | automated | 403 `operate_required` without `remedies`; network error; 500 | render | existing `vault-error` line with today's text; no callout |
| F4 | retry › success replaces callout | state-transition | L1 | automated | callout shown; next `fetchVault` resolves 200 | activate `vault-operate-retry` | vault content rendered; callout and retry gone |
| F5 | retry › single-flight (G1) | state-transition | L1 | automated | callout shown; next `fetchVault` held pending | activate retry twice, then resolve | exactly 1 `fetchVault` call; retry `disabled` and callout `aria-busy="true"` while pending; both cleared after settle |
| F6 | visual fidelity to the approved board in base dark, base light, nord dark, and at 375 px | visual/subjective | — | manual-only | `mockups/operate-callout.html` vs implementation | human compares | [judgment: matches approved mockup — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | disclosure | fault-injection (sensitive fixture) | L1 | automated | trusted `192.168.16.0/24`, server host name, device `dev-1` labelled `robson-mbp`, vault with one account, binding and grant | refuse a credential-less LAN caller and `dev-1` at `control` from the LAN | each body has exactly the five keys; no string contains `192.168.`, the CIDR, the host name, `dev-1`, `robson-mbp`, or the account, binding or grant names |
| X2 | retry › failure falls back | fault-injection (abort) | L1 | automated | callout shown; retry's `fetchVault` rejects with a network error | activate retry | callout replaced by the existing `vault-error` line |
| X3 | cross-machine reality check (G2) | fault-injection (real network) | — | manual-only | second machine on a trusted network over plain http, no credential | open Settings → Vault there, then on the host | remote: callout with the use-host row only; host: vault loads |

---

## Coverage summary

- Requirements covered: 3/3 (`Operate refusals carry a reason and remedies`, `… disclose nothing beyond the caller's own position`, `Vault settings explain an operate refusal`)
- Scenarios by class: edge 14 · perf 1 · frontend 6 · error 3
- Scenarios by level: L1 22 · L2 0 · L3 0 · — 2
- Scenarios by disposition: automated 22 · manual-only 2

## New infra needed

- none — every automated row extends an existing vitest file or adds a sibling (`vault-routes.test.ts` X12 table, `services/__tests__/routes.test.ts` E46, `auth-plugin.test.ts`, `VaultSection.test.tsx`, `lib/pairing/__tests__/paired-devices-api.test.ts` layout); no harness change (G2).
