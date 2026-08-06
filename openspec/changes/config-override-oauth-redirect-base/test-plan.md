# Test Plan — config-override-oauth-redirect-base

Stage: apply (soft gate)   Source: PR #409 review

Levels: **L1** = vitest unit / in-process Fastify `inject()`; **L2** = server-integration with real config file I/O; **L3** = Playwright against the Docker harness (real HTTP, real restart).

## ⚠ Clarifications (3 open, defaults assumed)

- **C1** Should an invalid `redirectBaseUrl` be *used* or *dropped*? → assumed **used + warned** (design D4). If product wants fail-closed, X1–X3 invert.
- **C2** Is the pairing/QR/endpoint drift acceptable to ship? → assumed **yes, documented** (design D5). If not, this change grows a `publicBaseUrl` capability and F3 becomes a gate rather than a documented gap.
- **C3** Should Settings ▸ Security expose the field? → assumed **no** in this slice. F4 pins the current no-UI reality so a later slice has a diff to flip.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | input | trigger | expected observable |
|----|-------------|-----------|-------|-------|---------|---------------------|
| E1 | R-redirect precedence | decision-table | L1 | (override ∈ {set, "", absent}) × (tunnel ∈ {active, null}) — 6 reachable rows | `buildRedirectUri("github", 8000, …)` | override wins whenever truthy; else tunnel; else `http://localhost:8000`. **E1b (override set + tunnel active) is the headline row PR #409 leaves uncovered** |
| E2 | R-redirect precedence | EP (valid) | L1 | override `https://pi.example.com`, tunnel `https://abc.share.zrok.io` | build | `https://pi.example.com/auth/callback/github`; string does NOT contain `zrok` |
| E3 | R-redirect normalization | BVA | L1 | `https://pi.example.com/`, `//`, `///` | build | exactly one separator: `https://pi.example.com/auth/callback/google` |
| E4 | R-redirect normalization | BVA (no slash) | L1 | `https://pi.example.com` | build | unchanged base, single separator |
| E5 | R-redirect empty override | boundary (falsy) | L1 | `""` | build | falls through; result must NOT be `/auth/callback/github` (pins `\|\|` over `??`, design D1) |
| E6 | R-redirect path prefix | EP (valid, exotic) | L1 | `https://pi.example.com/pi` | build | `https://pi.example.com/pi/auth/callback/github` |
| E7 | R-config parse | EP (valid) | L1 | `"redirectBaseUrl": "https://pi.example.com"` | `loadConfig()` | value returned verbatim |
| E8 | R-config parse | BVA (whitespace) | L1 | `"  https://pi.example.com/  "` | `loadConfig()` | trimmed to `https://pi.example.com/` (inner trailing slash preserved — normalization happens in the builder, not the parser) |
| E9 | R-config parse | EP (invalid) | L1 | `""`, `"   "`, `42`, `true`, `null`, `[]`, `{}` | `loadConfig()` | `undefined` for each; no throw |
| E10 | R-config default | EP (absent) | L1 | fresh config via `ensureConfig()` | read file | no `redirectBaseUrl` key written |
| E11 | R-partial write | state (merge) | L2 | existing `redirectBaseUrl` + partial `{auth:{allowedUsers:[…]}}` | `writeConfigPartial` | value preserved on disk; `secret`/`providers`/`bypass*` untouched |
| E12 | R-partial write | state (clear) | L2 | partial `{auth:{redirectBaseUrl:""}}` | `writeConfigPartial` → `loadConfig` | persisted `""`, loaded `undefined` (E5 then applies at build time) |
| E13 | R-redirect all call sites | decision-table | L1 | override set; providers = 1 | `GET /auth/login` (auto-redirect), `GET /auth/start/github` | both `Location` headers carry `redirect_uri=https%3A%2F%2Fpi.example.com%2Fauth%2Fcallback%2Fgithub` |
| E14 | R-redirect token exchange | invariant | L1 | override set; callback hit with a code | `GET /auth/callback/github` | the `redirect_uri` posted to the token endpoint is byte-identical to the authorize-time one (stub `fetch`, assert form body) |
| E15 | R-reload | state-transition | L1 | override A → `_reloadAuth({…override B})` | next `/auth/start/github` | `Location` carries B; no restart |
| E16 | R-reload | state-transition | L1 | override set → `_reloadAuth` with the key removed | next `/auth/start/github` | falls back to tunnel/localhost |

### Error-handling

