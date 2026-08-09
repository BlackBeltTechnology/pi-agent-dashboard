# Test Plan — config-override-oauth-redirect-base

Stage: apply (soft gate)   Source: PR #409 review + doubt cycles 1–3

Levels: **L1** vitest unit / in-process Fastify `inject()` · **L2** server-integration
with real config-file I/O · **L3** Playwright vs the Docker harness (port from
`.pi-test-harness.json` `dashboardPort` — never hardcode `:18000`).

Every row carries a **disposition** (`automated` | `manual-only`). Slice-1 rows
(E1–E16, X1–X7, P1–P2) are **landed** on this branch and kept as the regression
record; everything from G1 onward is new scope from D7–D15.

## ✅ Clarifications (all 4 resolved)

- **C1** Invalid `redirectBaseUrl` → **used + warned** (D4). Unchanged.
- **C4** **RESOLVED** — new read-only route `GET /api/auth/diagnostics` behind
  `networkGuard`. Not a field on `GET /api/config`. S3 asserts the gate.
- **C5** **RESOLVED** — concurrent config writes are **last-writer-wins**, and
  that is accepted as pre-existing: `config-api.ts:175` already read-merge-writes
  for every writer, so `DELETE` is not introducing the race. Not fixed here;
  named in design so it is not mistaken for new. No scenario asserts a mutex.
- **C6** **RESOLVED** — CORS and `networkGuard` use an **mtime-gated cache**:
  `statSync().mtimeMs` on each call, reparse only when the file changed.
  Measured on the real 3.5 KB config: full read+parse **24.5 µs**, `statSync`
  **1.9 µs** (~13× cheaper) — and `networkGuard` runs on every request, not just
  preflights. Live within one filesystem tick, so a hand-edited `config.json`
  still takes effect with no restart. **P3/P4 stay advisory**; they now assert
  the cache is present (no read+parse per request) rather than gating latency.

---

## Slice 1 — landed (regression record)

| id | requirement | technique | level | disposition | Triple (input · trigger · observable) |
|----|---|---|---|---|---|
| E1 | redirect precedence | decision-table | L1 | automated | override×tunnel 6 rows · `buildRedirectUri` · override wins when truthy, else tunnel, else localhost |
| E2 | precedence headline | EP | L1 | automated | override + active tunnel · build · result has no `zrok` substring |
| E3–E4 | slash normalization | BVA | L1 | automated | `/`,`//`,`///`, none · build · exactly one separator |
| E5 | empty override | boundary | L1 | automated | `""` · build · falls through (pins `\|\|` over `??`) |
| E6 | path prefix | EP | L1 | automated | `https://h/pi` · build · `https://h/pi/auth/callback/github` |
| E7–E10 | config parse + default | EP/BVA | L1 | automated | valid/whitespace/invalid/absent · `loadConfig` · verbatim / trimmed / `undefined` / no key written |
| E11–E12 | partial write | state | L2 | automated | preserve + clear · `writeConfigPartial` · value kept / `""` persisted, `undefined` loaded |
| E13 | all call sites | decision-table | L1 | automated | override, 1 provider · `/auth/login`, `/auth/start/:p` · both `Location`s carry the encoded override |
| E14 | token-exchange echo | invariant | L1 | automated | override · `/auth/callback/:p` · posted `redirect_uri` byte-identical to authorize-time |
| E15–E16 | hot reload | state-transition | L1 | automated | A→B, B→absent · `_reloadAuth` · next `Location` carries B / falls back |
| X1–X4 | misconfig warning | fault + EP | L1 | automated | no-scheme / hostile / query+fragment / valid · register · warn naming `auth.redirectBaseUrl` · silent on happy path |
| X5 | reload precondition | fault | L2 | automated | boot with `providers:{}` · `PUT /api/config` · no `/auth/*`, 404, restart required (D6) |
| X7 | unreadable config | fault | L2 | automated | invalid JSON · `writeConfigPartial` · starts fresh, no corrupt write |
| P1 | hot path | perf | L1 | automated | 100k builds with override · < 100 ms total · advisory |
| P2 | reload leak | perf | L2 | automated | 200 `_reloadAuth` alternating · `authState` identity stable, RSS flat · advisory |

