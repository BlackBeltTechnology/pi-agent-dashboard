# Test Plan — fix-corrupt-auth-json-500

Stage: design   Generated: 2026-08-29

Clarification C1 (OAuth poll consecutive-failure budget) resolved before writing:
**N = 3** consecutive malformed/non-`ok` responses ends the flow (~6s at the 2s
poll interval). Boundary rows F3/F4 encode it.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | auth.json corrupt-content recovery | EP (invalid class: empty) | L1 | automated | `auth.json` = `""` (0 bytes) | `readAuthJson()` called | returns `{}`, does not throw; `auth.json` bytes unchanged on disk |
| E2 | auth.json corrupt-content recovery | EP (invalid class: truncated) | L1 | automated | `auth.json` = `{"anthropic":{"type":"oauth","refr` | `readAuthJson()` | returns `{}`; a quarantine file exists whose bytes equal the input exactly |
| E3 | auth.json corrupt-content recovery | EP (valid JSON, wrong shape) | L1 | automated | `auth.json` = `null`, then `[]`, then `42` (3 cases) | `readAuthJson()` | each returns `{}` and quarantines; no throw |
| E4 | auth.json corrupt-content recovery | EP (valid boundary) | L1 | automated | `auth.json` = `{}` (legitimately empty object) | `readAuthJson()` | returns `{}`; **no** quarantine file created; no log line |
| E5 | auth.json corrupt-content recovery | EP (BOM boundary) | L1 | automated | `auth.json` = `\uFEFF{"openai":{"type":"api_key","key":"sk-x"}}` | `readAuthJson()` | returns the `openai` credential; no quarantine file |
| E6 | auth.json corrupt-content recovery | EP (ENOENT class) | L1 | automated | `auth.json` absent | `readAuthJson()` | returns `{}`; no quarantine file; no quarantine log line |
| E7 | auth.json corrupt-content recovery | BVA (filename charset) | L1 | automated | any corrupt `auth.json` | quarantine runs | created filename matches `auth.json.corrupt-\d{8}T\d{9}Z(-\d+)?` and contains no `:` |
| E8 | auth.json corrupt-content recovery | decision-table (name collision) | L1 | automated | corrupt bytes + a file already at the computed quarantine name holding `PRIOR` | quarantine runs | new file `...-1` created; the pre-existing file still contains `PRIOR` byte-for-byte |
| E9 | auth.json corrupt-content recovery | decision-table (dedup identity) | L1 | automated | corrupt content A read; replaced by different corrupt content B with an identical `(size, mtimeMs)` | `readAuthJson()` twice | two distinct quarantine files exist — one per content (proves hash-based, not stat-based, dedup) |
| E10 | auth.json corrupt-content recovery | EP (dedup hit) | L1 | automated | same corrupt bytes | `readAuthJson()` called 5× in one process | exactly 1 quarantine file created |
| E11 | credential writes refuse to clobber | decision-table (corrupt × backup) | L1 | automated | corrupt `auth.json`; quarantine copy forced to fail (`copyFileSync` throws EACCES) | `writeCredential("openai", …)` | throws; `auth.json` byte-identical to before; no new credential persisted |
| E12 | credential writes refuse to clobber | decision-table (corrupt × backup) | L1 | automated | corrupt `auth.json`; quarantine copy succeeds | `writeCredential("openai", …)` | `auth.json` contains only the `openai` credential; quarantine file holds the pre-corruption bytes |
| E13 | credential writes refuse to clobber | state-transition (dedup-hit deadlock) | L1 | automated | corrupt `auth.json` already quarantined by an earlier `readAuthJson()` in the same process | `writeCredential("openai", …)` | write **succeeds** (dedup hit counts as backed-up); does not throw |
| E14 | credential writes refuse to clobber | state-transition (healthy path) | L1 | automated | valid `auth.json` with an `anthropic` entry | `writeCredential("openai", …)` | file contains **both** entries — existing merge semantics unregressed |
| E15 | auth.json atomic write with locking (MODIFIED) | EP (mode) | L1 | automated | `auth.json` absent | any locked op runs, lock helper pre-creates the file, then a credential is saved | resulting `auth.json` mode is `0600` (not `0644`) |
| E16 | auth.json corrupt-content recovery | EP (backup mode) | L1 | automated | corrupt `auth.json` containing a credential-shaped fragment | quarantine runs | quarantine file mode is `0600` |
| E17 | auth.json corrupt-content recovery | fault-injection boundary | L1 | automated | corrupt bytes; first quarantine attempt fails, second is allowed to succeed | `readAuthJson()` twice | second call creates the quarantine file (failure not latched into the dedup set) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Credential status API (MODIFIED) | fault-injection (corrupt dependency) | L1 | automated | `auth.json` = `""` | `GET /api/provider-auth/status` via the route handler | HTTP `200`, body is an array, every row `authenticated: false` |
| X2 | auth.json corrupt-content recovery | fault-injection (I/O abort) | L1 | automated | `readFileSync` throws `EACCES` | `readAuthJson()` | throws (not swallowed); **no** quarantine file created |
| X3 | auth.json corrupt-content recovery | fault-injection (quarantine abort, read path) | L1 | automated | corrupt bytes; `copyFileSync` throws ENOSPC | `readAuthJson()` | returns `{}` without throwing (read-path copy failure is swallowed) |
| X4 | no-secret-leak (contract 3) | data-flow assertion | L1 | automated | corrupt `auth.json` whose bytes contain the literal `sk-SECRET123` | quarantine runs; capture all log output + the filename | neither the log line nor the filename contains `sk-SECRET123`; the log line does contain the quarantine path |
| X5 | Credential removal reports a refusal | fault-injection (write refusal) | L1 | automated | corrupt `auth.json` with quarantine forced to fail | `DELETE /api/provider-auth/anthropic` | response body has an `error` string naming the reason; body contains no credential material |
| X6 | Credential status API (MODIFIED) | fault-injection (corrupt dependency, live server) | L3 | automated | harness `~/.pi/agent/auth.json` overwritten with 0 bytes out-of-band | browser opens Settings → Provider Authentication | section renders provider rows (all signed-out); no ErrorBoundary fallback; `GET /api/provider-auth/status` observed `200` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Provider section degrades on failed/malformed status | state-transition (error edge) | L1 | automated | status fetch mocked → `500` with `{"statusCode":500,"error":"Internal Server Error","message":"Unexpected end of JSON input"}` | `ProviderAuthSection` renders | an inline error node is present; the component does not throw; no ErrorBoundary fallback rendered |
| F2 | Provider section degrades on failed/malformed status | EP (non-array body) | L1 | automated | status fetch mocked → `200` with `{"ids":[]}` | `ProviderAuthSection` renders | inline error rendered; no `TypeError` (proves no array method called on the body) |
| F3 | OAuth poll tolerates transient failures | BVA (N-1 = 2 failures) | L1 | automated | auth-code flow started; polls 1–2 return `500`, poll 3 returns an array with the provider `authenticated: true` | poll timer advances 3 ticks | flow completes successfully; no error message shown |
| F4 | OAuth poll tolerates transient failures | BVA (N = 3 failures) | L1 | automated | auth-code flow started; polls 1–3 all return `500` | poll timer advances 3 ticks | flow stops with an error message; polling ceases before the 5-minute timeout |
| F5 | Provider section degrades on failed/malformed status | state-transition (recovery) | L1 | automated | first status fetch `500`; user triggers a refresh; second fetch returns a normal array | refresh action | inline error is replaced by the normal provider rows |
| F6 | Settings usable while corrupt (contract 7) | state-transition (repair flow) | L3 | automated | harness `auth.json` zeroed out-of-band | open Settings, enter an API key for a provider, save | save succeeds; the row shows a masked key after the section refetches |

---

## Coverage summary

- Requirements covered: 6/6 (3 ADDED + 2 MODIFIED server, 2 ADDED ui — counted per requirement block)
- Scenarios by class: edge 17 · perf 0 · frontend 6 · error 6
- Scenarios by level: L1 26 · L2 0 · L3 3
- Scenarios by disposition: automated 29 · manual-only 0

No performance scenarios: the change adds one SHA-256 over a credential-sized
file on an already-failing path. No latency or throughput budget appears in the
spec, so no threshold exists to test — inventing one would be a fabricated slot.

No L2 (qa VM smoke) scenarios: nothing here is install-, spawn-, or
multi-OS-runtime-shaped. The one platform-specific concern (no `:` in the
quarantine filename) is asserted as a pure string property in E7 rather than by
booting a Windows VM.

## New infra needed

- none. E1–E17/X1–X5/F1–F5 extend existing vitest suites
  (`packages/server/src/__tests__/provider-auth-routes.test.ts`, a new sibling
  for `provider-auth-storage.ts`, and the existing
  `packages/client/src/__tests__/ProviderAuthSection*.test.tsx` family).
  X6/F6 extend the existing Playwright settings coverage against the docker
  harness, reading `dashboardPort` from `.pi-test-harness.json`.
