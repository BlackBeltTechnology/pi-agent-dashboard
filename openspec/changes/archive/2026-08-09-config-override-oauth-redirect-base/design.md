## Context

PR #409 (`Philogag:develop` → `BlackBeltTechnology:develop`) adds a config-file override for the OAuth redirect base URL. The contributor commit is +102/−9 across 9 files; the branch now carries maintainer follow-ups on top (validation, tests, docs). This document records what the PR does, how it is wired, the design questions it answers implicitly, the gaps closed before merge, and — from D7 onward — the public-origin unification folded in afterwards.

## What the PR actually changes

```mermaid
flowchart LR
  subgraph BEFORE["BEFORE"]
    B1["getTunnelUrl()"] -->|"?? fallback"| B2["http://localhost:PORT"]
    B2 --> B3["base + /auth/callback/PROVIDER"]
  end
  subgraph AFTER["AFTER"]
    A1["baseOverride — NEW, from config file"] -->|"or"| A2["getTunnelUrl()"]
    A2 -->|"or"| A3["http://localhost:PORT"]
    A3 --> A4["base with trailing slashes stripped<br/>+ /auth/callback/PROVIDER"]
  end
```

Full wiring, config file → provider redirect:

```mermaid
flowchart TD
  CFG["~/.pi/dashboard/config.json<br/>auth.redirectBaseUrl = https://pi.example.com"]
  CFG --> PARSE["parseAuthConfig() — trim, drop blank/non-string<br/>shared/config.ts"]
  PARSE --> TYPE["AuthConfig.redirectBaseUrl?: string"]
  TYPE --> REG["registerAuthPlugin() → authState.redirectBaseUrl<br/>auth-plugin.ts"]
  TYPE --> PUT["PUT /api/config → writeConfigPartial preserves the key<br/>config-api.ts"]
  REG --> R1["GET /auth/login — single-provider auto-redirect"]
  REG --> R2["GET /auth/start/:provider — mints redirect_uri"]
  REG --> R3["GET /auth/callback/:provider — MUST echo the identical URI<br/>to the token endpoint"]
  PUT --> RELOAD["loadConfig() → _reloadAuth(newConfig)<br/>authState.redirectBaseUrl reassigned — no restart"]
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

**Amendment (reviewed finding): reject userinfo too.** `https://user:pass@pi.example.com`
passes the checks as written — right protocol, no query, no fragment — yet
embeds credentials that would then travel in the authorize URL and land in the
provider's request logs and the browser history. The check therefore also
requires empty `username` and `password` on the parsed URL. Warn, do not reject
(D4's posture is unchanged); the warning names the credential leak specifically,
because "invalid URL" would not tell the operator what the actual hazard is.

**Where the warning lives.** In the **server**, at plugin register/reload — not
in `parseAuthConfig`. `packages/shared/src/config.ts` is imported by the client
too, and `readConfigRedacted()` runs `loadConfig()` on every `GET /api/config`,
so a warning sited in the parser would fire in every browser tab on every
settings fetch. Validation is a server-boot concern; parsing stays silent.

### D5 — SUPERSEDED by D7/D8: the drift is closed here, not deferred

> **Status: superseded.** D5 recorded the two-sources-of-truth split as accepted
> for this slice, on the premise that the follow-up would add a *new* scalar
> top-level `publicBaseUrl`. That premise was wrong — `pairing.publicBaseUrls`
> already exists and already answers the question for every non-OAuth surface,
> so the "forward-compatible shape" drawn below would have been a **third**
> source, not a unification. D7 replaces it. The original text is kept because
> the drift diagram is still the accurate statement of the problem. **The
> "forward-compatible shape" ladder drawn at the end of this section is the
> rejected option A of D7 — read it as history, not as guidance; D7's ladder is
> the one to implement.**



```mermaid
flowchart TD
  BROWSER["browser"] --> DOMAIN["https://pi.example.com"]
  DOMAIN --> NGINX["nginx"] --> PORT[":8000"]
  PORT --> OK["OAuth callback → https://pi.example.com/... ✅ this change"]
  PORT --> NO1["Pairing QR → https://xyz.share.zrok.io/... ❌ tunnel URL"]
  PORT --> NO2["/api/tunnel/endpoints (Accessible at) ❌ tunnel URL"]
```

After this change the dashboard holds **two** answers to "what is my public
origin". That is accepted for this slice: widening now would mean specifying
pairing/QR/endpoint behaviour that nothing implements, and would grow an
external contributor's focused PR into a cross-cutting refactor.

The forward-compatible shape is a top-level `publicBaseUrl` that every
externally-visible URL derives from, with `auth.redirectBaseUrl` remaining as a
narrower, higher-precedence override:

```mermaid
flowchart TD
  A["auth.redirectBaseUrl — OAuth only, highest"] --> B["publicBaseUrl — all public URLs (DEFERRED)"]
  B --> C["getTunnelUrl()"] --> D["http://localhost:PORT"]
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

### D7 — Promote `pairing.publicBaseUrls` to top-level `publicBaseUrls`, do not invent a scalar

Grounding facts that drive this:

- `PairingConfig.publicBaseUrls: string[]` — `packages/shared/src/config.ts:462`,
  default `[]` (`:507`), parsed with a string-only filter (`:931`).
- It already feeds `manualEndpoints()` → `collectEndpoints()` →
  `/api/tunnel/endpoints`, "Accessible at", and the pairing payload
  (`packages/server/src/tunnel/tunnel-endpoints.ts`).
- It is already operator-editable in the UI (`Gateway/GatewayEndpoints.tsx`,
  `lib/gateway/gateway-config-ops.ts`) — no hand-editing required.

So the question is not "how do we build a public-origin concept" but "which of
the two existing ones wins".

| Option | Result | Verdict |
|---|---|---|
| A. New scalar top-level `publicBaseUrl` (old D5 sketch) | Three keys answer one question | Rejected — makes the drift worse |
| B. `auth.redirectBaseUrl` falls back to `pairing.publicBaseUrls[0]` | Two keys, but OAuth silently depends on a key named *pairing* | Rejected — surprising coupling |
| C. Promote to top-level `publicBaseUrls[]`, both surfaces read it, `auth.redirectBaseUrl` stays the narrow override | One concept, one key; needs a legacy read path | **Chosen** |

Resulting precedence — **unchanged from PR #409**:

```mermaid
flowchart TD
  A["auth.redirectBaseUrl — OAuth only"] --> B["getTunnelUrl()"] --> C["http://localhost:PORT"]
```

#### `publicBaseUrls` does NOT feed OAuth (revised)

An earlier draft of D7 inserted a `publicBaseUrls` tier between the override and
the tunnel, gated on the list holding exactly one `https:` entry. **That tier is
removed.** Review established it was unsound in four independent ways, all
rooted in one mistake — inferring a scalar from a list:

1. The opt-in boundary was fiction. `GatewayEndpoints.tsx:180` scopes its input
   to pairing ("Only https/wss endpoints ride the pairing QR"); an operator
   editing it has no OAuth intent, yet the write would silently arm the OAuth
   tier whenever the list happened to hold one `https:` entry.
2. `wss://` was unclassified — `gateway-config-ops.ts:18` admits it, and the
   count rule would have told a wss-only operator "OAuth cannot use a non-TLS
   origin", which is false.
3. The tier had no validator. D4 guards `auth.redirectBaseUrl` only, so
   `https://pi.example.com?tenant=a` would be warned through one key and silent
   through the other.
4. The warning had no sound emitter: `buildRedirectUri` is per-request, so the
   diagnostic would either spam the log or miss mid-session changes.

D7's own arity argument is what settles it: if OAuth needs a scalar and
`publicBaseUrls` is a list, then **no inference rule belongs in the config
layer**. The operator states the scalar. Slice 2 remains a genuine unification
for the pairing/endpoint surfaces — one key instead of a nested one — and the
"one answer" goal of contract 1 is met at the **UX layer** by D12's single
gateway action, which writes both keys from one operator statement.

#### Why `auth.redirectBaseUrl` survives the unification (cardinality, not preference)

The two keys are not two answers to one question — they have different
**arities**, and that is the justification contract 1 requires:

- `publicBaseUrls` is a **list** by construction. A dashboard legitimately
  answers on several addresses at once (tunnel + reverse proxy + LAN), and
  `collectEndpoints()` advertises all of them.
- An OAuth `redirect_uri` is a **scalar**. It must be one origin, pre-registered
  byte-for-byte with the provider.

With a list of length >1 there is no non-arbitrary way to derive the scalar.
`auth.redirectBaseUrl` is the operator's disambiguator for exactly that case,
and the doc row + Settings help text say so in those words.

**Consequence — do not guess when the list is ambiguous.** OAuth derives its
base from `publicBaseUrls` only when the list contains **exactly one** `https:`
entry. Two or more `https:` entries and no `auth.redirectBaseUrl` ⇒ fall through
to the tunnel and log ONE warning naming both keys and telling the operator to
set `auth.redirectBaseUrl`. Picking `find(https:)` (an earlier draft of this
decision) would silently mint a callback on whichever host happened to sort
first — a config-ordering dependency with a login-breaking failure mode.

Zero `https:` entries with a non-empty list (all plain `http:`) is the same
case: fall through, and warn that OAuth cannot use a non-TLS origin. Silence
here was a reviewed finding — `warnOnInvalidRedirectBase` covers only
`auth.redirectBaseUrl`, so this tier needs its own diagnostic.

#### Migration: read-side fallback, and legacy values never reach OAuth

`parseConfig` resolves `publicBaseUrls` for the **pairing/endpoint** surfaces as
`parsed.publicBaseUrls ?? parsed.pairing?.publicBaseUrls ?? []` — existing
configs keep working, no file is rewritten on read, no behaviour changes.

**OAuth reads only a top-level `publicBaseUrls`.** A value inherited from the
legacy `pairing.publicBaseUrls` is deliberately NOT an OAuth source. Reason: on
the upgrade path, `pairing.publicBaseUrls` was populated by an operator who was
answering "where can a phone reach this for pairing", never "what should OAuth
call back to". Feeding it to OAuth automatically would hand a new consumer a
value chosen for a different question and could break a working login with no
warning — a contract-2 violation that key-absence reasoning hides. Promotion is
therefore **opt-in**: the operator moves the key to top level (or the Gateway UI
writes it there on the next edit) and thereby states the value is canonical.

Because the legacy key is inert for OAuth, no shadow-warning-forever state
exists: when both keys are present the top-level one wins for every consumer,
which is ordinary precedence, not a misconfiguration. **`publicBaseUrls` MUST
NOT be added to `DEFAULTS`** — a `[]` default would make "absent" and "present
but empty" indistinguishable and kill the legacy fallback (the same trap D1
pins for the scalar). Absence is load-bearing; represent it as absence.

