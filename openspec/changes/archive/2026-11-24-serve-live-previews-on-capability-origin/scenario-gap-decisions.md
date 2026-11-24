# Scenario-gap decisions — serve-live-previews-on-capability-origin

Summary (63 gaps from S1–S4 → 50 questions + 8 already specified):
- **SPEC-DEFECT 7** (Q1–Q7) · **SPEC-GAP 37** (Q8–Q44) · **TEST-INFRA 6** (Q45–Q50) · **already specified 8** (A1–A8, no decision).
- Most consequential 1 — **Q6**: `redactCapability` must match labels case-insensitively. As written, an attacker-cased `Origin` writes a live capability secret into the CSRF/WS gate logs.
- Most consequential 2 — **Q7**: CSP cannot express IPv6 literals. Tiers 1–4 must fall through to tier 5 for IPv6 dashboard origins (`::1` is dropped from the tier-1 set); otherwise those frames are silently blocked.
- Most consequential 3 — **Q1**: tier 1 cannot pass in the docker harness (the peer is the bridge gateway, so it gets tier 5). Run the tier-1 L3 spec on a host-run isolated server and fix D14 and task 14.2.

Approve by answering "accept all" or listing the Q numbers you overrule. Every recommendation is concrete; none is deferred.

---

## SPEC-DEFECT (artifacts contradict each other or are wrong)

**Q1 · S1-G19, S4-G1** — Where does tier 1 run end-to-end? D14 ("Tier 1 works from the Playwright browser as is") and task 14.2 (docker harness) contradict D1 (with published ports the peer is the gateway, so tier 5).
→ Run the tier-1 Playwright spec against a host-run isolated server (`HOME=<tmp>`, `restart-server.ts`, a non-8000 port). The docker-harness spec asserts that `localhost` gets tier 5.
Why: only a host-run server has a real loopback peer. · Changes: design D14 E2E; tasks 14.2 split into 14.2a (host-run tier 1) and 14.2b (harness asserts tier 5).

**Q2 · S3-G4** — Restricted tier 1–4 `frame-src`: D6 says `<entry.origin>`, while spec live-server-preview and task 5.1 say `'self'`.
→ `frame-src 'self'`; amend D6.
Why: the two are equivalent on the capability origin; the spec is authoritative, the header is shorter, and the test needs one exact string. · Changes: design D6 only.

**Q3 · S3-G11** — Task 5.1 asserts "explicit live pool origins (capped)". The baseline-csp spec, D6 and brief all say `http://<HostIP>:*`.
→ Task 5.1 asserts `http://<HostIP>:*` only when the Host is an IP and `portPool` is valid, and asserts no other IP host-source.
Why: user-confirmed decision; CSP has no port ranges. · Changes: tasks 5.1.

**Q4 · S1-G1** — The `localhost` suffix rule: D12 and task 1.4 say "is, or ends in, `localhost`"; the spec says "`localhost` or ends in `.localhost`".
→ Use a label boundary: reject when the normalised suffix `=== "localhost"` or ends with `.localhost`. `mylocalhost.dev` is accepted.
Why: only a label boundary resolves to loopback; the substring form rejects real domains. · Changes: design D12; tasks 1.4; add an accept scenario `foolocalhost.dev` to spec live-server-preview (Invalid values).

**Q5 · S1-G5, S3-G8** — The server-cors scenario "portPool includes `80`" is impossible: D5 requires ports ≥ 1024, and an invalid pool disables tier 3.
→ Rewrite with `portPool 8100-8199`: `http://[::ffff:192.168.16.242]:8101` and `http://192.168.16.242:8101` are the pool origin (no ACAO); `http://192.168.16.242` (port 80) and `https://192.168.16.242` (443) are not preview-shaped. Predicate (a) uses the *resolved* pool and the scheme-default effective port.
Why: on a raw-range reading, a disabled tier would block legitimate trusted-network origins. · Changes: specs/server-cors scenario; design D3 (a).

**Q6 · S1-G6** — The D2 redaction regex `[a-z2-7]{26}.` is lowercase, but the gate logs print the raw `Origin`. An upper-cased label leaks, which breaks the spec's "no log line carries a full `<capHost>`".
→ Make it case-insensitive and position-independent: `/\b[a-z2-7]{26}\./gi` → `<redacted>.`. Add a test using `Origin: http://K7Q4…LOCALHOST.:8000`.
Why: the label is the secret for tiers 1/2/4. · Changes: design D2 Redaction; tasks 2.4, 12.1; scenario in spec live-server-preview (observability).

