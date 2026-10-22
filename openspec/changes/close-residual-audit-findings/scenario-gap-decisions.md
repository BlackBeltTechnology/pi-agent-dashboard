# Scenario-design gap decisions — close-residual-audit-findings

Hard-gate answers for the spec gaps scenario-design surfaced (stage: design).
Each line: gap → chosen answer (letter refers to the candidate list in the
drafting output). Principle: fail closed, match existing behaviour, prefer the
simpler mechanism. Answers that change a spec are applied to the deltas before
the test plan is folded.

## Auth (B17, B16r, B18, B4r)

- A-G1 secret-length warning frequency → once per process lifetime.
- A-G2 whitespace-only secret → kept + warned (no forced logout).
- A-G3 audit value sanitization → chars outside `[\w.:-]` replaced with `_`; 8-char id prefix taken after sanitizing.
- A-G4 refused rotations → audited: `[pairing] rotate_refused id=<8> reason=<code> ip=<ip>` (theft signal). Unknown-id revoke not audited.
- A-G5 audit write failure → fail-open (mutation completes).
- A-G6 boundary equality → expired/invalid at `now >= limit` (TTL, 30 d ceiling, grace).
- A-G7 A→B→C chain → only the immediately previous bearer has a grace; A invalid at the second rotation.
- A-G8 superseded bearer after grace → plain 401 (no code) on every route incl. rotate.
- A-G9 rotate limiter → 10/min per device, sliding 60 s window, 429 + `Retry-After`.
- A-G10 registry persist failure on rotate → 500 `rotation_failed`, no state change, old bearer valid.
- A-G11 non-conforming holder declaration → treated as no declaration (only exact `holder:"browser"` counts).
- A-G12 expired bearer from a locally/network-trusted peer → a presented bearer is always judged: 401 `bearer_expired`.
- A-G13 malformed `expiresAt`/`pairedAt` → fail closed: row treated as expired.
- A-G14 grace vs own expiry → old bearer valid until `min(rotation + 60 s, own expiresAt)`.
- A-G15 25 % threshold base → issue→`expiresAt` of the current bearer (respects the 30 d cap).
- A-G16 first `expiresAt` → pairing redeem/poll response gains `expiresAt`; slot stores `{token, expiresAt}`.
- A-G17 rotation retry → on the next REST call, at most once per minute.
- A-G18 re-pair on `bearer_expired` → navigate once to the pairing landing page; deduplicated across concurrent 401s.
- A-G19 Electron/CLI detection → keyring path is a separate module that never calls the browser-slot code (verified at implementation).
- A-G20 `localStorage.setItem` throws after rotation → keep the new bearer in memory for the page session + one warning notice.
- A-G21 LAN carve-out with forwarding headers → carve-out skipped (current code); spec wording adds "with no forwarding headers".
- A-G22 verify-path performance → no per-verify latency row; invariant: no extra synchronous file read/write on the hot path.

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

## Server (B20, B1r, R1, S1r, B15r)

- S-G1 control characters → C0 `0x00–0x1F` + DEL `0x7F`.
- S-G2 masked form → keep the prefix + `***` (e.g. `ghp_***`).
- S-G3 token bounds → prefix + ≥ 20 chars of `[A-Za-z0-9_-]` with a non-word boundary before the prefix.
- S-G4 repo root itself → `.`; `ssh://user:pass@` → password removed, user kept; scp form unchanged.
- S-G5 ref/path validation scope → every caller-supplied git ref or path, incl. orphan-cleanup, PR-worktree and worktree-remove paths.
- S-G6 redaction perf → p99 < 10 ms for 100 KB input, linear scaling asserted at 1 MB.
- S-G7 terminal precedence → admission first; cap re-checked after admit (`terminal_error` wins for a refused cwd).
- S-G8 non-string/empty/relative standalone cwd → `terminal_error{code:"cwd_not_admitted"}`.
- S-G9 inline session with no recorded cwd → `cwd_not_admitted`.
- S-G10 unexpected admission/spawn throw → `terminal_error{code:"cwd_admission_unavailable"}`.
- S-G11 requester disconnects during admission → spawn suppressed.
- S-G12 notice stacking → newer terminal notice replaces the older one.
- S-G13 refused flow id → 400 `invalid_flow_id`.
- S-G14 non-string cwd on plugin routes → 400 `invalid_cwd`.
- S-G15 folder-scope contributions lifetime → read per request (disabled contributor stops being admitted immediately).
- S-G16 MCP tools requiring cwd → only folder-specific tools (create, update, delete, definition, runs, result).
- S-G17 automation allowlist breadth → provider's whole manifest `emits` (as designed; no runtime channel).
- S-G18 provider unloaded → its types leave the allowlist (computed live).
- S-G19 refused spoof `provide` → returns silently after logging.
- S-G20 `<source>` parsing → first segment after `automation.action.`; empty source → refused as malformed.
- S-G21 reserved-prefix emit → same once-per-(plugin, type) warning, naming the reserved prefix.
- S-G22 manifest `emits` limits → reject whitespace-bearing, empty, case-insensitive reserved-prefix entries; ≤ 64 entries, ≤ 128 chars each.
- S-G23 warning dedupe → capped at 1 000 (plugin, type) pairs, then one summary warning.
- S-G24 post-start plugin registration failure → logged and the plugin marked failed (server keeps running).

## Bridge / media / electron (B21, B22, R4, B23, B24)

- B-G1 overlapping pauses → deadline = max(existing, new) (never shortens).
- B-G2 invalid limit env values → fall back to the default + log once.
- B-G3 `PI_DASHBOARD_BRIDGE_PROMPT_RATE` format → `"<burst>/<refillPerSec>"`, e.g. `30/10`.
- B-G4 bucket across reconnects → kept per bridge process (reconnect does not refill).
- B-G5 counter-proof refusal causes → `server_proof_missing` (no proof) and `server_proof_invalid` (bad MAC/timeout).
- B-G6 pinned `host:port` normalization → the R2 canonical-origin helper (lowercase, default port, trailing dot, IPv6 brackets).
- B-G7 `maxAudioMb` → 1 MB = 1024² bytes; invalid values fall back to 200 + warn; error shows sizes with one decimal.
- B-G8 normal-use thresholds → assert zero refusals for the replayed peak workload and defaults ≥ 3× peak; numbers filled from task 13.1.
- B-G9 limiter overhead → p99 added < 1 ms per command.
- B-G10 doctor navigation → block any navigation whose URL differs from the doctor page's file URL (reload/hash allowed).
- B-G11 unparseable remote with userinfo → send no origin and build no links.
- B-G12 npx JS entry → `<dirname(execPath)>/node_modules/npm/bin/npx-cli.js`, then `<dirname(execPath)>/../lib/node_modules/npm/bin/npx-cli.js`; else refuse.
