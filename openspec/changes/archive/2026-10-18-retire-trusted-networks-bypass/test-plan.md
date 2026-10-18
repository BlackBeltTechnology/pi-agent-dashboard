# Test Plan — retire-trusted-networks-bypass

Stage: design   Generated: 2026-10-14

Hard gate passed: the one gap (viewer re-mint timing) was answered by the user and folded into `specs/live-server-preview/spec.md` (10 minutes before the absolute `expiresAt`, plus on every reopen).

Fixtures used throughout: listed LAN peer `192.168.16.20`; refused private peer `192.168.16.31`; public peer `198.51.100.23` / `198.51.100.7`; unlisted public `203.0.113.9`; live target id `vite-5173`; second target `docs-8080`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | trusted-networks: Network trust mode (boot decision) | decision-table | L1 | automated | no `network.trustMode`; lists `[]`, `["192.168.16.0/24"]`, `["0.0.0.0/0"]`, `["*.*.*.*"]`, `["127.0.0.1","127.0.0.4/30"]`, `["::1"]`, `["localhost"]`, `["nas.local"]` | server boot | written `trustMode` = pair, legacy, legacy, legacy, pair, pair, legacy, legacy; `trustModeOrigin: "upgrade"` each |
| E2 | trusted-networks: Network trust mode (never re-derived) | state-transition | L1 | automated | stored `trustMode: "pair"` | add `198.51.100.23` to `auth.bypassHosts`, reboot | mode still `pair`; unauthenticated `GET /api/sessions` from `198.51.100.23` → 403 |
| E3 | trusted-networks: Network trust mode (unrecognised value) | EP | L1 | automated | stored `trustMode: "open"` | 100 mode reads + boot | effective `pair`; origin `null`; exactly 1 `[trusted-networks]` warning naming `"open"`; file bytes unchanged |
| E4 | trusted-networks: Network trust mode (unparseable file) | fault-injection (abort) | L1 | automated | `config.json` = `{"auth":` (invalid JSON) | server boot | file bytes unchanged; effective mode `legacy`; exactly 1 `[trusted-networks]` error |
| E5 | trusted-networks: Network trust mode (write failure fallback) | fault-injection (abort) | L1 | automated | empty list; `writeConfigPartial` throws at boot | boot, then HTTP + WS from `192.168.16.20`, then successful `PUT /api/config {network:{trustMode:"legacy"}}` with list `192.168.16.0/24` | before PUT: fallback `pair` at guard and WS; 1 error logged; after PUT: next request admitted without restart |
| E6 | trusted-networks: Network trust mode (origin) | state-transition | L1 | automated | stored `legacy`/`upgrade` | `PUT /api/config {network:{trustMode:"pair"}}`; then PUT same mode; hand-edit `{trustMode:"legacy"}` without origin | origin `operator` after first PUT; unchanged after second; hand edit reads `operator` |
| E7 | trusted-networks: Network trust mode (partial merge) | decision-table | L1 | automated | config with `network` + `auth.bypassHosts` | partial `{network:{trustMode}}`; partial `{auth:{bypassHosts}}`; `GET` redacted config | each partial preserves the other block and `trustModeOrigin`; `network` round-trips through `PUT`/`GET` |
| E8 | design D2 (`isLoopbackOnlyEntry`) | EP | L1 | automated | `127.0.0.1`, `127.0.0.4/30`, `::1`, `0.0.0.0/0`, `*.*.*.*`, `::/0`, `192.168.16.0/24`, `localhost`, `nas.local` | call the helper | true, true, true, false ×6; existing `gateway-config-ops` tests unchanged |
| E9 | trusted-networks: Network match does not authenticate in pair mode | decision-table | L1 | automated | listed peer `192.168.16.20`, no credential; modes pair/legacy | universal hook, per-route guard, OAuth skip, WS (auth on), WS (auth off), observe bearer `POST /api/restart` | pair: 403, 403, auth required, 401, 403, 403 `insufficient_scope`; legacy: admitted, admitted, skipped, 101, 101, not tier-refused |
| E10 | trusted-networks: Network trust mode (live change) | state-transition | L1 | automated | legacy + listed peer | write `pair`, next HTTP + next ticketless WS; write `legacy`, repeat | denied/rejected then admitted, no restart |
| E11 | trusted-networks: Network-only admissions (credential-first ordering) | decision-table | L1 | automated | legacy, auth on, bypass host `192.168.16.0/24` | valid session cookie; expired session cookie; ticketed `/ws` | `authVia = "session"`; no cookie-clearing `Set-Cookie`; ticket consumed + 101 |
| E12 | trusted-networks: Relayed loopback (regression) | decision-table | L1 | automated | `127.0.0.0/8` listed; peer `127.0.0.1` + `X-Forwarded-For` | HTTP + WS in pair and legacy | 403 / rejected in both modes |
| E13 | design D1 (single admission source) | static analysis | L1 | automated | server source tree | `trusted-source-single-predicate.test.ts` | fails if an admission site passes a raw list; named exemptions only: `cors-origin.ts`, WS origin gate, `noteTrustedList`, bind advisory, knock gate |
| E14 | trusted-networks: Network guard factory (hint) | EP | L1 | automated | same denied request in pair and legacy | guard denial | bodies byte-identical; `hint` mentions neither `trustedNetworks` nor the mode |
| E15 | trusted-networks: Network-only admissions (count once) | decision-table | L1 | automated | legacy, listed peer | unauthenticated `GET /api/sessions` (per-route + universal guard); device-cookie request; session request; ticketed WS; ticketless WS | count +1, +0, +0, +0, +1 |
| E16 | trusted-networks: Network-only admissions (bounds) | BVA | L1 | automated | fake clock; 256 peers, oldest re-seen 1 min ago | 257th peer; peer last seen 7 d + 1 ms ago; 50 admissions in 59 min then 1 at 61 min | re-seen kept, LRU evicted; stale peer gone; 1 log line then a 2nd |
| E17 | trusted-networks: Loopback trusted entries are reported as inert (`trustPosture`) | decision-table | L1 | automated | legacy, 2 network-only peers | `/api/health` from local, authenticated, network-admitted LAN, remote unauthenticated | object, object, `null`, `null`; `distinctPeers: 2`; no IP string in any body |
| E18 | network-denial-ring-buffer: Accepting / prompting (pair) | decision-table | L1 | automated | pair, prompting on, operator channel | denial from `192.168.16.30`; `POST /api/tunnel/block-events` accept; CORS denial | block event recorded, no network prompt; 403 + config unchanged; CORS prompt raised |
| E19 | lan-knock-pairing: Configured networks extend knock eligibility | decision-table | L1 | automated | `acceptLanRequests` on/off; lists `198.51.100.0/24`, `0.0.0.0/0`, `127.0.0.0/8` | knock from `198.51.100.7`; unlisted `203.0.113.9`; listed + `X-Forwarded-For`; `0.0.0.0/0` + `203.0.113.9`; `127.0.0.1` + XFF; setting off | pending device (no bearer until approval); address-gate code ×4; setting-disabled code |
| E20 | live-server-preview: capability (mint) | EP | L1 | automated | targets `vite-5173`; principals observe/control; unknown id `nope` | `POST /api/live-server/:id/capability` | 403 `insufficient_scope` no token; 200 `{path:"/live/vite-5173/~c/<t>/", expiresAt = now+12h}` with `<t>` ≥ 22 base64url chars; 404; store holds only a hash |
| E21 | live-server-preview: capability (accept / path matching) | EP | L1 | automated | valid token for `vite-5173` | paths: valid; `/live/docs-8080/~c/<t>/`; `<t>evil/`; `%7Ec`; `x/../~c/<t>/`; no trailing `/`; `/api/sessions?c=<t>` | only the first admitted |
| E22 | live-server-preview: capability (lifetime) | BVA | L1 | automated | fake clock | use at 29:59 idle; at 30:00 idle; continuous use to 12 h − 1 ms; at 12 h | admitted (extends); refused; admitted; refused |
| E23 | live-server-preview: capability (invalidation) | state-transition | L1 | automated | valid tokens minted by device A / by session S | remove target; revoke device A; log out S; restart store | each next use refused |
| E24 | live-server-preview: capability (identity floor) | decision-table | L1 | automated | floor enforced/not; token minted by device / by identity principal | `/live/vite-5173/~c/<t>/ws` upgrade | enforced+device → refused; enforced+identity → 101; not enforced+device → 101 |
| E25 | live-server-preview: capability (forwarding) | EP | L1 | automated | real upstream echo server | GET under capability with `Referer` containing `<t>`; upstream 302 `/login`, `./x`, `http://127.0.0.1:5173/y`; response with/without own `Referrer-Policy` | upstream path + `Referer` without `/~c/<t>`; `Location` inside capability prefix ×3; `Referrer-Policy: no-referrer` only when absent; captured logs contain no `<t>` |
| E26 | live-server-preview: Dashboard credentials never reach the preview upstream | EP | L1 | automated | upstream echo for HTTP + WS | `Cookie: pi_dash_token=a; pi_dash_device=b; myapp_session=c`; `Cookie: pi_dash_token=a`; `Authorization: Bearer <device bearer>` / `<app token>`; upstream `Set-Cookie: pi_dash_token=x` + `myapp_session=y` | upstream sees `Cookie: myapp_session=c`; no `Cookie` header; device bearer removed / app token kept; browser receives only `myapp_session` |
| E27 | trust-and-credential-boundaries: live capability never opens a core socket | EP | L1 | automated | valid capability token | `/ws`, `/ws/terminal/x`, `/ws/bridge` presenting the token in path/query | all rejected |