**Q7 · derived from S3-G5 (new finding)** — The CSP host-source grammar has no IPv6 literal form; Chromium ignores `http://[::1]:*` as an invalid source. So `frame-ancestors <ancestors>` for a `[::1]`/IPv6 dashboard and `frame-src http://<IPv6>:*` cannot work. Today D1 allows tier 1 with Host `::1` and tier 3 with bracketed IPv6.
→ Skip tiers 1–4 when the mint's `ancestors` host or the Host is an IPv6 literal. Those fall to tier 5 (`frame-ancestors 'self'`) or legacy. The tier-1 set becomes `localhost` and `127.0.0.1`, and dashboard `frame-src` never emits IPv6 entries.
Why: otherwise every IPv6 frame is blocked silently. · Changes: design D1 table, D6; spec live-server-preview (tier 1 and tier 3 requirements); baseline-csp; tasks 5.1, 6.1.

## SPEC-GAP (the spec must state a value or behaviour)

**Q8 · S1-G16** — A live config change (suffix changed or removed, `forHosts` emptied, new overlap, `portPool` changed) while entries are live.
→ Revoke every entry whose `originHost` no longer matches its tier's current resolved config and close its pool listener. Log reason `config-changed`.
Why: dispatch and CORS are config-driven, so a stale entry can turn into a trusted origin (an old pool port becomes a trusted-network origin). · Changes: design D12, D13 (reason enum); spec live-server-preview config requirement (new scenario); tasks 1.1, 1.5.

**Q9 · S2-G4** — When a mint lands in the ≤ 20-min window and issues a new tier-5 pid, what happens to the old one?
→ The superseded pid serves until its own absolute expiry and is never returned by a mint again. The new pid comes back with the "restart with the new base" message. Reword "one pid per target" to "one *current* pid per target".
Why: the running site was started under the old base and must keep working. · Changes: design D8; spec tier-5 stability requirement; tasks 8.1.

**Q10 · S3-G13** — A preview keeps re-tossing a `pi_dash_*` cookie, so the operator is locked out (repeated 400s).
→ On any `duplicate_dashboard_cookie` response, the client blanks all open tier-2/3 live frames and shows a banner: "a preview reset dashboard cookies; reopen it to continue". It does not reopen them automatically.
Why: cheap, and it ends the loop without manual cookie surgery. · Changes: design D7, D10 (residual); spec live-server-preview (viewer); new task 10.6.

**Q11 · S1-G13** — With `enabled:false`, are wildcard/ipDns label hosts and IP+pool-port hosts still preview-shaped?
→ Yes. Every *valid configured* suffix and pool stays preview-shaped regardless of `enabled`, and `previewApp` answers 403.
Why: same principle as `.localhost`; a label host must never reach the dashboard app. · Changes: design D3; spec config scenario "Previews disabled".

**Q12 · S2-G1** — Who runs the sweep? D5 says "public `sweep()` *or* a 60 s timer".
→ A store-owned 60 s interval with `unref()`, cleared on dashboard close. `sweep` stays private. A pool port is released ≤ expiry + 60 s.
Why: it frees ports with zero traffic, and the test can control it with fake timers. · Changes: design D5 Release; spec tier-3 release; tasks 7.1.

**Q13 · S1-G10** — Fallback `ancestors` when the mint has no `Origin`: where does the scheme come from?
→ From the raw socket (`request.raw.socket.encrypted` → `https`, else `http`), never from `X-Forwarded-Proto`. An https tier 2 without `Origin` therefore falls through.
Why: `trustProxy` stays off, so this fails safe, and browsers always send `Origin` on POST. · Changes: design D2 `ancestors`; spec tier-selection requirement.

**Q14 · S1-G2** — How are `wildcard.suffix`, `ipDnsSuffix` and `forHosts` entries normalised?
→ Lowercase and strip one trailing dot. Reject (tier disabled + log naming the key) any scheme, port, path, `*.` prefix, empty label, or IP literal in a suffix.
Why: one canonical form for D1 matching and the D12 overlap check. · Changes: design D12; spec invalid-values scenarios; tasks 1.1, 1.4.

**Q15 · S1-G4** — Pool range grammar and which ports are reserved.
→ Strict `a-b`: integers, no whitespace or leading zeros, 1024 ≤ a ≤ b ≤ 65535, ≤ 100 ports. `8100-8100` is allowed; a bare `8100` is rejected. The TLS and model-proxy ports are reserved only when those listeners are configured. The log names the colliding key.
Why: the spec says "range string", and an unbound listener cannot collide. · Changes: design D5 Config; spec invalid-values; task 1.4 (add the ≥1024 rule and the model-proxy port).

