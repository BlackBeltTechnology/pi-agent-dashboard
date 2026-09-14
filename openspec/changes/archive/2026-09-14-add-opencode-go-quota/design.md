# Design — add-opencode-go-quota

## Context

The quota plugin owns one fetcher per provider in `server/quotas/fetchers.ts`,
each returning a `FetchResult` (`windows` | `failure`). `SUPPORTED_PROVIDERS` is
derived from `PROVIDER_FETCHERS` keys and asserted against the config/UI list by
test. `opencode-go` is default-on in `configSchema.json` but has no fetcher, so
`enabledProviders()` filters it out. This change adds the missing fetcher.

## Decisions

### D1 — Endpoint & auth: Go usage API, key-only
`GET https://opencode.ai/zen/go/v1/usage`, `Authorization: Bearer <token>` where
`token = auth.getApiKey("opencode-go")`. No `auth.get()` metadata needed (unlike
codex's account id or copilot's `refresh` token) — the plain api-key credential
suffices. Missing token → `{ failure: "no-credential" }`, mirroring every other
fetcher's first guard.

### D2 — Cloudflare 1010: per-fetcher User-Agent (minimal)
The default undici `User-Agent: node` is Cloudflare-1010-blocked and returns an
HTTP 403 that is indistinguishable from an auth/entitlement failure — this is the
most probable cause of the original spike's "unsupported" verdict.

**Chosen:** set `User-Agent: opencode/1.0.0` in the opencode-go fetcher's header
map only. This is exactly the pattern `githubCopilot` already uses (`User-Agent:
GitHubCopilotChat/…`). One header at one call site; `http.ts` and all other
fetchers are untouched.

