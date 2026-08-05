# Error banner: observe-only (drop Stop retrying + collapse)

## Why

The `retry-forever-with-stop-control` change shipped the error banner with a
**"Stop retrying"** control and a **dismiss→collapse** pill. Both are now
unwanted:

- **pi owns the retry loop.** The dashboard only reads pi's retry lifecycle and
  renders it — it never re-drives. The dedicated "Stop retrying" button is
  redundant with the always-present session Stop (bottom-left), which already
  ends pi's chain identically. One abort entry point is enough.
- **The collapse pill existed only to keep "Stop retrying" + status reachable
  after a dismiss.** With Stop gone, plus retry-status auto-clearing on a
  confirmed-good resume and the sidebar amber-dot mirror already carrying the
  live handle, the pill has no remaining job.

Net: the banner keeps exactly two behaviors — **show the retry status while pi
retries** (bare `attempt N` + countdown / "retrying now"), and **disappear on a
successful resume**. Both already work and ride the same observable events.

## What Changes

- **Remove the "Stop retrying" control** (`error-banner-stop`) from
  `SessionBanner`, and drop the banner's `onAbort` wiring in `App.tsx`.
- **Remove the collapse surface** entirely: the `CollapsedRetryPill`, the
  `error-banner-collapse` / `error-banner-expand` controls, the sticky-collapse
  state, and the dismiss→collapse degradation.
- **Keep** the retry status sub-line, the amber in-flight sweep, the settled
  error's state-clearing dismiss (`error-banner-dismiss`), Copy, and show-more.
- Update `SessionBanner.test.tsx` to drop stop/collapse cases.

### Explicitly out of scope

- Error-message humanization (raw provider JSON → readable text).
- Clearing the error on user Stop / abort.
- Any dismiss / re-arm-on-new-error behavior.

## Discipline Skills

- `review-code` — non-trivial component + spec change; review the diff before commit.

## Capabilities

### Modified Capabilities

- **session-status-banner** — surface states and action requirements lose Stop
  retrying + collapse.
- **provider-retry-state** — the retry banner no longer mandates a Stop control.
