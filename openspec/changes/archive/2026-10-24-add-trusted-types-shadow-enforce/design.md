## Context

The client registers one mode-aware `default` Trusted Types policy (`packages/client/src/lib/security/trusted-types.ts:231-246`). In `report` it returns input unchanged and only counts the call through `defaultHit` (`:204-206`). The caller comes from `callerSource()` (`:194-202`) and falls back to `"unknown"`. In `enforce` it applies `enforceDefaultHtml` (`:133-139`): the shared DOMPurify instance, profile chosen by an `<svg` test after `XML_PROLOGUE` (`:130`), no `FORCE_BODY`. It returns `null` from `createScript`, and `null` for script URLs failing `isAllowedScriptUrl` (`:80-94`, `PROD_SCRIPT_PATH` `:77`).

The violation channel tallies keys `directive\0sink\0source` (`bump`, `:181-184`). `takeReport` (`:306-320`) returns `null` when the tally is empty. Otherwise it keeps the first 50 keys in insertion order, sums the rest into `overflow`, and clears the tally. `flushViolations` (`:325-338`) drops the batch on any failure. `stripSource` (`:187-191`) does not truncate.

The server (`packages/server/src/routes/csp-violations-routes.ts`):
- rejects bodies over `CSP_VIOLATIONS_BODY_LIMIT = 8192` (`:21`);
- rejects the whole report on any invalid entry, e.g. `source` over 512 characters or a count outside `isCount` 1..`MAX_COUNT = 1_000_000` (`:28`, `:46-63`);
- drops unknown top-level fields (`:48`);
- rate-limits per principal (429);
- keeps an in-memory LRU of 500 keys and persists nothing (header `:8-13`).

`server.ts:2727` registers these routes before `CspReportStore` is constructed at `:2731`.

`CspReportStore` (`packages/server/src/auth/csp-report-store.ts`) persists `policy × directive` buckets over a fixed allow-set (`:36-62`):
- `record` (`:130-147`) maps unknown directives to `other`;
- changes are written within 5 s by the `markDirty` debounce;
- `parse` (`:261-279`) validates core keys and ignores other top-level keys, so an older server drops any unknown block on its next write;
- a failed core parse moves the file to `.corrupt` (`load`, `:237-258`).

`GET /api/health` spreads the snapshot into `cspReports` behind the disclosure predicate (`packages/server/src/routes/system-routes.ts:1179-1237`).

The flip change (`enforce-trusted-types-default`) reads this telemetry as soak evidence. A zero must mean "measured over the stated window and nothing found". Every way the evidence can be lost or reset must be visible as a newer window start, never as a zero.

## Goals / Non-Goals

**Goals**
- In `report` mode, classify per call what `enforce` would do, without changing output or the existing `default`-hit counts.
- Deliver the classification to a persisted, fixed-key counter. Loss is confined to documented residuals, and any reset of the evidence is visible through its own `since`.
- Make "not measured" countable: skipped and failed classifications have their own keys.
- Keep per-source attribution in memory for triage.

**Non-Goals**
- Changing the enforce rules, any named policy, or the script-URL allowlist.
- Flipping the default mode (`enforce-trusted-types-default`).
- Persisting sources, URLs or samples.
- Catching every silent DOMPurify normalization. Rendered parity under enforce stays the job of `tests/e2e/trusted-types-visual.spec.ts`.

## Decisions

**D1. Outcomes.** There are six fixed keys (`SHADOW_OUTCOMES`):
- `would-block-script`: every report-mode `createScript` call.
- `would-block-script-url`: a report-mode `createScriptURL` failing `isAllowedScriptUrl`.
- `would-alter-html`: enforcement would change the HTML content (D2).
- `would-throw-html`: the enforce sanitizer is unavailable (`assertPurify`) or its first pass throws, which would also throw under enforce.
- `not-evaluated`: an HTML input skipped by the cost budget (D4).
- `shadow-error`: an internal classifier failure that does not reflect enforce behaviour. It is kept separate so a classifier bug can never pass as a sanitizer outage or as a zero.

No script-URL example here is claimed as shipping code. Today the only app worker URL is `/sw.js` (`packages/client/src/lib/boot/client-boot.ts:19`).

