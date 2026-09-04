## Context

See proposal.md — Why. Today `computeQuota` (server/index.ts) fetches every
enabled provider once via `Promise.all`, each fetch hard-bounded at
`FETCH_TIMEOUT_MS = 15_000` in `fetchJson` (http.ts). On failure it keeps the
`lastGood` snapshot (`stale`) or reports `unavailable`. The client polls
`/api/quota` every 60 s (`useQuota`) and `QuotaDialog` receives `providers` as
immutable props from `QuotaWidget`. There is no retry and no manual refresh.

Two facts constrain the design:
- The fetcher layer (`fetchers.ts`) collapses every failure to `peer-rejected`,
  discarding the `JsonResult.kind` that `fetchJson` already computes. Retry
  classification is impossible until that kind is surfaced.
- `Promise.all` means the `/api/quota` response is gated by the slowest
  provider. Any per-provider retry adds to that critical path.

## Goals / Non-Goals

**Goals**
- Bounded, honest in-request retry for transient quota-fetch failures.
- On-demand dialog refresh with correct last-updated semantics.
- Retry configurable via the existing plugin-settings vocabulary, off by default.

**Non-Goals**
- Server-side request de-duplication / cross-client cooldown for `/api/quota`
  (finding #8). Out of scope; mitigated client-side only (disable-while-in-flight).
- Strengthening `scrub()` (finding #10). Its coverage is pre-existing; this change
  only guarantees it adds no new unscrubbed path.
- Background/scheduler retry (the rejected fork). Retry stays in-request so the
  "time consumed" figure the user configures equals the wait they actually incur.
- A footer-widget refresh control.

## Decisions

### D1 — Retry lives in `computeQuota`, per-provider, inside the existing branch
Each provider's fetch+retry runs inside its own `order.map` async branch; the
outer `Promise.all` is unchanged. This keeps one provider's retries from
multiplying another's attempts (spec: "do not multiply") while accepting that the
snapshot is gated by the slowest branch. **Alternative rejected:** a background
scheduler (flips pull→push, adds lifecycle/teardown, and turns the user-facing
"time consumed" into an invisible schedule — contradicts the core requirement).

### D2 — Surface the failure kind from the fetcher layer (finding #1)
`FetchResult.failure` is widened so a fetcher can report the transient/terminal
kind derived from `JsonResult.kind`: `http`+status → transient ONLY for 429/5xx,
terminal otherwise; `timeout`/`network` → transient; missing credential/adapter
→ terminal. **A thrown parse error or a malformed-but-200 body → terminal
(`no-data`), never transient** — retrying a well-formed HTTP 200 that we simply
cannot parse is pointless and would burn the budget (finding: parse exceptions
must not be misclassified as transient `peer-rejected`). `computeQuota`
classifies off that. This is the minimal seam; no HTTP behavior in `fetchJson`
changes.

### D3 — The BOUND is the finite capped schedule, not a separate budget knob (findings #2, #3)
There is no separate `totalBudgetMs` config. The worst case is inherently finite
because `maxAttempts` is schema-capped (see D5) and each delay is
`min(baseDelayMs · 2^n, maxDelayMs)`. The retry loop simply runs the finite
schedule: initial attempt + up to `maxAttempts` retries, stopping early on
success or a terminal kind. The wall-clock worst case is therefore
`(maxAttempts + 1) × requestTimeout + Σ delays` — the SAME number the preview
shows (D4). This is what keeps the `Promise.all` critical path bounded, and it
removes the ambiguity of an undefined budget value. **Scope of the bound:** it
covers the fetch attempts + sleeps. Credential resolution runs before/around the
fetch and is NOT inside `fetchJson`'s timeout today; a hanging auth resolver
stalling a branch is a PRE-EXISTING risk (see Risks), not introduced here.

### D4 — `maxAttempts` = retries after the initial attempt; preview mirrors `RetrySettingsSection` (findings #4, #5)
Semantics pinned to the shell's `RetrySettingsSection` (`maxRetries` +
`computeSchedule`/`human`/`SchedulePreview`). We cannot import across the
package boundary, so the helper is REPRODUCED (not imported) in the quota
plugin. The preview total = Σ backoff sleeps **+ (maxAttempts + 1) × request
timeout** — the initial attempt counts too, so the count is `maxAttempts + 1`,
not `maxAttempts` (finding: off-by-one). For a provider that issues multiple
internal HTTP calls per attempt (Copilot's bearer→token fallback, D6), one
attempt can reach up to N× the request timeout; the preview states the
single-call worst case and a caption notes multi-call providers may exceed it.

### D5 — Config is schema-bounded AND clamped on read (finding #11), with concrete bounds
`configSchema.json` gains a `retry` object; concrete bounds: `maxAttempts`
0–5 (integer), `baseDelayMs` 100–10000, `maxDelayMs` 100–60000. The server ALSO
clamps every field to these bounds on read (schema is advisory for an
externally-persisted file) before any arithmetic or `setTimeout`, so a
hand-edited overflow/negative value can never produce an unbounded wait or a
Node timer overflow. The concrete transient/terminal kind union (D2) is defined
in `types.ts`.

### D6 — One fetcher invocation = one retry attempt (finding #9)
Retry wraps the fetcher call, not its internal HTTP calls. Copilot's internal
bearer→token fallback is a single fetcher invocation and therefore ONE attempt;
retry never doubles it. The wall-clock caveat (an attempt with two internal
calls can reach ~2× the request timeout) is surfaced in the preview caption (D4).

### D7 — One hook owner passes handles down; sequence guard covers ALL requests (findings #6, #7, #10)
Refresh state cannot live in `QuotaDialog` (it gets immutable props). `useQuota`
is extended to expose `{ providers, lastUpdated, refresh, isRefreshing }`, and
**`QuotaWidget` is the single owner that instantiates it once and passes the
handles to `QuotaDialog` as props** — NOT called independently in both, which
would create two states and two guards. Every request (background poll AND
manual refresh) carries a monotonically increasing sequence id; a response is
applied only if its id is the latest issued, so the guard drops out-of-order
RACES for polls and refresh alike (not just manual refresh). `refresh` is a
no-op while `isRefreshing` (disable-while-in-flight — also the finding #8
mitigation). When a refresh drops the currently-selected provider from
`providers`, the dialog selection SHALL fall back (to `All`) rather than render
an empty detail view.

### D8 — Settings draft is merge-preserving (finding #12)
`QuotaSettings` currently rebuilds its draft from an allowlist
(`{ enabled, providers }`) and writes the whole draft, which would erase `retry`
— and any future field. The draft is changed to **spread the full loaded config**
and override only the edited fields, so `retry` (and any unknown future field)
round-trips a provider-toggle save. The dirty check compares the edited fields.

### D9 — `Retry-After` (open, safe to defer)
On an `http` 429 the upstream may send `Retry-After`. Honoring it is polite but
can force a multi-second wait inside the request. Deferred: the total budget (D3)
already caps the downside, and ignoring it only re-tries sooner. Revisit if a
provider penalizes early retries — does not change specs or task breakdown.

## Risks / Trade-offs

- **Slowest-branch latency** → total budget (D3) caps per-provider added latency;
  the widget already tolerates a slow `/api/quota` (it renders last-known).
- **Refresh amplifies throttling** (finding #8) → disable-while-in-flight (D7)
  bounds user-driven bursts; server dedup is a non-goal.
- **Preview honesty** → including the request timeout in the total (D4) risks a
  scary number for large `maxDelayMs`; acceptable — an honest large number beats
  a misleading small one, and the long-tail warning pattern from the mirrored
  component conveys it.
- **scrub() imperfection** → unchanged; the change adds no new path, and a test
  asserts no retried attempt introduces an unscrubbed log line.
- **Auth-resolver hang** (pre-existing) → credential resolution is not inside
  `fetchJson`'s timeout; a hanging resolver can stall a provider branch. Not
  introduced by this change and out of scope; noted so the "bounded" claim is
  understood to cover the fetch attempts, not credential resolution.
- **`lastGood` cross-account staleness** (pre-existing) → the retained snapshot
  is process-global keyed by provider id; a credential/account change could show
  the prior account's stale figures until the next success. Pre-existing
  behavior, out of scope for this change.
- **Schedule-helper drift** → the preview helper is reproduced (cross-package
  import is impossible). A unit test locks the quota preview to the expected
  `(maxAttempts + 1) × timeout + Σ delays` formula so it cannot silently diverge
  from the mirrored `RetrySettingsSection` behavior.

## Migration Plan

Additive. New config defaults off; existing configs gain no retry until the user
opts in. No data migration. Rollback = revert the change; `/api/quota` shape is
unchanged so no client/server version coupling.
