# Tasks — add-opencode-go-quota

## 1. Server: fetcher + parser

- [x] 1.1 Add `parseOpencodeGo(data)` to `packages/quota-plugin/src/server/quotas/parse.ts`: map `usage.rolling`/`weekly`/`monthly` via the existing `win()` helper — labels `5h`/`7d`/`30d`, windowSeconds `5*HOUR`/`7*DAY`/`30*DAY`, `usedPercent = num(percent)` (percent USED) with `limitValue:100`; emit a window only when `percent` is finite AND a reset stamp is present (drop otherwise via `win()` null); do NOT branch on `status`. Mirror the anthropic parser's `win()` usage.
- [x] 1.2 Add the `opencode-go` fetcher to `packages/quota-plugin/src/server/quotas/fetchers.ts`: `getApiKey("opencode-go")` → `no-credential` when absent; `get("https://opencode.ai/zen/go/v1/usage", { ...bearer(token), "User-Agent": "opencode/1.0.0" }, parseOpencodeGo, signal)`. Register it in `PROVIDER_FETCHERS`. Mirror the `githubCopilot` per-fetcher User-Agent pattern.
- [x] 1.3 In `fetchers.ts` `classifyHttpFailure` path (or the opencode-go fetcher), detect a 403 whose scrubbed body signals Cloudflare 1010 (`error-1010` / `Access denied`) and attach a DISTINCT `detail` (e.g. `"edge blocked (Cloudflare 1010) — not an auth failure"`) while keeping the failure terminal `peer-rejected`. Keep the token out of the detail (scrub).

## 2. Supported-provider lists (parity)

- [x] 2.1 Add `"opencode-go"` to the literal `SUPPORTED_PROVIDERS` array in `packages/quota-plugin/src/providers.ts` (the `fetchers.ts` `Object.keys(PROVIDER_FETCHERS)` derivation updates itself). Verify the parity test (quota-engine.test.ts) stays green.

## 3. Docs / comment reconciliation

- [x] 3.1 Rewrite the stale "opencode-go unsupported" rationale in FOUR sites, dropping the Go claim and RETAINING the Zen-wallet exclusion verbatim for `opencode` (cookie + workspace id, `server.queryBilling`, wallet not a resetting window): `providers.ts` header comment, `server/quotas/fetchers.ts` header comment, `src/AGENTS.md` (`providers.ts` row), `server/AGENTS.md` (`quotas/fetchers.ts` row). These AGENTS.md are hand-maintained (no doctor `generated` marker).

## 4. Tests (folded from test-plan.md manifest)

### 4a. Parse / mapping — L1 (see packages/quota-plugin/src/server/__tests__/quota-engine.test.ts)

