# Test Plan — delegate-provider-oauth-to-pi-ai

Stage: design   Generated: 2026-09-21

## ✓ Clarifications resolved (1)

- [x] **C1** — Registry-build latency ceiling → **p95 < 1500 ms on the CI runner** (2× headroom over the measured 673 ms). Unblocks P1.

---

## Scenarios

Requirement refs: `S:` = `specs/provider-auth-server`, `U:` = `specs/provider-auth-ui`, `A:` = `specs/provider-add-flow`, `C:` = `specs/oauth-callback-server`.

Harness notes: L1 server rows drive the real adapter against a **fake `OAuthLoginFlow`** (scripted `login()` that emits the exact event/prompt sequence of a named provider) unless the row says *real runtime* — those rows import `ModelRuntime` for real but never let a flow reach the network (they stop at the first event and abort). L3 rows mock `/api/provider-auth/start` and `/flow/:id` at the Playwright network layer, as `tests/e2e/redesign-provider-add-flow.spec.ts` already does; the docker harness never performs a real OAuth handshake.

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | S: OAuth provider registry | EP (real runtime) | L1 | automated | pi-coding-agent 0.86.1 resolved via `ModelRuntime.create({ modelsPath: null, credentials: emptyStore })` | build registry | id set is exactly `{anthropic, openai-codex, github-copilot, openrouter, kimi-coding, meta, xai}`; `radius` absent; every entry has a non-empty `name` and `typeof auth.login === "function"` |
| E2 | S: OAuth provider registry | decision-table (flowType hint) | L1 | automated | ids `anthropic`, `openai-codex`, `openrouter`, `github-copilot`, `kimi-coding`, `meta`, `xai`, `never-heard-of-it` | map through `FLOW_TYPE_HINT` | first three → `auth_code`; all others incl. the unknown id → `device_code` |
| E3 | S: OAuth provider registry | EP (isolation) | L1 | automated | a `~/.pi/agent/models.json` defining a custom provider with `oauth: "radius"` under id `my-gw`, and an extension-registered provider | build registry | neither `my-gw` nor the extension id appears (registry is builtin-only) |
| E4 | S: Flow start | state-transition (per-provider first step) | L1 | automated | fake flows scripted from the design's first-interaction table: anthropic (auth_url+manual_code), openrouter (progress, auth_url+manual_code), openai-codex (select), github-copilot (text), kimi-coding/meta/xai (device_code) | `POST /start { provider }` | 200 in every case; body `pending.kind` is `manual_code` / `manual_code` / `select` / `text` / `device_code`; `authUrl` present only for anthropic + openrouter; openrouter's leading `progress` did **not** resolve the handshake |
| E5 | S: Flow start | EP (pre-answer) | L1 | automated | github-copilot fake; body `{ enterpriseDomain: "" }` | `POST /start` | response `pending.kind === "device_code"`; the fake recorded its `text` prompt answered with `""`; `GET /flow/:id` never reported `pending.kind: "text"` |
| E6 | S: Flow start | EP (invalid pre-answer types) | L1 | automated | github-copilot fake; body `{ enterpriseDomain: null }` and `{ enterpriseDomain: 42 }` | `POST /start` | both treated as "no pre-answer": `pending.kind === "text"`; no `TypeError` logged |
| E7 | S: Flow start | EP (pre-answer scope) | L1 | automated | fake that issues `text` twice; body `{ enterpriseDomain: "x.ghe.com" }` | `POST /start`, then observe second prompt | first `text` answered `"x.ghe.com"` silently; second `text` surfaces as `pending.kind: "text"` (pre-answer discarded after the first prompt) |
| E8 | S: Flow start | EP (unknown / excluded ids) | L1 | automated | ids `radius`, `google-gemini-cli`, `google-antigravity`, `custom-llm`, `mistral` (api-key only), `""` | `POST /start` | 400 `{ error: "Unknown OAuth provider: <id>" }` for each; no flow record created (`GET /flow/*` count unchanged) |
| E9 | S: Flow status | state-transition (race retention) | L1 | automated | anthropic fake emits `auth_url` then `manual_code` synchronously | `GET /flow/:id` immediately after start | response has BOTH `authUrl` and `pending.kind: "manual_code"` |
| E10 | S: Flow status | state-transition (codex select → browser) | L1 | automated | codex fake | `POST /flow/:id/input { value: "<browser id>" }` then `GET /flow/:id` | 202; status now has `authUrl` + `pending.kind: "manual_code"` |
| E11 | S: Flow status | state-transition (codex select → device) | L1 | automated | codex fake | input `"<device id>"` then `GET` | 202; `pending.kind: "device_code"` with `userCode` + `verificationUri`; `authUrl` absent |
| E12 | S: Flow status | EP (serialisation guard) | L1 | automated | any pending flow | `GET /flow/:id` | body keys ⊆ `{flowId, provider, status, authUrl, message, pending, error}`; no `resolveInput` / `rejectInput` / `abort` / `preAnswers` / `promptCount` |
| E13 | S: Flow status | EP (id format) | L1 | automated | 50 starts | collect `flowId`s | every id matches UUID v4 regex; all distinct |
| E14 | S: Flow status | state-transition (terminal clears pending) | L1 | automated | anthropic fake whose `login()` resolves after the paste | input, then `GET` | `status: "complete"` and `pending` absent; a further `POST /input` → 409 |
| E15 | S: Flow input | EP (unanswerable pending) | L1 | automated | xai fake showing `pending.kind: "device_code"` | `POST /flow/:id/input { value: "x" }` | 409 `{ error: "No input pending for this flow" }` |
| E16 | S: Flow input | EP (secret hygiene) | L1 | automated | anthropic fake; Fastify logger spied | `POST /input { value: "http://localhost:53692/callback?code=SECRET123&state=s" }` | 202; no log line, no later `GET /flow/:id` body, and no `error` string contains `SECRET123` |
| E17 | S: Flow input | EP (text answer) | L1 | automated | github-copilot fake started without `enterpriseDomain` | input `"company.ghe.com"` then `GET` | 202; `pending.kind: "device_code"`, `verificationUri` host is `company.ghe.com` |
| E18 | S: Flow lifetime and pruning | BVA (TTL extension) | L1 | automated | fake emits `device_code` with `expiresInSeconds: 900` at t=0 (fake clock) | advance to t = 10 min + 1 s, `GET /flow/:id` | still 200 (expiresAt extended to ≥ 16 min) |
| E19 | S: Flow lifetime and pruning | BVA (default TTL) | L1 | automated | anthropic fake, no device code | advance to 9 min 59 s → GET; then 10 min + 1 s → GET | 200, then 404 `Invalid or expired flow` |
| E20 | S: Flow lifetime and pruning | EP (`expiresInSeconds` absent / non-numeric) | L1 | automated | fake emits `device_code` with `expiresInSeconds` `undefined` and `"600"` | inspect flow record | `expiresAt` unchanged (no `NaN`), `deviceCodeDeadline` unset; `GET /flow/:id` still 200 |
| E21 | S: Flow status (expired) | state-transition (deadline) | L1 | automated | fake `device_code` `expiresInSeconds: 60`; `login()` rejects with `"Device flow timed out"` at t = 61 s | `GET /flow/:id` | `status: "expired"` (derived from deadline, not message) |
| E22 | S: Flow status (expired) | EP (rejection before deadline) | L1 | automated | same fake, but `login()` rejects at t = 30 s with any message | `GET` | `status: "error"`, `error` = the message — NOT `expired` |
| E23 | S: Permanent-key OAuth credentials report no expiry | EP | L1 | automated | `auth.json` with `openrouter: { type:"oauth", access:"k", refresh:"", expires: 9007199254740991 }` and `anthropic: { …, refresh:"r", expires: 1234 }` | `GET /status` | `openrouter.expires === null`; `anthropic.expires === 1234` |
| E24 | S: Permanent-key … | EP (`refresh` absent) | L1 | automated | `openrouter` credential with no `refresh` key at all | `GET /status` | `expires: null` |
| E25 | S: New OAuth ids participate in api-key twin naming | decision-table | L1 | automated | `auth.json` `openrouter: { type:"api_key", key:"sk" }`; catalogue lists `openrouter` | `GET /status` | rows `openrouter` (oauth, `authenticated:false`) and `openrouter-api` (api_key, `authenticated:true`, name ends `(API Key)`); same for `kimi-coding`, `meta`, `xai` fixtures |
| E26 | S: Stored OAuth credentials are visible without a registry entry | EP | L1 | automated | `auth.json` `some-future-provider: { type:"oauth", access, refresh, expires }`; registry lacks it | `GET /status`; then `DELETE /api/provider-auth/some-future-provider` | OAuth row present, `authenticated:true`; DELETE succeeds and the key is gone |
| E27 | S: Server exposes registered handler ids | EP (custom-llm) | L1 | automated | catalogue `{ id:"custom-llm", hasOAuth:true, custom:true }` | `GET /status`, `POST /start { provider:"custom-llm" }` | no `custom-llm` OAuth row; 400 `Unknown OAuth provider: custom-llm` |
| E28 | S: OAuth implementation is resolved from the pi runtime dependency | EP (pins agree) | ci | automated | repo at HEAD | `node scripts/verify-release-deps.mjs` | passes; all six governed pins read `0.86.1` |
| E29 | A: The pane branches on the provider's flow type | decision-table | L1 | automated | mocked `/start` responses for `manual_code`, `select`, `text`, `device_code` | render `ProviderAddDialog` after start | paste field / option buttons / text field / device pane respectively; auth link stays rendered whenever `authUrl` present |
| E30 | U: Permanent-key OAuth credentials show no expiry | EP | L1 | automated | status row `openrouter` `authenticated:true, expires:null` | render connected list | no expiry text, no "expired" badge; `relativeExpiry` not invoked with `null` |
| E31 | S: Flow cancel / D5 shutdown | EP (shutdown) | L1 | automated | three pending fakes | server `close()` | each fake's `signal` aborted; all three flows `status:"error", error:"Cancelled"`; flow map empty |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D1/D3 registry build (C1) | threshold (real runtime) | L1 | automated | cold `import()` + `ModelRuntime.create({ modelsPath:null, credentials: emptyStore })`, 5 runs | p95 wall time < 1500 ms; `/api/provider-auth/handlers` answers within the same bound after listen | per run |
| P2 | S: Flow lifetime and pruning | soak (fake clock) | L1 | automated | 200 starts over a simulated 30 min, none completed | after prune, flow map size 0; every fake's `signal.aborted === true`; no listener left open (fake counts open/close = equal) | simulated 30 min |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | U: OAuth popup login flow (remote paste) | state-transition | L3 | automated | `/start` mocked → `{ authUrl, pending: manual_code }`; `/flow/:id` mocked pending until `/input` seen, then `complete`; `/status` lists anthropic connected after | Add provider → Anthropic → paste a redirect URL → Submit | converges to: field cleared, dialog closed, Anthropic shown connected; exactly one `POST /input` |
| F2 | U: Prompt-driven sign-in steps (codex select) | state-transition | L3 | automated | `/start` → `{ pending: select [browser, device] }`; `/input` device → `/flow` reports `device_code` | choose "Device code login" | device pane rendered for the SAME `flowId` (no second `/start`); "Open Registration Page" present and no tab opened automatically |
| F3 | U: Device code login flow (new providers) | EP | L3 | automated | picker containing `xai`, `kimi-coding`, `meta` (from mocked `/providers` + `/status`) | select each | identical device pane structure (same test ids) as GitHub Copilot |
| F4 | U: GitHub Enterprise domain prompt | state-transition | L3 | automated | select GitHub Copilot | enter `company.ghe.com` → continue | `POST /start` body contains `enterpriseDomain: "company.ghe.com"`; no `text` field is rendered afterwards |
| F5 | U: Prompt-driven sign-in steps (cancel) | state-transition | L3 | automated | pending anthropic flow | click Cancel | `DELETE /flow/:id` sent once; polling stops (no `/flow/:id` GET within 5 s after); picker shown; provider not listed connected |
| F6 | U: Device code expires | state-transition | L3 | automated | `/flow/:id` mocked → `expired` | poll observes it | "Code expired" + "Try Again"; Try Again issues a new `POST /start` |
| F7 | U: Start failure is shown in the pane | EP | L3 | automated | `/start` mocked → 500 `{ error:"Port 53692 in use" }` and 504 `{ error:"Provider did not respond" }` | start | pane shows the `error` text verbatim + "Try Again"; zero `/flow/*` GETs issued |
| F8 | U: Flow outlives the dialog | state-transition | L3 | automated | pending flow | dismiss dialog, wait, reopen | polling continued while closed (≥ 1 `/flow/:id` GET during the gap); on `complete` the list refreshes without user action |
| F9 | U: OAuth popup login flow | EP (popup blocked) | L3 | automated | `window.open` stubbed to return `null` | start anthropic | copyable `authUrl` link visible AND paste field visible |
| F10 | A/U: sign-in pane | visual/subjective | — | manual-only | paste + select + text + device panes in all 4 themes | human review | [judgment: layout of link-above-field and option buttons reads correctly; no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | S: Flow start (port bound) | fault-injection (abort) | L1 | automated | fake `login()` rejects synchronously with `Error("listen EADDRINUSE: address already in use 127.0.0.1:53692")` before any event | `POST /start` | 500 `{ error }` containing `53692`; `GET /flow/:id` → 404 (record deleted) |
| X2 | S: Flow start (no response) | fault-injection (delay) | L1 | automated | fake `login()` never emits and never settles; fake clock | `POST /start`, advance 15 s | 504 `{ error: "Provider did not respond" }`; fake's `signal.aborted === true`; record deleted; a fake that emits at 14.9 s instead → 200 |
| X3 | S: Flow start (second start supersedes) | illegal-transition | L1 | automated | pending anthropic fake A | `POST /start { provider:"anthropic" }` again | A's `signal` aborted, A reports `Cancelled`; new flow B → 200; only B in the map for `anthropic` |
| X4 | S: Flow cancel (releases port) | fault-injection (abort) | L1 | automated | anthropic fake that models pi-ai exactly: outer signal only cancels `waitForCode`; `manualPromise` must settle before `finally` closes the listener | `DELETE /flow/:id` | 204; within 1 s `status:"error", error:"Cancelled"`; fake's `listenerClosed === true` (proves the adapter rejected the pending prompt on the flow controller — the deadlock case) |
| X5 | S: Flow cancel (mid-poll) | fault-injection (abort) | L1 | automated | xai fake polling with no prompt pending; on abort it rejects with `"Login cancelled"` | `DELETE /flow/:id` | `error: "Cancelled"` — pi-ai's string is NOT stored |
| X6 | S: Flow cancel vs late resolve | race (illegal-transition) | L1 | automated | fake whose `login()` resolves 10 ms AFTER abort | `DELETE`, then wait | `status:"error", error:"Cancelled"`; `writeCredential` NOT called; `auth.json` unchanged |
| X7 | S: Flow status (write refused) | fault-injection (abort) | L1 | automated | `auth.json` holds `openrouter: { type:"api_key" }`; openrouter fake resolves with an OAuth credential | flow completes | `status:"error"`, `error` = `CredentialTypeConflictError` message; `auth.json` byte-identical to before |
| X8 | S: Flow input (state mismatch) | fault-injection | L1 | automated | anthropic fake that throws `"OAuth state mismatch"` when pasted `state` ≠ verifier | input a URL with wrong `state` | 202 on input; next `GET` → `status:"error", error:"OAuth state mismatch"` |
| X9 | S: Flow status (unsupported prompt) | fault-injection | L1 | automated | fake issues `prompt({ type:"secret" })` | `POST /start` | flow ends `status:"error"`, `error:"unsupported prompt: secret"`; the fake's promise was rejected (not left hanging) |
| X10 | S: OAuth implementation is resolved … (loader missing) | fault-injection (abort) | L1 | automated | `import()` stubbed to throw; separately `create()` stubbed to return `{ getProviders: () => [] }` | server boots | `GET /handlers` → `{ ids: [] }`; `GET /api/health` `providerAuth.error` non-empty and contains a version string (or `unknown`); `GET /status` still 200 |
| X11 | S: Stored OAuth credentials visible (registry failure) | fault-injection | L1 | automated | registry build failed; `auth.json` holds `anthropic` OAuth | `GET /status`; `DELETE /api/provider-auth/anthropic`; `POST /start { provider:"anthropic" }` | row present + connected; DELETE removes it; start → 400 |
| X12 | S: Flow lifetime and pruning (aborts live flow) | fault-injection (delay) | L1 | automated | anthropic fake with open listener; fake clock | advance past `expiresAt`, trigger prune | fake `signal.aborted`, `listenerClosed === true`, record gone; a subsequent `POST /start` for anthropic → 200 |
| X13 | S: Flow input (per-prompt signal) | fault-injection (abort) | L1 | automated | fake issues `manual_code` with its own `signal`, then aborts that signal while login continues | observe | `pending` cleared; later `POST /input` → 409 (not resolved into a dead promise) |
| X14 | Behavioural parity — anthropic | real-provider | — | manual-only | real Anthropic Claude Pro/Max account | sign in via callback on the same host; sign out; sign in via paste from a remote browser; diff `auth.json` entries against a pre-change login | [judgment: field set is a superset; a pi session can use the credential — needs a real account] |
| X15 | Behavioural parity — github-copilot + one of xai/kimi/meta | real-provider | — | manual-only | real accounts | sign in from the dashboard; `pi` → `/login` status | [judgment: pi reads the credential; Copilot token exchange happened — needs real accounts] |
| X16 | Docker/zrok remote paste | real-provider | — | manual-only | docker harness up; browser outside the container | start anthropic, complete via paste | [judgment: end-to-end against the real provider; harness cannot mock Anthropic] |

---

## Coverage summary

- Requirements covered: 20/20 (S: 10 of 10 incl. all 4 REMOVED-with-migration via E8/X1/F1; U: 5/5; A: 1/1; C: 5 REMOVED covered by X1/X4/F1/F8 migrations)
- Scenarios by class: edge 31 · perf 2 · frontend 10 · error 16
- Scenarios by level: L1 45 · L2 0 · L3 9 · ci 1 · — 4
- Scenarios by disposition: automated 55 · manual-only 4

## New infra needed

- **`packages/server/src/__tests__/helpers/fake-oauth-flow.ts`** — a scripted `OAuthLoginFlow` fake driven by a step list (`notify`/`prompt`/`resolve`/`reject`/`hang`) with a fake clock hook and `listenerClosed` / `signal.aborted` probes. One file, reused by every L1 server row; the existing `provider-auth-device-code-await.test.ts` shows the fake-clock pattern to copy.
- Nothing at L2/L3: Playwright network mocks and the docker harness already exist (`tests/e2e/redesign-provider-add-flow.spec.ts`).