### D8 — Promotion moves the key, not the TLS gate

The pairing payload's "never advertise plain http" rule (D14 of
`qr-device-pairing`) is enforced **at read time** in
`PairingManager.reachableUrls()`, not at config-parse time —
`toReachableUrlStrings()` deliberately flattens without filtering, and
`tunnel-endpoints.ts` documents the `tls` tag as *advisory*.

That is what makes the promotion safe: OAuth and pairing can share one input
list while keeping different admissibility rules, because pairing's rule lives
downstream of the shared list. The promotion MUST NOT move that gate upstream
as a "cleanup" — doing so would let a config-parse change silently widen what
reaches a QR code. A regression test pins that a `http://` entry in the
promoted list still never appears in the pairing payload.

### D9 — Provider deletion gets a verb, not a sentinel

`writeConfigPartial` merges providers additively
(`packages/server/src/config-api.ts:104`), and that is load-bearing: it is what
lets the client send a redacted `clientSecret` without clobbering the real one
(`:109`). Overloading `null` or `{}` as a delete sentinel inside that merge
would put a destructive operation on the same path as the secret-preserving
one, where a serialization quirk could delete a provider nobody asked to
delete.

`DELETE /api/config/auth/providers/:id` is therefore a separate route, behind
the same `networkGuard` + auth gate as `PUT /api/config`. It is idempotent
(deleting an absent provider is a success, not a 404-with-side-effects) and
triggers `_reloadAuth` like any other config write.