**Q16 · S1-G11** — `wildcard.port` validation.
→ Integer 1–65535, elided when equal to the scheme default; anything else disables tier 2.
Why: matches D1 default-port elision, so `originHost` equals the browser's Host. · Changes: design D12; spec tier-2 requirement.

**Q17 · S1-G3** — A non-boolean `enabled` (e.g. `"false"`).
→ Treat it as `false` (legacy only) and log the key.
Why: it is the rollback switch, so a typo must land on the safe path. · Changes: design D12; spec config requirement.

**Q18 · S1-G22** — When `wildcard.suffix === ipDnsSuffix` (after Q14 normalisation), which tier is disabled?
→ Both 2 and 4, with one log line naming both keys.
Why: either label host would be ambiguous, so fail closed. · Changes: design D12; spec "Suffix overlap" scenario.

**Q19 · S1-G15** — Live-tunnel origins and TLS-listener names are not in the D12 overlap set, yet the static exemption lets them through.
→ Add them to the overlap set, re-evaluated on tunnel connect and certificate change. An overlap disables the tier and logs.
Why: closes the only remaining path for a label host to reach the dashboard app. · Changes: design D12; tasks 1.4.

**Q20 · S1-G18** — The spec's "reported … on each live reload" spams the log on unrelated config writes.
→ Log at boot, and afterwards only when the validation result or the resolved tier set changes. Amend the spec wording.
Why: keeps transitions visible without the spam. · Changes: spec Invalid-values requirement; design D12.

**Q21 · S3-G9** — Does the parent-domain warning fire when tier 2 is invalid or disabled?
→ Only when tier 2 resolves *active* (valid suffix, non-empty `forHosts`, `enabled` true).
Why: no cookie-tossing surface exists otherwise. · Changes: design D10; spec warning requirement.

**Q22 · S1-G12** — Malformed `accept` (not an array, empty, unknown or wrong-case tokens, huge array).
→ Return legacy 200. Ignore unknown tokens; matching is case-sensitive; only the first 8 entries are read.
Why: an odd client must not lose its capability (the migration promises byte-identical behaviour). · Changes: design D1 Negotiation; spec mint-response requirement.

**Q23 · S1-G14** — When does the `live-preview` row appear in `/api/host-gate`?
→ Whenever previews are enabled, even with zero live entries; it is absent when `enabled:false`. Fix the scenario's "WHEN capabilities are live".
Why: a stable shape. · Changes: spec host-admission scenario; design D3.

**Q24 · S1-G9** — No mint `reason` exists for a loopback Host with a non-local peer and no forwarding headers (Docker).
→ Add `non-local-peer` to the D13 enum. Task 6.1 already tests this case.
Why: operators need to see why Docker users land on tier 5. · Changes: design D13; spec observability; tasks 12.1.

**Q25 · S1-G20** — `refuse reason=expired` vs `unknown` once an entry is deleted.
→ Log `expired` only while the entry still exists (between expiry and sweep), otherwise `unknown`. No tombstones; the response is identical either way.
Why: avoids extra state that would itself be an oracle. · Changes: design D13.

**Q26 · S1-G21** — A same-host reverse proxy that adds no forwarding headers looks local, so it is minted tier 1 and the remote user gets a dead frame.
→ Accept it as a documented limitation: add a new risk T-entry and docs (make the proxy add `X-Forwarded-For`, or set `enabled:false`), plus a pinned-behaviour test.
Why: no server-side signal exists without trusting headers. · Changes: design Risks; tasks 13.4 (docs), 6.1 (pinned test).

**Q27 · S3-G2** — Duplicate cookie *and* a preview `Origin` on the same request: which status wins?
→ Order: host gate → duplicate-cookie gate (400, no CORS headers) → origin gates (403). State this in the spec.
Why: matches D10's placement; test that the 400 carries no ACAO. · Changes: spec cross-site-request-gate (both requirements); tasks 4.1.

**Q28 · S3-G3** — Bounds on attacker-controlled cookie names and paths.
→ The JSON `cookie` field and log echo truncate names to 128 characters. Self-heal covers prefixes of the first 16 path segments, with a hard cap of 64 `Set-Cookie` lines. The log limiter is LRU over ≤ 256 names (`MAX_LOG_HOSTS` parity).
Why: all three are unbounded today. · Changes: design D10; spec duplicate-cookie requirement.

**Q29 · S3-G6** — Tier-2 `Domain=` expiry lines when the Host is an IP literal.
→ Emit `Domain=` variants only for a hostname Host, only for ancestors with ≥ 2 labels, and only while tier 2 is active.
Why: IP literals have no parent domain. · Changes: design D10; spec duplicate-cookie requirement.

