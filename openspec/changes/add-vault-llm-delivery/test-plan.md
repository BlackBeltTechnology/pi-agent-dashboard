# Test Plan — add-vault-llm-delivery

Stage: design   Generated: 2026-10-12

Hard gate passed. Two clarifications were answered and folded into `specs/vault-llm-delivery/spec.md`:
- lease renewal retries with exponential backoff, 5 s up to a 60 s cap;
- owned-key proxy overhead is p95 ≤ 25 ms above an unowned key.

Inherited from the foundation: the marker `[REDACTED:<NAME>]` and the 5 s propagation bound.

Exemplars (harness glue to copy):
- **L1 model proxy:**
  - `packages/server/src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts` (refresh single-flight);
  - `packages/server/src/model-proxy/__tests__/internal-registry.test.ts` (listing and find);
  - `packages/server/src/model-proxy/__tests__/api-key-store.test.ts` (keys and scopes);
  - `packages/server/src/__tests__/model-proxy-auth-gate.test.ts` (gate);
  - `packages/server/src/__tests__/model-proxy-routes.test.ts` (SSE route);
  - `packages/server/src/__tests__/model-proxy-parallel-isolation.test.ts` (concurrent requests).
- **L1 vault:** `packages/server/src/__tests__/plugin-credential-store.test.ts` (locked JSON store), alongside the foundation's `vault-store.test.ts` once it exists.
- **L1 bridge:**
  - `packages/extension/src/__tests__/provider-register-reload.test.ts` (register, reload);
  - `packages/extension/src/__tests__/provider-register-native-models.test.ts` (models_list).
- **L3:**
  - `tests/e2e/model-proxy-oauth-filter.spec.ts` (proxy listing in the harness);
  - `tests/e2e/delegate-provider-oauth-flow.spec.ts` (server OAuth flow UI);
  - `tests/e2e/redesign-providers-list.spec.ts` (provider settings list).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | vault-llm-credentials: OAuth accounts | EP | L1 | automated | link `anthropic` "personal" + vault-backed `anthropic` "work" | list accounts | 2 accounts, backends `link` and `vault`; no token fields in the response |