| id | requirement | technique | level | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------|---------|---------------------|
| X1 | R-misconfig warning | fault (bad input) | L1 | `pi.example.com` (no scheme) | register + reload | warning logged naming `auth.redirectBaseUrl` + the value; URI still built with it (C1) |
| X2 | R-misconfig warning | fault (hostile input) | L1 | `javascript:alert(1)`, `ftp://x`, `//evil.com` | register | warning logged; value never reaches a response header that a *request* could influence (it is operator config — assert no request-derived path exists) |
| X3 | R-misconfig warning | fault (query/fragment) | L1 | `https://pi.example.com?t=1`, `…#x` | register | warning logged (the resulting `redirect_uri` would be malformed for the provider) |
| X4 | R-misconfig warning | EP (valid, silent) | L1 | `https://pi.example.com`, `https://pi.example.com/pi` | register | NO warning — pins that the check does not cry wolf on the documented happy path |
| X5 | R-reload precondition | fault (empty registry) | L2 | server booted with `auth.providers = {}` | `PUT /api/config` adding `redirectBaseUrl` | `_reloadAuth` absent, no `/auth/*` route exists → 404; value takes effect only after restart (design D6). Pins the limitation instead of leaving it a surprise |
| X6 | R-redirect precedence | fault (provider rejects) | L3 | override deliberately not registered with the provider | full login attempt | provider returns `redirect_uri_mismatch`; dashboard surfaces the login error page rather than a blank screen (documents the operator-visible symptom of C1) |
| X7 | R-partial write | fault (unreadable config) | L2 | config file is invalid JSON | `writeConfigPartial({auth:{redirectBaseUrl:…}})` | starts fresh rather than throwing; no partial/corrupt write |

### Performance

| id | requirement | technique | level | workload | metric + threshold | window |
|----|-------------|-----------|-------|----------|--------------------|--------|
| P1 | R-redirect precedence | hot-path regression | L1 | 100k `buildRedirectUri` calls with an override set | no measurable regression vs the 2-arg baseline (the added work is one truthiness check + one regex on a short string) — assert < 100 ms total, i.e. an order of magnitude of headroom | single run |
| P2 | R-reload | leak | L2 | 200 sequential `_reloadAuth` calls alternating the override | `authState` object identity stable, no listener/provider-registry growth, RSS flat | 1 min |

Both perf rows are **advisory**, not ship gates: this change adds no I/O and no allocation per request beyond a string replace. They exist so a future refactor (e.g. moving validation into the hot path) has a tripwire.

### Frontend-quirk (rendered UI → L3 Playwright)

| id | requirement | technique | level | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------|---------|---------------------------------|
| F1 | R-redirect all call sites | state-transition | L3 | harness seeded with one provider + override, then restarted | `GET /auth/start/github` with redirects disabled | 302; `Location` host is `pi.example.com`, `redirect_uri` param exactly `https://pi.example.com/auth/callback/github` |
| F2 | R-reload | state-transition | L3 | live server from F1 | `PUT /api/config` changes the override, no restart | next `/auth/start/github` `Location` carries the NEW base — proves the hot-reload chain end to end (config file → `loadConfig` → `_reloadAuth` → route) |
| F3 | R-scope boundary (C2) | invariant / drift pin | L3 | override set + tunnel stubbed active | read the pairing/QR + "Accessible at" surfaces | they still advertise the TUNNEL host, not the override. Asserted deliberately: this is the documented split (design D5), and the assertion is the thing a future `publicBaseUrl` slice must flip |
| F4 | R-no-UI (C3) | invariant / drift pin | L3 | Settings ▸ Security | inspect the Authentication section | no redirect-base input exists; the field is config-file-only in this slice |

---

## Level routing rationale

- **L1 dominates** because the whole feature is a pure function plus three call sites; `fastify.inject()` reaches the real routes with no ports, no container, no network. Every precedence row belongs here.
- **L2** covers the only genuinely stateful parts: config-file merge semantics and the empty-registry boot limitation.
- **L3 is deliberately thin (4 rows)**. The harness boots with zero OAuth providers, so `/auth/*` does not exist until the spec seeds config and restarts the server — expensive and shared-state-hostile. It earns its place only for what L1 cannot prove: that the real config file on disk, read by a real server process, produces a real 302 with the right `Location`.

## Harness safety note (applies to every L3 row)

Requests from the Playwright host reach the container as **non-loopback**, so seeding a working OAuth provider would arm the auth gate and lock every later spec out of the shared harness. The spec therefore seeds `auth.bypassUrls: ["/"]` alongside the provider for the duration, and restores the original config + restarts in `afterAll` regardless of outcome.
