# Test Plan — triage-codeql-alert-debt

Stage: design   Generated: 2026-10-22

Levels: `L1` = vitest. Locations: `packages/*/src/**/__tests__/*.test.ts` and `scripts/__tests__/codeql-local*.test.mjs` (fake `CODEQL_BIN` via `scripts/__tests__/fixtures/fake-codeql.mjs`).

Gate decisions (2026-10-22, operator):
- #216 uses the worker-thread bound (design D3, option B).
- A fallback timeout answers HTTP 504 `{ success: false, error: "search timed out" }`.

The GitHub dismissal/mirror procedure (D5), the local-only review (D2), the execution-time re-measure, the prune/diff check (D6), and the goal checks G1–G3 are **procedural gates owned by `tasks.md`**, not durable tests. They act on live GitHub state and a real CodeQL run, so they are not manifest rows. The exception is the three post-merge checks, X6–X8 below, which `ship-change` defers as `manual-only`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | codeql-local-ratchet: Local analysis runs on a content-addressed snapshot ("Analysis options") | regression (flipped assertion) | L1 | automated | fake `CODEQL_BIN` recording argv | `node scripts/codeql-local.mjs --json` | each `database analyze` argv has the pinned suite, **no** argument starting with `--threat-model`, and no `--download` |
| E2 | design D3 #169 (MermaidBlock entity decode) | EP (each entity + double-encoded) | L1 | automated | code-block strings `--&gt;`, `a &lt; b`, `&amp;quot;x&amp;quot;`, `&amp;#39;`, `&amp;amp;` | decode helper used by `MermaidBlock` | `-->`, `a < b`, `&quot;x&quot;`, `&#39;`, `&amp;` (each entity decoded exactly once) |
| E3 | design D3 #30 (`findPortHolders` guard) | BVA | L1 | automated | ports `0`, `1`, `65535`, `65536`, `1.5`, `NaN`, `"80; rm -rf /"` (cast) on a non-win32 platform with a recording `exec` | `findPortHolders(port, { platform: "darwin", exec })` | `1` and `65535`: `exec` called once with `lsof -t -i :<port> -sTCP:LISTEN 2>/dev/null`. All others: returns `[]` and `exec` is never called |
| E4 | design D3 #345 (fake issuer redirect allowlist) | EP + BVA (origin / path boundary) | L1 | automated | issuer started with `redirectUriPrefixes: ["http://127.0.0.1:5000/cb"]` | authorize request with `redirect_uri` = each of `http://127.0.0.1:5000/cb`, `http://127.0.0.1:5000/cb/x`, `http://127.0.0.1:50000/cb`, `http://127.0.0.1:5000/cbx`, `http://u@127.0.0.1:5000/cb`, `https://127.0.0.1:5000/cb` | first two are accepted (302 to that target). The other four get 400 `{"error":"redirect target not registered"}` and no `location` header |
| E5 | design D3 #28/#29 (i18n scripts without a shell) | contract (source shape) | L1 | automated | sources of `scripts/i18n-parity.mjs` and `scripts/i18n-migrate-auto-keys.mjs` | contract test reads both files | neither calls `execSync`; each file-listing call is `execFileSync` with an argv array |
| E6 | design D3 #28/#29 (behaviour kept) | regression (equivalence) | L1 | automated | the repo tree | run `node scripts/i18n-parity.mjs` before and after the change | same exit code and the same plugin-catalog list in stdout |
| E7 | design D3 #152/#153 (pins the false-positive basis) | EP (invalid enum) | L1 | automated | toggle request with `type` = `"__proto__"`, `"constructor"` | `applyResourceToggle` | first two: `{ ok: false, status: 400 }` with `error` "type must be extension\|skill\|prompt\|theme", and `Object.prototype` gains no own key |
| E8 | design D3 #374 (pins the false-positive basis) | EP | L1 | automated | server stub returning local-proof `code` = `"a b;rm"`, `"x"` (too short), and a valid 43-char base64url | `pi-dashboard open` command function with a recording `open` | invalid codes: exit 1, `open` never called. Valid: `open` called once with `http://localhost:<port>/auth/local-proof?code=<code>` |
| E9 | editor-file-search: content-search endpoint (fallback keeps regex semantics) | regression | L1 | automated | file containing `foo123` and `fooBar`; no `rg` | `runGrep(cwd, "foo\\d+", { regex: true, rgPath: null })` | exactly one match, the `foo123` line (regex honoured in the worker) |
| E10 | editor-file-search (invalid pattern keeps the literal degrade) | EP | L1 | automated | file containing the literal text `a(b`; no `rg` | `runGrep(cwd, "a(b", { regex: true, rgPath: null })` | one match on that line |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | editor-file-search: pathological regex in the fallback cannot stall the server | timed invariant | L1 | automated | file with one line of 40 `a` followed by `!`; query `(a+)+$`, `regex=true`, no `rg`; scan timeout injected as 500 ms | 10 ms `setInterval` probe on the main thread: the largest gap between ticks < 200 ms while the scan runs, **and** the scan rejects/timeouts within 500 ms + 1 s | one scan |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | editor-file-search: timed-out fallback answers 504 | fault (timeout) | L1 | automated | route with `detectRipgrep` → null and scan timeout injected as 300 ms; query `(a+)+$` over the P1 file | `GET /api/grep?cwd=<known>&q=(a%2B)%2B%24&regex=true` | HTTP 504, body `{ "success": false, "error": "search timed out" }`. A second request issued meanwhile answers normally |
| X2 | editor-file-search: `rg` rejects the pattern → bounded fallback | fault (abort) | L1 | automated | fake `rgPath` binary that exits 2 (pattern error); same pathological query; timeout 300 ms | `runGrep(cwd, q, { regex: true, rgPath: <fake> })` | rejects with the timeout error within 300 ms + 1 s; the main-thread tick gap stays < 200 ms |
| X3 | editor-file-search: worker crash | fault (abort) | L1 | automated | worker entry that throws on start (injected) | `runGrep` with no `rg` | rejects (no unhandled rejection, no hang); the route maps it to a non-success reply, never 200 with stale matches |
| X4 | design D3 #19 (probe never follows redirects) | fault (redirect) | L1 | automated | local HTTP server A answering `302 Location: http://127.0.0.1:<B>/models`; server B recording requests | `probeProvider({ baseUrl: A, apiKey: "SECRET", api: "anthropic-messages" })`, and the same through `listProviderModels` | B receives **zero** requests (so no `x-api-key: SECRET` reaches it); the probe result is `ok: false` with an error naming the redirect |
| X5 | design D3 #19 (non-redirect behaviour kept) | regression | L1 | automated | server A answering 200 with a models list | `probeProvider` | `ok: true` with the listed models (existing `provider-probe.test.ts` cases pass unchanged) |
| X6 | design D5/G3: post-merge mirror | procedural, live GitHub | — | manual-only | entries listed in `evidence/residue.md` as refused (flag-on lines/count), plus entries reasoned in the branch after a fix (D3 "fix, then …" rows whose line is still reported, and exec-wrapper keys reasoned after caller fixes) | after the merge commit's analysis completes: dismiss, then `--mirror-dismissal` at that SHA | every listed entry is `github-dismissed (…)`, or the residue list records why it can't be (the alert closed as fixed) |
| X7 | design D6/G3: fixed alerts close on GitHub | procedural, live GitHub | — | manual-only | the merge commit analysed on `develop` | `gh api …/code-scanning/alerts?ref=refs/heads/develop&state=open` | no open alert matches a D3 **fix** row (#169, #30, #345, #167, #28, #29, #19, #216, and any exec-wrapper caller fixes) unless it was re-reasoned and dismissed; no open alert matches a triaged baseline entry |
| X8 | design G1: local == CI parity | procedural, live GitHub | — | manual-only | the merge commit `M` on `develop`, its `javascript-typescript` analysis done, same `javascript-all` version as the local pack | local analysis on a clean checkout of `M` compared with the GitHub SARIF/alerts at `M` by (rule, file, start line) | zero local-only and zero CI-only results; the numbers go into `docs/code-quality.md` "Known limitation" as the parity record |

---

## Coverage summary

- Requirements covered: 2/2 spec requirements (E1; E9, E10, P1, X1–X3) plus all D3 fix and false-positive pin rows.
- Scenarios by class: edge 10 · perf 1 · frontend 0 · error 7.
- Scenarios by level: L1 16 · L2 0 · L3 0 · — 3.
- Scenarios by disposition: automated 16 · manual-only 3.

## New infra needed

- none. P1, X1 and X2 need an injectable scan timeout and an injectable worker entry on the fallback; both are implementation seams, not new harnesses.