**Rejected:** a global default `User-Agent` in `http.ts::fetchJson`. Broader blast
radius (changes every provider's request fingerprint), and unnecessary — only
opencode.ai has shown the 1010 behaviour. Surgical beats global (repo Rule 3).

**Residual risk (raised in doubt-review, accepted as a trade-off).** Error 1010
is frequently IP-/TLS-fingerprint-based, not UA-only. The live 200 was proven
from the author's machine; a docker/datacenter deploy IP may still be blocked
even with the UA set — and D4 classifies 403 as terminal, so it would surface as
an uninformative "unavailable." Mitigations: (a) D4 detects a CF-1010 body and
emits a DISTINCT `detail` so the failure is not misread as "no subscription";
(b) a deploy-environment probe is a scenario in `test-plan.md` (run the fetch
from the docker harness IP before trusting it there). UA is a documented
fragility: if opencode's edge later checks a version or TLS fingerprint, every
install breaks together — accepted because there is no key-authenticated
alternative, and the same UA pattern already ships for `githubCopilot`.

### D3 — Response mapping: reuse `win()`, do NOT drop on status
Body: `{ usage: { rolling, weekly, monthly } }`, each `{ status, percent, resetsAt }`.
Build each window with the existing `parse.ts::win(label, used, iso, windowSeconds,
extra)` helper (mirrors every sibling parser) and `compact()` the nulls:
- `label` / `windowSeconds`: `rolling → "5h", 5*HOUR`; `weekly → "7d", 7*DAY`;
  `monthly → "30d", 30*DAY`. **Window lengths are sourced** from openusage's
  opencode provider doc ("rolling 5-hour window", "weekly … resets Monday UTC",
  "monthly … billing cycle"); the monthly length is an approximation for pace
  and flagged as a verify-on-implement item.
- `usedPercent = num(percent)`, mapped as **USED, not remaining** — evidence: the
  live probe returned `rolling:1, weekly:0, monthly:3` on a fresh/low-usage
  account, which only reads as "percent used." This matches anthropic
  `utilization` (used), NOT codex `percent_left` (remaining). `win()` already
  bounds it; add `limitValue:100` like the anthropic/codex windows.
- **NaN/absent guard for free:** `win()` returns `null` when the reset stamp is
  missing or `windowSeconds<=0`; `num()` coerces a malformed `percent` — but to
  avoid a misleading green 0% bar on a garbage-but-present body, a window whose
  `percent` is not finite is dropped (return `null`), same spirit as the
  `limit>0` guards in the zai/openrouter parsers.

**`status` is annotation, NOT a drop filter (doubt-review finding).** Emitting
only `status==="ok"` would DISCARD the window in exactly the "exceeded/throttled"
state the user most needs to see, and — if every window is non-ok — collapse the
provider to terminal `no-data` (a green-to-gone bar reading as "no quota," the
very lie `fetchers.ts` warns against). Instead: emit any window carrying a finite
`percent` + a reset stamp regardless of `status`. The known status vocabulary is
unverified, so `status` is not branched on for now beyond passing an at-100%
`exceeded`-style value straight through as usedPercent. If a later status is
found that means "this cadence is not entitled," that single value can be handled
then — but the default is EMIT, not drop.

### D4 — Failure classification: reuse the shared contract
Route through the shared `get()` helper (`fetchJson` → `classifyHttpFailure` /
`toWindows`). Consequences already correct for free:
- 401 (rejected key) → terminal `peer-rejected` (a 4xx will not self-heal).
- 403 `EntitlementError` (no Go subscription) → terminal `peer-rejected`.
- 429/5xx/timeout/network → transient (eligible for the existing retry loop).
- malformed-but-200 / parse throw → terminal `no-data`.

The **only** deviation from a plain `get()` call is the extra `User-Agent`
header, so the opencode-go fetcher still composes `get(url, headers, parse)`.

### D4 — Failure classification: reuse the shared contract, annotate CF-1010
Route through the shared `get()` helper (`fetchJson` → `classifyHttpFailure` /
`toWindows`), so every outcome is already correct: 401 (rejected key) and 403
(`EntitlementError`, no Go subscription) → terminal `peer-rejected` (a 4xx will
not self-heal); 429/5xx/timeout/network → transient; malformed-but-200 / parse
throw → terminal `no-data`. The only deviation from a plain `get()` call is the
extra `User-Agent` header (D2).

**CF-1010 disambiguation (doubt-review finding).** A 403 whose scrubbed body
signals Cloudflare 1010 (`error-1010` / `Access denied` marker) is still
treated as **terminal** (retrying the same blocked IP only burns budget), but the
fetcher sets a distinct `detail` (e.g. `"edge blocked (Cloudflare 1010) — not an
auth failure"`) so the settings UI explains the silence instead of implying "no
subscription." This keeps the wire `failure` reason unchanged while restoring the
signal the raw 403 destroys.

### D5 — Security: no new surface
The token is placed only in the `Authorization` header (D1), never in the URL.
All error messages flow through `http.ts::scrub()` unchanged. No new logging.
`sk-…` opencode keys are already covered by the `scrub` prefix rule. The fetcher
adds no `console`/`logger` call of its own.

### D6 — Credential resolution & the test blind spot (doubt-review finding)
`getApiKey("opencode-go")` resolves through the host registry
(`ctx.modelRuntime.getModelRegistry().getApiKeyAndHeaders`). Verified sound: pi
lists **28 registered `opencode-go` models**, so the registry knows the provider
and returns its `auth.json` api_key. BUT every quota test mocks `getApiKey` while
**ignoring the provider argument**, so a fetcher that queried the wrong id (e.g.
the Zen wallet id `opencode`) would pass the suite green. `contract.test.ts`'s
per-provider host map is the guard: adding `"opencode-go": "opencode.ai"` there
asserts the fetcher hits opencode.ai — but does not assert the credential id. Add
one L1 assertion that `getApiKey` is called with `"opencode-go"` (not `"opencode"`).

### D7 — ToS posture & default-on gating (doubt-review finding)
`opencode-go` is default-on in `configSchema.json`, so shipping the fetcher means
an install that already holds the key starts calling opencode.ai — **but only
after** the plugin itself is activated AND the ToS acknowledged (both default-off,
per the `provider-quota-surfacing` opt-in requirement). Blast radius is therefore
gated by plugin activation, not by upgrade. Unlike the anthropic OAuth endpoint
(a documented consumer-ToS breach → default-off), `/zen/go/v1/usage` is
key-authenticated and is the same usage API the opencode CLI itself calls, so it
stays at the plugin's default-on-per-provider tier. This is documented, not
changed.

## Docs / comment reconciliation (count corrected by doubt-review)

**Four** prose sites assert the stale Go rationale; rewrite each to (a) drop the
Go claim, (b) retain the Zen-wallet exclusion for `opencode` verbatim (cookie +
workspace id, `server.queryBilling`, wallet not a resetting window):
- `packages/quota-plugin/src/providers.ts` — header comment
- `packages/quota-plugin/src/server/quotas/fetchers.ts` — header comment
- `packages/quota-plugin/src/AGENTS.md` — `providers.ts` row
- `packages/quota-plugin/src/server/AGENTS.md` — `quotas/fetchers.ts` row

These AGENTS.md are **hand-maintained** (no doctor `generated` marker; root
doctrine: source-tree rows under `packages/` are edited directly) — so editing
them by hand is correct, not a doctor-convention violation.

Plus the **literal** `SUPPORTED_PROVIDERS` array in `providers.ts` gets
`opencode-go` added (there are TWO lists — the `providers.ts` literal and the
`fetchers.ts` `Object.keys(PROVIDER_FETCHERS)` derivation — kept in sync by a
parity test).

Test updates (three spots, doubt-review):
- `quota-engine.test.ts` unsupported loop — drop `opencode-go`, keep
  `deepseek`/`minimax`.
- `quota-engine.test.ts` "no-adapter when config names a provider we do not
  support" currently uses `opencode-go`; switch it to a still-unsupported id
  (`deepseek`) so it (a) stays meaningful and (b) does NOT fire a real HTTPS call
  to opencode.ai once opencode-go is supported.
- `contract.test.ts` per-provider host map — add `"opencode-go": "opencode.ai"`.

## Open questions

- **`windowSeconds` derivation** — confirm the exact `QuotaWindowDto` fields and
  whether `windowSeconds` is required; mirror whichever sibling parser is closest
  (zai also has 5h/7d/month cadences).
- **`User-Agent` version string** — `opencode/1.0.0` works; whether to pin a real
  opencode CLI version or a dashboard-branded UA is cosmetic (any non-`node` UA
  passed the live probe).
