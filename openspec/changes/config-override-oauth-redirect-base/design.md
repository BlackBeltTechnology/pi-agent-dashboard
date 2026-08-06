## Context

PR #409 (`Philogag:develop` → `BlackBeltTechnology:develop`, 1 commit, +102/−9, 9 files) adds a config-file override for the OAuth redirect base URL. This document records what it does, how it is wired, the two design questions it answers implicitly, and the gaps this change closes before merge.

## What the PR actually changes

```
                buildRedirectUri(provider, port, baseOverride?)
                ─────────────────────────────────────────────────

   BEFORE                                AFTER
   ──────                                ─────
   getTunnelUrl()                        baseOverride   ◀── NEW (config file)
        │  ?? fallback                        │  ||
        ▼                                     ▼
   http://localhost:<port>               getTunnelUrl()
        │                                     │  ||
        ▼                                     ▼
   `${base}/auth/callback/<p>`           http://localhost:<port>
                                              │
                                              ▼
                                    `${base.replace(/\/+$/,"")}/auth/callback/<p>`
```

Full wiring, config file → provider redirect:

```
~/.pi/dashboard/config.json
  { "auth": { "redirectBaseUrl": "https://pi.example.com" } }
        │
        ▼  parseAuthConfig()  — trim; drop blank / non-string      [shared/config.ts]
  AuthConfig.redirectBaseUrl?: string
        │
        ├── registerAuthPlugin() → authState.redirectBaseUrl       [auth-plugin.ts]
        │        ├── GET /auth/login            (single-provider auto-redirect)
        │        ├── GET /auth/start/:provider  (mints redirect_uri)
        │        └── GET /auth/callback/:provider (MUST echo the identical URI
        │                                          to the token endpoint)
        │
        └── PUT /api/config → writeConfigPartial (preserve key)    [config-api.ts]
                 → loadConfig() → _reloadAuth(newConfig)
                 → authState.redirectBaseUrl reassigned            ← no restart
```

The callback call site is the non-obvious one: OAuth2 requires the `redirect_uri`
sent to the token endpoint to be byte-identical to the one sent to the authorize
endpoint. Threading the override through `/auth/start` but not `/auth/callback`
would produce a green-looking login that fails at token exchange. PR #409 gets
this right — all three sites are threaded.

## Decisions

### D1 — `||` not `??`

`baseOverride || getTunnelUrl() || localhost` treats `""` as absent. With `??`,
a config file containing `"redirectBaseUrl": ""` (a plausible artifact of a UI
text input, or of `writeConfigPartial` round-tripping a cleared field) would
produce `"/auth/callback/github"` — a relative URI the provider rejects. The
falsy-coalescing is deliberate and is covered by a unit test. **Keep it, and
keep the test that pins it**, because `??` is the lint-preferred operator and a
future "modernize" pass would silently reintroduce the bug.

### D2 — Trailing-slash normalization applies to every base, not just the override

