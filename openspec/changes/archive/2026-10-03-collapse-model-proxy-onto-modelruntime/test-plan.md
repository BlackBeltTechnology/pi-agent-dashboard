# Test Plan — collapse-model-proxy-onto-modelruntime

Stage: design   Generated: 2026-09-30   Revised after doubt-review cycles 1–3

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | single runtime | EP | L1 | automated | server started with a test agent dir | construct model proxy, `/api/models`, plugin runtime, provider-auth listing | exactly one `ModelRuntime.create` call observed (`modelsPath: null`, `refreshOnCreate: false`, `allowModelNetwork: false`); every surface returns from it |
| E2 | catalogue and login flows agree | EP | L1 | automated | OAuth credential for `anthropic` | `/api/provider-auth/providers` + `/api/models` | `anthropic` listed in both; its models present |
| E3 | custom provider visible everywhere | EP | L1 | automated | `providers.json` custom provider with 2 discovered models | `/api/models`, proxy completion, plugin runtime (`getModelRegistry().find` + `streamSimple`) | both models listed, routable, visible |
| E4 | built-in completion unchanged | EP | L1 | automated | recorded fake provider | `/v1/chat/completions` stream with tools + system prompt | upstream request carries tools, system prompt as context system prompt, dashboard-resolved credential; no `apiKey` override passed to `streamSimple` |
| E5 | OAuth-incompatible filter kept | EP | L1 | automated | provider with OAuth-only credential, flagged model | `/api/models` and `?annotated=1` | flagged model excluded; annotated `excludedReason: "oauth-incompatible"` |
| E6 | missing OAuth implementation | EP | L1 | automated | OAuth credential for a provider exposing no `auth.oauth` in the runtime | proxy completion + diagnostics route | named missing-OAuth-capability error, no TypeError; diagnostics lists provider under missing-OAuth; api-key providers still routable |
| E7 | removed custom provider / field disappears | decision-table | L1 | automated | registered custom provider; then (a) entry removed, (b) only `apiKey` removed from `providers.json` | providers.json change handler | (a) provider absent from runtime + `/api/models`; (b) runtime no longer uses the removed key (`unregisterProvider` called before re-register) |
| E8 | unresolved `$ENV` custom key | EP | L1 | automated | custom provider with `apiKey: "$UNSET_VAR"` | registry build | no throw; `registerProvider` not called for it; other providers registered; log line carries no secret |
| E9 | ambient env does not list | EP | L1 | automated | no `openai` credential in `auth.json`, `OPENAI_API_KEY` exported | `/api/models` | no `openai/*` models listed |
| E10 | custom per-model headers survive | EP | L1 | automated | custom model with `headers: { "X-Org": "a" }` | proxy completion | upstream request carries `X-Org: a` |
| E11 | api_key credential through the store | EP | L1 | automated | `auth.json` holds `api_key` credential for a provider | `store.read(id)` + proxy completion | `read` returns the `api_key` credential; upstream carries that key (not an env key) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | no lock across network | fault-injection (delay 5s) | L1 | automated | fake OAuth refresh takes 5s | runtime `getAuth` for an expiring credential | a second lock acquisition (pi's `LOCK_OPTIONS`) succeeds during the 5s |
| X2 | refresh once under concurrency | fault-injection (concurrency) | L1 | automated | two proxy requests, expiring credential | parallel facade auth resolution | refresh endpoint called exactly once |
| X3 | crash during persist | fault-injection (abort) | L1 | automated | process-kill simulation between temp write and rename | persist | `auth.json` holds previous or new complete JSON |
| X4 | corrupt auth.json not overwritten | fault-injection (corrupt) | L1 | automated | unparseable `auth.json` | runtime-triggered write | write refused; quarantine copy of original bytes exists |
| X5 | lost race, non-idempotent callback | fault-injection (race) | L1 | automated | stored credential changes during the callback | `store.modify` with a callback that ignores `current` | lost-race result never persisted; valid stored credential returned or named error thrown |
| X6 | coordination outcomes preserved | decision-table | L1 | automated | the existing `model-proxy-credential-routing` coordination fixtures (fresher on-disk, waiting out pi refresh, changed/changed-expired/removed/replaced/corrupt/absent/contention, failed-refresh recovered by stored credential, failed-refresh explained by removal) | driven via `store.modify` as pi-ai drives it | each outcome identical to today's; named errors surface through `ModelsError.cause` unwrap |
| X7 | abort propagates | fault-injection (abort) | L1 | automated | client aborts mid-stream | `/v1/chat/completions` | upstream fetch aborted |
| X8 | real subscription refresh | manual | — | manual-only | real Anthropic subscription, near-expiry token, running pi session | proxy request | [judgment: single refresh, auth.json valid, pi keeps working — needs real credentials] |
| X9 | joint degradation | fault-injection (abort) | L1 | automated | `ModelRuntime.create` rejects | server boot | provider-auth listing `{ ids: [] }` + `getRegistryError()` set; proxy and `/api/models` report the same registry error; no crash |
| X10 | failed refresh shared once | fault-injection (reject) | L1 | automated | two requests, expiring credential, provider rejects refresh | parallel facade auth resolution | refresh endpoint called once; both requests fail with that error |
| X11 | delete never creates auth.json | fault-injection (absent) | L1 | automated | no `auth.json` on disk | `store.delete(id)` | `auth.json` still absent afterwards |
| X12 | no credential write at boot | fault-injection (near-expiry) | L1 | automated | OAuth credential expiring in 1 min | server boot (runtime create) | refresh endpoint not called; `auth.json` byte-identical |
| X13 | torn read retried | fault-injection (corrupt) | L1 | automated | first unlocked read sees truncated JSON, locked re-read sees valid JSON | `store.read(id)` | returns the valid credential; no quarantine of the valid file |
| X14 | refresh abort propagates | fault-injection (abort) | L1 | automated | initiating request aborts during its in-flight refresh | facade auth resolution | refresh signal aborted; nothing written to `auth.json` |
| X15 | serialized modify/delete | fault-injection (race) | L1 | automated | `delete` issued while a 2s `modify` for the same provider runs | `store.delete` + `store.modify` | `delete` starts only after `modify` settles; final `auth.json` has no credential for the provider |

---

## Coverage summary

- Requirements covered: 5/5 (single runtime, auth.json guarantees, OAuth relocation, completions identical, piai-compat removal via E4/E6)
- Scenarios by class: edge 11 · perf 0 · frontend 0 · error 15
- Scenarios by level: L1 25 · L2 0 · L3 0
- Scenarios by disposition: automated 25 · manual-only 1

## New infra needed

- none