- [x] 4.1 L1 — Go usage exposed. input: 200 body `{usage:{rolling:{status:"ok",percent:1,resetsAt:R1},weekly:{…percent:0…},monthly:{…percent:3…}}}` · trigger: computeQuota opencode-go enabled · observable: 3 windows, labels 5h/7d/30d, usedPercent 1/0/3, windowSeconds 18000/604800/2592000, resetsAt R1/R2/R3. (test-plan #E1)
- [x] 4.2 L1 — percent boundary low. input: rolling percent:0 · trigger: parse · observable: usedPercent 0, window still emitted. (test-plan #E2)
- [x] 4.3 L1 — percent boundary high. input: rolling percent:100 · trigger: parse · observable: usedPercent 100. (test-plan #E3)
- [x] 4.4 L1 — clamp above max. input: rolling percent:140 · trigger: parse · observable: usedPercent clamped 100. (test-plan #E4)
- [x] 4.5 L1 — clamp below min. input: rolling percent:-5 · trigger: parse · observable: usedPercent clamped 0. (test-plan #E5)
- [x] 4.6 L1 — malformed percent dropped. input: rolling percent:"n/a", weekly+monthly valid · trigger: parse · observable: rolling omitted, weekly+monthly emitted. (test-plan #E6)
- [x] 4.7 L1 — missing reset stamp dropped. input: rolling {status:"ok",percent:5} no resetsAt · trigger: parse · observable: rolling omitted, others emitted. (test-plan #E7)
- [x] 4.8 L1 — non-ok window still emitted. input: rolling {status:"exceeded",percent:100,resetsAt:R1} · trigger: parse · observable: rolling exposed usedPercent 100, NOT dropped. (test-plan #E8)
- [x] 4.9 L1 — partial body. input: {usage:{monthly:{…}}} only · trigger: parse · observable: exactly one window, no throw. (test-plan #E9)
- [x] 4.10 L1 — empty 200. input: body {} · trigger: computeQuota · observable: opencode-go unavailable reason no-data, terminal (not retried). (test-plan #E10)

### 4b. Error-handling / fault injection — L1 (see quota-engine.test.ts; use fake timers as in the retry suite)

- [x] 4.11 L1 — no credential. input: getApiKey→undefined · trigger: computeQuota · observable: unavailable no-credential, zero fetches. (test-plan #F1)
- [x] 4.12 L1 — rejected key 401. input: fetch→401, retry maxAttempts=2 · trigger: computeQuota · observable: exactly 1 fetch (terminal, no retry), unavailable peer-rejected. (test-plan #F2)
- [x] 4.13 L1 — no Go subscription 403 EntitlementError. input: fetch→403 `{"error":{"type":"EntitlementError"}}`, retry on · trigger: computeQuota · observable: 1 fetch, unavailable peer-rejected. (test-plan #F3)
- [x] 4.14 L1 — edge block distinct detail. input: fetch→403 body `Error 1010: Access denied` · trigger: computeQuota · observable: unavailable peer-rejected with detail naming edge block (≠ entitlement); no token substring. (test-plan #F4)
- [x] 4.15 L1 — transient 429 then success. input: 429 then 200, retry maxAttempts=2 baseDelayMs=100 fake timers · trigger: computeQuota · observable: opencode-go live in providers[], exactly 2 fetches. (test-plan #F5)
- [x] 4.16 L1 — transient 5xx retried. input: 503 all attempts, retry maxAttempts=2 · trigger: computeQuota · observable: 3 total fetches then unavailable. (test-plan #F6)
- [x] 4.17 L1 — timeout transient. input: fetch aborts TimeoutError, retry off · trigger: computeQuota · observable: unavailable peer-rejected, 1 fetch. (test-plan #F7)

### 4c. Contract / security — L1 (see packages/quota-plugin/src/server/__tests__/contract.test.ts)

- [x] 4.18 L1 — correct host + header token. input: fetch spy, token `sk-OCG-TESTKEY` · trigger: opencode-go fetcher · observable: URL contains opencode.ai; `Authorization: Bearer sk-OCG-TESTKEY` header; token not in URL/query (add opencode-go→opencode.ai to the contract host map). (test-plan #C1)
- [x] 4.19 L1 — non-default User-Agent. input: fetch header spy · trigger: opencode-go fetcher · observable: `User-Agent` header present, value non-empty and not `node`. (test-plan #C2)
- [x] 4.20 L1 — credential id is opencode-go. input: getApiKey spy recording provider arg · trigger: opencode-go fetcher · observable: getApiKey called with "opencode-go", NOT "opencode". (test-plan #C3)
- [x] 4.21 L1 — token never leaks on failure. input: 403 body echoing `Bearer sk-OCG-TESTKEY` · trigger: fetch fails · observable: no substring of sk-OCG-TESTKEY in detail/log (scrub). (test-plan #C4)

### 4d. Regression / parity — L1

- [x] 4.22 L1 — SUPPORTED_PROVIDERS parity. input: both lists · trigger: parity test · observable: derivation equals literal; both contain opencode-go. (test-plan #R1)
- [x] 4.23 L1 — Zen/deepseek/minimax excluded. input: supported list · trigger: membership · observable: contains opencode-go; excludes opencode, deepseek, minimax (update the unsupported-loop to drop opencode-go). (test-plan #R2)
- [x] 4.24 L1 — no-adapter test no longer hits network. input: config names deepseek enabled, no fetch mock · trigger: computeQuota · observable: providers empty, ZERO real network calls (switch the existing opencode-go example to deepseek). (test-plan #R3)
- [x] 4.25 L1 — plugin gate closed. input: plugin disabled OR opencode-go disabled · trigger: computeQuota · observable: zero fetch calls for opencode-go. (test-plan #R4)

## 5. Verify

- [x] 5.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` scoped to quota-plugin; confirm all folded rows pass and no test issues a real network call.
- [x] 5.2 (post-merge, manual) Probe `GET /zen/go/v1/usage` from the docker harness IP to confirm the deploy environment is not CF-1010-blocked (design D2 residual risk; not an automatable row).