### Performance

None — no requirement in this change states a latency, throughput or memory threshold. Telemetry is O(1) per admission by design (bounded map); not separately measured.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | settings-panel: Trusted Networks section (mode radio) | state-transition | L1 | automated | saved `legacy` | open Security; add an entry; select Pair; Save | "Trust whole networks" checked after add; no write before Save; Save body has `network.trustMode: "pair"` |
| F2 | settings-panel: consequence callout | decision-table | L1 | automated | saved legacy, draft pair × `distinctPeers` 3 / 0 / posture `null` × `acceptLanRequests` on/off | render | "3 device addresses" / no count / generic copy; operate-tier + in-page notes present; checkbox present **unchecked** only when off; checking + Save writes `pairing.acceptLanRequests: true` |
| F3 | settings-panel: mode-dependent copy | decision-table | L1 | automated | mode pair / legacy (with and without migration callout) | render | heading "Networks that may request access" + no full-access warning / heading "Trusted networks — admitted without sign-in" + warning only when no migration callout; wide copy matches mode |
| F4 | settings-panel: refused peers in pair | EP | L1 | automated | pair; block events `192.168.16.31` (private) + `198.51.100.23` (ineligible) | render; click allow-requests | info row with no `block-event-trust-*` testid; draft `auth.bypassHosts` gains exactly `198.51.100.23` |
| F5 | settings-panel: pair + LAN requests off; unknown value | EP | L1 | automated | pair + `acceptLanRequests` off; stored `"open"` | render | info callout with control; Pair checked + warning naming `"open"` |
| F6 | settings-panel: Order | state | L1 | automated | legacy with advisory, migration callout, refused peers, entries | render | DOM order radio → callout → heading → advisory → refused rows → list → add → warning |
| F7 | trusted-networks: Access migration banner; access-settings-tab deltas | decision-table | L1 | automated | (legacy, upgrade, 3) / (legacy, operator, 1) / (pair) / (legacy, posture null); pending CORS + network denial in pair | render Access | warning / info / none / none; headings by mode; composition test: only revoke buttons; no network pending row in pair, CORS row answerable |
| F8 | connection-status-banner: Network-not-allowed | EP | L1 | automated | `networkDenied` + knock idle / pending / refused (`knock_disabled`) | render, click Request access | Request access primary + Settings → Servers secondary; pending text with code; refusal reason; no `amber-` classes |
| F9 | live-server-preview: viewer mint + re-mint | state-transition (fake timers) | L1 | automated | mint returns `expiresAt = t0+12h` | open viewer; advance to 11:49:59; to 11:50:00; close + reopen | iframe `src` = capability path, sandbox token set unchanged; no re-mint at 11:49:59; new mint + new `src` at 11:50:00; reopen mints again |
| F10 | trusted-networks: pair mode end to end | state-transition | L3 | automated | harness with `network.trustMode: "pair"` and list covering the harness client network | open dashboard from the Playwright browser (non-loopback peer); then `PUT network.trustMode: "legacy"` via local admin; reload | denied bar with Request access, guarded API 403; after switch, sessions list loads without server restart |
| F11 | live-server-preview: remote preview via capability | state-transition | L3 | automated | harness in pair mode; browser paired at `control` (via existing pairing fixture); fixture target serving HTML + script + image + `fetch` + WS echo | open the target in the live viewer | browser network log: page, script, image, fetch 2xx and WS 101 under `/live/<id>/~c/…/`; no `pi_dash_*` cookie at the fixture upstream |
| F12 | ui (mockup parity) | visual/subjective | — | manual-only | Security, Access, denied bar | compare with `mockups/network-trust.html` in base dark, base light, nord dark | [judgment: matches mockup, nothing clipped] |
| F13 | live-server-preview (real HMR) | hardware/network | — | manual-only | phone on the LAN paired at `control`, Vite target | edit a source file | [judgment: preview hot-reloads without a manual refresh] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | live-server-preview: capability (forwarding) | fault-injection (abort) | L1 | automated | upstream for `vite-5173` stopped | GET under a valid capability | same error status as today's `/live/<id>/` path for a down target; token absent from the logged error |
| X2 | trusted-networks: Network trust mode (upgrade on a real install) | migration | — | manual-only | existing install with `auth.bypassHosts: ["192.168.x.0/24"]` | upgrade + restart; use a LAN phone; open Access on the host | [judgment: `config.json` gains `legacy`/`upgrade`; phone keeps working; banner counts it] |

---

## Coverage summary

- Requirements covered: every ADDED/MODIFIED requirement in the 12 delta files has ≥1 row (MODIFIED-only wording changes in `auth-bypass-url-list` / `oauth-authentication` are covered by E9/E11).
- Scenarios by class: edge 27 · perf 0 · frontend 13 · error 2
- Scenarios by level: L1 37 · L2 0 · L3 2 · manual 3
- Scenarios by disposition: automated 39 · manual-only 3

## New infra needed

- F11 needs a small live-server fixture target in the docker harness (HTML + script + image + `fetch` + WS echo). Extend the target used by `tests/e2e/live-server-downloads.spec.ts` rather than adding a new service.
