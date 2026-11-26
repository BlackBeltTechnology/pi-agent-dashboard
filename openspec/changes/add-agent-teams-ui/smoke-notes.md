# Manual smoke notes — add-agent-teams-ui (tasks §11.3–11.6)

Run in the docker test harness only (`PI_E2E_SEED=1 docker/test-up.sh -d --build`; image build needed a
TEMPORARY `ENV NODE_OPTIONS=--max-old-space-size=4096` in `docker/Dockerfile`, reverted right after each
build — `git diff docker/Dockerfile` is empty). Harness port from `.pi-test-harness.json` (`dashboardPort` 18744).
Live dashboard `:8000` untouched: `lsof -i:8000` PID `6389` before, between and after. Both harnesses torn
down with `docker/test-down.sh` (no `pi-dash-test-*` container left, `.pi-test-harness.json` gone).
Browser: `agent-browser` (Chromium) + `curl`. Screenshots under `/tmp/smoke-*.png`.

## Test-input caveat (read first)

The repo's faux scenarios only cover "lead creates 1 team + 1 teammate" (`agent-teams-lead-spawn`,
`agent-teams-lead-task`). To drive two teammates, a shutdown reject/approve and a bigger team, extra
scenarios were **appended to the in-container copy** of `~/.pi/agent/extensions/faux-provider/faux-scenarios.ts`
(`docker exec`, source `/tmp/smoke-scenarios-append.ts`, `/tmp/smoke-fill2.ts`, `/tmp/smoke-ab.ts`). No repo
file was changed. Scenarios: `smoke-lead-setup` (TeamCreate, spawn alice + bob, 2 TaskCreate, bob's task blocked
by #1), `smoke-worker-sleep` (alice: `bash sleep 600`), `smoke-lead-shutdown-reject|approve` (lead
`ShutdownRequest` whose `reason` carries `[[faux:smoke-worker-reject|approve]]`, which is the sentinel the
teammate's wake turn resolves), `smoke-lead-fill` (12 tasks, 8 long messages), `smoke-lead-a|b|a-more`.
Consequence: a lead *wake* turn carries no sentinel, so the faux model answers it with a canned fallback text;
the wake itself (a new lead turn) is real.

## 11.3 Lead + two teammates, live badges / Team view, Stop, shutdown reject/approve, Shut down team — PASS

Steps / observed (session `01a21619-…`, team `t_1ad9ad79` "smoke-team"):
1. New session (faux/faux-1), prompt `[[faux:smoke-lead-setup]] go`. Within ~15 s `GET /teams` → 1 team
   (`members:2, tasks:2`). Sidebar shows badges **Lead**, **alice**, **bob** live (`smoke-11.3-a-lead-badge.png`).
   A "Team notice … bob is idle and picked up its next task" card appeared in the lead chat.
2. Lead badge → `/session/<lead>/team`: header "smoke-team · Active", Members table (alice Working, bob Idle
   with `#1 smoke task one`), Tasks tab (Pending #2 Blocked "waits for #1 — in progress", In progress #1 bob),
   Messages tab (spawn prompts, task_assigned, notice) (`…-b-teamview.png`, `…-d-tasks.png`, `…-d-messages.png`).
3. Second browser tab sent `[[faux:smoke-lead-shutdown-reject]]` to the lead while the Team view stayed open:
   Messages tab count went 4 → 6 **without reload** (shutdown_request + "bob rejected the shutdown request — still
   busy"); lead woke (chat shows the notice and a new lead turn) (`…-c-reject-messages.png`).
4. Stop on busy alice (button in Members row, no confirm): `POST …/members/alice/stop` → 200; alice
   busy → idle; mail "alice was stopped by the user"; **lead woke** (new turn at 05:27:06 after the notice)
   (`…-e-lead-woke.png`).
5. `[[faux:smoke-lead-shutdown-approve]]`: bob approved, status `gone` ("released to pending: 1", task #1
   reassigned to alice). bob's session card/badge **disappeared** from the sidebar live (`…-f-after-approve.png`).
   Observation: in that screenshot (taken ~15 s after the prompt) the Members table still showed bob Idle and
   Messages 7; ≤20 s later it showed `Gone — Reason: session ended` and Messages 10. Server state was already
   final (rev 48). The tab was not foreground-driven when the frames arrived; I did not isolate whether this
   was frame delay or the safety refetch (not judged a bug, flagged).
6. After the 11.4 restart (below) Shut down team: confirm dialog (`…-g-shutdown-dialog.png`) → confirm →
   `status:"closed"`, members gone, banner "This team is closed. It is shown read-only.", `team-shutdown` and
   `team-member-stop` absent (`…-h-closed.png`).
Not exercised: nothing skipped from the task text. Limitation: lead wake turns answered by canned faux text.

## 11.4 Restart mid-team, recovery via `epoch`, no refetch storm — PASS

`POST /api/restart` → 200; health back within ~8 s.
- Before: ETag `"5b250213fb9b9563:48"`. After: new epoch `a98a0fc73a1e6ff5`, **rev reset to 2** (below 48 — exactly
  the case epoch protects), ETag `"a98a0fc73a1e6ff5:2"`; `If-None-Match: "5b250213fb9b9563:48"` → **200** (not 304).
  Team persisted: same id/name, 2 members, 3 mail rows, `leadConnected:true`, list shows it.
- Open Team view (no reload) recovered: lead badge still in sidebar (`Open team view, Lead`), tabs Members 2 /
  Tasks 2 / Messages 10 (`smoke-11.4-after-restart.png`, `…restart2.png`). A new lead prompt after the restart
  (`agent-teams-lead-task`) updated the open view live: rev 3, Tasks 2 → 3, new epoch `46c7…` on a 2nd restart.
- Request count (browser Resource Timing; server log has no request lines). Second, clean restart with
  `performance.clearResourceTimings()` first, 45 s window:
  `/teams?sessionId=` 200 @336.4s, `/teams/:id` 200 @336.8s, `/teams/:id` 200 @337.9s, then the safety-timer pair
  `/teams/:id` **304** + `?sessionId` 200 @367.4s → 5 requests in 45 s, 2 snapshot fetches within ~1 s of
  reconnect, then one 30 s tick. No storm. (Inference, not proven: the 2nd 200 is rev 1 → 2 as the lead bridge
  reconnected; the new-epoch refetch itself is one request.)

## 11.5 Identity enforced, two principals — PASS (HTTP + WS, not browser UI)

Harness: `TEST_EXTRA_COMPOSE=compose.test.identity.yml PI_E2E_SEED=1` (fake OIDC issuer :18090, enforced via
the fixture login descriptor). An ordinary browser socket is refused by design, so this is bearer + `ws`
driven (script `/tmp/smoke-identity.mjs`, raw results `/tmp/smoke-identity-results.json`,
`/tmp/smoke-identity-frames.json`). Real path used (no seeding): each principal's ws (`/ws?ticket=` from
`POST /api/ws-ticket`, minted bearers `user-anna` / `user-bela`) sent `spawn_session`
`initialPrompt:"[[faux:smoke-lead-a|b]] go"`, so the faux lead sessions are owned by that principal and the
teams got `owner` from the host session. A owns `a-team` (`t_049e643e`, 1 teammate, task), B owns `b-team`
(`t_91ce17e7`). The local operator = break-glass bearer (`/api/identity/local-code` with the host-only local
token via `docker exec`, then `/api/identity/local-exchange`).
- `GET /teams`: anna → `[a-team]`, bela → `[b-team]`, operator → `[a-team, b-team]`; no bearer → 401 `sign_in_required`.
- Bela on A's team id: `GET /teams/t_049e643e` → 404 `{"error":"not_found"}`; unknown id → 404, **byte-identical
  body**; same with `If-None-Match` of A's ETag (404, no 304 oracle). `GET /teams?sessionId=<A lead>` → 200
  `{"teams":[],…}`, identical to an unknown session id. `POST …/members/alice/stop` and `POST …/shutdown` on A's
  team → 404, identical to an unknown id. Anna on B's team → 404.
- Operator `GET /teams/<A>` and `/<B>` → 200 both.
- WS frames (3 sockets, whole run incl. a later A-lead change): Bela received `agent-teams:changed` only for his
  own lead (2), **0** for A's lead session, **0** frames of any type mentioning A's team id or A's lead session id.
  Anna: 5 for A's lead, 0 for B's. Operator: 5 for A + 2 for B.
Not verified: the Team view / badges rendered in a browser as principal B (identity-active harness refuses
ordinary browser sockets); `compose.test.identity.yml` login-form variant not run.

## 11.6 Overlay route reachability, desktop/mobile × dark/light — PASS

Route `/session/<lead>/team`, team `fill-team` (2 members, 12 tasks with long titles, 9 mail with a 60-char
unbroken token). Script `/tmp/smoke-check.js` (per tab: scrolls every control into view, `elementFromPoint`
occlusion test, viewport-bounds test, scroller discovery, last-item-at-bottom, horizontal overflow).
| viewport | theme | page overflow-x | occluded / off-screen controls | scrollers | last item reachable |
|---|---|---|---|---|---|
| 1440×900 | dark | 0 | none (10/18/9 controls) | Tasks panel 793/1354, log 630/899 | yes |
| 1440×900 | light | 0 | none | same | yes |
| 390×844 | light | 0 | none (10/21/9) | Members 647/740, Tasks 647/2052, log 591/1313 | yes |
| 390×844 | dark | 0 | none | same | yes |
No control under 24 px. Mobile Shut down dialog (dark): within viewport (16–374 × 329–515), both buttons hit-test
clean (`…mobile390-dark-dialog.png`). Screenshots: `smoke-11.6-desktop1440-{dark,light,dark-messages}.png`,
`smoke-11.6-mobile390-{light-members,dark-members,dark-messages,dark-dialog}.png`.
Cosmetic note (not a contract failure): at 1440×900 the Messages log scroller stops at y≈789, leaving ~110 px
of empty space below it.

## Bugs found

None blocking. Items flagged for a human: (a) the 11.3 step-5 Team-view lag (≤20 s) after a teammate's
approval — cause not isolated; (b) the Messages-log bottom gap at desktop height.