**Q30 · S3-G5** — Dashboard `frame-src` when the Host has no port.
→ Use the tier-1 rule: the Host port, else the accepting socket's port, elided when it is the scheme default. Apply it to the localhost, ipDns and wildcard entries.
Why: the frame source must equal the minted origin (D1). · Changes: spec baseline-csp (scenario); design D6.

**Q31 · S2-G5** — Raw-path refusals on `/preview/<pid>/`.
→ 404 for dot-segments; for `%2F %7E %2E %5C` (case-insensitive hex); and for raw `\` and `%00`. Forward everything else raw (`//`, `%252e`).
Why: parity with `/live/` plus the obvious traversal and NUL bytes; double encoding is inert because nothing is decoded. · Changes: design D8; spec tier-5 requirement; tasks 8.1.

**Q32 · S2-G6** — Invalid `to=` on the pool listener's `?k=` redirect.
→ When `to` fails `^/(?!/)`, contains `\` or a control character, or is longer than 2048 characters, redirect to `/`. `k` is consumed either way.
Why: harmless fallback after a valid `k`. · Changes: design D5, D7; spec tier-3 requirement.

**Q33 · S2-G7** — Adopting a reservation when the adopter is already at the 32-pid cap.
→ Adoption counts against the adopter. At the 32 or 256 cap, adoption is refused and the mint falls back to legacy; the reservation stays for its normal lifetime.
Why: matches D8 ("created or adopted", never evict). · Changes: design D8 Bounds; spec tier-5 bounds.

**Q34 · S2-G8** — Reservation lifetime when its target appears and then disappears.
→ The deadline is always measured from creation: +10 min with no target, +12 h while a target exists. On target removal it reverts to creation + 10 min (dropped at the next sweep if already past).
Why: simple, and no reservation lives forever. · Changes: design D9 Lifetime; spec reserve requirement.

**Q35 · S2-G9** — A reservation whose adoption fails the SSRF re-check.
→ Drop it immediately and log `pid dropped reason=adoption-refused`; the mint is refused as today.
Why: that port can never adopt validly. · Changes: design D9, D13; spec reserve requirement.

**Q36 · S2-G12** — A pool listener errors or closes outside the store's control.
→ Delete the entry via `onDelete` (reason `listener-error`); the next mint reallocates. No rebind.
Why: one deletion path, no zombie entry holding a listener-cap slot. · Changes: design D5 Release, D13.

**Q37 · S4-G4** — A tier-5 or legacy response that carries `origin` or `base`.
→ The client validator rejects it (fails closed), as it does a tier 1–4 `base` that is not in pid shape.
Why: D7 "exactly one of". · Changes: design D7; spec client requirement; tasks 10.1.

**Q38 · S4-G5** — Base edge cases (`/`, internal `//`, `%5C`, `%252F`, control characters, non-ASCII).
→ Use an allowlist `^/([A-Za-z0-9._~-]+/)+$` with no `.`/`..` segment and ≤ 256 characters. An explicit `/` means "no base": start at root, no probe.
Why: an allowlist subsumes the listed refusals. · Changes: spec mockup-live-component-site (Serve tool); design D11; tasks 11.1.

**Q39 · S4-G6** — With base `/api/`, is an app request to `/api/roles` a dev path, a fixture hit, or an app route?
→ The base is stripped only to test DEV_PATHS passthrough. Fixture matching sees the raw path. The missing-fixture report strips the base only from paths under it.
Why: the spec says DEV_PATHS match after stripping and fixtures still intercept app routes. · Changes: design D11 #5; spec mockup-site-environment.

**Q40 · S4-G8** — The site fails to start after a host-answered base was reserved.
→ Check the port is free *before* emitting the probe. On any later failure (spawn error, crash, READY timeout), abort `signal` so the host releases the reservation (`preview_path_release` / `DELETE`).
Why: no orphan pid. · Changes: design D9, D11; spec Serve tool; tasks 9.4, 11.3.

**Q41 · S4-G14** — Two listeners answer `mock-site:base-reservation`.
→ The first listener to set `pending` wins; later listeners must not overwrite it (`pending === undefined` check). A losing listener that already reserved releases its own reservation.
Why: deterministic. · Changes: design D9 seam; spec Serve tool; tasks 9.4.

**Q42 · S4-G12** — Validator rejection and mint timeout on the client.
→ A rejection is terminal: the viewer shows "preview response rejected" with a manual Retry, and there is no auto-retry. The mint timeout stays as today (out of scope).
Why: a hostile or misconfigured server won't correct itself. · Changes: design D7; spec client requirement; tasks 10.1.