**The write path needs its own primitive — `writeConfigPartial` cannot express a
deletion.** Its providers merge is spread-then-overlay
(`config-api.ts:104-112`); no input value removes a key, so wiring DELETE
through it is a silent no-op. The obvious alternative — `readConfigRedacted()`,
drop the key, write — is worse: it would persist the redaction placeholder over
**every other provider's real `clientSecret`**, breaking the exact preservation
contract D9 cites. So the route uses a narrow sibling helper,
`deleteAuthProvider(id)`, which reads the raw (unredacted) config, deletes one
key from `auth.providers`, and writes back — touching no other field and never
routing through the redaction path. A test asserts the surviving providers keep
their real secrets.

#### Deleting the last provider is a lockout, not a disable

The first draft of this decision said removing the last provider "leaves auth
disabled after reload". **That is wrong**, and the error matters because it
inverts the operator-facing risk. `_reloadAuth` only mutates `authState`
fields; the `onRequest` gate is installed *after* the empty-registry early
return and there is no `removeHook` anywhere in the codebase. So:

| Path to "zero providers" | Resulting state |
|---|---|
| **Boot** with zero providers (D6) | Early return — no gate, no `/auth/*`. Dashboard open. |
| **Delete** down to zero at runtime | Gate still installed and still rejecting; `/auth/login` renders an empty provider list. **Auth enforced with no way to authenticate.** |

