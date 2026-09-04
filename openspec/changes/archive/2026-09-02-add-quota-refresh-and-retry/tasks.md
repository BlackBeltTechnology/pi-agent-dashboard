# Tasks — add-quota-refresh-and-retry

## 1. Server: surface failure kind + transient retry

- [x] 1.1 Widen the per-provider fetcher result so `computeQuota` receives the underlying failure KIND (transient vs terminal) instead of a flat `peer-rejected`, in `packages/quota-plugin/src/server/quotas/fetchers.ts` + `types.ts`. Classification per design D2: `http` 429/5xx → transient; other `http` → terminal; `timeout`/`network` → transient; `no-credential`/`no-adapter` → terminal; thrown parse error or malformed-but-200 → terminal (`no-data`). Verify a new unit test asserts each mapping.
- [x] 1.2 Add the transient-retry loop to `computeQuota` in `packages/quota-plugin/src/server/index.ts`: retry a transient failure with delay `min(baseDelayMs·2^n, maxDelayMs)`, up to `maxAttempts` retries after the initial attempt (design D3/D6: one fetcher invocation = one attempt), stopping early on success or a terminal kind, staying inside the existing `order.map` branch so the outer `Promise.all` is unchanged. Verify the L1 tests in section 5 pass.
- [x] 1.3 Read + clamp the retry config in the server on each call before any arithmetic/timer (design D5 bounds: `maxAttempts` 0–5, `baseDelayMs` 100–10000, `maxDelayMs` 100–60000). Verify test E8 passes.

## 2. Config schema + types

- [x] 2.1 Add the bounded `retry` object (`enabled`,`maxAttempts`,`baseDelayMs`,`maxDelayMs`) with `default` off and `minimum`/`maximum` per design D5 to `packages/quota-plugin/configSchema.json`, and the matching type to `packages/quota-plugin/src/types.ts`. Verify `openspec validate` stays green and the schema parses.

## 3. Client: shared fetch/refresh state + dialog refresh control

- [x] 3.1 Extend `useQuota` in `packages/quota-plugin/src/client.tsx` to expose `{ providers, lastUpdated, refresh, isRefreshing }`, with a monotonic sequence id applied to BOTH poll and refresh so only the latest response is applied, and `refresh` a no-op while `isRefreshing` (design D7). Verify tests F1, F2, X1 pass.
- [x] 3.2 Make `QuotaWidget` the single owner of the hook and pass the refresh handles to `QuotaDialog` as props (not a second hook call). Add the refresh control + relative "last updated" caption to the `QuotaDialog` header only (NOT the footer widget), and fall back to the `All` selection when a refresh drops the selected provider (design D7). Verify tests F3, F5 pass.

## 4. Client: settings retry block + honest preview

- [x] 4.1 Add the retry block to `QuotaSettings` reusing the shell's `RetrySettingsSection` element vocabulary (Tailwind: checkbox + labelled number inputs + schedule preview), reproducing the `computeSchedule`/`human`/`SchedulePreview` helpers. Preview total = Σ delays + `(maxAttempts + 1) × requestTimeout` with a caption noting multi-call providers may exceed it (design D4). Verify test F4 passes.
- [x] 4.2 Change the `QuotaSettings` draft to spread the full loaded config and override only edited fields (merge-preserving), so `retry` round-trips a provider-toggle save (design D8). Verify test E10 passes.

## 5. Tests (folded from test-plan.md manifest)

