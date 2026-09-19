# Test Plan — redesign-providers-settings-page

Stage: design   Generated: 2026-02-14

Three hard-gate clarifications were resolved before this file was written, and the answers were folded back into the specs rather than left here:

- `PATCH /api/providers/:name` responds at **p95 < 300 ms** with the upstream stalled (probe fully detached) — `custom-provider-crud`.
- The pending health pill reconciles from **exactly one health read ~2 s after the write response** — `custom-provider-crud`, `provider-connection-test`.
- Both refusal directions carry the single code **`provider_auth.credential_type_conflict`** with `vars` naming the stored type — `provider-auth-server`.

No open clarification markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | provider-auth-server · Credential status API | decision-table | L1 | automated | catalogue entry × `auth.json` credential × `ambient`, all 6 `source` values | `_buildAuthStatus` builds an **api-key** row | `configured` true iff stored api-key key present, OR `ambient`, OR (`entry.configured && source != null && source !== "stored"`); one asserted row per combination |
| E2 | provider-auth-server · Credential status API | decision-table | L1 | automated | `auth.json` = `{anthropic:{type:"oauth"}}`, catalogue `anthropic` = `{configured:true, source:"stored"}` | build status | `anthropic` row `configured:true`; `anthropic-api` row `configured:false`, no `maskedKey` |
| E3 | provider-auth-server · Credential status API | decision-table | L1 | automated | `auth.json` = `{anthropic:{type:"api_key",key:"sk-x"}}` | build status | `anthropic` (OAuth) row `configured:false`; `anthropic-api` row `configured:true`, `source:"stored"` |
| E4 | provider-auth-server · Credential status API | EP (invalid partition) | L1 | automated | catalogue entry `{configured:true}` with `source` **absent** | build status | api-key row `configured:false` — absent source is not evidence |
| E5 | provider-auth-server · Credential status API | EP | L1 | automated | `ANTHROPIC_API_KEY=sk-env`, no stored credential, catalogue `anthropic` = `{configured:true, source:"environment"}` | build status | `anthropic-api` row `configured:true`, `source:"environment"` (the env-var-on-an-OAuth-id cell that broke two proposal drafts) |
| E6 | provider-auth-server · Credential status API | EP | L1 | automated | `google-vertex` with both a stored key and `ambient:true` | build status | `maskedKey` is the stored key's mask, not `(ambient)` — stored beats ambient |
| E7 | provider-auth-ui · section badge table | decision-table | L1 | automated | rows: oauth / stored-key / `ambient` / `source:"environment"` / `source:"runtime"` / `source:"models_json_key"` | badge mapper | Subscription / API key / Environment / Environment / API key / API key — only ambient+environment earn Environment |
| E8 | provider-auth-ui · custom-endpoint configured predicate | EP+BVA | L1 | automated | `providers.json` entries: `apiKey:""` · `apiKey:"$UNSET"` · `apiKey:"$SET"` with `SET=sk-x` · `apiKey:"sk-x"` | list projection | listed = ✗ ✗ ✓ ✓; the two listed carry the **Custom endpoint** badge, never Environment |
| E9 | provider-auth-ui · configured-vs-authenticated fallback | BVA (absent field) | L1 | automated | status rows with `configured` **undefined**, `authenticated:true` on 2 of 41 | render list | 2 rows listed — an old server must not produce an empty list |
| E10 | provider-add-flow · Single Add-provider entry point | BVA (count) | L1 | automated | 41 rows, 6 configured, 1 suppressed by cross-type rule | compute the Add label | label names **34** (selectable), not 35 |
| E11 | custom-provider-crud · field semantics | decision-table | L1 | automated | existing `proxy={baseUrl,api,apiKey:"sk-real"}`; PATCH bodies: `{}` · `{api}` · `{apiKey:"***"}` · `{apiKey:"sk-new"}` | apply patch | preserve · preserve-except-api · preserve key · replace key; `"***"` never persisted |
| E12 | custom-provider-crud · upsert | EP | L1 | automated | no `vllm` entry; `PATCH /api/providers/vllm` with baseUrl+api+key | apply | entry created |
| E13 | custom-provider-crud · blank name in path | BVA (invalid) | L1 | automated | `PATCH /api/providers/%20` and `/api/providers/` | request | rejected 4xx; file byte-unchanged |
| E14 | custom-provider-crud · name encoding | EP | L1 | automated | provider literally named `a/b`, percent-encoded in the path | PATCH then DELETE | decoded once, used verbatim as the JSON key; both operations address the same entry |
| E15 | custom-provider-crud · non-provider key preservation | EP | L1 | automated | `providers.json` holding `roles`, `rolePresets`, `activePreset` + 2 providers | PATCH one provider, then DELETE the other | all three non-provider keys deep-equal to their pre-write values in both cases |
| E16 | custom-provider-crud · delete of an absent name | EP | L1 | automated | file without `ghost` | `DELETE /api/providers/ghost` | success; remaining entries unchanged |
| E17 | provider-connection-test · pill scope | decision-table | L1 | automated | one row of each kind, custom endpoint with no cached health | render pills | pill only on the custom-endpoint row ("not tested"); none on subscription / api-key / environment rows |
| E18 | provider-auth-server · catalogue-ready | state-transition | L1 | automated | no push → push → last bridge disconnects | read `GET /api/provider-auth/catalogue-ready` | `false` → `true` → `false` |
| E19 | provider-auth-bridge · catalogue payload | EP | L1 | automated | `OPENAI_API_KEY` exported, no `auth.json` entry | build catalogue | `openai` entry `configured:true, source:"environment", envVar:"OPENAI_API_KEY"` (corrects the spec's prior `configured:false`) |
| E20 | custom-provider-crud · route tiers + manifest | decision-table | L1 | automated | the two new routes and `catalogue-ready` | run the existing tier + manifest-completeness checks | each route has a tier entry and is manifest-bound or denylisted |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | custom-provider-crud · write does not block on the probe | tail-latency + fault injection (stall) | L1 | automated | upstream accepts the TCP connection and never responds; 20 sequential `PATCH` calls | **p95 < 300 ms** response time | the 20-call run |
| P2 | custom-provider-crud · only the touched provider is probed | invariant count | L1 | automated | 5 providers in the file, 1 patched | exactly **1** probe issued | per write |
| P3 | provider-auth-ui · list render | render cost | L1 | automated | status response with 41 rows, 6 configured | rows mounted = 6; the 35 unconfigured never mount a row component | single render |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | provider-add-flow · the flow outlives the dialog | state-transition | L3 | automated | auth-code sign-in started from the dialog | dialog dismissed while the flow polls, then the provider becomes configured server-side | converges to: provider listed as connected; the poll never stopped at dismissal |
| F2 | provider-add-flow · poll reads the unfiltered status | state-convergence | L1 | automated | polled provider absent from the rendered (configured-only) list | provider becomes configured in the raw `/status` array | flow completes; it does not time out waiting on the filtered view |
| F3 | provider-add-flow · per-provider poll keying | state-transition (illegal edge) | L1 | automated | two concurrent auth-code flows | one hits its 3-consecutive-failure bound and ends | the other keeps polling; its timer and counter are untouched |
| F4 | provider-auth-ui · OAuth poll tolerates transient failures | BVA on the failure bound | L1 | automated | poll responses `500,500,ok(authenticated)` then `500,500,500` | run both sequences | first completes; second ends with an error message, not a 5-minute "waiting" |
| F5 | provider-add-flow · keyboard-only picker | state-transition | L3 | automated | picker open, 35 entries | type a filter, ArrowDown ×2, Enter | the highlighted provider's pane opens; no pointer event used |
| F6 | provider-add-flow · cross-type suppression | decision-table | L3 | automated | `anthropic` OAuth connected · `anthropic` api-key stored | open the picker in each state | the conflicting entry is rendered non-selectable and names the remove-first path; the other direction suppresses the OAuth entry |
| F7 | provider-auth-ui · catalogue-unavailable | state-transition | L3 | automated | `catalogue-ready:false`, one OAuth credential, keys in `auth.json` | render the page | Subscription row renders; the scoped "may be out of date" notice renders; the **Add control renders**; the "nothing configured" empty state does **not** |
| F8 | provider-auth-ui · Save Bar is not a provider surface | state-transition | L3 | automated | clean Settings panel | add, edit, then remove a credential | Save Bar never appears; Discard on an unrelated dirty field does not revert the provider writes |
| F9 | provider-auth-ui · single dispatch funnel | invariant count | L3 | automated | listener counting `provider-auth-event` | one successful key save; one custom-endpoint write; one removal | exactly one event per successful write, regardless of which control initiated it |
| F10 | provider-connection-test · pending pill | state-transition (timed) | L3 | automated | custom endpoint saved, probe still in flight | write returns | pill shows pending, then reconciles from exactly one health read ~2 s later |
| F11 | provider-auth-ui · rows identified by source | decision-table | L3 | automated | `anthropic` OAuth credential + a `providers.json` entry also named `anthropic` | render | two rows: one Subscription, one Custom endpoint labelled by its `providers.json` name; neither replaces the other |
| F12 | provider-auth-ui · badge readable without colour | contrast/token audit | L1 | automated | all 18 palettes × badge tokens | compute contrast from the theme tokens | every badge's text ≥ 4.5:1; no badge conveys kind by hue alone |
| F13 | anthropic-peer-hint · gating | state-transition | L3 | automated | `anthropic` unconfigured, peer probe failing | render the page and open the Add dialog on Anthropic | no hint in the list (no row exists) and none in the picker or pane |
| F14 | mockup fidelity (list + dialog vs the shipped surface) | visual/subjective | — | manual-only | `mockups/index.html`, `add-dialog.html` | a human compares the built UI against them | [judgment: spacing/rhythm "matches the mockup" — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | provider-auth-server · API key CRUD (write refusal) | fault injection (conflicting state) | L1 | automated | `auth.json` holds an OAuth credential for `anthropic` | `PUT /api/provider-auth/api-key {provider:"anthropic-api"}` | `409`, `code:"provider_auth.credential_type_conflict"`, `vars` naming `oauth`; stored credential byte-unchanged |
| X2 | provider-auth-server · API key CRUD (remove refusal) | fault injection | L1 | automated | same state | `DELETE /api/provider-auth/anthropic-api` | refused; the OAuth credential still present — the path that silently revokes a subscription today |
| X3 | provider-auth-server · API key CRUD (inverse direction) | fault injection | L1 | automated | `auth.json` holds an api-key credential under `anthropic` | an OAuth sign-in for `anthropic` completes | the stored key is not overwritten; the flow reports the refusal on its own surface |
| X4 | provider-auth-server · API key CRUD | state-transition | L1 | automated | conflicting credential removed first | retry the refused write | succeeds — the guard blocks accident, not intent |
| X5 | provider-auth-server · API key CRUD | EP (must-not-refuse) | L1 | automated | same-type api-key overwrite; OAuth token refresh over the stored OAuth credential | both writes | both succeed — the guard must not break refresh |
| X6 | provider-add-flow · refusal after the dialog closed | fault injection (late failure) | L3 | automated | flow started from the dialog, dialog dismissed, write refused server-side | flow completes | the section renders the refusal inline; the list does not show the provider connected |
| X7 | provider-auth-ui · per-source degradation | fault injection (abort) | L3 | automated | `GET /api/provider-auth/status` → 500 | render | custom-endpoint rows still render with their actions; a scoped inline error renders beside them; no ErrorBoundary |
| X8 | provider-auth-ui · per-source degradation (inverse) | fault injection (abort) | L3 | automated | `/api/providers` → 500 | render | credential rows still render; the error is scoped to the custom-endpoint source |
| X9 | provider-auth-ui · malformed status body | fault injection (shape) | L1 | automated | `/status` returns `200` with a JSON object | render and poll | inline error; no array method called on the body; no TypeError |
| X10 | custom-provider-crud · lost update | concurrency | L1 | automated | two in-process writes to different providers issued simultaneously | both complete | both providers present; no read→write interleave |
| X11 | custom-provider-crud · atomic write | fault injection (interrupt) | L1 | automated | interrupt between write and rename | read the file | previous or new content, never a partial document |
| X12 | custom-provider-crud · recursive proxy guard | fault injection (bad input) | L1 | automated | `baseUrl` pointing at the dashboard's own proxy endpoint | PATCH | rejected, on the same terms as the retained whole-map write |
| X13 | provider-auth-server · status under corrupt auth.json | fault injection (corrupt) | L1 | automated | truncated `auth.json` | `GET /api/provider-auth/status` | `200`, JSON array, every row `authenticated:false` — no 5xx |
| X14 | provider-auth-server · catalogue invalidation consequence | state-transition | L1 | automated | api key stored for `openrouter`, last bridge disconnects | read `/status` | no `openrouter` api-key row while unavailable; the row returns once a catalogue is pushed again (the accepted management gap) |
| X15 | i18n coverage | EP | L1 | automated | every new client string and the refusal code | run the i18n key-coverage check | no untranslated literal; `err.provider_auth.credential_type_conflict` present in every shipped locale |

---

## Coverage summary

- Requirements covered: 27 / 27 requirements across the 10 delta specs (every `### Requirement` has ≥1 row)
- Scenarios by class: edge 20 · perf 3 · frontend 14 · error 15 — **52 total**
- Scenarios by level: L1 36 · L2 0 · L3 15 · manual-only 1
- Scenarios by disposition: automated 51 · manual-only 1

L2 (qa VM smoke) is empty deliberately: this change adds no install, spawn, or
multi-OS runtime surface — it is server routes + rendered UI, which route to L1
and L3 respectively.

## New infra needed

- **Stalled-upstream fixture** for P1/X-class probe tests: a server that accepts the connection and never responds (distinct from the existing refused-connection fixture used by `provider-connection-test`). Lives with the existing probe tests; no new harness or level.
- Everything else reuses `packages/server/src/__tests__` (vitest), `packages/client/src/**/__tests__` (vitest + RTL), and `tests/e2e/*.spec.ts` against the docker harness port from `.pi-test-harness.json`.