A remote operator whose JWT expires in that state cannot log in and cannot reach
`/api/config` to undo it; recovery requires loopback / a trusted network / a
process restart. The route therefore **refuses to delete the last remaining
provider by default** and requires an explicit `?force=true`, whose response
states the lockout consequence verbatim. This is the irreversible-step case the
`doubt-driven-review` discipline exists for; it is not left to a doc row.

### D10 — Diagnostics report the *resolved* base and its source

D4's warning tells an operator that a value is malformed. It does not tell them
which value won, which is the actual question when OAuth breaks — the chain now
has four tiers. The runtime surface therefore reports both the resolved base and
the tier that produced it (`auth.redirectBaseUrl` | `publicBaseUrls` | `tunnel` |
`localhost`); the `doctor` module renders it.

**Gating trap (reviewed finding).** Putting it behind the same gate as
`/api/config` means the operator whose OAuth is broken — the only operator who
needs it — cannot obtain a JWT to reach it remotely. The endpoint is still
gated (it discloses the deployment's public origin), so the diagnostic MUST NOT
be remote-only:

- the `doctor` module reads it over **loopback**, server-side, where
  `networkGuard` admits it without a JWT — that is the supported path and the
  reason 3.4 pairs an endpoint with a module rather than shipping the endpoint
  alone;
- the same resolved-base line is written to the server log at register/reload,
  so `~/.pi/dashboard/server.log` answers the question with no HTTP at all.

**No-provider boot state (D6).** With an empty boot registry no `/auth/*` route
and no `_reloadAuth` exist, so a reported `authState` value would be
boot-frozen and misleading. In that state the surface reports the tier
resolution *and* an explicit `authActive: false`, rather than a number that
looks live and is not.

### D11 — Accepted: config mutation mid-flow breaks byte-identity

`/auth/start` mints the `redirect_uri` at T1; `/auth/callback` **rebuilds** it
at T2 rather than echoing a stored value. A `PUT /api/config` (or a tunnel flap)
between the two yields a non-identical URI and the provider rejects the token
exchange with an opaque "Token exchange failed".

Accepted, not fixed. The failure mode predates this change (a tunnel flap does
the same), the window is seconds wide, the blast radius is one retryable login,
and the fix — persisting the minted URI in the OAuth `state` — touches the CSRF
nonce path, which is a worse thing to destabilise for this benefit. Recorded so
it is diagnosed rather than rediscovered.

### D12 — One operator action: "add a gateway URL"

Contract 1 asks for one answer to "what is my public origin". D7 shows the
config layer cannot give it — the surfaces genuinely need a list *and* a scalar.
So the single answer lives one layer up: **one dialog, one statement, four keys
written atomically.**

```mermaid
flowchart TD
  OP["Operator states: my gateway is https://pi.example.com, used for OAuth"]
  OP -->|"ONE PUT /api/config"| W1["publicBaseUrls += https://pi.example.com — pairing / QR / Accessible at"]
  OP --> W2["cors.allowedOrigins += https://pi.example.com — browser loads from here now"]
  OP --> W3["auth.redirectBaseUrl = https://pi.example.com — only when OAuth selected"]
  OP --> W4["trustedNetworks += CIDR — required for http, optional for https"]
```

#### Scheme drives eligibility

| URL scheme | `trustedNetworks` | QR pairing | OAuth | `cors.allowedOrigins` |
|---|---|---|---|---|
| `http://` | **required** — the only way in | ineligible (`qr-device-pairing` D14 TLS gate) | ineligible (providers reject non-TLS) | required |
| `https://` | optional | eligible | eligible | required |

The dialog states these rules inline rather than validating silently — the rules
are non-obvious and each one has a different owner (pairing D14, the OAuth
provider, the browser). For `http://` the CIDR field is pre-filled and the dialog refuses to save with
no trusted network, because that gateway would be unreachable.

**The prefill must be a `/32`, not a range.** `gateway-config-ops.ts:44-60`
(`suggestTrustEntries`) already establishes the convention: default to an exact
`/32` and label subnets "wide"/"explicitly riskier". A pre-filled `/8` would hand
the operator a confident 16.7-million-address auth bypass as the default — the
opposite of the repo's existing posture. The dialog reuses `suggestTrustEntries`
rather than inventing a second suggestion rule.

**At least one auth mode is mandatory** for `https://` too. A gateway with none
of {trusted network, QR pairing, OAuth} is either unreachable or unprotected,
and both outcomes are worse than a refused save. Multiple modes may be selected
together (OAuth *and* trusted network is a normal shape).

#### Provenance: removal reverses exactly what add wrote

Removal cannot be derived. Three of the four keys look derivable from the URL
(`publicBaseUrls` entry, `cors.allowedOrigins` = `new URL(u).origin`,
`auth.redirectBaseUrl` = the URL) — but deriving would delete an entry the
operator had authored *before* ever running the action. And `trustedNetworks` is
not derivable at all: it is a CIDR list (`config.ts:359`,
`parseTrustedNetworks:785`) and a proxy hop's address cannot be read off a
public URL.

So the action records what it wrote:

```jsonc
gateways: [
  {
    url: "https://pi.example.com",
    authModes: ["oauth", "pairing"],          // ≥1, memorized per gateway
    wrote: {                                   // exact values, for exact reversal
      publicBaseUrls:      ["https://pi.example.com"],
      corsAllowedOrigins:  ["https://pi.example.com"],
      authRedirectBaseUrl: "https://pi.example.com",  // present iff oauth
      trustedNetworks:     ["10.0.0.0/8"]             // present iff trusted-network
    }
  }
]
```

Remove deletes only values present in `wrote` and still equal in live config;
anything else is left alone. When the removed gateway owned
`auth.redirectBaseUrl`, that key is cleared and OAuth falls back to
tunnel/localhost. A confirmation screen lists every field that will change
before the write — provenance makes the reversal exact, the confirmation makes
it visible.

**Limit of provenance — identical-value authorship.** If the operator had already
hand-set `auth.redirectBaseUrl = https://pi.example.com` and *then* adds an OAuth
gateway for the same URL, the add is idempotent and the record claims a value the
operator authored. Removal would clear it. Provenance cannot distinguish
authorship of identical values, and inventing a heuristic would be worse than the
confirmation screen already required: the add dialog states "this value is
already set; removing this gateway later will clear it", and the remove
confirmation lists the clear explicitly. Visible, not silent — that is the whole
budget this edge deserves.

**Seed the top-level key from legacy on first write.** D7's read rule is
top-level-first, so the moment `publicBaseUrls` exists at top level the legacy
`pairing.publicBaseUrls` entries stop being read *for every surface*. A naive
`publicBaseUrls += <gateway>` would therefore make an operator's existing
"Add HTTPS URL" entries vanish from the QR and "Accessible at" on their first
gateway add. The first write MUST seed top-level from the legacy list, then
append.

**`http://` gateways and the existing writer.** `gateway-config-ops.ts:18`
(`isSecureBaseUrl`) *throws* on a non-https/wss URL — the existing UI writer
enforces TLS on this field. D12 writes `http://` entries into the same list, so
there would be two writers with different postures. Accepted, because the field
is an endpoint *inventory* and the TLS rule is a pairing-payload rule enforced
downstream (D8), not a field invariant — but the two writers MUST be reconciled
in one helper rather than left to diverge, and the pairing regression test (D8)
is what pins that an `http://` entry never reaches a QR.

#### Placement and lifecycle

Not first-run-only. `GatewaySetupGuide.tsx` gets the step for the first run, and
the Gateway page gets a persistent add/remove list — **one shared component**,
so the two entry points cannot drift. The action is *not* gated on "no tunnel
active": a gateway and a tunnel legitimately coexist, and hiding the control
while a tunnel is up would strand the operator mid-migration.

### D13 — Drift is expected; "Fix" reconciles instead of re-adding

`trustedNetworks`, `cors.allowedOrigins` and `publicBaseUrls` all remain
individually editable — by the existing Gateway list editor, by Settings, and by
hand-editing `config.json`. So a gateway's `wrote` record will drift out of
agreement with live config, and the operator's symptom is indirect (CORS errors,
a QR that no longer works, a login loop) rather than a message naming the
gateway.

