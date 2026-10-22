# Tasks

TDD throughout: write each test task first, watch it fail, then implement. Rebuild per the `implement` skill: server and shared changes need `/api/restart`; client changes need a build plus restart. Test tasks reference rows in `test-plan.md`.

## 1. Shared helper and types (design D1, D2)

- [x] 1.1 L1 test, exemplar `packages/client/src/lib/session/__tests__/selectedSessionId.test.ts` (new `packages/shared/src/__tests__/session-ui-path.test.ts`). Input: ids `abc` and `a/b c`, views none / `diff` / `editor`. Trigger: call `sessionUiPath`. Expect: `/session/abc`, `/session/abc/diff`, `/session/abc/editor`, `/session/a%2Fb%20c` (test-plan #E1).
- [x] 1.2 Implement `packages/shared/src/session-ui-path.ts` (`sessionUiPath`). In `packages/shared/src/rest-api.ts`, add `SessionListItem = DashboardSession & { uiUrl: string; diffUrl: string }` and retype `ListSessionsResponse`. `DashboardSession` stays as it is. Add AGENTS.md rows.

## 2. Server: UI links and id filter (design D1, spec dashboard-server)

- [x] 2.1 Spike, no code merged. Run `GET /api/sessions` through a live zrok public share with request-header logging, and record whether `Host` or `X-Forwarded-Host` carries the share host. If neither does, stop and write `SHIP_IT_BLOCKED.md`; design D1 needs revision. If one does, record which header in design.md D1 "Gate".
- [x] 2.2 L1 test, exemplar `packages/server/src/__tests__/auth-redirect-base.test.ts` (new `packages/server/src/__tests__/ui-link-base.test.ts`).
  - Setup: `publicBaseUrls=["https://pi.example.com/"]`; live tunnels `https://abc.share.zrok.io` (primary) and `https://custom.share.zrok.io`.
  - Trigger: `resolveRequestUiBase` with:
    - (a) `Host: pi.example.com:443`;
    - (b) `Host: abc.share.zrok.io`;
    - (c) `Host: custom.share.zrok.io`;
    - (d) `Host: localhost:8000` plus `X-Forwarded-Host: abc.share.zrok.io`.
  - Expect: (a) `https://pi.example.com`; (b) `https://abc.share.zrok.io`; (c) `https://custom.share.zrok.io`; (d) `https://abc.share.zrok.io` (test-plan #E2).
- [x] 2.3 L1 test, exemplar `packages/server/src/__tests__/host-admission.test.ts` (same file as 2.2).
  - Setup: same config; `localhost` and `pi.example.com` admitted.
  - Trigger:
    - (a) `Host: localhost:8000`, `X-Forwarded-Host: evil.example, abc.share.zrok.io`;
    - (b) `Host: pi.example.com`, `X-Forwarded-Host: other.example`;
    - (c) `Host: localhost:8000`, `X-Forwarded-Host: evil.example`.
  - Expect: (a) `http://localhost:8000`; (b) `https://pi.example.com`; (c) `http://localhost:8000`. No result contains `evil.example` (test-plan #E3).
- [x] 2.4 L1 test, exemplar `packages/server/src/__tests__/host-admission.test.ts` (same file).
  - Setup: admitted hosts, protocol `http`.
  - Trigger, by `Host`:
    - (a) `LOCALHOST:8000`;
    - (b) `[::1]:8000`;
    - (c) `localhost:1`;
    - (d) `localhost:65535`;
    - (e) `localhost:65536`;
    - (f) `localhost:abc`.
  - Expect:
    - (a) `http://localhost:8000`;
    - (b) `http://[::1]:8000`;
    - (c) `http://localhost:1`;
    - (d) `http://localhost:65535`;
    - (e) `http://localhost`;
    - (f) `http://localhost:8000` (malformed port, not admitted, fallback).
  - (test-plan #E4)
- [x] 2.5 L1 test, exemplar `packages/server/src/__tests__/auth-redirect-base.test.ts` (same file).
  - Setup: port 8000, tunnel live, host gate in `report` mode.
  - Trigger: (a) no `Host`; (b) `Host: evil.example`, which is neither admitted nor configured.
  - Expect: both give `http://localhost:8000`, and neither contains `abc.share.zrok.io` (test-plan #E5).
- [x] 2.6 Implement `packages/server/src/routes/ui-link-base.ts` (`resolveRequestUiBase`). Inputs:
  - `parseHostname` / `hostnameFromUrl` from shared;
  - `isHostAdmitted`;
  - the `getLiveTunnelOrigins` provider;
  - `resolvePublicBaseUrls`;
  - `auth.redirectBaseUrl`;
  - the port.
  Never enable `trustProxy`. Add an AGENTS.md row.
- [x] 2.7 L1 test, exemplar `packages/server/src/__tests__/session-routes-custom-entry.test.ts` (new `packages/server/src/__tests__/session-routes-ui-links.test.ts`).
  - Setup: 2 sessions owned by principal A and 1 by B; request as A with `Host: localhost:8000`.
  - Trigger: `GET /api/sessions`.
  - Expect:
    - 2 rows, each with `uiUrl === "http://localhost:8000" + sessionUiPath(id)` and `diffUrl === uiUrl + "/diff"`;
    - B's row is absent;
    - the stored session gains no `uiUrl` key.
  - (test-plan #E6)
- [x] 2.8 L1 test, exemplar `packages/server/src/__tests__/session-routes-custom-entry.test.ts` (same file as 2.7).
  - Setup: two visible `01a16086-*` sessions, one visible ended `ffff…` session, and `cccc…` owned by someone else.
  - Trigger:
    - (a) `?id=01A16086`;
    - (b) `?id=01a1608`;
    - (c) `?id=<ffff full>`;
    - (d) `?id=<cccc full>`;
    - (e) `?id=a&id=b`;
    - (f) no `id`.
  - Expect:
    - (a) 2 rows;
    - (b) 0 rows;
    - (c) the ended row with `uiUrl`;
    - (d) 0 rows;
    - (e) HTTP 400;
    - (f) the existing rows plus link fields.
  - (test-plan #E7)
- [x] 2.9 Implement the mapping and `id` filter in `packages/server/src/routes/session-routes.ts` `GET /api/sessions`. Apply both after `filterOwned`. A non-string `id` returns 400. Update the AGENTS.md row.

## 3. Client: resolution, canonical id, not-found (design D3, D4, spec url-routing)

- [x] 3.1 L1 test, exemplar `packages/client/src/lib/session/__tests__/selectedSessionId.test.ts` (new `resolve-session-route-id.test.ts`).
  - Setup: held ids `01a16086-aaaa-…`, `01a16086-bbbb-…`, `deadbeef-0000-…`, `deadbeef`, `cafe1234-5678-…`.
  - Trigger, resolving:
    - (a) `deadbeef`;
    - (b) `DEADBEEF-0000-…`;
    - (c) `cafe1234`;
    - (d) `CAFE1234`;
    - (e) `01a16086`;
    - (f) `cafe123`;
    - (g) `nope0000`.
  - Expect:
    - (a) exact `deadbeef`;
    - (b) `deadbeef-0000-…`;
    - (c) and (d) `cafe1234-5678-…`;
    - (e) ambiguous with both candidates;
    - (f) and (g) none.
  - (test-plan #E8)
- [x] 3.2 Implement `packages/client/src/lib/session/resolve-session-route-id.ts`.
- [x] 3.3 L1 test, exemplar `packages/client/src/components/shell/__tests__/ShellContent.test.tsx` (new `packages/client/src/components/session/__tests__/SessionNotFound.test.tsx`).
  - Setup: (a) `id="nope"`; (b) `id="01a16086"` plus 2 candidates; (c) `lookupFailed`.
  - Trigger: render, click back, click retry.
  - Expect:
    - `session-not-found` testid, with the id in `<code>`;
    - the hint mentions `GET /api/sessions` and `?archived=1`;
    - (b) has 2 links to `/session/<full>`;
    - back calls `navigate("/")`;
    - retry calls `onRetry` once.
  - (test-plan #E13)
- [x] 3.4 Implement `packages/client/src/components/session/SessionNotFound.tsx` and the `session-resolving` placeholder. Add i18n keys `session.notFound.title`, `.hint`, `.back`, `.candidates`, `.retry`, and `session.resolving` in en / hu / zh-CN. Verify `i18n.test.ts` and `i18n-orphans.test.ts` pass.
- [x] 3.5 L1 test, exemplar `packages/client/src/hooks/__tests__/useMessageHandler.snapshot-replace.test.tsx` (new `packages/client/src/hooks/__tests__/useSessionRouteResolution.test.tsx`).
  - Setup: route `abc`, `snapshotGeneration=0`, empty `sessions`.
  - Trigger: render, then generation 1 with `abc` held.
  - Expect: first `pending` with `canonicalId` undefined, then `ok` with `abc`; never `notFound` (test-plan #F1).
- [x] 3.6 L1 test, same file, exemplar `useMessageHandler.snapshot-replace.test.tsx`.
  - Setup: `abc` resolved `ok`.
  - Trigger: reconnect (generation 0, `sessions` cleared), then a snapshot with `abc`.
  - Expect: `canonicalId` is `"abc"` in every render, and `status` is never `pending`, `notFound` or `vanished` (test-plan #F2).
- [x] 3.7 L1 test, same file, exemplar `useMessageHandler.snapshot-replace.test.tsx`.
  - Setup: `abc` resolved `ok`.
  - Trigger: (a) `abc` removed from `sessions` and the lookup returns `[]`; (b) server switch, then a snapshot without `abc` and a lookup returning `[]`.
  - Expect: `vanished` only after the lookup resolves, and `navigate("/", {replace:true})` exactly once in each case (test-plan #F3).
- [x] 3.8 L1 test, same file, exemplar `packages/client/src/hooks/__tests__/useMessageHandler.archive-session-error.test.tsx`.
  - Setup: `abc` resolved `ok`.
  - Trigger: apply the `session_removed` reducer (row kept, `status:"ended"`).
  - Expect: `status` stays `ok` and `navigate` is not called (test-plan #F4).
- [x] 3.9 L1 test, same file, exemplar `useMessageHandler.snapshot-replace.test.tsx`.
  - Setup: a snapshot without `old1`; the mocked lookup returns a row carrying `notifyLog`, `uiUrl`, `diffUrl`.
  - Trigger: resolve `old1`.
  - Expect:
    - one fetch per connection;
    - the merged row has no `notifyLog`, `uiUrl` or `diffUrl`;
    - `sessionOrderMap` and `endedTotals` are reference-equal before and after;
    - `status` is `ok`.
  - (test-plan #F5)
- [x] 3.10 L1 test, same file, exemplar `useMessageHandler.snapshot-replace.test.tsx`.
  - Setup: `old1` resolved through the lookup.
  - Trigger: reconnect with a snapshot that lacks `old1`.
  - Expect: a second lookup is issued, `canonicalId` stays `old1`, and `navigate` is never called (test-plan #F6).
- [x] 3.11 L1 test, same file, exemplar `useMessageHandler.snapshot-replace.test.tsx`.
  - Setup: route `01a16086` with one held match.
  - Trigger: add a second `01a16086-*` session before the replace effect flushes.
  - Expect: `ambiguous` with 2 candidates, and no navigate to a full id (test-plan #F7).
- [x] 3.12 L1 test, exemplar `packages/client/src/hooks/__tests__/useMessageHandler.snapshot-replace.test.tsx` (new `useMessageHandler.lookup-merge-paging.test.tsx`).
  - Setup: `old1` merged by the lookup.
  - Trigger: `sessions_page_result` for its group, with `old1` in `order`.
  - Expect: `old1` appears exactly once in `sessionOrderMap.get(group)`, at the page position (test-plan #F8).
- [x] 3.12a L1 test, exemplar `packages/client/src/hooks/__tests__/useMessageHandler.snapshot-replace.test.tsx` (in `useMessageHandler.lookup-merge-paging.test.tsx`).
  - Setup: group `g` with `endedTotals[g]=200` and no paged ids held; `old1` (ended, group `g`) merged by the lookup.
  - Trigger: expand `g`; deliver a `sessions_page_result` containing `old1`; expand again.
  - Expect:
    - the first request is `sessions_page {cwd:g, offset:0}`;
    - after the page, `old1` counts toward the next offset (offset = page size);
    - `old1` appears once in `sessionOrderMap.get(g)`.
  - (test-plan #F22)
- [x] 3.13 L1 test, exemplar `packages/client/src/components/shell/__tests__/ShellContent.test.tsx`.
  - Setup: prop `sessionRoute`, set to `ok` (`canonicalId` `full-1`), `notFound`, `ambiguous` or `pending`.
  - Trigger: routes `/session/01a16086`, mobile `/session/x/diff`, `/session/x/editor`.
  - Expect:
    - `ok` → `renderSession("full-1")` / `renderDiff("full-1")`, never the raw id;
    - `notFound` / `ambiguous` → `renderSessionNotFound` on all 3 routes;
    - `pending` → `session-resolving`.
  - (test-plan #F9)
- [x] 3.14 Implement `packages/client/src/hooks/useSessionRouteResolution.ts`:
  - sticky `resolvedRef` and `wasHeldRef` per route visit;
  - one `GET /api/sessions?id=` per route id per connection;
  - strip-and-merge into `sessions` only, adding merged ids to `lookupOnlyIds`, which the paging offset and held-ended count in `useMessageHandler` exclude until a page or snapshot delivers the id;
  - 401 / 403 handed to the auth-loss path;
  - retry.
  Make the matching `useMessageHandler` merge entry point available.
- [x] 3.15 Wire it into `App.tsx`:
  - remove the redirect effect (`App.tsx:1464-1473`);
  - derive `archivedReadOnlyId` from the raw param;
  - replace the raw id with `canonicalId` at `selectedId` (`:672`), `selectViewedSessionId` (`:699`) and `diffSessionId` / `editorSessionId` (`:617-618`);
  - add the not-found and pending arms to the desktop diff and editor branches;
  - add the `{replace:true}` canonical-URL effect;
  - add the `vanished` → `/` navigation.
  In `ShellContent.tsx`, add the `sessionRoute` prop and its arms. Update the AGENTS.md rows for `App.tsx`, `ShellContent.tsx`, the new hook and `SessionNotFound`.

## 4. Client: embed mode (design D5, specs url-routing, app-decomposition)

- [x] 4.1 L1 test, exemplar `packages/client/src/hooks/__tests__/useMessageHandler.hidden-nav.test.tsx` (new `packages/client/src/hooks/__tests__/useEmbedMode.test.tsx`).
  - Setup: empty `sessionStorage`.
  - Trigger: locations `/session/x?embed=1` → `/session/x/diff` → `/?embed=0` → `/session/x`.
  - Expect: returns true, true, false, false; the key is `"1"` after step 1 and absent after step 3 (test-plan #E11).
- [x] 4.2 L1 test, exemplar `packages/client/src/components/shell/__tests__/ShellContent.test.tsx` (new `packages/client/src/components/shell/__tests__/EmbedExit.test.tsx`).
  - Setup: embed on, at `/session/x?archived=1`, `/session/x?embed=1&focus=terminal` and `/`.
  - Trigger: click `embed-exit`.
  - Expect: `navigate` is called with `{replace:true}` and, respectively, `/session/x?archived=1&embed=0`, `/session/x?focus=terminal&embed=0`, `/?embed=0` (test-plan #E12).
- [x] 4.3 L1 test, exemplar `packages/client/src/lib/identity/__tests__/login-session.test.ts` plus `dashboard-login.test.ts`.
  - Setup: path `/session/x`, search `?embed=1`.
  - Trigger: (a) `loginRedirectFor("auth_required", …)`; (b) the OAuth return-to stash.
  - Expect: both targets contain `/session/x?embed=1`, with no `token=`, `access_token=` or `Authorization` (test-plan #X3).
- [x] 4.4 Implement `packages/client/src/hooks/useEmbedMode.ts`, the `EmbedExit` control and the embed home message.
  - Wire them in `App.tsx`. Desktop branch: omit the `hidden md:flex` sidebar wrapper, `HamburgerButton` and `MobileOverlay`. Mobile branch: the `MobileShell` list panel shows the embed home message.
  - On desktop, the home placeholder at `/` is the embed message.
  - Add i18n keys `embed.exit` and `embed.noSession` in en / hu / zh-CN.
  - Update the AGENTS.md rows.

## 5. L3 browser scenarios (docker harness; port from `.pi-test-harness.json`)

- [x] 5.1 L3 test, exemplar `tests/e2e/mobile-viewport-bound.spec.ts` (new `tests/e2e/session-deep-link-embed.spec.ts`).
  - Setup: 1 seeded live session, viewport 1024×768.
  - Trigger: open `/session/<id>?embed=1`, then `/settings`.
  - Expect:
    - the composer is visible;
    - `session-list`, the sidebar handle and the hamburger count 0;
    - the settings panel is visible with the sidebar still at 0.
  - (test-plan #F10)
- [x] 5.2 L3 test, exemplar `tests/e2e/mobile-viewport-bound.spec.ts` (same spec).
  - Setup: embed on.
  - Trigger: click the diff entry, so the URL becomes `/session/<id>/diff` with no query.
  - Expect: diff visible, sidebar count 0, `sessionStorage['pi-dash-embed']==="1"` (test-plan #F11).
- [x] 5.3 L3 test, exemplar `tests/e2e/mobile-viewport-bound.spec.ts` (same spec).
  - Setup: viewport 400×800, 1 session.
  - Trigger: open `/session/<id>?embed=1`, then press the header back button.
  - Expect: the detail is visible; after back, the URL is `/`, the embed home message is visible and there are 0 session cards (test-plan #F12).
- [x] 5.4 L3 test, exemplar `tests/e2e/mobile-viewport-bound.spec.ts` (same spec).
  - Setup: 1 session `<id>`.
  - Trigger: open `/session/<first 8>/diff?embed=1`.
  - Expect: the URL converges to `/session/<id>/diff?embed=1`, the diff is visible, and `goBack()` never lands on the 8-character URL (test-plan #F13).
- [x] 5.5 L3 test, exemplar `tests/e2e/archive-fold.spec.ts` (new `tests/e2e/session-not-found.spec.ts`).
  - Setup: at least 1 seeded session, viewport 1280×800.
  - Trigger: open `/session/does-not-exist` and wait until the seeded session appears in the sidebar.
  - Expect: `session-not-found` visible, containing the id; the URL is unchanged after a further 2 s `expect.poll` (test-plan #F14).
- [x] 5.6 L3 test, exemplar `tests/e2e/sessions-page-stub-group.spec.ts` (same new spec as 5.5).
  - Setup: 130 ended sessions seeded in one group.
  - Trigger: open `/session/<oldest id>`.
  - Expect: one request to `/api/sessions?id=<oldest>`, the header shows that session's name, and `session-not-found` count is 0 (test-plan #F15).
- [x] 5.7 L3 test, exemplar `tests/e2e/durable-session-diff.spec.ts` (same new spec as 5.5).
  - Setup: viewport 1280×800, recording network requests.
  - Trigger: open `/session/does-not-exist/diff`.
  - Expect: `session-not-found` visible and zero `session-diff` requests for `does-not-exist` (test-plan #F16).
- [x] 5.8 L3 test, exemplar `tests/e2e/mobile-viewport-bound.spec.ts` (the `session-deep-link-embed.spec.ts` spec).
  - Setup: embed on at `/session/<id>`.
  - Trigger: click `embed-exit`.
  - Expect: the URL ends `?embed=0`, the sidebar is visible, and `history.length` is unchanged (test-plan #F17).
- [x] 5.9 L3 test, exemplar `tests/e2e/paging-exhausted-reconnect-rearm.spec.ts` (the `session-not-found.spec.ts` spec).
  - Setup: viewing `/session/<id>` with the chat rendered.
  - Trigger: force a WebSocket reconnect.
  - Expect: `session-not-found` and `session-resolving` count 0 at every poll, and the chat container keeps the same element handle (test-plan #F18).
- [x] 5.10 L3 test, exemplar `tests/e2e/archive-fold.spec.ts` (the `session-not-found.spec.ts` spec).
  - Setup: viewing an ended `/session/<id>`.
  - Trigger: archive it through the session menu.
  - Expect: the URL converges to `/` and `session-not-found` count is 0 (test-plan #F19).
- [x] 5.11 L3 test, exemplar `tests/e2e/mobile-viewport-bound.spec.ts` (the `session-deep-link-embed.spec.ts` spec).
  - Setup: page A at `/session/<id>?embed=1`.
  - Trigger: open page B in a fresh context at `/session/<id>`.
  - Expect: B shows the sidebar and A still shows none (test-plan #F20).

## 6. Docs (design D6, specs claude-code-plugin, pi-dashboard-skill)

- [x] 6.1 L1 test, exemplar `scripts/__tests__/claude-plugin-parity.test.mjs` (extend it).
  - Setup: the extension `api-reference.md` with `## UI routes (browser)` placed after the closing `---` of bus verbs.
  - Trigger: `transformApiReference`, then the parity check.
  - Expect:
    - the derived text has the section and every route, including `/folder/:encodedCwd/openspec/archive`;
    - it has no bus-verbs heading;
    - it is byte-equal to the committed plugin file.
  - (test-plan #E9)
- [x] 6.2 L1 test, exemplar `scripts/__tests__/claude-plugin-ensure-dashboard.test.mjs` (`sh` from vitest; new `scripts/__tests__/encoded-cwd-oneliner.test.mjs`).
  - Setup: paths `/Users/me/proj`, `/home/münchen`, `/a?>~`, `/ab`, `/abc`.
  - Trigger: run the documented one-liner via `execFileSync('sh')`, and run `encodeFolderPath`.
  - Expect: byte-equal results, with no `=`, `+`, `/` or newline (test-plan #E10).
- [x] 6.3 L1 test, exemplar `scripts/__tests__/claude-plugin-structure.test.mjs` (extend it).
  - Setup: the control `SKILL.md`.
  - Trigger: read the file.
  - Expect:
    - it contains the heading "View a session in the browser";
    - it mentions `uiUrl`, `?embed=1`, `/api/sessions/archived` and `?archived=1`;
    - it has the "When a call is refused" cross-reference and a never-token-in-URL sentence;
    - the parity route check passes.
  - (test-plan #E14)
- [x] 6.4 Write `## UI routes (browser)` in `packages/extension/.pi/skills/pi-dashboard/references/api-reference.md`, after the `---` that closes `## WebSocket bus verbs` and followed by its own `---`. Content per design D6. Add `uiUrl` / `diffUrl` and the `?id=` filter to `GET /api/sessions`. Then run `node scripts/sync-claude-plugin.mjs`.
- [x] 6.5 Add the "View a session in the browser" section to `packages/claude-plugin/skills/pi-dashboard-control/SKILL.md` (design D6 steps 1–4).
- [x] 6.6 By hand, update both `api-reference.agent.md` sidecars and the `packages/claude-plugin/AGENTS.md` rows for `SKILL.md` and `references/api-reference.md` (`fix-stale-kb-dox-rows` discipline).
- [x] 6.7 DocScribe: add a note to `docs/embedding-chat-view.md` that distinguishes URL embed mode (`?embed=1`) from the `chat-embed` import barrel, and a routing note in `docs/architecture.md` covering session not-found, prefix resolution and the `GET /api/sessions?id=` lookup.

## 7. Error-handling (client lookup)

- [x] 7.1 L1 test, exemplar `packages/client/src/hooks/__tests__/useMessageHandler.archive-session-error.test.tsx` (in `useSessionRouteResolution.test.tsx`).
  - Fault: the lookup rejects with a network error, then returns 503.
  - Trigger: resolve, then call `retry()`.
  - Expect: `notFound` with `lookupFailed` each time, `navigate("/")` never called, and exactly one new fetch per retry (test-plan #X1).
- [x] 7.2 L1 test, exemplar `packages/client/src/lib/identity/__tests__/login-session.test.ts` (in `useSessionRouteResolution.test.tsx`).
  - Fault: the lookup returns 401, then 403.
  - Trigger: resolve.
  - Expect: the auth-loss handler is invoked with the current path and query, and the status is never `notFound` (test-plan #X2).

## 8. Manual verification (post-merge)

- [ ] 8.1 Manual: look at the embed home message and `SessionNotFound` on base dark and base light, at 400 px and 1280 px. They should be readable, the exit control easy to find, and the layout not broken (test-plan: manual-only, #F21).
- [ ] 8.2 Manual: through a real zrok public share, `curl https://<share>/api/sessions` with an observe token. Every `uiUrl` should start with `https://<share>/session/` (test-plan: manual-only, #X4).
- [ ] 8.3 Manual: in the Claude desktop app with the plugin installed, ask the agent to show a session. The pane should open `uiUrl?embed=1` and show the chat with no sidebar (test-plan: manual-only, #X5).

## 9. Verify

- [ ] 9.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary. Everything must be green.
- [x] 9.2 `npm run quality:changed` comes back clean.
- [x] 9.3 Run `review-code` on the diff, and `Audit` on the D1 resolver and the `id` filter (they handle untrusted input).
- [x] 9.4 `openspec validate add-session-ui-deep-links-for-agents --strict`.
