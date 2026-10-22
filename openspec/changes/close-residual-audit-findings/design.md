# Design — close-residual-audit-findings

## Context

See proposal.md (Why / What Changes). This doc fixes the *how* for the 19 residual `security-boundary-audit` items owned here. All items stay in one change, which ships and archives **once** (see Landing). B14r (the `requireLocalProof` default) is **not** here: it moved to `close-container-loopback-impersonation` (D4). For S3b this change ships the report sink, the counter and the strict policy, but the CSP default stays `report`. The flip to `enforce` moves to the follow-up change `enforce-strict-csp-default`.

Constraints that shape the approach:

- **No server logger.** Fastify runs `logger: false` (`packages/server/src/server.ts:1905-1906`), so `request.log.*` is a no-op (`routes/provider-auth-routes.ts:306,340`). Audit lines use `console.*`, as pairing does (`pairing/pairing.ts:542,581,586,604`).
- **`trustProxy` stays off.** This is deliberate (`auth/auth-plugin.ts:319-324`): `request.ip` is the socket peer, so tunnel traffic appears as `127.0.0.1`.
- **Plugin cwd admission already exists.** Its primitives are `host.knownFolderCwds` (`server.ts:1595`), `host.cwdAdmissionOnIndeterminate` (`server.ts:1601`) and `admitCwd` (`packages/shared/src/cwd-guard.ts:405`). Precedents: `mcp-client-plugin/src/server/routes.ts:152`, `goal-plugin/src/server/index.ts:224`.
- **No baseline CSP report sink exists.** `buildCsp()` emits no `report-uri`/`report-to` (`auth/csp.ts:46-60`). The only sink is the live-preview one, mounted per preview at `/live/<id>/__pi/csp-report` (`live-server/live-csp.ts:41,72`; `live-csp-report.ts:49`).
- **Trusted Types already shipped.** Archived `harden-client-sinks` (commit `433993088`) added `PI_DASHBOARD_TRUSTED_TYPES` (`auth/csp.ts:22-28,70-73`, resolved at `server.ts:2254-2255`) and the baseline requirements "Independent Trusted Types mode" and "Trusted Types directive emission". Its in-memory client counters live at `/api/csp-violations` (`packages/shared/src/route-tiers.ts:121,316`); this change does not touch them.
- **Shared spec text.** Several requirements this change MODIFIES are also MODIFIED by other active changes. Every MODIFIED block is written on **baseline** text (`openspec/specs/**`); rebase rules are in Sequencing. Spec deltas describe what this change ships (CSP default `report`). Requirement wording lives in `specs/` and is referenced here, not restated.

## Landing

```mermaid
flowchart LR
  CCLI["close-container-loopback-impersonation<br/>archived (owns B14r)"] -->|blocked_by| THIS
  RBT["fix-remote-bridge-ticket-origin"] -->|blocked_by| THIS
  THIS["close-residual-audit-findings<br/>one ship-it pass → merge → archive<br/>CSP default stays report"]
  THIS -->|"archive unblocks"| TT["add-trusted-types-report-only"]
  THIS -->|"archive unblocks"| FU["enforce-strict-csp-default"]
  FU --> SOAK["soak on released builds"]
  SOAK -->|"violation: fix source, reset counter"| SOAK
  SOAK -->|exit met| FLIP["default report → enforce"]
```

- **One landing.** ship-it runs every item in one pass, merges, then archives. No stage gate; the spec deltas match the shipped code.
- **S3b here:** the baseline sink, a persisted counter with a reset action and a `dropped` count, the strict nonce policy as a **second** Report-Only header in `report` mode, `enforce` = strict policy enforced (opt-in, `PI_DASHBOARD_CSP=enforce`), passkey scripts as static assets, the import-map nonce, and the soak instrumentation (D8–D10).
- **B14r** does not ship here (D4). `dependencies.yaml`: `blocked_by` `close-container-loopback-impersonation` (shared capabilities, rebase) and `fix-remote-bridge-ticket-origin` (R4).
- **Handoff to `enforce-strict-csp-default`** (`blocked_by` this change). It owns the soak gate, the default flip (`resolveCspMode`, `auth/csp.ts:62-65`), its release note, and the MODIFIED "Staged CSP mode resolution" delta. This change leaves that requirement unmodified. Soak exit (recorded there; all must hold):
  - zero `strict` `script-src*` violations on the persisted counter over ≥14 consecutive days;
  - zero `dropped` reports in the same window;
  - the window spans ≥1 release, on released builds;
  - Playwright E2E green against the docker harness with `PI_DASHBOARD_CSP=enforce`.
  - Trusted Types reports (`trusted-types` policy label, D8) never count toward this exit.

## Goals / Non-Goals

**Goals**
- Close each finding with a test-backed change, or a "no gap" record with evidence (B23 `render.ts`).
- Bound every new attack surface: the bearer rotation endpoint and the CSP report sink.
- Give every default flip a config rollback that needs no code revert.
- Sequence against overlapping changes so that no MODIFIED requirement gets clobbered.

**Non-Goals**
- Dependency bumps. Fastify GHSA-p68q-wchp-6fh7 and the other runtime bumps move to `bump-runtime-security-advisories`. This change only records triage (D11).
- `style-src 'unsafe-inline'`, which mermaid SVG needs. S3b tightens `script-src` only.
- Trusted Types itself. It already shipped (Context); this change only points its existing header at the sink (label `trusted-types`, D8/D10) and preserves every TT carve-out of the baseline text. `add-trusted-types-report-only` becomes `blocked_by` this change; its premise is partly stale (Sequencing).
- The `requireLocalProof` default (B14r). Owned by `close-container-loopback-impersonation` (D4).
- The CSP default flip and its soak gate. Both belong to `enforce-strict-csp-default` (Landing).
- Pattern redaction of bash output. R5 is docs-only (D20).
- Navigate-to-origin or same-origin proxying for the cross-origin ServerSelector. The user rejected it for B4r.
- Rotating existing `auth.secret` values (D1).

## Decisions

### Auth

**D1 · B17 — pin HS256, mint 32-byte secrets, keep every existing secret.** *(user-confirmed)*
- `verifyToken` gains `{ algorithms: ["HS256"] }`. Today it calls `jwt.verify` with no options (`auth/auth.ts:181`). `signToken` already signs HS256 (`auth.ts:165-177`), so live tokens keep verifying.
- `ensureAuthSecret` mints `randomBytes(32)`, i.e. 64 hex chars. Today it mints 16 bytes (`auth.ts:142`).
- Any existing non-empty `auth.secret` is kept unchanged: no forced logout. This includes operator-set values (`packages/server/src/config-api.ts:270-273`).
- A secret shorter than 32 characters logs one startup warning recommending rotation, never printing the secret.

*Rationale:* a 128-bit HMAC key is beyond brute force; an auto-minted 32-hex secret cannot be told apart from a hand-set one; rotation would kill every `pi_dash_token` (7 d, `auth.ts:162`) and every in-flight OAuth state.

MODIFIES oauth-authentication "Auth secret management".

*Alternatives:* rotate on upgrade (one-time logout, false positive on hand-set secrets); an opt-in rotate action (deferred, no demand).

**D2 · B18 — pairing-style audit lines with socket IP where a request exists.**
- Format: `[<area>] <verb> k=v…`, the same as the existing `[pairing]` lines.
- New lines add `actor=` (`session:<sub8>` | `device:<id8>` | `local` | `system`) and `ip=<request.ip>`.
- Values are sanitized (other characters → `_`, id prefix taken after sanitizing) to prevent log injection. A refused rotation of a known device logs `[pairing] rotate_refused id= reason= ip=`; unknown-id revoke is not audited; an audit write failure never fails the mutation. Lines never carry a secret, token, hash, key or flow input value.
- The existing pairing decision lines (`pairing.ts:332,423,460,542,581,586,604`) keep their format. They run in the pairing state machine, which has no request, so they gain no IP.

