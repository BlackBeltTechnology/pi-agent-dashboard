# Test Plan — collapse-model-proxy-onto-modelruntime

Stage: design   Generated: 2026-09-30

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | single runtime | EP | L1 | automated | server started with a test agent dir | construct model proxy, `/api/models`, plugin runtime, provider-auth listing | exactly one `ModelRuntime.create` call observed; every surface returns from it |
| E2 | catalogue and login flows agree | EP | L1 | automated | OAuth credential for `anthropic` | `/api/provider-auth/providers` + `/api/models` | `anthropic` listed in both; its models present |
| E3 | custom provider visible everywhere | EP | L1 | automated | `providers.json` custom provider with 2 discovered models | `/api/models`, proxy completion, plugin runtime | both models listed, routable, visible |
| E4 | built-in completion unchanged | EP | L1 | automated | recorded fake provider | `/v1/chat/completions` stream with tools + system prompt | upstream request carries tools, system prompt as context system prompt, dashboard-resolved credential |
| E5 | OAuth-incompatible filter kept | EP | L1 | automated | provider with OAuth-only credential, flagged model | `/api/models` | flagged model excluded |
| E6 | missing OAuth implementation | EP | L1 | automated | OAuth credential for a provider exposing no OAuth in the runtime | model resolution | reported as missing OAuth capability; no TypeError; api-key providers still routable |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | no lock across network | fault-injection (delay 5s) | L1 | automated | fake OAuth refresh takes 5s | runtime `getAuth` for an expiring credential | a second lock acquisition (pi's `LOCK_OPTIONS`) succeeds during the 5s |
| X2 | refresh once under concurrency | fault-injection (concurrency) | L1 | automated | two proxy requests, expiring credential | parallel `getAuth` | refresh endpoint called exactly once |
| X3 | crash during persist | fault-injection (abort) | L1 | automated | process-kill simulation between temp write and rename | persist | `auth.json` holds previous or new complete JSON |
| X4 | corrupt auth.json not overwritten | fault-injection (corrupt) | L1 | automated | unparseable `auth.json` | runtime-triggered write | write refused; quarantine copy of original bytes exists |
| X5 | lost race, non-idempotent callback | fault-injection (race) | L1 | automated | stored credential changes during the callback | `store.modify` with a callback that ignores `current` | lost-race result never persisted; valid stored credential returned or named error thrown |
| X6 | coordination outcomes preserved | decision-table | L1 | automated | the existing `model-proxy-credential-routing` coordination fixtures (fresher on-disk, waiting out pi refresh, changed/removed/replaced/corrupt/absent/contention) | driven via `store.modify` as pi-ai drives it | each outcome identical to today's |
| X7 | abort propagates | fault-injection (abort) | L1 | automated | client aborts mid-stream | `/v1/chat/completions` | upstream fetch aborted |
| X8 | real subscription refresh | manual | — | manual-only | real Anthropic subscription, near-expiry token, running pi session | proxy request | [judgment: single refresh, auth.json valid, pi keeps working — needs real credentials] |

---

## Coverage summary

- Requirements covered: 5/5
- Scenarios by class: edge 6 · perf 0 · frontend 0 · error 8
- Scenarios by level: L1 13 · L2 0 · L3 0
- Scenarios by disposition: automated 13 · manual-only 1

## New infra needed

- none