**Q43 · S4-G10** — Viewer state after the navigation guard blanks the frame.
→ The blocked notice stays until Reload, which re-frames the capability and clears the notice. The guard fires again on a repeat. No auto re-mint.
Why: the user can recover. · Changes: design D6(b), D7; tasks 10.1.

**Q44 · S4-G9** — Copy fails, or there is no `navigator.clipboard` (plain-http tier 5).
→ Announce "Copy failed — select the path" via `aria-live="polite"` and keep the path as selectable text. No `execCommand` fallback.
Why: accessible, with no deprecated API. · Changes: design D7 hint; tasks 10.4.

## TEST-INFRA (how/where to test; no spec change)

**Q45 · S3-G12** — L3 for the tier-3/4 cookie-toss rows needs a non-loopback IP.
→ Cover the server logic at L1 (injected Host + real pool listener, task 14.5). Mark S3-F1/F2 manual-only on a LAN until the harness gains an alias IP.
Why: the harness binds loopback (D14). · Changes: test-plan only.

**Q46 · S4-G2** — Where the mock site runs for the L3 acceptance.
→ Tier 1: on the host, next to the host-run server (Q1). Tier 5: inside the container via `docker exec … serve-cli.mjs --base <path>`, with the path from `POST /api/live-server/preview-path`. The agent probe path is covered at L1 (tasks 9.4, 11.1).
Why: the proxy only reaches loopback in the dashboard's own namespace. · Changes: test-plan; tasks 14.2b, 14.4 text.

**Q47 · S4-G3** — How Firefox reaches tier 5.
→ Run the Firefox project against the docker harness at `localhost`: the peer is the gateway, so the dashboard picks tier 5 automatically. No resolver prefs.
Why: needs no extra mechanism. · Changes: test-plan; tasks 14.4.

**Q48 · S1-G17, S2-G10, S3-G10, S4-G7** — No performance thresholds exist.
→ Assert invariants and same-run ratios only: fd/listener counts back to baseline, 0 leaked sockets; dispatch/lookup p95 ≤ 1.2× the no-preview baseline; log limiter ≤ 1 line/host/60 s and ≤ 256 hosts (host-gate constants); base start ≤ 1.2× no-base start; heap/RSS trend-only in the soak.
Why: absolute numbers would be flaky across machines. · Changes: test-plan only.

**Q49 · S2-G2, S4-G13** — Timing edges.
→ 2 s probe: with fake timers, an answer at 1 999 ms is used; at 2 001 ms the site starts at root and `signal` is aborted. The exact 2 000 ms edge is not pinned. HMR reconnect: assert convergence within the ≥ 60 s Playwright timeout (D14), with no tighter bound.
Why: deterministic, machine-independent. · Changes: test-plan only.

**Q50 · S3-G14** — Does a bare expiry line delete a `Secure` cookie on an https dashboard?
→ Add an https L1 jar-oracle case in `device-cookie-secure.test.ts`. Mirror `Secure` on expiry lines only if that case fails.
Why: verify before changing the specified bare form. · Changes: test-plan; tasks 4.1.

---

## Already specified (no decision)

| id | Where the artifacts answer it |
|---|---|
| A1 · S1-G7 | D1 names `isGenuinelyLocal` (core list, `localhost-guard.ts:28-34`); D2/D3 admission uses the same function, so mint and admission cannot disagree. |
| A2 · S1-G8 | D1 (`net.isIP`/`URL` round-trip) + D3 normalisation (mapped IPv6 compared as IPv4, one shared helper); the tier-1 set is exact, so `127.0.0.2` falls through. (Q7 further narrows the set.) |
| A3 · S2-G3 | D8 D-U7 exception: revoking any holder drops the pid for all; mint holders leave only by revocation, expiry or target removal. |
| A4 · S2-G11 | D14 + task 14.5 (tiers 3/4 at L1 with an injected Host); D5 Docker: without the mapping, operators leave tier 3 off; no self-test. |
| A5 · S2-G13 | D3 Forwarding reuses `forwardPort`/`forwardStatic`, so existing timeouts are inherited (WS connect 10 s, `live-server-proxy.ts:410`). Test asserts parity. |
| A6 · S3-G1 | D10 "prefix `pi_dash_`" = literal, case-sensitive `startsWith` (same as `live-server-proxy.ts:25`); a bare `pi_dash_` matches. |
| A7 · S3-G7 | D2 re-mint reuse key includes `ancestors`, so a mint from a second dashboard origin gets a new entry (binding to the first origin is kept). |
| A8 · S4-G11 | D2 "touch … unchanged": visibility/touch cadence is existing viewer behaviour, out of scope here. |
