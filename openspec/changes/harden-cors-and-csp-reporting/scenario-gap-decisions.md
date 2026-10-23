# Scenario-design gap decisions — harden-cors-and-csp-reporting

Hard-gate answers for the spec gaps scenario-design surfaced (stage: design).
Each line: gap → chosen answer (letter refers to the candidate list in the
drafting output). Principle: fail closed, match existing behaviour, prefer the
simpler mechanism. Answers that change a spec are applied to the deltas before
the test plan is folded.

## Web / CSP (B19, R2, S3b, B26r)

- W-G1 TT topology when TT mode = CSP mode → `report`: TT directive appended to the baseline Report-Only header; `enforce`: appended to the strict enforcing header. Mismatched modes keep the existing TT-only header.
- W-G2 Vite dev × `enforce` → baseline policy emitted enforcing with the legacy dev `script-src`.
- W-G3 Vite dev × TT → no report destination on any header in dev (dev never feeds a counter).
- W-G4 dev detection → per response: only responses actually proxied to Vite are "dev".
- W-G5 non-HTML responses → strict header present without a nonce (nonce only on HTML documents).
- W-G6 limiter → token bucket, capacity 20, refill 1 token/s (= 60/min), per socket peer.
- W-G7 understated Content-Length → L1 `inject`-only scenario (sink returns 413).
- W-G8 malformed/empty/non-report/gzip body → 400, not counted (compressed bodies refused).
- W-G9 Reporting API batch → each array element counted; the limiter charges one token per POST.
- W-G10 directive key → `effective-directive`/`effectiveDirective`, falling back to the first token of `violated-directive`; lowercased.
- W-G11 precedence → 404 (label) → 429 (limiter; every request reaching it consumes a token) → 415 → 413.
- W-G12 non-POST methods → 405 with `Allow: POST`.
- W-G13 slow body → sink read deadline 5 s → 408, counted as dropped.
- W-G14 counter failures → write failure: 204, keep counting in memory, one warning; corrupt file at boot: start at zero with new `since`, move to `csp-reports.json.corrupt`; read failure during health: `cspReports` omitted.
- W-G15 flush → ≤ 5 s debounce + flush on graceful shutdown.
- W-G16 reset response → `200 {"success":true,"since":"<ISO-8601>"}`; all timestamps ISO-8601.
- W-G17 `cspReports` shape → `{ since, dropped, counts: { <policy>: { <directive>: n } } }`; no URLs or report content.
- W-G18 limiter state → per-peer entries evicted once their bucket is full and idle (map returns to 0 after idle).
- W-G19 perf budget → p99 added latency to `GET /` < 1 ms for nonce + header.
- W-G20 passkey browser check → L1 only (no virtual-authenticator L3).
- W-G21 opt-in wildcard × canonical form → canonicalised (trailing dot / case / :443 allowed like dotless).
- W-G22 `cors.allowZrokWildcard` reload → same reload semantics as `cors.allowedOrigins` (test asserts parity).
- W-G23 audit source → `pnpm audit --json` snapshot committed beside the triage; checker diffs the snapshot (task 19.3 wording fixed npm→pnpm); stale triage rows warn.
- W-G24 classification → completeness + `reachable` rows must name an owning change id (e.g. `bump-runtime-security-advisories`).

