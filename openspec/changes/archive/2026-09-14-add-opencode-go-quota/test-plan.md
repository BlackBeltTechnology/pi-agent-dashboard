# Test Plan — add-opencode-go-quota

Stage: design   Generated: 2026-09-14

All scenarios are server-side fetcher/parser logic exercised against a mocked
`globalThis.fetch` — the existing `quota-plugin` unit tier
(`packages/quota-plugin/src/server/__tests__/`). No rendered-UI or process/install
scenario applies (the client widget already renders any `ProviderQuota` window,
unchanged). Every row is L1 / `automated`.

Provisional constants (scenarios written against these; verify-on-implement):

| Constant | Value | Source |
|---|---|---|
| Endpoint | `GET https://opencode.ai/zen/go/v1/usage` | live probe (HTTP 200) |
| Window lengths | rolling `5*HOUR`, weekly `7*DAY`, monthly `30*DAY` | openusage doc (monthly = approximation) |
| `percent` semantics | percent USED (not remaining) | live probe `1/0/3` on low-usage account |
| CF-1010 marker | 403 body containing `error-1010` / `Access denied` | live probe body |
| UA | any non-default (e.g. `opencode/1.0.0`) | live probe (node UA → 403, UA set → 200) |

---

## Scenarios

### Edge-case (parse / mapping)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Go usage exposed | happy-path | L1 | automated | 200 body `{usage:{rolling:{status:"ok",percent:1,resetsAt:R1},weekly:{status:"ok",percent:0,resetsAt:R2},monthly:{status:"ok",percent:3,resetsAt:R3}}}` | computeQuota with opencode-go enabled | `providers[]` has opencode-go with 3 windows: labels `5h`/`7d`/`30d`, usedPercent `1`/`0`/`3`, resetsAt R1/R2/R3, windowSeconds `18000`/`604800`/`2592000` |
| E2 | percent USED, boundary low | BVA | L1 | automated | rolling `percent:0` | parse | window usedPercent `0`, still emitted (not treated as absent) |
| E3 | percent USED, boundary high | BVA | L1 | automated | rolling `percent:100` | parse | window usedPercent `100` |
| E4 | percent clamp above max | BVA | L1 | automated | rolling `percent:140` | parse | usedPercent clamped to `100` |
| E5 | percent clamp below min | BVA | L1 | automated | rolling `percent:-5` | parse | usedPercent clamped to `0` |
| E6 | malformed percent dropped | EP | L1 | automated | rolling `percent:"n/a"` (non-finite), weekly+monthly valid | parse | rolling window omitted; weekly+monthly still emitted (no misleading 0% window) |
| E7 | missing reset stamp dropped | EP | L1 | automated | rolling `{status:"ok",percent:5}` (no resetsAt), others valid | parse | rolling omitted (win() null guard); others emitted |
| E8 | non-ok window still emitted | state-transition | L1 | automated | rolling `{status:"exceeded",percent:100,resetsAt:R1}` | parse | rolling window EXPOSED with usedPercent `100` (NOT dropped) |
| E9 | partial body | EP | L1 | automated | body `{usage:{monthly:{status:"ok",percent:3,resetsAt:R3}}}` (no rolling/weekly) | parse | exactly one window (monthly); no throw |
| E10 | empty/garbage 200 | EP | L1 | automated | body `{}` | computeQuota | opencode-go in `unavailable` with reason `no-data` (terminal, not retried) |

### Error-handling (fault injection)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | no credential | EP | L1 | automated | `getApiKey("opencode-go")` → undefined | computeQuota | opencode-go unavailable reason `no-credential`; zero fetch calls |
| F2 | rejected key (401) | fault-injection | L1 | automated | fetch → 401 | computeQuota, retry enabled maxAttempts=2 | terminal: exactly 1 fetch (no retry), unavailable `peer-rejected` |
| F3 | no Go subscription (403 EntitlementError) | fault-injection | L1 | automated | fetch → 403 body `{"error":{"type":"EntitlementError"}}` | computeQuota, retry enabled | terminal: 1 fetch, unavailable `peer-rejected` |
| F4 | edge block distinct detail | fault-injection | L1 | automated | fetch → 403 body containing `Error 1010: Access denied` | computeQuota | unavailable `peer-rejected` with a `detail` naming the edge block (≠ entitlement); no token substring in detail |
| F5 | transient 429 then success | fault-injection | L1 | automated | fetch → 429 attempt 1, 200 attempt 2; retry enabled maxAttempts=2 baseDelayMs=100 (fake timers) | computeQuota | opencode-go live in `providers[]` (not stale/unavailable); exactly 2 fetches |
| F6 | transient 5xx retried | fault-injection | L1 | automated | fetch → 503 all attempts; retry enabled maxAttempts=2 | computeQuota | 3 total fetches (1+2), then unavailable |
| F7 | timeout transient | fault-injection | L1 | automated | fetch aborts via TimeoutError | computeQuota, retry off | unavailable `peer-rejected` transient path (1 fetch) |

### Contract / security

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| C1 | correct host + header token | contract | L1 | automated | spy on fetch; token `sk-OCG-TESTKEY` | opencode-go fetcher runs | request URL contains `opencode.ai`; `Authorization: Bearer sk-OCG-TESTKEY` in headers; token NOT in URL/query (extends contract.test host map) |
| C2 | non-default User-Agent sent | contract | L1 | automated | spy on fetch headers | opencode-go fetcher runs | request carries a `User-Agent` header whose value is not empty and not `node` |
| C3 | credential id is opencode-go | contract | L1 | automated | `getApiKey` spy recording provider arg | opencode-go fetcher runs | `getApiKey` called with `"opencode-go"` (NOT `"opencode"`) |
| C4 | token never leaks on failure | security | L1 | automated | 403 body echoing `Bearer sk-OCG-TESTKEY` | fetch fails | unavailable detail/log contains no substring of `sk-OCG-TESTKEY` (scrub) |

### Regression / parity

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | SUPPORTED_PROVIDERS parity | contract | L1 | automated | both lists | parity test | `Object.keys(PROVIDER_FETCHERS).sort()` equals literal `SUPPORTED_PROVIDERS`; both contain `opencode-go` |
| R2 | Zen/deepseek/minimax still excluded | decision-table | L1 | automated | supported list | membership check | list contains `opencode-go`; does NOT contain `opencode`, `deepseek`, `minimax` |
| R3 | no-adapter test no longer hits network | state | L1 | automated | config names still-unsupported `deepseek` enabled, no fetch mock | computeQuota | `providers` empty; ZERO real network calls (example switched off opencode-go) |
| R4 | plugin gate closed → no fetch | state | L1 | automated | plugin disabled OR opencode-go disabled | computeQuota | zero fetch calls for opencode-go |

---

## New infra needed

None. All rows extend existing suites: `quota-engine.test.ts` (E1–E10, F1–F7,
R2–R4), `contract.test.ts` (C1–C4, R1). No L2/L3, no new harness.

## Verify-on-implement (carried from design open questions)

- Monthly `windowSeconds` (30*DAY) is a pace approximation — confirm against a
  real `resetsAt` span when the fetcher lands (E1 asserts the chosen constant).
- Deploy-environment edge behaviour (F4's premise): a docker/datacenter IP may
  hit CF-1010 even with the UA set — a manual probe from the harness IP is a
  post-merge check, not an automatable row (design D2 residual risk).
