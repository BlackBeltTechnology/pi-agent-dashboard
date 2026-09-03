# Test Plan — add-quota-refresh-and-retry

Stage: design   Generated: 2026-09-02

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Server retries transient failures | fault→recovery | L1 | automated | provider fetch returns `http` 429 on attempt 1, success on attempt 2; retry enabled `maxAttempts=2 baseDelayMs=100` | `computeQuota` runs (fake timers) | provider appears in `providers[]` with live windows, NOT `stale`, NOT in `unavailable[]`; exactly 2 fetcher invocations |
| E2 | Terminal kinds not retried | classification | L1 | automated | fetcher reports `no-credential` | `computeQuota` runs, retry enabled | exactly 1 fetcher invocation; provider in `unavailable[]` with reason `no-credential` |
| E3 | HTTP status classification (BVA) | EP+BVA | L1 | automated | statuses {429,500,503} vs {400,401,403,404} | classify each | 429/500/503 → transient (retried); 400/401/403/404 → terminal (not retried) |
| E4 | Parse error is terminal | classification | L1 | automated | fetcher gets HTTP 200 with malformed/unparseable body | `computeQuota` runs, retry enabled | classified terminal (`no-data`), zero retries, budget not consumed |
| E5 | Retry bounded by finite schedule | boundary | L1 | automated | provider fails `network` on every attempt; `maxAttempts=5 baseDelayMs=100 maxDelayMs=60000` | `computeQuota` (fake timers), count attempts + summed delay | attempts = `maxAttempts+1` = 6; total sleep = Σ min(100·2^n,60000); then stale/unavailable |
| E6 | maxAttempts=0 disables retry | boundary | L1 | automated | retry `enabled=true maxAttempts=0`, provider fails `timeout` | `computeQuota` runs | exactly 1 attempt; no retry |
| E7 | Retry defaults off | default | L1 | automated | plugin enabled, NO `retry` key in config | `computeQuota` runs, provider fails transiently | exactly 1 attempt per provider (no retry) |
| E8 | Malformed config clamped | EP+BVA | L1 | automated | persisted `retry` = `{maxAttempts:99, baseDelayMs:-5, maxDelayMs:9e15}` | server reads config | clamped to `{5,100,60000}` before any timer/arithmetic; no unbounded wait, no timer overflow |
| E9 | Disabled provider never retried | gate | L1 | automated | plugin enabled, provider `enabled=false`, retry enabled | `computeQuota` runs | zero fetch attempts + zero retries for that provider |
| E10 | Settings draft preserves retry | merge | L1 | automated | loaded config has `retry` set; user toggles one provider | `QuotaSettings` commit (jsdom) | persisted `plugin_config_write` payload retains `retry` unchanged + new provider state |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Retry keeps `/api/quota` bounded | worst-case bound | L1 | automated | 2 providers: one healthy (1 call), one failing all attempts, `maxAttempts=5` | healthy provider's result not delayed beyond slowest branch; total added latency ≤ `(maxAttempts+1)×timeout + Σdelays` (fake timers, computed) | per request |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Out-of-order response discarded | state-convergence | L1 | automated | poll req#1 (seq 1) slow, refresh req#2 (seq 2) fast; #1 resolves last | both requests race in `useQuota` | state converges to req#2's snapshot; req#1's late resolve is dropped; `lastUpdated` never regresses |
| F2 | Refresh disabled while in flight | state | L1 | automated | a refresh is outstanding (`isRefreshing=true`) | user activates refresh again | second `refresh()` is a no-op; no extra fetch issued |
| F3 | Selected provider disappears → fall back | state-transition | L1 | automated | dialog open selected=`openai-codex`; refresh returns snapshot without `openai-codex` (jsdom) | refresh applied | dialog selection falls back to `All`; no empty detail view |
| F4 | Preview states the real total | formula-lock | L1 | automated | `maxAttempts=3 baseDelayMs=1000 maxDelayMs=60000` | render `QuotaSettings` preview (jsdom) | preview total = Σ sleeps `1s→2s→4s` **+ (3+1)×15s** timeout; sequence `1 s → 2 s → 4 s` shown; matches `(maxAttempts+1)×timeout + Σdelays` |
| F5 | Refresh re-queries end-to-end | state-transition | L3 | automated | dashboard open, quota dialog open (docker harness, derived port) | user clicks the dialog refresh control | a fresh `GET /api/quota` is issued and the shown snapshot + "last updated" caption update; footer widget has NO refresh control |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Refresh failure degrades honestly | fault-injection (abort) | L1 | automated | refresh `GET /api/quota` rejects | user refreshes with a prior snapshot shown | prior snapshot retained; no error dialog; caption unchanged |
| X2 | No token leaks across retried attempts | fault-injection + scrub assert | L1 | automated | upstream 429 body + headers echo a token-shaped string on EVERY retried attempt | `computeQuota` retries then logs failure | no substring of any token appears in `/api/quota` output, broadcast, or any captured log line, across all attempts |

---

## Coverage summary

- Requirements covered: 3/3 (dialog refresh · server transient retry · configurable retry+preview)
- Scenarios by class: edge 10 · perf 1 · frontend 5 · error 2
- Scenarios by level: L1 17 · L2 0 · L3 1
- Scenarios by disposition: automated 18 · manual-only 0

## New infra needed

- none — L1 vitest exists (`packages/quota-plugin/src/**/__tests__`, jsdom for
  component rows); L3 uses the existing docker harness + Playwright e2e tier
  (`tests/e2e/*.spec.ts`, harness port from `.pi-test-harness.json`).