---

## New scope — Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|---|---|---|---|---|---|---|
| G1 | D4 userinfo | fault (credential leak) | L1 | automated | `https://user:pass@pi.example.com` | register | warning fires naming the **credential leak** specifically; value still used (C1). Pins the gap cycle-3 found: current validator checks protocol+search+hash only |
| G2 | D7 promotion read | EP | L1 | automated | top-level `publicBaseUrls:["https://a"]`, no `pairing` key | `loadConfig` | value returned; pairing/endpoint surfaces see it |
| G3 | D7 legacy fallback | EP | L1 | automated | only `pairing.publicBaseUrls:["https://a"]` | `loadConfig` | same result as G2 — byte-identical upgrade behaviour (contract 2) |
| G4 | D7 precedence | decision-table | L1 | automated | both keys present, different values | `loadConfig` | top-level wins for every consumer |
| G5 | D7 no DEFAULTS entry | invariant | L1 | automated | fresh config | `ensureConfig()` then read file | **no** top-level `publicBaseUrls` key written — absence must stay distinguishable from `[]`, else G3 dies |
| G6 | D7 OAuth isolation | invariant | L1 | automated | `publicBaseUrls:["https://a"]`, no `auth.redirectBaseUrl`, tunnel active | `buildRedirectUri` | result is the **tunnel** URL, not `https://a`. Pins that the removed inference tier stays removed |
| G7 | D8 TLS gate regression | fault | L1 | automated | `publicBaseUrls:["http://192.168.1.9:8000"]` (**non-loopback** — a `localhost` fixture passes via the `PI_E2E_SEED` exception at `pairing.ts:36` even with the gate broken) | `reachableUrls()` | entry absent from the pairing payload |
| G8 | D9 delete | state | L2 | automated | 2 providers configured | `DELETE /api/config/auth/providers/github` | github gone from disk; `_reloadAuth` ran |
| G9 | D9 secret preservation | invariant | L2 | automated | 2 providers with real `clientSecret`s | delete one | surviving provider's secret is still the **real** value, not `"***"` — pins that the redaction path was not used |
| G10 | D9 idempotence | EP | L2 | automated | provider absent | `DELETE …/nonexistent` | success, no side effect, no 404-with-write |
| G11 | D9 last-provider guard | decision-table | L2 | automated | exactly 1 provider · with and without `?force=true` | DELETE | refused without force; with force, succeeds **and** the response states the lockout |
| G12 | D9 lockout reality | state-transition | L1 | automated | booted with 1 provider, then force-delete it | any gated request | still **403** (gate installed, no `removeHook`) and `/auth/login` lists zero providers — pins that this is a lockout, not a disable |
| G13 | D12 scheme decision table | decision-table | L1 | automated | scheme{http,https} × modes{tn,qr,oauth}^ | validate dialog payload | http+qr and http+oauth rejected; http with no tn rejected; https with no mode rejected; every other combination accepted |
| G14 | D12 atomic write | invariant | L2 | automated | https gateway, modes {oauth,qr} | add | **one** config write containing `publicBaseUrls`, `cors.allowedOrigins`, `auth.redirectBaseUrl`; no partial state observable between them |
| G15 | D12 legacy seeding | state | L2 | automated | legacy `pairing.publicBaseUrls:["https://old"]`, no top-level | add first gateway | top-level list contains **both** `https://old` and the new URL — pins the orphaning regression cycle 3 found |
| G16 | D12 removal exactness | state | L2 | automated | gateway added, then operator hand-adds `https://mine` to cors | remove gateway | only the gateway's recorded values removed; `https://mine` still present |
| G17 | D12 identical-value authorship | state | L2 | automated | operator hand-set `auth.redirectBaseUrl=X`, then adds an OAuth gateway for X | remove gateway | key **is** cleared (documented limit), and both dialogs disclosed it |
| G18 | D12 CIDR prefill | BVA | L1 | automated | `http://10.4.0.9:8000` | open dialog | prefill is `10.4.0.9/32` via `suggestTrustEntries`, not a subnet |
| G19 | D13 status table | decision-table | L1 | automated | 4 drift states per the D13 table | compute status | OK / Incomplete / Conflicting / Ineligible respectively |
| G20 | D13 Fix is delta-only | invariant | L2 | automated | Incomplete gateway (cors entry deleted) | Fix | exactly the missing value restored; list not duplicated; no other key touched |
| G21 | D13 two-key trusted networks | decision-table | L1 | automated | entry under `auth.bypassHosts` vs top-level `trustedNetworks` | compute status | status reflects the **effective merge**, not one key |
| G22 | D14 Secure derivation | decision-table | L1 | automated | resolved base `https://…` vs `http://…` | issue session cookie | `Secure` set / not set accordingly |
| G23 | D15 CORS is live | state-transition | L2 | automated | server running; add origin via config write | preflight from that origin **without restart** | allowed — pins that the boot-closure capture is gone |
| G24 | D15 networkGuard is live | state-transition | L2 | automated | server running; add a CIDR | request from that range without restart | admitted |
| G25 | D15 reload merge bug | state-transition | L1 | automated | boot with top-level `trustedNetworks:["10.0.0.0/8"]`, then any `_reloadAuth` | bypass check for `10.1.2.3` | still bypassed — **currently fails**: boot merges (`auth-plugin.ts:124`), reload does not (`:142`) |

