# Test Plan — add-session-ui-deep-links-for-agents

Stage: design   Generated: 2026-10-24

No clarifications are outstanding. The hard gate passed: every Triple below is concrete. The zrok header behaviour is a **spike task** (tasks 2.1), not a scenario gap. Its outcome either confirms E3/M2 or hands planning back.

Harness facts used:
- **L1 server routes.** `fastify.inject` against `registerSessionRoutes`, as in `packages/server/src/__tests__/session-routes-custom-entry.test.ts`.
- **L1 base resolver.** Pure-function cases, as in `packages/server/src/__tests__/auth-redirect-base.test.ts` and `packages/server/src/__tests__/host-admission.test.ts`.
- **L1 client.**
  - Pure resolution: `packages/client/src/lib/session/__tests__/selectedSessionId.test.ts`.
  - Shell arms: `packages/client/src/components/shell/__tests__/ShellContent.test.tsx`.
  - Snapshot / page merge: `packages/client/src/hooks/__tests__/useMessageHandler.snapshot-replace.test.tsx`.
  - Login: `packages/client/src/lib/identity/__tests__/login-session.test.ts` and `dashboard-login.test.ts`.
- **L1 plugin docs.** `scripts/__tests__/claude-plugin-parity.test.mjs` and `scripts/__tests__/claude-plugin-structure.test.mjs`.
- **L3.** The docker harness port comes from `.pi-test-harness.json` (`dashboardPort`), never `:18000`.
  - Seeding 120+ ended sessions to push one out of the snapshot window: `tests/e2e/sessions-page-stub-group.spec.ts`.
  - Forced WebSocket reconnect: `tests/e2e/paging-exhausted-reconnect-rearm.spec.ts`.
  - Mobile viewport: `tests/e2e/mobile-viewport-bound.spec.ts`.
  - Archive while viewing: `tests/e2e/archive-fold.spec.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | dashboard-server "Session list carries UI links" (`sessionUiPath`, D2) | EP | L1 | automated | ids `abc`, `a/b c`; views none / `diff` / `editor` | call `sessionUiPath` | `/session/abc`, `/session/abc/diff`, `/session/abc/editor`, `/session/a%2Fb%20c` |
| E2 | dashboard-server "UI link base resolution" — configured match | decision-table | L1 | automated | configured: `publicBaseUrls=["https://pi.example.com/"]`, live tunnels `https://abc.share.zrok.io` (primary) + `https://custom.share.zrok.io` | `resolveRequestUiBase` with (a) `Host: pi.example.com:443`; (b) `Host: abc.share.zrok.io`; (c) `Host: custom.share.zrok.io`; (d) `Host: localhost:8000` + `X-Forwarded-Host: abc.share.zrok.io` | (a) `https://pi.example.com` (trailing slash stripped); (b) `https://abc.share.zrok.io`; (c) `https://custom.share.zrok.io`; (d) `https://abc.share.zrok.io` |
| E3 | "UI link base resolution" — forwarded-header precedence and spoofing | decision-table | L1 | automated | same config; host admission admits `localhost`, `pi.example.com` | (a) `Host: localhost:8000`, `X-Forwarded-Host: evil.example, abc.share.zrok.io`; (b) `Host: pi.example.com`, `X-Forwarded-Host: other.example`; (c) `Host: localhost:8000`, `X-Forwarded-Host: evil.example` | (a) `http://localhost:8000` (only the first XFH value is read, it does not match, so `Host` is used); (b) `https://pi.example.com`; (c) `http://localhost:8000`; no result contains `evil.example` |
| E4 | "UI link base resolution" — normalized output | EP + BVA (port 1 / 65535 / 65536) | L1 | automated | admitted hosts, protocol `http` | (a) `Host: LOCALHOST:8000`; (b) `Host: [::1]:8000`; (c) `Host: localhost:1`; (d) `Host: localhost:65535`; (e) `Host: localhost:65536`; (f) `Host: localhost:abc` | (a) `http://localhost:8000`; (b) `http://[::1]:8000`; (c) `http://localhost:1`; (d) `http://localhost:65535`; (e) `http://localhost` (out-of-range port dropped); (f) `http://localhost:8000` (`parseHostname` rejects the non-numeric port, so the host is not admitted and the fallback applies) |
| E5 | "UI link base resolution" — fallback | decision-table | L1 | automated | port 8000, tunnel `https://abc.share.zrok.io` live, host gate `report` | (a) no `Host`; (b) `Host: evil.example` (not admitted, not configured) | both `http://localhost:8000`; neither contains `abc.share.zrok.io` |
| E6 | "Session list carries UI links" (route mapping, owner filter, no persistence) | EP | L1 | automated | registry: 2 sessions owned by principal A, 1 by B; request as A with `Host: localhost:8000` | `GET /api/sessions` | `data` has 2 rows, each `uiUrl === "http://localhost:8000" + sessionUiPath(id)` and `diffUrl === uiUrl + "/diff"`; B's row absent; `sessionManager.get(id)` has no `uiUrl` key afterwards |
| E7 | dashboard-server "Session list id filter" | BVA (7 / 8 chars) + EP | L1 | automated | sessions `01a16086-aaaa…` and `01a16086-bbbb…` visible; `ffff0000-…` (ended) visible; `cccc1111-…` owned by another principal | (a) `?id=01A16086`; (b) `?id=01a1608`; (c) `?id=<full ffff… id>`; (d) `?id=<cccc… full id>`; (e) `?id=a&id=b`; (f) no `id` | (a) 2 rows; (b) 0 rows; (c) exactly the ended row, with `uiUrl`; (d) 0 rows; (e) HTTP 400; (f) same rows as before this change, plus link fields |
| E8 | url-routing "Session id prefix resolution" (`resolveSessionRouteId`) | decision-table + BVA | L1 | automated | ids `01a16086-aaaa-…`, `01a16086-bbbb-…`, `deadbeef-0000-…`, `deadbeef`, `cafe1234-5678-…` | resolve (a) `deadbeef`; (b) `DEADBEEF-0000-…` (full, uppercase); (c) `cafe1234`; (d) `CAFE1234`; (e) `01a16086`; (f) `cafe123`; (g) `nope0000` | (a) exact `deadbeef` (raw exact wins over the prefix of `deadbeef-0000-…`); (b) `deadbeef-0000-…`; (c) and (d) `cafe1234-5678-…`; (e) ambiguous with both `01a16086-*`; (f) none (7 chars); (g) none |
| E9 | claude-code-plugin "Derived reference carries UI routes"; pi-dashboard-skill "API reference documents UI routes" | EP | L1 | automated | extension `api-reference.md` with `## UI routes (browser)` inserted after the bus-verbs closing `---` | run `transformApiReference(source)`, then the parity test | derived output contains `## UI routes (browser)` and every route string from the "Route table complete" scenario, including `/folder/:encodedCwd/openspec/archive`; the `## WebSocket bus verbs` heading is absent; parity passes; the derivation is byte-equal to the committed plugin file |
| E10 | pi-dashboard-skill "API reference documents the encodedCwd encoding" | EP + BVA (UTF-8 byte length mod 3 = 0/1/2, chars mapping to `+` `/`) | L1 | automated | paths `/Users/me/proj`, `/home/münchen`, `/a?>~`, `/ab`, `/abc` | run the documented one-liner `printf %s "$CWD" \| base64 \| tr '+/' '-_' \| tr -d '=\n'` via `execFileSync('sh')`, and `encodeFolderPath(path)` | outputs byte-equal for all 5; no `=`, `+`, `/` or newline in the output |
| E11 | url-routing "Embed mode toggle" (`useEmbedMode`) | state-transition | L1 | automated | `sessionStorage` empty | locations in order: `/session/x?embed=1` → `/session/x/diff` → `/?embed=0` → `/session/x` | returns true, true, false, false; key `pi-dash-embed` is `"1"` after step 1 and absent after step 3 |
| E12 | url-routing "Leaving embed mode keeps other parameters" | EP | L1 | automated | embed on; locations `/session/x?archived=1`, `/session/x?embed=1&focus=terminal`, `/` | click `embed-exit` | `navigate` called with `{replace:true}` and `/session/x?archived=1&embed=0`, `/session/x?focus=terminal&embed=0`, `/?embed=0` respectively |
| E13 | url-routing "Refresh at session URL with unknown ID" / "Ambiguous prefix lists candidates" (`SessionNotFound`) | EP | L1 | automated | props (a) `id="nope"`; (b) `id="01a16086"`, candidates `[01a16086-aaaa…, 01a16086-bbbb…]`; (c) `id="x"`, `lookupFailed` | render, click "Back to sessions", click retry in (c) | `data-testid="session-not-found"`; the id is in a `<code>`; hint text mentions `GET /api/sessions` and `?archived=1`; (b) 2 links to `/session/<full>`; back calls `navigate("/")`; (c) retry calls `onRetry` once |
| E14 | claude-code-plugin "Control skill shows a session in the browser" / "UI links never carry credentials" / "Listing with auth enabled" | EP | L1 | automated | `packages/claude-plugin/skills/pi-dashboard-control/SKILL.md` | structure test reads the file | contains the heading `View a session in the browser`, the strings `uiUrl`, `?embed=1`, `/api/sessions/archived`, `?archived=1`, the "When a call is refused" cross-reference, and a never-token-in-URL sentence; no new `METHOD /api/...` outside the registered set (parity route check passes) |