The gateway row therefore carries a computed **status**, and an invalid status
offers **Fix**:

| Status | Condition | Offered |
|---|---|---|
| OK | every value in `wrote` is present in live config | — |
| Incomplete | ≥1 recorded value missing from live config | **Fix** — re-writes only the missing values |
| Conflicting | `auth.redirectBaseUrl` holds a different value than this gateway recorded | **Fix** — reclaims it, after naming the current holder |
| Ineligible | recorded `authModes` no longer legal for the URL | **Fix** — requires re-choosing modes; cannot be silent |

**How does a gateway become Ineligible if there is no edit affordance?** D12
lists add and remove only, so a URL cannot change scheme through the UI. The
reachable paths are a hand-edited `config.json` and a restored/older config —
both real, neither frequent. The status therefore stays (silent breakage is the
worse failure), but it is explicitly **not** evidence of a missing edit surface;
editing a gateway is remove-then-add, which keeps the provenance record honest.

**Trusted networks live under two keys, and D13 must check both.** The Settings
trusted-networks editor writes `auth.bypassHosts` (pinned by
`trusted-networks-section.test.ts`: *target `auth.n`, never touch top-level
`trustedNetworks`*), while D12 and the connectivity banner write top-level
`trustedNetworks`. A status check that reads only the recorded key would let the
other key change with no status change, and `Fix` could "succeed" while the
gateway stays broken. D13 computes against the same merge the runtime uses —
which D15 makes a single live source rather than two snapshots.