## New scope — Error-handling / security

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|---|---|---|---|---|---|---|
| S1 | D14 **no** trustProxy | fault (spoof) | L1 | automated | request with `X-Forwarded-For: <a trusted CIDR address>` from an untrusted peer | any gated route | **403** — `request.ip` stays the socket peer. This is the regression test for the cycle-3 critical finding; it must fail if anyone enables `trustProxy` later |
| S2 | D14 WS/REST parity | invariant | L1 | automated | same spoofed header | WS upgrade + REST request | both authorize on the socket peer; no divergence |
| S3 | D10 gated | fault | L2 | automated | unauthenticated non-loopback request | diagnostics endpoint | rejected by the same guard as `PUT /api/config` (contract 7) |
| S4 | D10 loopback path | EP | L2 | automated | loopback request (the doctor module's path) | diagnostics endpoint | returns resolved base + winning tier — reachable exactly when OAuth is broken |
| S5 | D10 no-provider boot | fault | L2 | automated | boot with zero providers | diagnostics endpoint | reports `authActive: false` rather than a boot-frozen value |
| S6 | D10 log mirror | invariant | L1 | automated | any register/reload | inspect log | one line naming the resolved base + tier |
| S7 | D11 mid-flow mutation | fault (race) | L1 | automated | change `auth.redirectBaseUrl` between `/auth/start` and `/auth/callback` | callback | token exchange fails with a **diagnosable** error, not a blank screen (accepted trade-off, pinned so it is recognised) |
| S8 | D12 write failure | fault (disk) | L2 | automated | config write throws mid-action | add gateway | no partial provenance record; either all four keys or none |
| S9 | D9 route auth | fault | L2 | automated | unauthenticated DELETE | `DELETE /api/config/auth/providers/:id` | rejected by the same guard as `PUT /api/config` |

## New scope — Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|---|---|---|---|---|---|---|
| P3 | D15 live CORS cost | hot-path | L1 | automated | 1k preflights, config file unchanged | exactly ONE read+parse; subsequent calls hit the mtime cache | single run |
| P4 | D15 live guard cost | hot-path | L1 | automated | 10k `networkGuard` calls, config unchanged | one read+parse total; p95 < 50 µs/call (statSync floor measured at 1.9 µs) | single run |
| P5 | D15 cache invalidation | state-transition | L1 | automated | 100 calls, config file rewritten at call 50 | the post-rewrite calls observe the NEW value — pins that the cache is mtime-gated, not permanent | single run |

Advisory per **C6**. P5 is the important one: it is what stops the cache being
"fixed" into a boot snapshot, which would silently undo D15.

## New scope — Frontend-quirk (rendered UI → L3 Playwright)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|---|---|---|---|---|---|---|
| F1 | Slice-1 e2e | state-transition | L3 | automated | harness seeded with a provider + override, restarted | `/auth/start/github`, redirects off | 302; `redirect_uri` exactly the override callback |
| F2 | Slice-1 hot reload | state-transition | L3 | automated | live server from F1 | `PUT /api/config` changes the override | next `Location` carries the NEW base |
| F5 | D12 add flow | state-transition | L3 | automated | Gateway page, https URL, modes {oauth} | complete the dialog | all recorded keys visible in `GET /api/config`; gateway row shows **OK** |
| F6 | D12 scheme gating | decision-table | L3 | automated | type an `http://` URL | dialog re-renders | OAuth + QR checkboxes disabled **with reason text**; trusted-network required; save disabled until it is set |
| F7 | D12 remove flow | state-transition | L3 | automated | gateway from F5 | remove + confirm | confirmation lists each reverted field; after write the keys are gone |
| F8 | D13 Fix flow | state-transition | L3 | automated | delete the cors entry behind the gateway's back | reload the page | row shows **Incomplete** with the reason; Fix restores exactly one value |
| F9 | D15 end-to-end payoff | state-transition | L3 | automated | add a gateway, do **not** restart | load the dashboard from the new origin | no `ERR_ABORTED` module-script failure — the whole point of D15 |
| F10 | Settings input | state-transition | L3 | automated | Settings ▸ Security | set the redirect base | persisted and reflected in `/auth/start` |
| F11 | a11y floor | invariant | L3 | automated | gateway dialog, both themes | axe scan | zero WCAG-AA violations; contrast ≥ 4.5:1 (mockup measured min 4.65 dark / 4.54 light) |
| F12 | shared component | invariant | L3 | automated | first-run guide **and** Gateway page | open both | identical dialog markup — pins D12's "one shared component" |
| F13 | visual/UX quality | — | — | **manual-only** | mockup at 3 breakpoints, both themes | human review | "reads clearly, hierarchy is right" — no automatable signal |
| F14 | copy review | — | — | **manual-only** | all dialog strings | human review | rules text is accurate and plain-language |

## New infra needed

- **None.** L1/L2 extend existing `packages/*/src/**/__tests__/`, L3 extends
  `tests/e2e/`. G8–G12 need a Fastify `inject()` harness with a seeded provider
  registry — the pattern already exists in `auth-redirect-base.test.ts`.

## Level-routing rationale

- **L1 dominates** (25 of 39 automated rows): most of the new surface is pure
  decision logic — precedence, scheme eligibility, status computation, cookie
  derivation. `inject()` reaches the real routes with no container.
- **L2** carries everything stateful: config-file merge, delete semantics,
  provenance round-trip, and the D15 "live vs boot snapshot" distinction, which
  is only observable across a real write + a real subsequent request.
- **L3 stays at 12 rows** and earns each one: the dialog's scheme gating, the
  add/remove/Fix flows, and F9 — the only place the change's actual payoff (no
  CORS failure without a restart) is observable end to end.
- **S1 is the highest-value single row in this plan.** It is the regression test
  for a critical finding that a prior draft of D14 would have shipped.

## Harness safety note (every L3 row)

Requests from the Playwright host reach the container as **non-loopback**, so
seeding a working OAuth provider arms the auth gate and would lock every later
spec out of the shared harness. Specs seed `auth.bypassUrls:["/"]` alongside the
provider and restore the original config + restart in a **`try`/`finally`** —
not a bare `afterAll`, which a mid-test throw would skip, leaking a blanket
bypass into the rest of the suite.