| Event | Site | Line |
|---|---|---|
| device revoke | `DELETE /api/paired-devices/:id` (`routes/pairing-routes.ts:519`) | `[pairing] revoked id= actor= ip=` |
| direct device mint | `POST /api/paired-devices` (`pairing-routes.ts:535`) | `[pairing] minted id= tier= actor= ip=` |
| browser bearer rotate (D5) | new rotate route | `[pairing] rotated id= ip=` |
| provider API key | `PUT /api/provider-auth/api-key` (`provider-auth-routes.ts:282`) | `[provider-auth] key_set provider= actor= ip=` |
| provider remove | `DELETE /api/provider-auth/:provider` (`:318`) | `[provider-auth] removed provider= actor= ip=` |
| provider OAuth start | `POST /api/provider-auth/start` (`:206-240`) | `[provider-auth] oauth_start provider= actor= ip=` |
| OAuth flow input | `POST /api/provider-auth/flow/:flowId/input` (`:255`; answers the flow's pending prompt, value may be an auth code) | `[provider-auth] flow_input flow=<id8> actor= ip=` (value never logged) |
| Radius MCP config | `POST /api/provider-auth/radius/mcp` (`:160`; writes a global MCP server entry via `auth/radius-mcp.ts` `configureRadiusMcp`) | `[provider-auth] radius_mcp written= actor= ip=` |
| system writers | `auth/pi-legacy-credentials.ts:277`, `auth/dashboard-credential-store.ts:237,298` | `… actor=system` |

- Logging happens at the route layer, where the IP is known. The storage layer logs system actors only.
- OAuth completion is async; only `/start` and `/flow/:id/input` have a request.
- Forwarded headers are never logged as the IP. Docs state that tunnel traffic logs as `127.0.0.1`.

*Alternatives:* a JSON audit file (new persistence and rotation, overkill); enabling the Fastify logger (global behaviour change).

**D3 · B16r — `Secure` from a per-request secure-origin predicate; never `trustProxy`.**

`isSecureOrigin(request)` returns true if any of these holds:
- the socket uses TLS;
- the resolved base is https (`resolveRedirectBase`, `auth/auth.ts:380-395`);
- the **socket peer is a loopback address** **and** the request `Host` equals — host **and** port, compared with the R2 `canonicalOrigin` helper (D7) — an **https** entry of `liveTunnelOrigins()` (`tunnel/tunnel.ts:473`). http tunnel origins never qualify.

The branch keys on the socket peer, not on "genuinely local". Header-injecting tunnels (zrok, cloudflared) add forwarding headers yet still arrive from a loopback socket, and "genuinely local" excludes forwarded requests.

Where it is used:
- the OAuth state cookie (`auth-plugin.ts:309-315`) and `pi_dash_token` (`:328-334`). Their setters `issueState` (`:306`) and `setSessionCookie` (`:326`) take only `reply` today; both gain the `request`;
- the device cookie `pi_dash_device`: the global branch of `deviceCookieSecure` (`auth/bearer-auth.ts:54-62`, set at `:124-130`), which already receives the request and passes it on. The direct plain-http LAN carve-out stays, and applies only to a request carrying no forwarding header; with one, the carve-out is skipped and the normal rule decides.
- `pi_dash_local` is unchanged (`routes/local-proof-routes.ts:44-49`). It is a loopback-only bootstrap.

*Rationale:* with no `redirectBaseUrl`, an https tunnel already yields `Secure`. The residual gap is an `http:` override, or a tunnel URL that is not yet known. A forged `Host` can only make the cookie *stricter*.

MODIFIES oauth-authentication "Session cookie `Secure` flag derives from the resolved base" and fixes the stale "(when not localhost)" wording in "JWT session token". MODIFIES bearer-device-auth "Device cookie survives a plain-http LAN exchange" (the requirement that specifies the device cookie's `Secure` rule).

*Alternatives:* `trustProxy` / `X-Forwarded-Proto` (forbidden); global `Secure` (breaks plain-http LAN logins).

**D4 · B14r — moved.** *(user-confirmed)* Owned by `close-container-loopback-impersonation`, which flips the `requireLocalProof` default against a demonstrated container exploit. This change carries no B14r delta, task or rollback.

**D5 · B4r — short-lived, rotated browser bearer.** *(approach user-confirmed; parameters final)*

Scope: only browsers whose API base is cross-origin, via `LAST_SERVER_KEY` or `VITE_API_URL` (`client/src/App.tsx:503-507`, `lib/api/server-switch.ts:23-34`).
- The client declares `holder:"browser"` at pairing or rotation only when it keeps the bearer in browser storage, i.e. `isSameOriginApi()` is false (`client/src/lib/pairing/device-auth.ts:52-58`).
- Electron (keyring, `docs/electron-server-windows.md:7,67`), the CLI and manual MCP tokens omit it and keep non-expiring rows.
- Same-origin browsers keep the bearer only until the cookie is proven (bearer-device-auth "Browser keeps its bearer until the cookie is proven", baseline :386-393). The keep-failed path (`finishDevicePairing`, `client/src/lib/pairing/device-auth.ts:116`) wrote the legacy global slot (`BEARER_KEY`, `device-auth.ts:30`); it now writes the **per-origin** slot, so the requirement still holds with a changed storage key. It is MODIFIED (storage key only, baseline text); a same-origin browser that proves its cookie never declares a holder.

| Parameter | Value |
|---|---|
| TTL | `expiresAt = issue + 7 d`, matching the session cookie (`auth.ts:162`) |
| Absolute lifetime | 30 d from the original pairing (theft ceiling), then 401 `bearer_expired` → re-pair. A rotation near the ceiling is capped at it. |
| Rotation | `POST /api/paired-devices/rotate`, tier **`observe`**, entered in the route→tier map (`packages/shared/src/route-tiers.ts`). Authenticated **only** by `Authorization: Bearer <browser-held or legacy row bearer>`. Cookie-only, local-proof or no-bearer callers → 401 `bearer_required`. Any device id in the body is ignored: the bearer identifies the row, so a bearer rotates **itself** only. An already-expiring browser row needs no declaration. Returns `{token, expiresAt}` with `Cache-Control: no-store`. Keeps device id, label, tier. 10/min per device (sliding 60 s) → 429 + `Retry-After`; persist failure → 500 `rotation_failed`, no state change. |
| Grace | Previous hash valid for **60 s**, then invalid. Only the immediately previous bearer has a grace, until `min(rotation + 60 s, its own expiresAt)`. Rotate called with a bearer superseded within its grace → 409 `bearer_superseded`, no new bearer; after the grace it is a plain 401 on every route; the client picks up the new token from its slot (`storage` event), so tabs never fork. |
| Client schedule | Rotate on startup and when <25 % of the lifetime (issue→`expiresAt` of the current bearer) remains (≈42 h). |
| Expired | 401 `{code:"bearer_expired"}`, distinct from revoked. The client clears that server's slot and re-pairs. |
| Revoke | Unchanged: deleting the row kills the current and the previous hash. |
| Storage | One slot per server: `pi-dashboard:device-bearer:<apiOrigin>`. |
| Legacy slot | The single global key `pi-dashboard:device-bearer` (`device-auth.ts:30`) is **discarded** on upgrade on **both** paths, cross-origin and same-origin: never exchanged for a cookie, never sent. It may hold another server's bearer (the `VITE_API_URL` early fallback, `device-auth.ts:54-55`, can pick the wrong base). No new write targets it: the same-origin keep-failed path writes the per-origin slot. Cross-origin browser users re-pair once. |
| Legacy rows | A non-expiring row presented to rotate **with** `holder:"browser"` converts to a browser row (only shortens life; 30 d counts from conversion). **Without** the declaration → 409 `holder_declaration_required`, nothing issued; the row stays non-expiring — no contradiction with "non-browser bearers never expire". A 404 from an old server keeps today's behaviour. |

MODIFIES (all on baseline text):
- bearer-device-auth "Long-lived opaque bearer tokens in a revocable registry": the token is returned exactly once **per issuance or rotation**; browser rows expire. "A device bearer's tier gates REST routes and WS-ticket minting": route→tier entries for the rotate route and the CSP report reset route. "Browser keeps its bearer until the cookie is proven": per-origin slot. ADDS "Browser-held device bearers expire and rotate", "Legacy non-expiring rows convert on browser declaration", "Expired bearer is reported distinctly from revoked".
- trust-and-credential-boundaries "Browser device credential is not JS-readable": the baseline scenario "legacy stored bearer migrated" (`openspec/specs/trust-and-credential-boundaries/spec.md:165-167`, exchanged for the cookie) becomes "discarded, never exchanged or sent";
- cross-origin-client "Bearer auth mode independent of origin-bound cookie".

*Overlap:* `device-key-mutual-check` also MODIFIES "Long-lived opaque bearer tokens…" and the tier requirement (Sequencing).

*Alternatives:* navigate-to-origin or document-only (rejected by the user); sessionStorage (poor UX, still XSS-readable); migrating the legacy slot (wrong-server leak).

### CORS

**D6 · B19 — zrok wildcard off on the read path; real config key as escape hatch.** *(planner default)*
- Today branch 5 runs on the read path because `allowZrokWildcard !== false` (`auth/cors-origin.ts:158`). It becomes `=== true`. Admission already passes `false` (`:261`), unchanged.
- `cors.allowZrokWildcard` becomes a **real config key**: today it exists only as a `CorsOriginOptions` field (`cors-origin.ts:55`) and is never parsed. It is added to the `cors` config type and parser in `packages/shared/src/config.ts` (default block `:1813`, parser `:2674-2675`; boolean `true` only, default `false`) and threaded through `corsOpts()` (`server.ts:2057`).
- The live zrok URL stays allowed through branch 4b (`:147-155`), because `liveTunnelOrigins()` includes the zrok runtime URL (`tunnel/tunnel.ts:486-487`). The "load-bearing" comment (`:47`) is rewritten.
- Consumers: `@fastify/cors` (`server.ts:2224`), the denial observer (`access/cors-denial.ts:23`), the kind test (`__tests__/cors-origin-classification.test.ts:86`).

MODIFIES server-cors "Every live tunnel origin is an allowed CORS origin", "Neutral shell origin trusted by default", "Trusted-network origins allowed for LAN-to-LAN switching"; live-server-preview "CORS SHALL reject the opaque `null` origin" (wording only). cross-site-request-gate already excludes the wildcard.

*Alternatives:* narrow the suffix match to live hostnames (equivalent to 4b); delete with no escape hatch (no config rollback).

**D7 · R2 — one `canonicalOrigin()` helper.**
- Lowercases scheme and host, strips the default port, strips one trailing dot from the hostname, drops the path.
- Applied on both sides of: branch 4 (raw compare today, `cors-origin.ts:142`); branch 4b (`URL.origin`, keeps the dot, `:150,154`); `isSameOriginByHost` (`:216-240`); and the D3 Host match.
- A trailing-dot origin equals its dotless form, matching host admission (`auth/host-admission.ts:44-48`, `packages/shared/src/host-admission.ts:70-92`). zrok URLs are captured case-insensitively (`tunnel-providers/zrok.ts:388-389`).
- Tests cover case, `:443`, path and trailing-dot variants on every branch. ADDS server-cors "Tunnel origins compare in canonical form".

*Alternative:* deny trailing-dot origins. Stricter, but then the CORS gate and host admission disagree.

### CSP (S3b)

**D8 · Baseline report sink + persisted violation counter.** *(user-confirmed)*

*Route:* `POST /__pi/csp-report/:policy`, `:policy ∈ {baseline, strict, trusted-types}`; anything else → 404.
- Mounted at the root, **outside guard jurisdiction** (`/api`, `/v1`, `/editor`, `/live` — trusted-networks "Guard jurisdiction and in-namespace public exceptions", `openspec/specs/trusted-networks/spec.md:338-343`). So no trusted-networks exception delta is needed, and the mutation-origin gate, which covers only `/api/*` and `/auth/logout` (`auth/mutation-origin-gate.ts:31`), does not apply.
- **OAuth gate:** the auth `onRequest` hook (`auth/auth-plugin.ts:507-554`) runs globally and would 401 or redirect a signed-out page. Reports must arrive from signed-out pages (login, passkey), so the sink path joins its public skips (next to `/api/health`, `:534`). oauth-authentication has no enumerated public-path requirement, so this lands as ADDED "CSP report sink is public to the OAuth gate".
- Host admission still applies: the host gate is a global `onRequest` hook (`server.ts:2196`).
- No collision: the live sink is `/live/<id>/__pi/csp-report`; the SPA `setNotFoundHandler` fallbacks (`server.ts:3646-3666`) see only unmatched routes. A test asserts both.
- Each emitted policy carries `report-uri /__pi/csp-report/<policy>` plus `report-to csp-<policy>`, declared in `Reporting-Endpoints`. This includes the TT-only header (D10, emitted only when the TT mode differs from the CSP mode), labelled `trusted-types`.

*Hardening (unauthenticated POST):*
- *Size cap:* the sink reads its own body with a **byte-counting read** and aborts at 8 KiB, chunked bodies included → **413**. The cap is independent of `content-length`, Fastify `bodyLimit` and parser registration order. Context: `registerCspReportParsers` (`live-server/live-csp-report.ts:22-32`) is idempotent and skips a type already registered, so the first registrant fixes the parser limit (the live proxy registers at `live-server-proxy.ts:182`); the baseline sink does not rely on it. The live sink is unchanged. Scenario: chunked oversize body → 413.
- Content-Type `application/csp-report` | `application/reports+json`, else **415**.
- *Limiter:* dedicated, per route, keyed by socket peer, a token bucket of capacity 20 refilled at 1 token/s (= 60/min); every request reaching it consumes one token, a Reporting API batch included. Loopback is **not** exempt: the global `@fastify/rate-limit` allow-lists `127.0.0.1`/`::1` (`server.ts:1962-1967`), which would exempt all tunnel traffic. Excess → **429**.
- Body read deadline 5 s → **408**. Method other than POST → 405 `Allow: POST`; empty/malformed/non-report/content-encoded body → 400, uncounted. Precedence: 404 → 429 → 415 → 413.
- Every report refused by the limiter, the size cap or the read deadline increments a persisted `dropped` counter; the follow-up's exit requires `dropped == 0` in the window.
- Accepted → **204**, empty body. No response reflects input. Raw reports are never logged or stored (`blocked-uri` can carry tokens).

*Counter:*
- Keyed by `policy × effective-directive`; directives from a fixed allow-set, else `other`. Trusted Types violations land in the `require-trusted-types-for` directive bucket (under the emitting header's label, `trusted-types` for a TT-only header) and never count toward the strict `script-src*` measure. A bounded document-path breakdown (path only, no query, top-N with `other`) supports the soak review.
- Stores counts, `dropped`, `firstSeen`/`lastSeen` and a global `since`. No URLs beyond the bounded path, no user data.
- **Persisted** across restarts to `~/.pi/dashboard/csp-reports.json` (0600, debounced).
- *Reset* (sets a new `since`): `POST /api/csp-reports/reset` at tier `operate`, entered in the route→tier map, or deleting the file while the server is stopped (equivalent). Distinct namespace from harden-client-sinks' in-memory client TT counters at `/api/csp-violations` (`route-tiers.ts:121,316`), which are not touched.
- Throttled log line: `[csp] violation policy=strict directive=script-src-elem`.

*Exposure:* an optional `cspReports` block in `GET /api/health` (`routes/system-routes.ts:1134`), present only when `canDiscloseAccessPosture(request)` passes (`auth/localhost-guard.ts:110-115`) — the same predicate as the existing access-posture disclosure (`system-routes.ts:1162`). Otherwise the block is **omitted**; health never refuses. That predicate ignores strict mode: accepted, since the block carries counts only, no user data (Risks).

*Trusted Types:* TT emission already exists and stays independent of the CSP mode (Context). Its reports go to `/__pi/csp-report/trusted-types` when a TT-only header carries it, else to the label of the header it is appended to; either way they land in the `require-trusted-types-for` bucket. `add-trusted-types-report-only` assumes this sink; a task writes its `dependencies.yaml` `blocked_by: close-residual-audit-findings`.

ADDS baseline-content-security-policy "Baseline CSP violation report sink", "Violation counter is observable and persistent", "Violation counters reset only by explicit operator action", "Violation counters appear in the health report only when disclosure is permitted"; oauth-authentication "CSP report sink is public to the OAuth gate".

**D9 · Strict policy shape.**
- `script-src 'self' 'nonce-<n>'`, with no `'unsafe-inline'` and no `'unsafe-eval'`. All other directives stay as in `auth/csp.ts:46-60`.
- *Nonce:* 16 random bytes per HTML response. `cspNonceFor(reply)` memoizes it; the onSend hook (`csp.ts:88-93`) reads it. Non-HTML responses carry none.
- *Import map* carries the nonce: `injectImportMap` already accepts one (`lib/index-html.ts:22-23`), but `sendIndexWithImportMap` callers pass none (`server.ts:3641,3653,3658,3659`). They now do.
- *Passkey pages* (`auth/passkey/passkey-pages.ts:94,120,154`): the inline scripts move to static same-origin assets (like the existing `/auth/passkey/webauthn.js`, `:93`); per-request data goes into non-executable `<script type="application/json">`. No nonce is needed there.
- *Eval:* no real need. pdf.js probes `new Function` in try/catch; the client sets `isEvalSupported:false` so the probe does not report.
- *Vite dev* (`--dev`): the react-refresh preamble is inline, so the strict policy header is **not emitted at all** in dev (neither report nor enforce); the baseline header keeps the legacy `script-src`. Dev never feeds the strict counter.
- Plugin bundles load via same-origin `import()` (`client/src/lib/plugins/runtime-plugin-loader.ts:138`), covered by `'self'`. `blob:`/`data:` stay forbidden. Electron local pages keep their own meta CSP.

MODIFIES baseline-content-security-policy "Mode-dependent header emission" (preserving every TT carve-out of the baseline: the TT-only header is not the baseline CSP; the Off scenario keeps "AND the Trusted Types mode is `off`"; TT emission stays independent of the CSP mode), "Baseline policy directives", "Runtime plugin loading fits the baseline policy"; ADDS "Strict policy uses a per-response script nonce", "Strict policy is not enforced in Vite dev mode". "Staged CSP mode resolution" is **not** modified (default stays `report`; the follow-up modifies it).

*Alternatives:* hash-based (the import-map JSON varies with the plugin set); `strict-dynamic` (no script-inserted loaders beyond `import()`).

**D10 · Modes.**

| `PI_DASHBOARD_CSP` | Headers |
|---|---|
| `report` (default, unchanged) | `baseline` Report-Only → `/__pi/csp-report/baseline` **and** `strict` Report-Only → `/__pi/csp-report/strict` |
| `enforce` (opt-in here; default in `enforce-strict-csp-default`) | `strict` enforced → `/__pi/csp-report/strict`. The `baseline` policy is **not** emitted as Report-Only. |
| `off` | no baseline or strict CSP header (`csp.ts:8-10`) |
| any, Vite dev (per proxied response) | baseline header only (legacy `script-src`), enforcing in `enforce`; no strict header; no report destination on any header |

- *Trusted Types* follows its own mode in every row (`csp.ts:82-87`): matching modes append the directive (`report`: to the baseline Report-Only header; `enforce`: to the strict enforcing header; it then reports to that header's label), differing modes set the other header kind with the TT directive alone. Topology unchanged; the TT-only header gains `report-uri`/`report-to` → `/__pi/csp-report/trusted-types`. Non-HTML responses carry the strict header without a nonce.
- Route-level per-response policies (`/api/file/raw` sandbox, `ctx.serveApp` mounts) are untouched by mode.
- *Rollback:* `PI_DASHBOARD_CSP=report` or `off`, plus restart. Release notes state that an explicit `enforce` now enforces the strict policy.

*Alternatives:* strict in report mode only (never closes S3b); drop `'unsafe-eval'` only (partial).

### Dependencies

**D11 · B26r — triage only.** *(user-confirmed)*
- `advisory-triage.md` is an implementation-task deliverable. It lists every `pnpm audit` advisory (7 critical / 51 high / 54 moderate / 8 low at planning). Columns: `package@version | advisory | path | class (reachable / build-only / accepted) | reason | owner`; a `reachable` row names an owning change id. A `pnpm audit --json` snapshot is committed beside it and the checker diffs against the snapshot; stale rows warn.
- xlsx: CDN pin `packages/server/package.json:113`; integrity `pnpm-lock.yaml:10147-10148`; `pnpm audit` does not cover URL tarballs. The task re-verifies 0.20.3 online against GHSA-4r6h-8v6p-xvw6 (fixed 0.19.3) and GHSA-5pgg-2g8v-p4x9 (fixed 0.20.2) and records the advisory links.
- Runtime bumps (fastify ≥5.12.5 etc.) belong to `bump-runtime-security-advisories`. A task creates that stub if missing.

### Server: git, terminal, plugins

**D12 · B20 — `redactGitText()` on every outbound string, after mapping.**

Rules, in order:
1. Strip **any** userinfo from `http(s)` URLs, password-less `user@` included (pattern after `memory-eval/src/scrub.ts:16-37`).
2. Redact specific token shapes only: `sk-…`, `ghp_…`, `github_pat_…`, `glpat-…`, `Bearer …`. `redactSecrets` is **not** reused: its catch-all ≥40-char blob rule (`spawn-process/spawned-turn-log.ts:36`) would destroy commit SHAs. A scenario asserts a 40-hex SHA survives.
3. Make absolute paths under the **operation's repository root** relative. The root is resolved by the operation itself, not the request cwd at broadcast time.
4. Replace home with `~`.
5. Replace other absolute paths (POSIX or drive-letter) with `<path>`.

Where: every outbound `error` / `message` / `stderr` string in `routes/git-routes.ts`, applied **after** server-side mapping, so mappers still see raw text.
- `err.message` at `:285,309,329,369,406,408,472,490,609,1203`; `result.message` at `:708,756,1152`.
- `stderr` at `:662,709,846,958,1012,1040,1085,1116,1153,1181`.
- `worktree_init_failed` (WS `:660`) and the REST body (`:662`): both `message` — the `mapInitStderrToHint` result (`:658`) — and `stderr`.

The client branches only on `code` (`client/src/lib/api/server-error.ts:40`), so `stderr` stays: hook output is useful UX. Users still see redacted messages (accepted).

*Path move:* `extract-git-as-plugin` moves `git-operations.ts` and `routes/git-routes.ts` into `packages/git-plugin/` (its `proposal.md:15`). Citations in D12/D13 are pre-move; whichever change lands second re-applies B20/B1r at the new path.

ADDS git-operations-api "Git error bodies are redacted", "Redaction follows mapping and the operation's repository root".

*Alternative:* drop stderr (loses hook diagnostics).

**D13 · B1r — `assertRefArg()` on caller and derived git arguments.**
- Rejects non-string, empty, leading `-`, or control characters → 400 `invalid_ref`, before git runs. Precedent: `packages/kb/src/sources.ts:184`. The validator is the control; no `--end-of-options`.
- Missing `cwd`/`branch` on checkout keeps the existing 400 `cwd_and_branch_required` (`git-routes.ts:295-297`); present-but-invalid → `invalid_ref`.
- Applies to:
  - checkout `branch` (`git-worktree/git-operations.ts:520`) **and** the derived `localName` after remote-prefix strip (`:508`, used at `:510-516`). An empty derived name (`origin/`) → `invalid_ref`;
  - addWorktree `newBranch` (the `-b` value, `:820`), `base` / checkout commit-ish (`:821`);
  - worktree `path`: optional; absent → default `.worktrees/<slug>` (`:786-796`) or `.worktrees/pr-<n>` for PR worktrees (`:1976`, body at `git-routes.ts:1135`); validated when present (`git-routes.ts:694`);
  - `baseHint`: arrives over WS (`browser-handlers/session-action-handler.ts:826`, `gitWorktreeBase`). An invalid hint is not stored and is logged; no client error (it is a hint). It is re-validated where used (`mergeWorktreeImpl` `:1342-1358`, `worktreeDiffStatImpl` `:1437-1448` → `resolveDefaultBaseStrict` `rev-parse --verify <hint>` `:1278`).

MODIFIES git-operations-api "Checkout endpoint". ADDS "Caller-supplied refs are never parsed as options", "Derived and optional git arguments are validated".

*Alternative:* `--end-of-options` (needs per-subcommand verification on the git ≥2.31 floor; no early 400).

**D14 · R1 — terminal cwd admission.**

Current state: both handlers are sync and spawn at `msg.cwd` unchecked — standalone `terminal-handler.ts:66`, inline `:92`. Caps are the only check (`terminal/terminal-manager.ts:303-339`).
- *Inline* (`handleOpenInlineTerminal`): spawns at the session's own cwd from `sessionManager`; `msg.cwd` is ignored (stays in the protocol for old clients). Unknown session → refuse.
- *Standalone* (`handleCreateTerminal`): becomes async and awaits `admitCwd(msg.cwd, () => listKnownFolderCwds(...))` (`lib/route-admission.ts:25`, `cwd-guard.ts:405`) before `spawn`.
- *Race:* the cap is re-checked after the await (or a slot is reserved synchronously before it), so two concurrent creates cannot exceed it.
- *Callers:* `pairing/browser-gateway.ts:2481,2484` handle the returned promise (`.catch` → log), so no unhandled rejection. Sync-throw tests adapt to the async form.
- *Denial message:* existing shapes do not fit — `terminal_limit_reached` is cap-specific (`shared/src/browser-protocol.ts:765`), `folder_refused` carries a fixed `reason: "outside_allowed_roots"` literal (`:779-782`, `folder-gate.ts:33`). A new `terminal_error { code: "cwd_not_admitted" | "cwd_admission_unavailable" | "session_not_found", cwd, inline, message }` goes to the requesting socket only; the client shows it as a dismissible notice next to the `terminal_limit_reached` handling (`client/src/hooks/useMessageHandler.ts:1941`).

MODIFIES terminal-emulator "Server-side PTY management".

*Alternative:* sync `isAllowedCwd` (`cwd-guard.ts:86`). It skips the tri-state indeterminate handling the plugins use.

**D15 · S1r — plugin cwd admission, plus the post-start registration invariant.**

`cwd_required` (400, **before** admission) applies only where a folder is semantically needed. Any cwd that **is** supplied is admitted tri-state: 403, or 503 `cwd-admission-unavailable` with `Retry-After`. `scopeBaseFor` (`automation-plugin/src/server/routes.ts:37-38`) drops the `process.cwd()` fallback; global scope keeps `os.homedir()`. Automation admit set: `host.knownFolderCwds` ∪ `automation.folderscope.*` (`automation-plugin/src/server/index.ts:293-310`).

| Route (`routes.ts`) | No cwd | cwd supplied |
|---|---|---|
| `POST /run` `:124`, `POST /stop` `:146`, `GET /actions` `:168` | unchanged | admitted |
| `GET /trigger-kinds` `:174` | unchanged (takes no cwd) | n/a |
| `GET /git-capable` `:182` | `{gitCapable:false}` as today (`:184`) | admitted |
| `GET /list` `:199` | global only | admitted |
| `GET /runs` `:216`, `GET /result` `:229`, `POST /create` `:274`, `POST /update` `:312`, `GET /definition` `:351`, `DELETE /` `:395` | scope `folder`/non-global → `cwd_required`; `global` → home | admitted |
| flows `GET /flow-inputs` (`flows-plugin/src/server/index.ts:64-68`) | `cwd_required` | admitted |

- *MCP callers:* 12 generated automation tools call these routes (`mcp-server-plugin/src/server/generated/tools.ts:92-95,133,164-168,189-190`). The generated tool manifest marks `cwd` **required** for the folder-scope automation tools (a task regenerates it); a folder-scope call without `cwd` gets 400 `cwd_required`.
- *Flow ids:* exactly `.` or `..` are refused; the regex `[\w.-]+` (`flow-inputs.ts:29`) already excludes separators, and `team.review` / `a..b` stay valid.
- *Post-start registration:* verified against fastify@5.12.1 — `route()` calls `throwIfAlreadyStarted('Cannot add route!')` (`node_modules/fastify/lib/route.js:205`), which throws once `ready()` has started the instance (`fastify.js:378,468-469`). So the caveat at `server.ts:3512-3519` is enforced today. The trusted-networks requirement states behaviour, not Fastify internals: a route registered after start fails, nothing serves a sensitive-namespace route without the guard. A task adds a regression test proving post-start registration throws in this server. Re-verify after the fastify bump.
- *Overlap checked:* neither `close-container-loopback-impersonation` nor `add-plugin-capability-routes` modifies trusted-networks "Network guard threaded to all protected routes" (they modify other trusted-networks requirements); our block is written on baseline text.

ADDS plugin-cwd-admission "Automation and flows plugin routes admit the request cwd", "Automation admit set includes folder-scope contributions", "Flow ids cannot traverse". MODIFIES trusted-networks "Network guard threaded to all protected routes".

*Alternative:* per-plugin allowlist config (duplicates host admission).

**D16 · B15r — static `emits` manifest enforced at the server seam.** *(user-confirmed)*
- Manifests gain `emits: string[]`, matched exactly — distinct from the inbound `eventTypes`. The validator (`dashboard-plugin-runtime/src/manifest-validator.ts:805-817`, the `eventTypes` block) gains an `emits` block: an array of exact event names.
- `emitEventToSession` (`plugin-event-seam.ts:11-25`, wired at `server.ts:4311-4316`) refuses anything not in the calling plugin's allowlist, and still refuses reserved prefixes.
- *Provider attribution:* `ctx.provide` (`server.ts:4329`) records the **provider plugin id**; `consumeAll` (`:4334`) entries gain an additive `provider` field (host-set entries carry provider `host`). The host never trusts a registration key's source segment.
- *Key ownership:* for an `automation.action.<source>` key the provider plugin id MUST equal `<source>`; otherwise the provide is refused and logged. This prevents key spoofing and overwrite.
- *Automation allowlist,* computed by the host with no runtime channel: automation's manifest `emits` ∪ the manifest `emits` of every plugin that provides an accepted `automation.action.*` registration. A registration whose `emits` is not a subset of **its actual provider's** manifest `emits` is refused with a warning. The engine's per-action check (`engine.ts:128`) stays.
- *Inventory task:* every in-tree `emitEventToSession` caller gets manifest `emits`: automation (`automation-plugin/src/server/index.ts:449`); flows declares `flow:run` (`flows-plugin/src/server/index.ts:147`, consistent with `openspec/specs/flows-plugin/spec.md:114`) and `dashboard-flows:report-files` (`flow-files.ts:202`, via `index.ts:82`). `mcp-server-plugin/src/server/tools.ts:29,76` lists the seam in denylists only — not an emitter; recorded.
- *Out-of-tree plugins:* one warning per (plugin, eventType) per process, naming the plugin, the event type and the missing manifest field `emits`. CHANGELOG carries a migration note.
- The bridge (`extension/src/bridge-handlers/dispatch.ts:326-332`) stays a relay; the server is the trust point.

ADDS dashboard-plugin-loader "Plugin manifest declares emitted event types", "Provide records the provider plugin"; MODIFIES "Cross-plugin service seam" (baseline `:1524-1530`), "Prefix enumeration over the service board" (`:42-46`, additive `provider` field), "Emit a configured event into a session", automation-action-registry "Plugin-registered automation actions" and "Event-dispatch actions", bridge-extension "Relay plugin-emitted events into the session bus".

*Alternative:* bridge-side enforcement (the bridge has no manifests).

### Bridge

**D17 · B21 — normalize `quiesceMs`, bound inbound prompt/bash.**

*Quiesce* (`dispatch.ts:80-87` accepts any `>0`; `connection.ts:748-752` accepts `1e15`). The bound is enforced **inside `pauseAutoStart`** (`connection.ts:748-752`), so every caller is bounded; dispatch passes the value through. Shared `MAX_QUIESCE_MS = 120000` sits next to `RESTART_QUIESCE_MS` (`shared/src/recovery-timing.ts`); `SHUTDOWN_QUIESCE_MS` (60000) moves there from `routes/system-routes.ts:345`. Rules, in order:
1. not a number, or `NaN` → ignored (no pause);
2. non-integer → rounded **up** (`ceil`), so the "at least `quiesceMs`" floor holds;
3. ≤ 0 → ignored;
4. > MAX, including `Infinity` → clamped to 120000.

5000 and 60000 are honoured exactly. A test asserts `MAX ≥ 2 × max(sent)`. MODIFIES server-restart "Bridges pause auto-start during quiesce window".

*Inbound limits* — the spec is qualitative with floors: bounded concurrent bash per session, bounded inbound prompt rate per connection, limits configurable, refusals visible (never silent), normal use not throttled. ADDS bridge-extension "Inbound command bounds".
- *Bash bound* covers every `handleBashCommand` caller (`extension/src/command-handler.ts`): `!`/`!!` (`:718`) and exec slash templates (`:1392`). 30 s timeout `:434`.
- *Prompt bucket* covers every turn-starting inbound command: `send_prompt` (`:661`), `retry_session` (`:965`), `git_commit_draft` (`:1039`); and in `bridge-handlers/dispatch.ts`: `flow_management` `run` (`:184-186`), `plugin_emit_event` (`:326-332`), `promote_followup_entry` (`:430-434`).
- *Config:* `PI_DASHBOARD_BRIDGE_MAX_BASH`, `PI_DASHBOARD_BRIDGE_PROMPT_RATE`, with defaults.
- *Refusal:* reuses the existing extension→server path for a refused `send_prompt`: `prompt_received` plus an `event_forward` of `command_feedback {command, status:"error", message}` (`command-handler.ts:674-685`), which settles the optimistic bubble and shows the user an inline error. No new message type.
- **Provisional defaults** (design only): 4 bash in flight per session; prompt bucket burst 30, refill 10/s per connection. The follow-up cap is unchanged (`followup-buffer.ts:13,53`).
- *Measurement task* (performance-optimization) sets final defaults before landing: replay automation per run (`automation-plugin/src/server/index.ts:455`), the `/reload` fan-out (`session-action-handler.ts:95,185`), flows and chat-gateway; defaults ≥3× the observed peak.

*Alternatives:* server-side limiter only (no protection against a rogue server, see R4); drop-oldest (silent loss).

**D18 · B22 — strip userinfo, keep the raw origin shape.**
- A new helper strips credentials from every URL-form remote, keeping scheme, host, port and path: `http(s)` loses all userinfo; `ssh://user:pass@host` loses the **password** but keeps the user. scp forms (`git@host:o/r`) carry no password and are unchanged.
- `parseRemoteUrl` (`extension/src/git-link-builder.ts:40-42`) uses it, so links are built correctly.
- Vault: the bridge sends the userinfo-stripped **raw** origin in `vault_sync_request.origin` (`vault-delivery.ts:273`). The hub stores it (`vault/vault-delivery-hub.ts:252`) and derives `repoKey` via `normalizeOrigin` exactly once (`:187`). `normalizeOrigin` is **not idempotent** — its `host/path` output has no scheme and no `@`, so re-parsing returns `undefined` (`shared/src/vault-origin.ts`, `normalizeOrigin`/`parseScp`). So its output never goes on the wire. The hub imports `normalizeOrigin` via the `vault-project-key.js` re-export (`vault-delivery-hub.ts:25`; re-export at `shared/src/vault-project-key.ts:14-18`). The hub also strips credentials on receipt, which covers old bridges.
- The doc comment at `shared/src/protocol.ts:902` is updated. Recorded: the git-info path never carries the raw URL (`vcs-info.ts:331-334`).

ADDS bridge-extension "Remote URL credentials never leave the bridge"; credential-vault "Repository origin sent to the hub is credential-free".

**D19 · R4 — counter-proof on every loopback dial; no bearer to an unpinned discovered host.** *(user-confirmed)*
- *Loopback scope:* when the bridge holds the local token, **every** loopback TCP dial or retarget — configured endpoint, auto-start, discovered advert, retarget, reconnect — requires server counter-proof (`extension/src/local-token-header.ts:129-199`). Today that happens only when the spawn marker is set (`:142`, `markerEnforces` `:84-90`). This covers **both** `ws:` and `wss:` loopback dials whenever the token exists. Exempt, stated explicitly: only `ws+unix:` (filesystem permissions; already skipped at `:133`).
- *Opt-out:* `PI_DASHBOARD_REQUIRE_SERVER_PROOF` is **not** reused: `markerEnforces` treats any non-empty unparseable value, `"0"` included, as enforcing, and the spawner deletes/overwrites it (`server/src/spawn-process/process-manager.ts:397,413`). A new explicit env `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1` opts out, logged when active.
- A refusal blocks registration and session data, is logged with a named cause, and falls back to backoff.
- *Skew window:* servers answer counter-proof since 0.10.0 (`CHANGELOG.md:420-424`). A new bridge against a same-host server older than 0.10.0 is refused unless the opt-out is set.
- *Pinned* = exact `host:port` equality with the configured endpoint (config/env) or with a `server-pin-store` entry's `lastEndpoint` (`extension/src/server-pin-store.ts`). `resolvePinForEndpoint`'s single-pin fallback (`server-pin-store.ts:79-83`, "the sole pin") is **not** used: it would treat any endpoint as pinned when one pin exists.
- *Gate location:* the ticket-mint call site — `prepareRemoteUpgrade` (`bridge.ts:1047`, mint at `:1051`) → `mintBridgeTicket` (`bridge-ticket-client.ts:66-71`, `Authorization: Bearer` at `:70`). The bearer is attached only for a pinned endpoint. Discovered-only mDNS candidates (`server-auto-start.ts:199-206`, `shared/src/mdns-discovery.ts:414-427`) never receive it; the refusal is logged through the bridge's existing `[dashboard] bridge ticket <cause>` line (`bridge.ts:1053`) with cause `unpinned_discovered_host`.
- *Coordination:* `fix-remote-bridge-ticket-origin` rewrites the HTTP-origin resolution in the same call sites; R4 builds on its resolver (dependencies.yaml `blocked_by`).

MODIFIES mdns-discovery "Guarded migration away from an established bridge"; ADDS "Local-token holders require server counter-proof on every loopback dial", "Device bearer never sent to an unpinned discovered host".

**D20 · R5 — document.** *(user-confirmed)*
- `!` output reaches tunnel viewers by design (`extension/src/command-handler.ts:1526-1538`). Only vault values are masked (`vault-redaction.ts:1-21`).
- Document in `docs/architecture.md` "Remote confinement" (~`:3103`), `docs/faq.md` (~`:723`) and README "Tunnel (zrok)" (~`:394`), via DocScribe.

### Media / Electron

**D21 · B23 — media argument safety.**
- *Audio size:* `maxAudioMb` (`video-transcription/src/config.ts:184`, default 200 at `:15`) limits the **extracted** audio: its total size is checked via `stat` after extraction, before upload/transcription. The error names the limit and the size. `0` disables the check (scenario).
- *Media paths:* every positional ffmpeg/ffprobe media path is resolved to absolute against the spawn cwd at **every** site — `ffmpeg.ts:82` (output), `:108-116` (ffprobe input), `:149` (chunk dest), `discover.ts:51` (`path.join(dir, name)`), `audio-decode.ts:74-90` (positional `out`), and the `voiceid.ts` runner (`:179-192`, feeding `decodeAudio` / `getDurationSeconds`). An absolute path never starts with `-`.
- *nano-banana prompt:* `buildArgs` emits `["--prompt", prompt, …]` (`nano-banana.ts:94`); `npx` is pinned to `@the-focus-ai/nano-banana@1.0.10`, whose parser takes `--prompt` (verified: package `cli.ts:275`).
- *nano-banana on win32:* `npxRunner` uses `buildSafeArgv("npx", …)` (`nano-banana.ts:79`), which wraps `npx.cmd` in `cmd.exe /d /s /c` without escaping args (`shared/src/platform/exec.ts:89-95`). On win32 there is **no** `cmd.exe` path at all, for every arg (prompt, `--model`, `--file`, `--output`): the runner invokes npx's JS entry with node directly (`process.execPath` + npm's `npx-cli.js`, resolved next to the node binary). If that entry is not resolvable, the run is refused with a clear error. Pin string `@the-focus-ai/nano-banana@1.0.10` appears verbatim in the spec.
- *render.ts:* no gap. The input sits behind `-i`, and `outPng` is absolute (`render.ts:183,337`). Recorded.

ADDS video-transcription "Extracted audio size limit enforced before upload", "Media paths are absolute and never parsed as options". MODIFIES nano-banana-image-generation-client "Single Image Generation and Editing"; ADDS "Prompt is never parsed as a CLI flag", "Prompt never passes through cmd.exe on Windows".

**D22 · B24 — Electron residuals.**
- *doctor.html:* already fixed. The link replacer allows only `http(s)` and renders anything else as text (`renderer/doctor.html:101-105`, commit `433993088` harden-client-sinks). Kept as a requirement with a regression test.
- *Residual — doctor-window.ts:* its `webPreferences` lack `sandbox` (`lib/doctor-window.ts:141-145`) and it has no navigation guards. It gains `sandbox: true`, `setWindowOpenHandler` (deny, plus `shell.openExternal` for http(s)) and a `will-navigate` guard, mirroring `lib/connecting-window.ts:35-45`.
- *dependency-detector.ts:91:* the node version probe becomes `execFileSync(base.path, ["--version"])` directly. Node is never a `.cmd` shim, so no `buildSafeArgv` and no shell.

ADDS electron-shell "Doctor window links are scheme-restricted", "Doctor window navigation is guarded", "Node version probe never uses a shell string" (narrowed to the node probe).

## Sequencing

```mermaid
flowchart TD
  subgraph External["Other changes"]
    CCLI["close-container-loopback-impersonation<br/>(owns B14r; bearer-device-auth, trust-and-credential-boundaries,<br/>oauth-authentication, trusted-networks)"]
    CLW["close-loopback-legacy-window<br/>(bearer-device-auth, trust-and-credential-boundaries)"]
    RBT["fix-remote-bridge-ticket-origin<br/>(bridge-ticket-client.ts resolver)"]
    DKMC["device-key-mutual-check<br/>(bearer-device-auth Long-lived + tier req)"]
    PIR["add-plugin-isolation-and-public-routes<br/>(server-cors, cors-origin.ts, tier req)"]
    PCR["add-plugin-capability-routes<br/>(localhost-guard, auth-plugin, CSP)"]
    EGP["extract-git-as-plugin<br/>(moves git-link-builder.ts,<br/>git-operations.ts, git-routes.ts)"]
    SRT["add-srt-translation-pass<br/>(video-transcription config.ts)"]
    N26["raise-node-floor-to-26<br/>(dependency-detector.ts)"]
    BUMP["bump-runtime-security-advisories<br/>(fastify et al.)"]
  end
  subgraph This["close-residual-audit-findings"]
    PR["one ship-it pass: all items<br/>sink + counter, dual Report-Only, R4"]
    ARC["archive"]
  end
  subgraph After["blocked_by this change"]
    TT["add-trusted-types-report-only<br/>(needs sink; premise partly stale)"]
    FU["enforce-strict-csp-default<br/>(soak gate + default flip)"]
  end
  CCLI -->|blocked_by: shared capabilities| PR
  CLW -. later archiver rebases shared requirements .- ARC
  RBT -->|blocked_by: R4 builds on resolver| PR
  PR --> ARC
  ARC --> TT
  ARC --> FU
  DKMC -. second archiver re-copies bearer-device-auth blocks .- ARC
  PIR -. textual rebase: server-cors / cors-origin.ts .- PR
  PCR -. rebase localhost-guard / auth-plugin / csp.ts .- PR
  EGP -. second lander re-applies B22, B20, B1r at new paths .- PR
  SRT -. rebase config.ts .- PR
  N26 -. rebase dependency-detector.ts .- PR
  BUMP -. separate, urgent, no dependency .- PR
```

- `retire-trusted-networks-bypass` is archived (`2026-10-18-…`); no coordination.
- *Spec rebase rule:* the change that archives second rebases its MODIFIED block on the other's text:
  - **every** MODIFIED block here is written on **baseline** text (`openspec/specs/**`), including B4r / B16r / B18 blocks in bearer-device-auth, trust-and-credential-boundaries and oauth-authentication, and the S1r block in trusted-networks. Whichever of this change / `close-container-loopback-impersonation` / `close-loopback-legacy-window` archives **later** rebases the shared requirements on the earlier archiver's text. By `blocked_by`, this change lands after `close-container-loopback-impersonation`;
  - bearer-device-auth "Long-lived opaque bearer tokens…" and "A device bearer's tier gates REST routes…" — with `device-key-mutual-check` (and PIR for the tier requirement);
  - baseline-content-security-policy "Mode-dependent header emission" — `add-trusted-types-report-only` archives after us and rebases on our text; `enforce-strict-csp-default` MODIFIES only "Staged CSP mode resolution" (untouched here);
  - server-cors — with PIR (different requirements, textual only).
- *Path moves:* `extract-git-as-plugin` moves `git-link-builder.ts` (B22) and `git-operations.ts` + `routes/git-routes.ts` (B20, B1r). Whichever lands first, the other re-applies at the new path; citations here are pre-move.
- *TT premise partly stale:* `add-trusted-types-report-only` assumes no TT directive exists; it already ships (Context). A task writes its `dependencies.yaml` `blocked_by` this change and notes the stale premise there.
- Archive is the last task. Task notes: write TT's `dependencies.yaml` (D8); confirm `enforce-strict-csp-default` exists with `blocked_by` this change.

## Risks / Trade-offs

- **[Risk]** The strict CSP breaks an unseen inline script in production. → the default stays `report`, so this change cannot break pages; dual Report-Only surfaces the script; the follow-up's soak exit needs zero count, zero dropped and green E2E; opt-in `enforce` rolls back with `PI_DASHBOARD_CSP=report`.
- **[Trade-off] Counter inflation fails safe.** Anyone reaching the sink (e.g. `curl` with a forged `document-uri`) can add strict violations. That can only **delay** the follow-up's flip, never hide a real violation. Bounds: Content-Type gate, 8 KiB cap, non-loopback-exempt limiter, fixed key set. The operator inspects the directive / document breakdown before the flip.
- **[Risk]** Tunnel users share one limiter bucket (`127.0.0.1`), so a flood can push real reports into `dropped`. → `dropped` is counted, and `dropped > 0` blocks the follow-up's exit; the sink is a signal, not access control.
- **[Trade-off] Counter disclosure ignores strict mode.** `canDiscloseAccessPosture` does not consult `requireLocalProof`, so a bare-loopback caller sees the `cspReports` block. Accepted: counts only, no user data.
- **[Trade-off] 7-day idle re-pair.** A cross-origin browser idle >7 d, or any browser past 30 d from pairing, must re-pair. Accepted as the theft ceiling; Electron and CLI users are unaffected. Cross-origin users also re-pair once at upgrade (legacy slot discarded).
- **[Residual] Same-origin keep-failed browsers.** A same-origin browser whose cookie is not yet proven keeps its bearer in the per-origin slot (D5). It never declares `holder:"browser"`, so that bearer is non-expiring until the cookie is proven. Accepted; revoke still kills it.
- **[Risk]** A thief who exfiltrates a browser bearer keeps rotating it. → rotation splits the token (legit client gets 409/401 within the grace); revoke kills the row; the 30-day absolute lifetime caps the window.
- **[Risk]** zrok may rewrite `Host` to the local target, so the D3 loopback+Host branch never fires. → harmless; the no-override case is covered by `resolveRedirectBase`; a task verifies zrok's Host behaviour.
- **[Trade-off] R2 trailing-dot equality.** `https://x.share.zrok.io.` equals the dotless origin. It widens nothing (same host per DNS and host admission) and keeps CORS and host admission consistent.
- **[Risk]** B19 breaks a stale second zrok frontend, or a probe from zrok A to server B. → server-selector's server-side probe fallback; `cors.allowZrokWildcard: true`.
- **[Trade-off] Scenario-name mismatches.** `openspec validate` matches MODIFIED blocks by requirement name, and some baseline scenario names (e.g. server-cors "Empty trusted networks preserves prior behavior") no longer describe the new behaviour. Names are kept so the validator matches; the scenario bodies carry the new truth.
- **[Risk]** B21 limits throttle legitimate fan-out (automation, `/reload`). → the measurement task sets defaults (≥3× peak); limits are configurable via env; refusals are visible.
- **[Risk]** R4 refuses a same-host server older than 0.10.0. → named cause; `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1`.
- **[Residual] R4 same-user rogue process.** A process running as the same user can read the local token and answer counter-proof. Counter-proof only stops other users' listeners; same-user compromise is out of scope.
- **[Risk]** B15r refuses an out-of-tree plugin's undeclared emit. → one actionable warning per (plugin, eventType); CHANGELOG migration note.
- **[Trade-off] B15r trust tier.** The allowlist and the `automation.action.<source>` = provider rule target mistakes and confused deputies. A malicious **trusted** plugin can still declare arbitrary non-reserved event types in its own manifest; trusted plugins are assumed non-hostile.
- **[Risk]** B20 hides a path the user needs. → repo-relative paths and `~` stay; only foreign absolute paths become `<path>`.
- **[Risk]** S1r turns a missing cwd into 400 for clients that relied on `process.cwd()`. → only folder-scoped routes require it (D15 table); a task audits client callers first; the server cwd is not a user folder.
- **[Risk]** S1r breaks MCP agents that relied on the server-cwd fallback. → they must pass `cwd`; the regenerated tool manifest marks it required. The fallback was the hole.
- **[Risk] R1 old clients.** Their inline terminals now open at the session cwd, not the `msg.cwd` they sent. Usually identical; accepted.
- **[Risk]** D22 `sandbox: true` breaks the doctor preload. → a task checks the preload uses only sandbox-safe APIs (`contextBridge`, `ipcRenderer`).
- **[Trade-off] B24 node override shim.** A node override path pointing at a `.cmd`/`.ps1` shim makes the argv probe fail → reported not usable. Accepted.
- **[Risk]** B23 on win32: npm's `npx-cli.js` not resolvable next to node → nano-banana refuses with a clear error instead of falling back to `cmd.exe`.
- **[Risk]** Overlapping changes conflict. → Sequencing and rebase rules above.

## Migration Plan

One landing: every row below ships in one ship-it pass, then the change archives. R4 follows `fix-remote-bridge-ticket-origin`; the change follows `close-container-loopback-impersonation`. B14r is not here (D4). The CSP default flip is not here (`enforce-strict-csp-default`).

| Item | Data / config migration | Rollback |
|---|---|---|
| B17 | None. New mints are 64-hex; every existing secret kept (short ones warn). | Revert the alg pin (no data change). |
| B18 | None. | Revert the log lines. |
| B16r | None. | Revert the predicate; cookies re-issue at next login. |
| B4r | Row gains optional `expiresAt` / `pairedAt` / `previousHash` / `previousExpiresAt`. Client discards the legacy global slot on both paths; the same-origin keep-failed path writes the per-origin slot; cross-origin browsers re-pair once. Legacy rows convert only on explicit declaration. | Server revert: old code ignores the new fields, rows become non-expiring. Client revert: re-pair once. |
| B19 | New config key `cors.allowZrokWildcard` (default `false`). | `cors.allowZrokWildcard: true`. |
| R2 | None. | Revert the helper. |
| S3b | New `~/.pi/dashboard/csp-reports.json` (0600). Reset: `POST /api/csp-reports/reset` (operate) or delete the file while the server is stopped; both start a new `since`. Default stays `report`, dual Report-Only; `enforce` = strict, opt-in. | `PI_DASHBOARD_CSP=report` or `off`, plus restart. |
| B26r | None (doc). | n/a |
| B20 | None. | Revert the boundary call. |
| B1r | None. | Revert the validator. |
| R1 | New `terminal_error` browser message (old clients ignore it). | Revert the handler. |
| S1r | None. | Revert the admission calls. |
| B15r | Manifest `emits` added (in-tree plugins); provider id recorded on `provide`. | Revert the seam check; manifests stay harmless. |
| B21 | New env limits `PI_DASHBOARD_BRIDGE_MAX_BASH`, `PI_DASHBOARD_BRIDGE_PROMPT_RATE`. | Raise limits via env, or revert; shared constants revert together. |
| B22 | None (hub derives the key as before). | Revert; stored origins stay valid. |
| R4 | New opt-out env. | `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1`; revert the bearer gate. |
| R5 | Docs. | n/a |
| B23 | `npx` version pin. | Unpin / revert. |
| B24 | None. | Revert. |

*Compatibility:*
- Old bridge, new server: B15r is server-side; the hub strips credentials for B22.
- New bridge, old (<0.10.0) loopback server: R4 refuses; the opt-out env covers it.
- Old client, new server: no `holder` declaration → non-expiring rows as today; `msg.cwd` on inline terminals ignored.
- No database. All persistence is JSON with optional fields.

## Open Questions

- Can Vite `html.cspNonce` remove the dev-only `script-src` carve-out (D9)? Dev only; the production policy does not change.