Fix is **reconcile-to-record**, never re-run-add: it writes the delta and
nothing else, so it cannot duplicate list entries and cannot resurrect a value
the operator deliberately removed *without* saying so — the confirmation lists
exactly what it will restore. Status is computed on read, never persisted; a
stored status would itself drift.

### D14 — Secure cookie WITHOUT `trustProxy` (corrected)

The problem is real: `server.ts:1017` constructs Fastify with no `trustProxy`,
so `request.protocol` is always `"http"` behind a reverse proxy and the session
cookie's `secure: request.protocol === "https"` evaluates **false** — in exactly
the deployment shape this change enables.

**The first draft fixed it by enabling `trustProxy`. That was a security
regression and is rejected.** Fastify's `trustProxy` rewrites `request.ip` from
`X-Forwarded-For`, and `request.ip` is what **both** authorization bypasses read:

| Trust point | Code |
|---|---|
| auth-gate bypass | `auth-plugin.ts:288` — `isBypassedHost(request.ip, authState.bypassHosts)` |
| `networkGuard` bypass | `localhost-guard.ts:116` — `isBypassedHost(request.ip, trustedNetworks)` |

The codebase already states the invariant that draft would have broken —
`localhost-guard.ts:120`: *"The recorded IP is the SOCKET PEER (`request.ip`)
only — never a forwarding header."* With `trustProxy` on, any client that can
reach the port directly sends `X-Forwarded-For: <a trusted CIDR address>` and
passes both gates, including the gate on `PUT /api/config`. D12's pre-filled
private range would have widened that to a whole RFC1918 block. It would also
have split REST from WS, since the upgrade path authorizes on
`socket.remoteAddress` (`server.ts:1966,1985`).