**D2. HTML classification.**
- **Tag-free fast path (normative):** input with no `<` gets no outcome and no work.
- **Instance and profile.** The classifier uses a separate DOMPurify instance (`DOMPurify(window)`), so its `removed`, `CONFIG` and `FORCE_BODY` state never touches the shared instance used by named policies and `enforceDefaultHtml`. It calls that instance directly, never a sink-facing named policy.
- **Parse policy.** A second instance cannot create its own internal `dompurify` policy, because Trusted Types throws on duplicate names (`node_modules/dompurify/dist/purify.es.mjs:529-532`). It would then fall back to a raw `DOMParser.parseFromString`, itself a Trusted Types sink. So `installTrustedTypes` creates one module-private parse-only policy, `pi-shadow-parse` (identity `createHTML`, the same shape as DOMPurify's internal policy), and the classifier passes it as the instance's `TRUSTED_TYPES_POLICY` (`purify.es.d.mts:180`). It is never exported and never applied to a document sink; it only feeds DOMPurify's inert parse. Without browser Trusted Types it is absent and DOMPurify parses strings directly. Profile selection moves to one shared function, `enforceProfileFor(s)` (prologue strip + `<svg` test), which both `enforceDefaultHtml` and the classifier call.
- **Pass 1** sanitizes with that profile. `removedCount = shadowPurify.removed.length` is read immediately.
- **Pass 2** runs only when `removedCount === 0` and the prologue-stripped input matches `/^<(?:style|link|meta|title|base|script|noscript|template)[\s>/]/i`. It is the same profile with `FORCE_BODY: true` (a cloned config). If its output differs from pass 1, leading head content would be dropped.
- **Result:** `would-alter-html` when `removedCount > 0` or pass 2 differs.
- **Accepted residual:** other silent normalizations. The visual spec covers rendered parity.

**D3. The classifier never affects the sink or the counts.**
- Report-mode callbacks always return the original input.
- `try/catch`: an `assertPurify` or pass-1 throw counts `would-throw-html`; any other classifier throw counts `shadow-error`.
- A module-level `inShadow` flag makes a `default` callback invoked during classification return its input at once. Such a nested call counts no `defaultHit` and no shadow outcome. With `pi-shadow-parse` no re-entry is expected. The guard is defence in depth.
- Invariant tested: shadow evaluation adds zero `default`-policy hits.

**D4. Bounded cost without starving long-lived tabs.**
- Script and script-URL classification runs on every call (O(1) / one URL parse).
- **Memo:** a `Map` keyed by the full input string (exact, no hash collisions), LRU-evicted past 512 entries or 4 Mi UTF-16 code units of keys. A memo hit reuses the outcome; an evicted input is classified again on its next sighting.
- **Budget:** per flush window (30 s), at most 200 HTML classifications, 2 Mi UTF-16 code units of classified input, and 50 ms of classification time (`performance.now()`), whichever runs out first. An input over budget is not memoized. It counts `not-evaluated` once per distinct input per window (a per-window skip set) and is classified on a later sighting when budget allows.
- **Perf gate:** a report-mode variant of `tests/e2e/trusted-types-perf.spec.ts` with the same metric and threshold as the existing check: sum of `default`-callback time per page load, median of 5 runs, ≤ 20 ms (`:14-17`). The existing checks force `enforce` (`:35`, `:55`) and never run shadow code.

**D5. Client transport.**
- **Totals.** `shadowTotals` is a fixed six-key map. Every report carries `shadow: { <outcome>: n }` for its non-zero keys, each clamped to `MAX_COUNT`, with the remainder kept for the next report. `takeReport` produces a report when either the tally or `shadowTotals` is non-empty, so a totals-only flush is sent.
- **Retention.** Totals are subtracted only on a 2xx. On 400 (a schema rejection, which a conforming client never triggers) they are discarded so a deterministic rejection cannot poison every later report, and one `shadow-error` is added to the fresh totals, so the loss is visible. On any other failure (401, 403, 408, 413, 429, 5xx, network) they are kept and merged with new counts.
- **Body bound.** `takeReport` adds entries in priority order (violations, then default hits, then per-source `trusted-types-shadow` detail) while the serialized body stays ≤ 7,168 bytes. The rest is summed into `overflow`. The `shadow` field (≤ 6 small keys) is always included. Every `source` is truncated to 512 UTF-16 code units (the server's `source.length` check, `csp-violations-routes.ts:58`), which only affects sources that today make the server reject the whole batch. With the byte bound, fewer than 50 entries may be sent.
- **Accepted residual:** the final `pagehide` keepalive send cannot be retried. Counts from the last ≤ 30 s of a page are lost if it fails.

**D6. Server intake.**
- `parseReport` accepts an optional `shadow` field. A present `shadow` that is not a plain object (array, string, `null`, number) → 400. Known `SHADOW_OUTCOMES` keys must pass `isCount`, otherwise 400. Unknown keys are ignored (forward compatibility; never persisted).
- `entries` may be empty.
- After the schema and the rate limit accept a report, the route calls `deps.recordShadow?.(outcome, n)` for each known key. It never calls `record()`, so shadow text cannot reach `other` or the strict measure.
- Per-source `trusted-types-shadow` entries go to a separate in-memory LRU of 500 keys, so shadow detail can never evict violation or default-hit keys. `GET /api/csp-violations` returns both.
- `server.ts` constructs `CspReportStore` before `registerCspViolationRoutes` and passes `recordShadow`.
- The route and store header comments are updated: the route now feeds a persisted aggregate.

**D7. Storage, window start and degradation.**
- **File shape:** `serialize` writes `ttShadow: { since, counts: { "<outcome>": { count, firstSeen, lastSeen } } }` (`version` stays `1`). Health exposes the flat form (D8). In the file parse, unknown outcome keys are ignored (as on intake), so a newer version's extra key does not invalidate the block. A known key with a bad bucket, or a non-object block, is malformed.
- `ttShadow.since` is set to now whenever the block starts from zero other than by its own reset:
  - a fresh store;
  - a file without the block (first upgrade, or a rewrite by an older server after a rollback);
  - a malformed block, which also logs one warning and keeps core counters and the core `since`.
  `POST /api/csp-reports/reset` zeroes the block and sets `ttShadow.since` to the core `since`.
- Any loss of shadow evidence therefore shows as a `ttShadow.since` later than the soak start. The flip gate requires `ttShadow.since` ≤ window start.
- `recordShadow` calls `markDirty()`.
- **Accepted residual:** a crash loses ≤ 5 s of counts (existing debounce).

**D7b. Gate expectations for the flip change.** Evidence is valid only for a window that starts at or after `ttShadow.since`. Over that window, `not-evaluated` and `shadow-error` must be zero, with no triage path, because a classification that never ran is not a zero. If the D4 budget produces `not-evaluated` on real traffic, the budget is resized in its own change. `would-alter-html` = 0 is necessary but not sufficient (D2 residual), so the visual spec under enforce stays a gate condition. The flip change (`enforce-trusted-types-default`) owns the full gate.

**D8. Health exposure.** Whenever this server version emits `cspReports`, it carries `ttShadow: { since, "would-block-script": n, …all six… }`. Counts are plain numbers, zeros included, and there are no per-key timestamps. An absent `ttShadow` means the server predates this change.

**D9. Trust model.** Only reports accepted by schema and rate limit feed the persisted aggregate. A forged inflation never changes server behaviour, but it can hold the flip until an operator triages or resets. That is the intended failure direction: forging delays or blocks enforcement and never advances it.

## Risks / Trade-offs

- **Render-path cost.** Mitigated by the tag-free path, memo and windowed budget, and gated by the report-mode perf check (≤ 20 ms median).
- **Undetected silent normalization (D2 residual).** Covered by the visual spec under enforce, which the flip gate re-runs.
- **Pagehide and crash residuals (D5/D7).** Bounded to the last ≤ 30 s per page and ≤ 5 s per crash. A ≥14-day window over recurring traffic makes a systematic miss unlikely.
- **Split operator view after reset.** `/api/csp-reports/reset` zeroes the persisted block but not the in-memory per-source rows, which predate it until the server restarts. The architecture doc states this.
- **Traffic coverage.** Unvisited routes are not shadow-measured. The enforce, visual and budget E2E specs cover core routes in CI.

## Migration Plan

1. Ship client and server together.
   - An older server ignores `shadow` (`parseReport` drops unknown fields).
   - An older client sends no `shadow`.
   - The first start writes `ttShadow` with a fresh `since`.
2. After release, operators reset (`POST /api/csp-reports/reset`) to start the soak window.
3. Rollback: revert. The older server drops `ttShadow` on its next write. A later roll-forward starts a new `ttShadow.since`, so the lost evidence is visible, not zero.

## Open Questions

None blocking.