### Performance

None. The change adds no latency, throughput or memory requirement. The server lookup is one owner-filtered in-memory filter per route visit per connection.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | url-routing "Not found is not shown before the snapshot" / "No subscription before resolution" / "Pending placeholder" | state-transition | L1 | automated | hook `useSessionRouteResolution("abc")`, `snapshotGeneration=0`, `sessions` empty | render, then set `snapshotGeneration=1` with `abc` in `sessions` | before: `status="pending"`, `canonicalId=undefined`; after: `status="ok"`, `canonicalId="abc"`; `notFound` never emitted |
| F2 | url-routing "Reconnect keeps the open session" | state-transition | L1 | automated | resolved `ok` for `abc` | set `snapshotGeneration=0` and clear `sessions` (reconnect), then deliver a snapshot containing `abc` | `canonicalId` stays `"abc"` in every intermediate render; `status` never `pending`, `notFound` or `vanished` |
| F3 | url-routing "Session archived while viewing" / "Server switch away from an open session" | state-transition | L1 | automated | resolved `ok` for `abc` | (a) remove `abc` from `sessions` (archive); lookup returns `[]`; (b) server switch: generation 0, new snapshot without `abc`, lookup `[]` | `status="vanished"` only after the lookup resolves empty; `navigate("/", {replace:true})` called exactly once in each case |
| F4 | url-routing "Session ended while viewing" | state-transition (illegal-edge check) | L1 | automated | resolved `ok` for `abc` | apply the `session_removed` reducer (row kept, `status:"ended"`) | `status` stays `ok`; `navigate` never called |
| F5 | url-routing "Ended session outside the snapshot window" (merge rules) | state-convergence | L1 | automated | snapshot without `old1`; mocked `GET /api/sessions?id=old1` returns a row with `notifyLog:[…]`, `uiUrl`, `diffUrl` | hook resolves `old1` | exactly one fetch per connection; `sessions.get("old1")` has none of `notifyLog`, `uiUrl`, `diffUrl`; `sessionOrderMap` and `endedTotals` are reference-equal before and after; `status="ok"` |
| F6 | url-routing "Reconnect while viewing a looked-up ended session" | state-transition | L1 | automated | `old1` resolved through the lookup | reconnect: generation 0, snapshot without `old1` | a second lookup is issued for the new connection; `canonicalId` stays `old1` throughout; `navigate` never called |
| F7 | url-routing "Ambiguous prefix" (race) | state-convergence | L1 | automated | route `01a16086`, `sessions` holds one match | before the replace effect flushes, add a second `01a16086-*` session | final `status="ambiguous"` with 2 candidates; `navigate` to a full id never called |
| F8 | design D3 merge rule (looked-up row vs later paging) | state-convergence | L1 | automated | `old1` merged by the lookup (not in the order map) | dispatch `sessions_page_result` for its group with order `[…, old1, …]` | `old1` appears exactly once in `sessionOrderMap.get(group)`, at the page position |
| F22 | session-listing "Looked-up sessions do not affect paging" | state-transition | L1 | automated | group `g`: `endedTotals[g]=200`, no paged ids held; `old1` (ended, group `g`) merged by the lookup | expand `g`'s ended list; then deliver `sessions_page_result` containing `old1` and expand again | first request is `sessions_page {cwd:g, offset:0}`; after the page result, `old1` counts toward the next offset (offset = page size) and appears once in `sessionOrderMap.get(g)` |
| F9 | url-routing "Prefix never selects a non-canonical id" / "Uppercase full id is canonicalized"; Placement (ShellContent arms) | decision-table | L1 | automated | `ShellContent` with prop `sessionRoute` = `{status:"ok", canonicalId:"full-1"}` / `notFound` / `ambiguous` / `pending` | route `/session/01a16086`, `/session/x/diff` (mobile), `/session/x/editor` | `ok` → `renderSession("full-1")` / `renderDiff("full-1")`, never called with the raw route id; `notFound` / `ambiguous` → `renderSessionNotFound` on all 3 routes; `pending` → `session-resolving` placeholder |
| F10 | url-routing "Embed session view hides the sidebar" / "Overlay routes still work in embed" | state-convergence | L3 | automated | harness with 1 seeded live session; viewport 1024×768 | open `/session/<id>?embed=1`, then navigate to `/settings` | chat composer visible; `[data-testid="session-list"]`, the sidebar resize handle and the hamburger count 0; at `/settings` the settings panel is visible and the sidebar still counts 0 |
| F11 | url-routing "Embed persists across in-app navigation" | state-transition | L3 | automated | same; embed on | click the session's diff entry (URL becomes `/session/<id>/diff`, no query) | diff view visible; sidebar count 0; `sessionStorage['pi-dash-embed']==="1"` |
| F12 | url-routing "Narrow embed shows the session, not the list"; app-decomposition "Mobile layout in embed mode" | state-transition | L3 | automated | viewport 400×800, 1 seeded session | open `/session/<id>?embed=1`, then press the header back button | first: session detail visible; after back: URL `/`, embed home message visible, 0 session cards |
| F13 | url-routing "Unique prefix resolves" | state-convergence | L3 | automated | 1 seeded session `<id>` | open `/session/<first 8 chars>/diff?embed=1` | converges to `page.url()` ending `/session/<id>/diff?embed=1`; diff visible; `page.goBack()` never lands on the 8-char URL |
| F14 | url-routing "Refresh at session URL with unknown ID" | state-convergence | L3 | automated | harness with ≥ 1 seeded session; viewport 1280×800 | open `/session/does-not-exist` and wait until the sidebar shows the seeded session (snapshot applied) | `session-not-found` visible, containing `does-not-exist`; URL unchanged after a further `expect.poll` window of 2 s |
| F15 | url-routing "Ended session outside the snapshot window" | state-convergence | L3 | automated | seed 130 ended sessions in one group, so the oldest falls outside `SNAPSHOT_ENDED_GLOBAL=120` (seeding as in `sessions-page-stub-group.spec.ts`) | open `/session/<oldest id>` | one request to `/api/sessions?id=<oldest id>`; that session's header shows its name; `session-not-found` count 0 |
| F16 | url-routing "Unknown ID on the desktop diff route" | state-convergence | L3 | automated | viewport 1280×800 | open `/session/does-not-exist/diff`, recording network requests | `session-not-found` visible; zero requests whose URL contains `session-diff` and `does-not-exist` |
| F17 | url-routing "Leaving embed mode keeps other parameters" | state-transition | L3 | automated | embed on at `/session/<id>` | click `embed-exit` | URL ends `?embed=0`; sidebar visible; `history.length` unchanged by the click |
| F18 | url-routing "Reconnect keeps the open session" | state-transition | L3 | automated | viewing `/session/<id>` with the chat rendered | force a WebSocket reconnect (as in `paging-exhausted-reconnect-rearm.spec.ts`) | across the reconnect, `session-not-found` and `session-resolving` each count 0 at every poll; the chat container stays attached (same element handle) |
| F19 | url-routing "Session archived while viewing" | state-transition | L3 | automated | viewing an ended session `/session/<id>` | archive it through the session menu (as in `archive-fold.spec.ts`) | URL converges to `/`; `session-not-found` count 0 |
| F20 | url-routing "Independent tab is not affected" | EP | L3 | automated | page A opened `/session/<id>?embed=1` | open a new page in a fresh browser context at `/session/<id>` | page B shows the sidebar; page A still has no sidebar |
| F21 | url-routing "Embed home has no session list" (appearance) | visual/subjective | — | manual-only | embed home message and `SessionNotFound` on base dark / base light | a human looks at both at 400 px and 1280 px | [judgment: the message is readable, the exit control is discoverable, and the layout does not look broken — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | url-routing "Lookup failure" | fault-injection (abort) | L1 | automated | mocked `GET /api/sessions?id=x` rejects (network error), then returns 503 | the hook resolves `x` after the snapshot; then call `retry()` | after each failure `status="notFound"` with `lookupFailed=true`; `navigate("/")` never called; `retry()` issues exactly one new fetch |
| X2 | url-routing "Lookup requires sign-in" | fault-injection (auth) | L1 | automated | mocked lookup returns 401, then 403 | the hook resolves `x` | the auth-loss handler (`loginRedirectFor` path) is invoked with the current path and query; `status` is never `notFound` |
| X3 | url-routing "Embed survives sign-in" | EP | L1 | automated | path `/session/x`, search `?embed=1` | (a) `loginRedirectFor("auth_required", "/session/x", "?embed=1")`; (b) the OAuth return-to stash for the same location (`dashboard-login` helper) | (a) and (b) targets contain `/session/x?embed=1`; neither contains `token=`, `access_token=` or `Authorization` |
| X4 | dashboard-server "UI link base resolution" — live tunnel through real zrok | fault/env (external) | — | manual-only | real zrok public share to the local dashboard | `curl https://<share>/api/sessions` with an observe token | [judgment/env: needs an internet tunnel unavailable in CI; observable: every `uiUrl` starts with `https://<share>/session/`. Pre-checked by spike task 2.1] |
| X5 | claude-code-plugin "Agent shows a session to the user" (end to end) | env (external app) | — | manual-only | Claude desktop app with the plugin installed and its browser pane | ask the agent "show me session X" | [judgment/env: requires the Claude desktop app; the pane opens `uiUrl?embed=1` and shows the chat without a sidebar] |

---

## Coverage summary

- Requirements covered: 18/18. That is url-routing 5 (incl. the MODIFIED one), app-decomposition 1, dashboard-server 3, session-listing 1, claude-code-plugin 2, pi-dashboard-skill 2, plus 4 design-level invariants (D3 merge, D3 race, D1 normalization, D6 placement).
- Scenarios by class: edge 14 · perf 0 · frontend 22 · error 5
- Scenarios by level: L1 27 · L2 0 · L3 11 · manual 3
- Scenarios by disposition: automated 38 · manual-only 3

## New infra needed

None. Every L3 row reuses existing harness glue: seeding, forced reconnect, mobile viewport, archive action. E10 runs `sh` from vitest, which is already done in `scripts/__tests__/claude-plugin-ensure-dashboard.test.mjs`.