**Chosen instead:** derive the flag from configuration, not from a request
header. The cookie is marked `Secure` when the **resolved redirect base** is
`https:` — a value the operator states (D7/D12) and an attacker cannot
influence. `request.ip` semantics are untouched, no new header is trusted, and
the WS/REST divergence never opens.

**Do not "improve" this later by enabling `trustProxy`** without first moving
both bypass points to `request.socket.remoteAddress`. The two changes are only
safe together, and only the first one looks harmless.

### D15 — The action must APPLY, not just persist

D12 claims one action configures the gateway. Persisting is not applying: two of
the four keys are captured at boot and ignored at runtime.

| Key | Runtime reality | Consequence for D12 |
|---|---|---|
| `cors.allowedOrigins` | `server.ts:1053` captures it **once** into the CORS callback closure | The new origin stays denied — the browser hits the `ERR_ABORTED` module-script failure documented at `server.ts:1042-1047`, i.e. the very failure this change exists to fix |
| `trustedNetworks` | `server.ts:1113` closes `networkGuard` over the boot snapshot | An `http://` gateway's *only way in* does not work until restart |
| `auth.bypassHosts` | boot merges top-level (`auth-plugin.ts:124`), reload does **not** (`:142`) | **Pre-existing bug**: every `_reloadAuth` silently drops top-level trusted networks from the auth gate |

The third row is a live defect independent of this change — any `PUT /api/config`
carrying an `auth` block already disables top-level trusted networks until
restart, and `system-routes.ts:257` passes only `reloaded.auth`, so the merge is
unrecoverable at reload time.

So the keys are made **live**: the CORS `origin` callback and `networkGuard`
read current config at request time instead of closing over a boot snapshot, and
`_reloadAuth` merges top-level `trustedNetworks` exactly as boot does. This is
the honest reading of "one action" — the alternative (returning
`restartRequired: true`) would ship a control whose own dialog admits it does
not work yet.

**"At request time" means an mtime-gated snapshot, not `loadConfig()` per
request.** `networkGuard` is a `preHandler` on every request, so the cost is
paid per request, not per preflight. Measured on the real 3.5 KB config:

| | per call |
|---|---|
| `existsSync` + `readFileSync` + `JSON.parse` (the floor of `loadConfig`) | 24.5 µs |
| `statSync().mtimeMs` | 1.9 µs |

So the snapshot `stat`s on each call and reparses only when the mtime moved:
~13× cheaper in steady state, still live within one filesystem tick, and still
correct for a hand-edited `config.json` (which an explicit
invalidate-on-write cache would miss). **The cache MUST stay mtime-gated** —
"optimising" it into a boot-time snapshot silently reinstates the bug this
decision exists to fix, which is why P5 pins invalidation as its own scenario.

**Consequence for D13:** status must be computed against **effective** runtime
state, not only the persisted file. A file-truth-only check would report `OK`
for a gateway whose trusted network the gate is not honouring, and `Fix` would
have no delta to write because the value *is* in the file. Reading current
config at request time is what makes file-truth and runtime-truth the same
thing again.

