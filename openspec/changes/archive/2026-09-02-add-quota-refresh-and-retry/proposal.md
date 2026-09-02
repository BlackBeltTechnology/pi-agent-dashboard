## Why

Today the quota plugin fetches each provider's usage endpoint exactly once per
60 s poll with no retry: a single throttle (HTTP 429) or network blip drops the
provider to a `stale` snapshot (or `unavailable`) until the next poll cycle, and
a user inspecting the dialog has no way to force a fresh read. Operators want to
(a) re-query on demand and (b) have transient failures retried automatically —
with the cost of those retries stated up front so the wait is never a surprise.

## What Changes

- **Manual refresh in the dialog.** `QuotaDialog` gains a refresh control in its
  header that re-queries `GET /api/quota` on demand and shows a "last updated"
  relative caption, so a user inspecting numbers can force a live read without
  waiting for the 60 s poll. The compact footer widget is unchanged (too tight
  for a control).
- **In-request retry with expanding backoff.** `computeQuota` retries a
  provider whose fetch failed with a **transient** kind (`http` 429/5xx,
  `timeout`, `network`) using an exponential backoff, before falling back to the
  existing stale/unavailable handling. Non-transient kinds (`no-credential`,
  `no-adapter`, `no-data`) fail fast — they will never succeed on retry. This
  requires the fetcher layer to **surface the underlying `JsonResult.kind`** to
  `computeQuota` (today `fetchers.ts` collapses every failure to
  `peer-rejected`, which cannot be classified). Retry runs INSIDE the
  `/api/quota` request. Because the snapshot is a `Promise.all`, the response is
  gated by the SLOWEST provider, so the backoff is bounded by an explicit
  **per-provider total retry budget** (a wall-clock cap that includes each
  attempt's request timeout, not just the sleep between attempts). Retries for
  one provider stay in its own branch and never multiply another provider's
  attempts.
- **Configurable retry, off by default, with a live schedule preview.** New
  `plugins.quota.retry.{enabled,maxAttempts,baseDelayMs,maxDelayMs}` config
  keys, each schema-bounded (min/max) and clamped to safe values on read so a
  malformed persisted config can never drive an unbounded wait or a timer
  overflow. `maxAttempts` = **retries after the initial attempt** (0 disables),
  matching the mirrored `RetrySettingsSection` semantics exactly. The
  `QuotaSettings` section gains a retry block that mirrors that shell pattern
  (checkbox + labelled number inputs + a schedule preview) rendering the exact
  backoff sequence and the **total wall-clock time the retries will consume**
  — backoff sleeps PLUS the per-attempt request timeout — before a provider is
  marked unavailable, so the stated cost is the real cost.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `provider-quota-surfacing`: adds a manual-refresh requirement on the dialog, a
  server-side transient-retry-with-backoff requirement on the quota fetch, and a
  configurable-retry-with-schedule-preview requirement on the settings section.

## Impact

- **Code**
  - `packages/quota-plugin/src/server/index.ts` — `computeQuota` gains a
    per-provider transient-retry loop bounded by a total budget; new retry
    config read + clamped from plugin config.
  - `packages/quota-plugin/src/server/quotas/fetchers.ts` — the per-provider
    fetchers must surface the failure KIND (not a flat `peer-rejected`) so
    `computeQuota` can classify transient vs terminal. One fetcher invocation
    (incl. Copilot's internal bearer→token fallback) counts as ONE retry attempt.
  - `packages/quota-plugin/src/server/quotas/http.ts` — retry decision keys off
    the existing `JsonResult.kind`; may surface `Retry-After` (design decision).
  - `packages/quota-plugin/src/client.tsx` — `QuotaDialog` gains a header
    refresh control + "last updated" caption; the fetch/refetch state must be
    OWNED where both widget and dialog see it (dialog gets immutable props
    today), single-flight guarded so an out-of-order response cannot clobber a
    newer one, and the refresh disabled while a request is in flight.
    `QuotaSettings` retry block (Tailwind, to match `RetrySettingsSection`) with
    a schedule-preview helper; its draft must PRESERVE `retry` through
    base/draft/reset/dirty (today the draft carries only `enabled`+`providers`,
    which would erase retry on save).
  - `packages/quota-plugin/configSchema.json` — new bounded `retry` object,
    default off.
  - `packages/quota-plugin/src/types.ts` — retry config typing.
- **APIs** — no new endpoint; `GET /api/quota` behaviour extended (retry before
  giving up). Response shape unchanged.
- **Dependencies** — none new. The schedule-preview logic mirrors (does not
  import) `packages/client/.../RetrySettingsSection.tsx` — cross-package import
  is not possible; the pattern is reproduced.
- **Security** — retry rides the token-carrying `fetchJson`; the change SHALL
  add no new log/output path that bypasses the existing `scrub()` (each retried
  attempt reuses the same scrubbed error path). `scrub()`'s known-imperfect
  coverage is pre-existing and out of scope for this change.

## Discipline Skills

- **performance-optimization** — in-request retry adds latency to `/api/quota`;
  the backoff sum is a per-request budget and the `Promise.all` snapshot is only
  as fast as its slowest retrying provider. The bound must be justified.
- **security-hardening** — the retry loop re-enters the only code path where a
  token touches the network; every retried attempt's error path must stay
  scrubbed.
- **review-code** — run before commit once tests pass.