| E2 | vault-llm-credentials: Linking | invariant | L1 | automated | hub `auth.json` with an `anthropic` OAuth entry | link, then unlink | `auth.json` sha256 is unchanged after each step; `vault.json` contains no `refresh` field for the link |
| E3 | vault-llm-credentials: Linking | BVA | L1 | automated | linked token with remaining lifetime of 30 min, 5 min 1 s, 4 min 59 s | `issueAccessToken` | the first two return the stored token with 0 refresh calls; the third makes exactly 1 refresh call through `dashboard-credential-store` |
| E4 | vault-llm-credentials: Linking | decision table | L1 | automated | linked "personal" is the default of `anthropic` and the override of project B's grant | unlink | binding default empty; project B grant `no-account`; `auth.json` unchanged |
| E5 | vault-llm-credentials: Linking | state | L1 | automated | link recorded with identity `acct-1`; `auth.json` re-login now has identity `acct-2` | `issueAccessToken` | link state `identity-changed`; no token issued; event `identity-changed` logged |
| E6 | vault-llm-credentials: Single refresher | concurrency | L1 | automated | expired vault-backed "work"; stub refresh delayed 200 ms | lease request + proxied read + plugin read concurrently | stub refresh called once; all three get the same new access token |
| E7 | vault-llm-credentials: Single refresher | concurrency | L1 | automated | "personal" refresh stalled 2 s; "work" valid | lease for "work" | "work" served in < 100 ms |
| E8 | vault-llm-credentials: Single refresher | state | L1 | automated | refresh in flight for "work" | revoke "work", then refresh resolves | minted token discarded; caller gets an error; vault record unchanged except revocation |
| E9 | vault-llm-credentials: Single refresher | state | L1 | automated | refresh in flight; account re-enrolled meanwhile | refresh resolves | minted token discarded; the token returned comes from the re-enrolled record |
| E10 | vault-llm-credentials: Single refresher | BVA | L1 | automated | record persisted 10 s ago with 4 min left | `issueAccessToken` | refreshes (the 30 s reuse window does not override the 5-minute minimum) |
| E11 | vault-llm-credentials: LLM bindings | EP | L1 | automated | names `anthropic-work`, `Anthropic`, `a--b`, `-x`, clone `openai` (base anthropic), clone `x` with no base | create binding | only `anthropic-work` is accepted; the rest get validation errors |
| E12 | vault-llm-credentials: LLM bindings | decision table | L1 | automated | delivery × account kind × provider: key/oauth × key/lease/proxy × anthropic (lease-listed, anthropic-messages) / openai (openai-responses) / openai-codex | create binding | accepted only where the spec's delivery rules allow; each rejection names the rule |
| E13 | vault-llm-credentials: LLM bindings | decision table | L1 | automated | `openai-codex` binding to an `anthropic` account; override of a different kind; override on a pool | create, set override | all rejected; the vault is unchanged |
| E14 | vault-llm-credentials: LLM bindings | state | L1 | automated | clone `foo` valid; then the hub's `providers.json` adds provider `foo` | build snapshot | `foo` state `name-conflict`; not in the snapshot |
| E15 | vault-llm-credentials: Pools | decision table | L1 | automated | pool with delivery `lease`; mixed key+oauth pool; valid proxy pool | create | first two rejected; valid pool stored with `failoverEnabled: false` |
| E16 | vault-llm-credentials: Enrolment | state | L1 | automated | identity of the new tokens: equals vault "work" / equals linked "personal" / absent (with a link present) | enrol | "work" tokens replaced with the same id; refused; proceeds only with a confirm flag, and the confirmation is logged |
| E17 | vault-llm-credentials: Credential changes notify | state | L1 | automated | connected bridge stub | enrol, re-enrol, link, unlink, revoke, binding edit | one `credentials_updated` broadcast per action (6 in total) |
| E18 | vault-llm-credentials: Plugin reads | decision table | L1 | automated | approved plugin; binding default `oauth` vault-backed / `key` / unapproved | read | access token (no `refresh` key in the result) / key / nothing |
| E19 | vault-llm-credentials: Plugin reads | invariant | L1 | automated | vault-backed-only provider `anthropic-work` | plugin `ctx.modelRuntime` completion; `ctx.providerAuth.getCredential("anthropic-work")` | no-credential error; `undefined` |
| E20 | credential-vault (MODIFIED): grants | decision table | L1 | automated | `oauth` account as the default of env binding `ANTHROPIC_OAUTH_TOKEN` and of llm `anthropic-work` (lease) | snapshot | env entry absent; llm lease present |
| E21 | vault-llm-delivery: Local precedence | decision table | L1 | automated | session-side sources: `auth.json` anthropic / `ANTHROPIC_OAUTH_TOKEN` / `ANTHROPIC_AUTH_TOKEN` / `providers.json` anthropic / `models.json` anthropic with `apiKey` / none | apply llm `anthropic` | the first five give `local-override` with no `registerProvider` call; `none` registers |
| E22 | vault-llm-delivery: Local precedence | EP | L1 | automated | local `auth.json` anthropic; bindings `anthropic` and clone `anthropic-work` | apply | `anthropic` `local-override`; `anthropic-work` registered |
| E23 | vault-llm-delivery: Local precedence | state | L1 | automated | env `GEMINI_API_KEY` delivered by the vault (tracked) | apply llm `google` | `google` registered; not `local-override` |
| E24 | vault-llm-delivery: Literal keys | EP | L1 | automated | keys `!rm -rf x`, `$OPENAI_SECRET_abc123` (env var set), `a$b$$c`, `${HOME}x` | `toLiteralApiKey`, then pi's config-value resolver | each resolves to exactly the input string; no command spawned (spy) |
| E25 | vault-llm-delivery: Literal keys | invariant | L1 | automated | `toRegisterApiKey("$FOO")` | call | still returns `$FOO` (the `providers.json` path is unchanged) |
| E26 | vault-llm-delivery: Lease | BVA | L1 | automated | lease issued with 60 min; fake clock | advance 47:59, then 48:00 | no renewal at 47:59; renewal requested at 48:00 |
| E27 | vault-llm-delivery: Lease | BVA (backoff) | L1 | automated | renewal fails at t=0; hub returns at t=12 s | fake clock | retries at t=5 and t=15; the second succeeds; at most 60 s between retries over a long outage |
| E28 | vault-llm-delivery: Lease | state | L1 | automated | `anthropic` lease bound; registered shape changes lease → proxy | push | `unregisterProvider` called before `registerProvider`; a renewal re-registers in place without unregister |
| E29 | vault-llm-delivery: Proxy delivery | decision table | L1 | automated | owned key for `anthropic-work`; labels `claude-sonnet-4-5`, `anthropic-work/claude-sonnet-4-5`, `openai/gpt-4o`, `ghost`, plus an alias and `preferredModels` configured | resolve | the first two resolve to the same model; `openai/gpt-4o` → 403 `BINDING_MISMATCH`; `ghost` → 404; the alias and preferred model are never used |
| E30 | vault-llm-delivery: Proxy delivery | state | L1 | automated | session with a proxy binding | snapshot #1, reconnect snapshot #2 | key #2 ≠ key #1; key #1 → 401; key #1's record is deleted from `config.json` |
| E31 | vault-llm-delivery: Proxy delivery | decision table | L1 | automated | owned key; triggers: session end / grant revoke / confirmation revoke / pairing revoke / grace expiry / hub start | trigger | the key is rejected with 401 within 5 s for each trigger |
| E32 | vault-llm-delivery: Proxy delivery | compat | L1 | automated | today's gate code (`api-key-store.keyHasScope` unchanged) and a key with `scopes: ["vault-session"]` | call `/v1/models`, `/v1/messages` | 403 `SCOPE_INSUFFICIENT` on both; nothing listed or called |
| E33 | vault-llm-delivery: Proxy delivery | EP | L1 | automated | binding `api` anthropic-messages / openai-completions; hub origin `https://hub:8443` | bridge builds the registration | `baseUrl` `https://hub:8443` and `https://hub:8443/v1` respectively; `authHeader: true`; models = the snapshot's list |
| E34 | model-proxy (MODIFIED): Model availability | invariant | L1 | automated | owned key for clone `anthropic-work`; auth.json has `openai` | `/v1/models` with the owned key, then with an unowned key | owned: only `anthropic-work/*`; unowned: exactly today's `getAvailable()` and no `anthropic-work/*` (cache not polluted) |
| E35 | model-proxy-credential-routing (MODIFIED): filtering | EP | L1 | automated | owned key for oauth clone of anthropic; base model `claude-3-5-haiku-20241022` flagged incompatible | list | that clone model excluded; `claude-haiku-4-5` listed |
| E36 | model-proxy-credential-routing (MODIFIED): credential writes | concurrency | L1 | automated | expired `auth.json` anthropic + expired vault "work" (binding `anthropic`) | unowned and owned requests concurrently | 2 refresh calls in total (one per credential); `auth.json` holds only its own rotation; "work" only in the vault |
| E37 | model-proxy-credential-routing (MODIFIED): credential writes | invariant | L1 | automated | composite store with a vault binding | runtime `list()`, `modify("anthropic-work")`, `delete` outside scope; `read` inside scope | list has no vault ids; modify/delete do not touch the vault; read returns `{type:"api_key"}` |
| E38 | vault-llm-delivery: Proxy delivery (scope hygiene) | invariant | L1 | automated | owned request in flight | the hub calls `registerProvider` for a binding change during the request | the runtime availability snapshot afterwards contains no vault-only id |
| E39 | vault-llm-delivery: Redaction | EP | L1 | automated | lease token, proxy key and llm key delivered for `anthropic-work` | `tool_result` printing each | each becomes `[REDACTED:anthropic-work]`; earlier lease tokens stay masked after renewal |
| E40 | vault-llm-delivery: Outage, reload, disable | state | L1 | automated | hub unreachable; lease with 5 min left; grace 24 h | advance 5 min | override unregistered; one notice "vault unreachable for anthropic-work"; the message contains no token |
| E41 | vault-llm-delivery: Outage, reload, disable | state | L1 | automated | hub unreachable; key and proxy bindings; grace 1 h | advance 59 min, then 61 min | registered at 59 min; unregistered at 61 min |
| E42 | vault-llm-delivery: Outage, reload, disable | state | L1 | automated | valid lease; hub unreachable | `session_shutdown(reload)` + `session_start(reload)` | provider re-registered with the same token; no hub call; an expired lease is not re-registered |
| E43 | vault-llm-delivery: Outage, reload, disable | state | L1 | automated | llm `anthropic` delivered | disable delivery | `unregisterProvider("anthropic")`; owned keys revoked; vault `providers.json` tracking untouched (`lastRegistered` unchanged) |
| E44 | vault-llm-delivery: Observability | EP | L1 | automated | issuance, refresh, failover, mint, revoke, local-override, identity-changed | emit | each event matches `{at, kind, accountId, bindingName, sessionId, outcome}`; failover also has `fromAccountId`/`toAccountId`; no value matches `/sk-ant\|pi-proxy-\|refresh/` |
| E45 | vault-llm-credentials: Token material | fault | L1 | automated | refresh stub rejects with `Error("bad", {cause: {body: "sk-ant-oat01-SECRET"}})` | `issueAccessToken` | log line and returned error contain the account id and kind, and do not contain `sk-ant-oat01-SECRET` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | vault-llm-delivery: Proxy overhead is bounded | tail-latency | L1 | automated | 1 000 owned-key + 1 000 unowned-key `/v1/messages` requests to a stub upstream with a fixed 50 ms latency; no refresh | p95(owned) − p95(unowned) ≤ 25 ms | 2 000 requests after 100 warm-up requests |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | vault-llm-credentials: Linking / OAuth accounts | state-convergence | L3 | automated | harness with a seeded `auth.json` anthropic login | Settings → Vault → "Link existing login" | the account appears with backend `link`; network responses contain no `sk-ant` value |
| F2 | vault-llm-credentials: Pools | state-transition | L3 | automated | proxy pool with 2 accounts | open the pool, enable failover | the provider-terms notice must be acknowledged; the toggle stays off on cancel and persists as on after acknowledgement and reload |
| F3 | vault-llm-credentials: LLM bindings | state-transition | L3 | automated | an `openai-codex` OAuth account | create a binding: choose lease | lease rejected with the reason; proxy not offered (the API has no proxy route) |
| F4 | vault-llm-delivery: Observability | state-convergence | L3 | automated | session with lease `anthropic-work`, proxy `anthropic`, and `local-override` `google` | open session details | three rows show the delivery mode; the lease shows `expires in`; no token or key in the DOM |
| F5 | vault-llm-credentials: Enrolment | state-transition | L3 | automated | linked anthropic present; enrolment stub returns no identity | "Add account" for anthropic | the warning dialog requires a confirm; cancel leaves the account list unchanged |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | vault-llm-delivery: Pool failover | fault-injection | L1 | automated | primary stub returns 429 with `retry-after: 30` before any content | streamed `/v1/messages` on an enabled pool | the session's SSE stream comes from member 2; no bytes from the primary attempt are written; primary cooling 30 s |
| X2 | vault-llm-delivery: Pool failover | fault-injection | L1 | automated | member 2 streams 3 content events, then 429 | the same request | the stream ends with an `event: error` frame after the 3 events; no third member is called |
| X3 | vault-llm-delivery: Pool failover | BVA (clock) | L1 | automated | primary cooling with `retry-after: 30` | requests at +29 s and +31 s | +29 s uses member 2; +31 s uses the primary |
| X4 | vault-llm-delivery: Pool failover | fault-injection | L1 | automated | all members cooling | request | an immediate rate-limit error; the upstream stub receives 0 calls |
| X5 | vault-llm-delivery: Pool failover | fault-injection | L1 | automated | 429 without `retry-after` | request | primary cooling for 60 s |
| X6 | vault-llm-delivery: Pool failover | fault-injection | L1 | automated | failover disabled; primary returns 429 | request | the session receives 429; member 2 is never called |
| X7 | vault-llm-credentials: Single refresher | fault-injection | L1 | automated | upstream rotates, then the CAS persist throws (disk full) | `issueAccessToken` | account `needs-reauth`; no access token returned; the error contains no token |
| X8 | vault-llm-delivery: Proxy delivery | fault-injection | L3 | automated | docker harness: real pi session with proxy binding `anthropic-work` → hub → stub upstream | agent prompt | the stub upstream sees the vault account's token; the session process's env and `~/.pi/agent/*` contain no token (grep) |
| X9 | vault-llm-delivery: Lease | fault-injection | L3 | automated | docker harness: real pi session with lease binding `anthropic-work` and a stub upstream | agent prompt | the upstream sees `Authorization: Bearer <lease token>` with the OAuth beta header; `~/.pi/agent/` contains no token (grep) |
| X10 | vault-llm-delivery: Lease (clone coexistence) | fault-injection | L3 | automated | the same session also with a local `anthropic` login | prompts to `anthropic/*` and `anthropic-work/*` | upstream sees the local token and the lease token respectively |
| X11 | vault-llm-delivery: Proxy delivery | fault-injection | — | manual-only | a real Anthropic subscription account through the proxy | a long tool-using session with thinking | [judgment: response fidelity against a direct session — no automatable oracle for "behaves the same"] |

---

## Coverage summary

- Requirements covered: 22 of 22:
  - `vault-llm-credentials`: 9;
  - `vault-llm-delivery`: 9;
  - `model-proxy` (MODIFIED): 2, with "Model ID resolution" covered by E29;
  - `model-proxy-credential-routing` (MODIFIED): 2;
  - `credential-vault` (MODIFIED): 1.
- Scenarios by class: edge 45 · perf 1 · frontend 5 · error 11
- Scenarios by level: L1 53 · L2 0 · L3 8 · manual 1
- Scenarios by disposition: automated 61 · manual-only 1

## New infra needed

- **Stub Anthropic upstream reachable from the docker harness (X8–X10).** It records request headers. The harness has no fake LLM upstream yet; verify during apply whether an existing stub (e.g. the model-proxy E2E's) can be reused before adding one.