## Risks / Trade-offs
|---|---|
| Typo'd base → login loop / `redirect_uri_mismatch` | D4 warning naming the field; docs state the provider-side registration requirement |
| Operator sets the override but pairing QR still shows the tunnel host | **Narrowed, not closed.** `server.ts:270-274` unions the tunnel URL with `publicBaseUrls`, and `reachableUrls()` filters rather than subtracts — with a tunnel up the QR still advertises the tunnel host too. D12 makes the gateway URL a first-class advertised address; it does not suppress the tunnel |
| Underlying keys edited independently ⇒ a gateway silently stops working | D13 computed status + Fix |
| Fix resurrects a value the operator deliberately deleted | D13: Fix is reconcile-to-record and its confirmation lists every value it will restore |
| Session cookie lacks `Secure` behind a reverse proxy | D14: derived from the resolved redirect base scheme — **not** `trustProxy`, which would make both IP bypasses header-forgeable |
| Gateway added but CORS still denies the origin / trusted network not honoured | D15: CORS + `networkGuard` read current config at request time; `_reloadAuth` merges top-level `trustedNetworks` |
| First gateway add orphans legacy `pairing.publicBaseUrls` entries | D12: the first top-level write seeds from the legacy list before appending |
| Removal clears a value the operator authored themselves | D12: unresolvable by provenance for identical values — surfaced in both the add and remove dialogs instead |
| CIDR prefill hands the operator an over-wide bypass | D12: reuse `suggestTrustEntries` (`/32` default, subnets labelled risky) |
| Two concurrent `PUT /api/config` writers race | **Accepted, pre-existing** (`config-api.ts:175` read-merge-write already races for every writer). Last-writer-wins; `DELETE` does not introduce it and does not fix it. Named so it is not mistaken for new (C5) |
| The D15 live-config read becomes a per-request file read | mtime-gated snapshot: 1.9 µs steady-state vs 24.5 µs (C6); P5 pins that invalidation still works |
| Promotion widens what reaches a pairing QR | D8: the TLS gate stays read-time in `reachableUrls()`; regression test pins a **non-loopback** `http://` entry never reaching the payload (a `http://localhost` fixture would pass via the `PI_E2E_SEED` loopback exception at `pairing/pairing.ts:36` even with the gate broken) |
| Diagnostics endpoint unreachable exactly when it is needed | D10: loopback/doctor path + a server-log line, not remote-only |
| Open-redirect concern | Not applicable: value is operator config, never request-derived; provider's own allowlist is a second gate. Called out so a reviewer does not have to re-derive it |
| A future `??`-modernization reintroduces the empty-string bug | D1 pinned by an explicit unit test with a comment |
| E2E leaves the shared harness auth-gated and breaks later specs | The e2e seeds `auth.bypassUrls: ["/"]` alongside the provider, and restores + restarts in `afterAll`; requests from the host reach the container as non-loopback, so the gate would otherwise lock the suite out. **The restore MUST be `try`/`finally`-equivalent** — a throw before `afterAll` would otherwise leak a blanket `"/"` bypass into every later spec |
| Deleting the last provider hard-locks a remote operator | D9: refused without explicit `?force=true`; the response states the consequence |
| `deleteAuthProvider` written via the redaction path clobbers surviving secrets | D9: raw read/write helper, never `readConfigRedacted()`; test asserts surviving secrets stay real |
| Legacy `pairing.publicBaseUrls` silently starts driving OAuth on upgrade | D7: legacy-sourced values are inert for OAuth; promotion is opt-in |
| Ambiguous `publicBaseUrls` (0 or ≥2 https entries) silently ignored by OAuth | D7: fall through **and warn**, naming both keys |
| `redirectBaseUrl` carrying userinfo leaks credentials to the provider's logs | D4 amendment: userinfo rejected by the validator |

## Migration

`auth.redirectBaseUrl`: none. Absent key = current behaviour exactly. No config
rewrite, no default value written by `ensureConfig()` (an empty default would be
indistinguishable from a cleared field — see D1).

`publicBaseUrls`: read-side only (D7). `parseConfig` falls back to
`pairing.publicBaseUrls`; no config file is rewritten on read, and the legacy
key keeps working indefinitely. The first `writeConfigPartial` that touches the
field writes the top-level key.