- [x] 5.1 L1 (see packages/quota-plugin/src/server/__tests__/quota-engine.test.ts) — transient 429 then success. input: fetcher returns http 429 attempt 1, success attempt 2, retry enabled maxAttempts=2 baseDelayMs=100 · trigger: computeQuota with fake timers · observable: provider in providers[] live (not stale, not unavailable), exactly 2 invocations. (test-plan #E1)
- [x] 5.2 L1 (see quota-engine.test.ts) — terminal not retried. input: fetcher reports no-credential · trigger: computeQuota, retry enabled · observable: exactly 1 invocation, provider in unavailable[] reason no-credential. (test-plan #E2)
- [x] 5.3 L1 (see quota-engine.test.ts) — HTTP status classification BVA. input: statuses {429,500,503} vs {400,401,403,404} · trigger: classify each · observable: 429/500/503 transient (retried), 400/401/403/404 terminal (not retried). (test-plan #E3)
- [x] 5.4 L1 (see quota-engine.test.ts) — parse error is terminal. input: HTTP 200 with unparseable body · trigger: computeQuota, retry enabled · observable: classified no-data, zero retries. (test-plan #E4)
- [x] 5.5 L1 (see quota-engine.test.ts) — retry bounded by finite schedule. input: network failure every attempt, maxAttempts=5 baseDelayMs=100 maxDelayMs=60000 · trigger: computeQuota fake timers, count attempts+delay · observable: attempts=6, total sleep=Σ min(100·2^n,60000), then stale/unavailable. (test-plan #E5)
- [x] 5.6 L1 (see quota-engine.test.ts) — maxAttempts=0 disables retry. input: retry enabled maxAttempts=0, provider fails timeout · trigger: computeQuota · observable: exactly 1 attempt. (test-plan #E6)
- [x] 5.7 L1 (see quota-engine.test.ts) — retry defaults off. input: plugin enabled, no retry key · trigger: computeQuota, provider fails transiently · observable: exactly 1 attempt per provider. (test-plan #E7)
- [x] 5.8 L1 (see quota-engine.test.ts) — malformed config clamped. input: persisted retry {maxAttempts:99,baseDelayMs:-5,maxDelayMs:9e15} · trigger: server reads config · observable: clamped to {5,100,60000}, no unbounded wait, no timer overflow. (test-plan #E8)
- [x] 5.9 L1 (see quota-engine.test.ts) — disabled provider never retried. input: plugin enabled, provider enabled=false, retry enabled · trigger: computeQuota · observable: zero attempts + zero retries. (test-plan #E9)
- [x] 5.10 L1 (see packages/quota-plugin/src/__tests__/dialog.test.tsx) — settings draft preserves retry. input: loaded config has retry set, user toggles one provider · trigger: QuotaSettings commit (jsdom) · observable: plugin_config_write payload retains retry + new provider state. (test-plan #E10)
- [x] 5.11 L1 (see quota-engine.test.ts, timed with fake timers) — retry keeps /api/quota bounded. input: 2 providers, one healthy (1 call), one failing all attempts maxAttempts=5 · observable: healthy result not delayed beyond slowest branch; added latency ≤ (maxAttempts+1)×timeout + Σdelays. (test-plan #P1)
- [x] 5.12 L1 (see packages/quota-plugin/src/__tests__/widget.test.tsx) — out-of-order response discarded. input: poll seq1 slow, refresh seq2 fast, seq1 resolves last · trigger: race in useQuota · observable: state converges to seq2 snapshot, seq1 late resolve dropped, lastUpdated never regresses. (test-plan #F1)
- [x] 5.13 L1 (see widget.test.tsx) — refresh disabled while in flight. input: refresh outstanding (isRefreshing=true) · trigger: activate refresh again · observable: second refresh() no-op, no extra fetch. (test-plan #F2)
- [x] 5.14 L1 (see dialog.test.tsx) — selected provider disappears → fall back. input: dialog open selected=openai-codex, refresh returns snapshot without openai-codex (jsdom) · trigger: refresh applied · observable: selection falls back to All, no empty detail view. (test-plan #F3)
- [x] 5.15 L1 (see dialog.test.tsx) — preview states the real total. input: maxAttempts=3 baseDelayMs=1000 maxDelayMs=60000 · trigger: render QuotaSettings preview (jsdom) · observable: total = Σ sleeps 1s→2s→4s + (3+1)×15s, sequence "1 s → 2 s → 4 s" shown, matches (maxAttempts+1)×timeout+Σdelays. (test-plan #F4)
- [x] 5.16 L3 (see tests/e2e/subagent-detail-dialog.spec.ts; harness port from .pi-test-harness.json dashboardPort) — refresh re-queries end-to-end. input: dashboard open, quota dialog open · trigger: click dialog refresh control · observable: fresh GET /api/quota issued, snapshot + "last updated" caption update, footer widget has NO refresh control. (test-plan #F5)
- [x] 5.17 L1 (see widget.test.tsx) — refresh failure degrades honestly. input: refresh GET /api/quota rejects, prior snapshot shown · trigger: user refreshes · observable: prior snapshot retained, no error dialog, caption unchanged. (test-plan #X1)
- [x] 5.18 L1 (see quota-engine.test.ts) — no token leaks across retried attempts. input: upstream 429 body+headers echo a token-shaped string on every retried attempt · trigger: computeQuota retries then logs failure · observable: no substring of any token in /api/quota output, broadcast, or any captured log line across all attempts. (test-plan #X2)

## 6. Final verification

- [x] 6.1 quota-plugin suite green locally (84 tests, `vitest run` in packages/quota-plugin); full `npm test` deferred to CI on the PR. Manual dialog-refresh/settings-preview confirmation deferred to QA.