`base.replace(/\/+$/, "")` runs after precedence resolution, so it also
normalizes the tunnel URL and the localhost fallback. Neither has ever carried a
trailing slash, so this is a no-op in practice — but it is a behaviour change to
a shared path and belongs in the doc row (PR #409 records it there).

Bases with a path prefix work (`https://pi.example.com/pi` →
`https://pi.example.com/pi/auth/callback/github`). Bases with a query or
fragment do not, and are not detected. See D4.

### D3 — Precedence order: override wins over the tunnel

The alternative (tunnel wins, override is only a fallback for the no-tunnel
case) was not taken, and should not be: the deployment this feature exists for
is "stable custom domain in front of the dashboard", where a tunnel may still be
running for other purposes but is *not* the origin the browser reached. An
override that a live tunnel could silently defeat would be non-deterministic
from the operator's point of view.

**Consequence, and the gap this change closes:** the entire justification for
the feature is the `override > tunnel` edge, and PR #409 does not test it. The
test file states plainly that no tunnel runtime exists under test, so every
assertion in it is really `override vs localhost`. `getTunnelUrl` is a plain
module import in `auth.ts`, so `vi.mock("../tunnel/tunnel.js")` covers it.

### D4 — Validation: warn, do not reject

Options considered:

| Option | Behaviour on `"pi.example.com"` (no scheme) | Verdict |
|---|---|---|
| A. Accept anything (PR #409 as-is) | Emits `pi.example.com/auth/callback/github`; provider rejects; nothing logged | Silent, undiagnosable |
| B. Reject at parse → drop the field | Falls back to tunnel/localhost; operator sees "my setting does nothing" | Worse: masks the typo as a no-op |
| C. Accept + warn once at register/reload | Value still used; a single log line names the field and the parse failure | **Chosen** |

C keeps the operator in control (an exotic-but-valid base still works) while
making the misconfiguration observable. The check is `new URL(value)` succeeding
with protocol `http:` or `https:` and no query/fragment — anything else logs a
warning naming `auth.redirectBaseUrl` and the offending value.

### D5 — Scope boundary: OAuth only, and the drift that creates

```
  ┌──────────────────────────────────────────────────────────────┐
  │  Reverse proxy / custom domain in front of the dashboard      │
  └──────────────────────────────────────────────────────────────┘
        browser ──▶ https://pi.example.com ──▶ nginx ──▶ :8000

        OAuth callback     → https://pi.example.com/...   ✅ this change
        Pairing QR code    → https://xyz.share.zrok.io/... ❌ tunnel URL
        /api/tunnel/endpoints ("Accessible at")            ❌ tunnel URL
```

After this change the dashboard holds **two** answers to "what is my public
origin". That is accepted for this slice: widening now would mean specifying
pairing/QR/endpoint behaviour that nothing implements, and would grow an
external contributor's focused PR into a cross-cutting refactor.

The forward-compatible shape is a top-level `publicBaseUrl` that every
externally-visible URL derives from, with `auth.redirectBaseUrl` remaining as a
narrower, higher-precedence override:

```
   auth.redirectBaseUrl   (OAuth only, highest)
        │
        ▼
   publicBaseUrl          (all public URLs — DEFERRED)
        │
        ▼
   getTunnelUrl()
        │
        ▼
   http://localhost:<port>
```

Nothing in this slice blocks that: adding a layer below the current top of the
chain is additive, and the shipped key keeps working.

### D6 — Known limitation: hot reload only works if auth booted with a provider

`registerAuthPlugin` returns early (`providerRegistry.size === 0` → "Auth
configured but no providers resolved — auth disabled") **before** installing
`_reloadAuth` and before registering any `/auth/*` route. So:

- dashboard booted **with** ≥1 provider → `PUT /api/config` hot-reloads
  `redirectBaseUrl` with no restart ✅
- dashboard booted **without** providers → the whole auth surface is absent;
  adding `redirectBaseUrl` (or providers) requires a restart ⚠️

This predates PR #409 and is not fixed here, but it dictates the e2e strategy:
a browser-level test against the shared Docker harness (which boots with no
providers) **must** seed config and restart the server before `/auth/*` exists
at all. The spec records the limitation so it is not rediscovered as a bug.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Typo'd base → login loop / `redirect_uri_mismatch` | D4 warning naming the field; docs state the provider-side registration requirement |
| Operator sets the override but pairing QR still shows the tunnel host | D5 documented explicitly in `docs/architecture.md`; deferred slice named |
| Open-redirect concern | Not applicable: value is operator config, never request-derived; provider's own allowlist is a second gate. Called out so a reviewer does not have to re-derive it |
| A future `??`-modernization reintroduces the empty-string bug | D1 pinned by an explicit unit test with a comment |
| E2E leaves the shared harness auth-gated and breaks later specs | The e2e seeds `auth.bypassUrls: ["/"]` alongside the provider, and restores + restarts in `afterAll`; requests from the host reach the container as non-loopback, so the gate would otherwise lock the suite out |

## Migration

None. Absent key = current behaviour exactly. No config rewrite, no default
value written by `ensureConfig()` (an empty default would be indistinguishable
from a cleared field — see D1).
