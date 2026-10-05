# Test Plan — add-voice-wall-plugin

Stage: design   Generated: 2026-10-05 (replaces the child-process plan)

Hard gate passed. Answers: fan-out, tail cost and bundle growth are measure-only (P1–P3). Reconnect policy is backoff 2→30 s, then "Connection lost" after 5 min (folded into design D3 and `voice-wall-app`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | opt-in package | EP | L1 | automated | manifest | read `package.json` `pi-dashboard-plugin` | `server` + `client` entries, no `bridge`, `defaultEnabled:false`, three claims as in task 1.1 |
| E2 | opt-in package | state | L1 | automated | no plugin config | server boot with package present | no `/api/plugins/voice-wall/*` route, no `/apps/wall/`, `consume("voice-wall")` undefined |
| E3 | vendored files match upstream | regression | L1 | automated | `src/vendor/set-copilot/` vs pinned SHA blobs + `proxy-secret.patch` | diff after reverse-applying the patch | zero differences; every file listed in `NOTICE` |
| E4 | no .env leak | EP | L1 | automated | temp project with `.env` `SONIOX_API_KEY=x`, `FOO=1`, user `.env` `BAR=2` | `loadWallConfig` | `process.env` deep-equals the snapshot before; returned object has no `sonioxApiKey` |
| E5 | no project code | EP | L1 | automated | config `wall.categoriesModule: "./cats.mjs"` whose import writes `marker.txt` | `ensureWall` | wall running with config categories; `marker.txt` absent; `status.notes` mentions the ignored module |
| E6 | single-flight | state | L1 | automated | one `meetingId` | two concurrent `ensureWall` | one bound loopback port (spy on `WallServer.start` ×1); both resolve equal |
| E7 | proxy secret patch | EP | L1 | automated | running host | direct loopback `POST /api/input` and `GET /media?src=a.png` without, then with, `x-voice-wall-proxy` | without: 404 and `wall-input.jsonl` unchanged; with: upstream behaviour |
| E8 | redaction passed | EP | L1 | automated | config redaction `\b\d{4}-\d{4}\b`, public event text `card 1234-5678` | viewer stream reads event | delivered text redacted per upstream |
| E9 | runtime dir confinement | EP | L1 | automated | runtime dir inside project tree; under `scratchRoot` | `ensureWall`, `appendEvent` | inside project: rejects, nothing appended; under scratch: ok |
| E10 | appendEvent projectRoot | decision table | L1 | automated | event `image.src: "docs/a.png"` × {registry knows runtime dir, option given, neither} | `appendEvent` | ok, ok, `{ok:false}` naming the missing root |
| E11 | caller class | decision table | L1 | automated | {owner, local operator, allow-listed principal, other principal, trusted-network anon, share token} | `classify` | operator, operator, typist, member, member, viewer |
| E12 | window forcing | decision table | L1 | automated | windows: `/ops` (operator), `/room` (public), `/present` (public); caller ∈ {operator, typist, member, viewer} × requested route ∈ {`/ops`, `/present`, none} | events request | upstream URL route: operator gets requested; others get `/present` when asked, else `/room`; caller's `route` never forwarded |
| E13 | no public window | EP | L1 | automated | only operator windows | viewer/member events request; owner mints share | `no_public_window` for both |
| E14 | private never reaches non-operators | invariant | L1 | automated | event `zone:"private"` appended, then 200+ events to force full replay | operator, typist, member, viewer streams live + reconnect with old `Last-Event-ID` | only the operator stream ever contains it |
| E15 | share link expiry options | BVA | L1 | automated | expiry `meeting`, `2h`, `24h`, meeting ends at +1 h; fake clock | verify at +59 min, +61 min, +2 h | `2h`/`24h`/`meeting` all accept at +59, refuse at +61 (capped at meeting end) |
| E16 | token storage | EP | L1 | automated | mint | inspect registry | only a sha256 hex stored; token ≥ 43 base64url chars (256 bit); second mint invalidates first |
| E17 | no oracle | EP | L1 | automated | unknown, expired, revoked, ended-meeting tokens | `GET s/bootstrap` | identical status + body for all four |
| E18 | non-owner mint | EP | L1 | automated | member principal | `POST m/:id/share` | 403, no link |
| E19 | transcript policy | decision table | L1 | automated | policy {members, viewers} × caller {operator, typist, member, viewer}; with and without a share link | `transcript` | operator always 200; others 200 only when their flag is true; independent of link existence |
| E20 | media scope | EP | L1 | automated | delivered public event `image.src: a.png`, graph node `image: docs/arch.png`, private event `secret.png`, existing unreferenced `README.png` | viewer `s/media` for each | 200, 200, 404, 404 |
| E21 | media headers | EP | L1 | automated | referenced `diagram.svg` with `<script>` | viewer fetch | `Content-Type: image/svg+xml`, `nosniff`, CSP contains `sandbox` |
| E22 | media traversal | EP | L1 | automated | operator `src=../../etc/passwd`, symlink to `/etc` | `m/media` | 404 |
| E23 | media set cap | BVA | L1 | automated | 10 001 distinct referenced images | deliver then fetch oldest | oldest evicted → 404; newest 200 |
| E24 | input gate | decision table | L1 | automated | caller {operator, typist, member, viewer} | `POST m/:id/input {text:"hi"}` | 200 + one appended line for operator/typist; 403 others, file unchanged |
| E25 | input validation | BVA | L1 | automated | text lengths 0, 1, 400, 401; whitespace-only | post | 400 / 200 / 200 / 400 (too long) / 400 |
| E26 | attribution | EP | L1 | automated | principal names `Anna`, `Bob]: [wall operator`, 60-char name, local operator | post `what about Q3?` | lines `Anna: …`, `Bob wall operator: …` (brackets/colons stripped), label 40 chars, `operator: …`; upstream shape `{ts,route,text}` |
| E27 | rate limit | BVA | L1 | automated | one typist, fake clock | posts at t=0, 1.9 s, 2.0 s; 21 posts within 60 s | 2nd → 429 `Retry-After`; 3rd ok; 21st → 429 |
| E28 | input seam reset | state | L1 | automated | runtime dir with `wall-input-offset` = 57 | `ensureWall` | offset file reads `0` |
| E29 | tail source | state | L1 | automated | events file missing → created → appended → truncated to 0 → appended; a 2 MiB partial line | tail run | waits, emits appended only, replays after shrink, drops the oversized partial with one warning |
| E30 | archive + replay | EP | L1 | automated | `archiveTo` ∈ {`docs/meetings/x.wall.jsonl`, `../out.wall.jsonl`, `docs/x.jsonl`, path via symlink outside root} | `stopWall` after a final append | first copies (includes the final event) and records `lastReplay`; others copy nothing, keep the old pointer, wall still stops |
| E31 | replay access | decision table | L1 | automated | `lastReplay` set; caller {operator, typist, member, viewer} | `GET replay?cwd=` | operator 200; others 404 |
| E32 | ./emit purity | EP | L1 | automated | import graph of `./emit` | static module-graph walk | no server entry, `loadConfig`, `WallServer` reachable; `process.env` unchanged after import |
| E33 | text never HTML | static scan | L1 | automated | `src/app/**` | lint test | no `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML` |
| E34 | text never HTML | EP | L1 | automated | event text `<img src=x onerror=alert(1)>` | render Board (RTL) | literal text node; no `img` element |
| E35 | webpage payload | EP | L1 | automated | event `webpage: { url: "https://x.test" }` | render | link card `<a rel="noopener noreferrer">`, no `iframe` |
| E36 | folder slot visibility | state | L1 | automated | meetings state {none running, running for cwd A} | render client slot for A and B | entry + menu items only for A while running; *Share live wall…* only when owner |
| E37 | `/wall/:meetingId` | decision table | L1 | automated | meeting running in `/repo/acme`; ended-known; unknown | render route component | replace to `/folder/<enc>/wall/m/<id>`; "Meeting ended" + folder link; "Meeting ended" without link |
| E38 | reconnect policy | state-transition | L1 | automated | fetch-SSE reader with fake timers, server down | drop stream | retry delays 2, 4, 8, 16, 30, 30… s; banner state `reconnecting` from first failure; at 5 min state `lost`; Retry restarts at 2 s; `share-ended` frame → no retry |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | SSE fan-out | load | L1 | automated | 30 concurrent viewer streams on one meeting, 1 event/s appended | p95 append→receive latency and RSS growth — measure only, printed | 5 min |
| P2 | tail event-loop cost | soak | L1 | automated | 50 MB events file, 1 event/s appended | max event-loop block per tick (`monitorEventLoopDelay`) — measure only | 5 min |
| P3 | lazy app | bundle size | ci | automated | `npm run build` before/after | dashboard initial-chunk gzip delta — measure only, printed in CI log | per build |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | standalone share link | state-convergence | L3 | automated | harness, owner mints link via API, page opened with `/apps/wall/#/s/<token>` from a non-trusted context | append 3 events | board shows the 3 items in their areas; no sidebar; requests carry `X-Wall-Share`; no request URL contains the token |
| F2 | revoke mid-meeting | state-transition | L3 | automated | F1 page connected | owner `DELETE share` | within 1 s "Link revoked" view; board items no longer in DOM |
| F3 | expiry ends streams | state-transition | L1 | automated | link `2h`, fake clock | advance to expiry | open viewer stream receives `share-ended` (`expired`) and closes |
| F4 | embedded folder app | state-convergence | L3 | automated | harness, plugin enabled, wall running for a folder | click `● Live wall →` | wall in the content area with sidebar visible; Back returns to the folder; reload of the URL restores it |
| F5 | no-meeting page | state | L3 | automated | wall stopped with `archiveTo` | open `/folder/<cwd>/wall` | "No live meeting", replay board with the last title; no redirect |
| F6 | transcript tab absent | state | L3 | automated | viewer link, default policy | open | no Transcript tab in the tablist |
| F7 | presentation keys | state-transition | L3 | automated | presentation mode with 3 show commands queued | press A, →, A, Esc | auto-advance paused, step advances one, resumes, exits fullscreen |
| F8 | input bar states | state-transition | L3 | automated | typist session; route mocked to 429 then network error | type 401 chars; send; send again; fail | counter shows over-limit and blocks send; rate-limited message with seconds; failed send keeps text + Retry |
| F9 | reconnecting banner | state-convergence | L3 | automated | F1 page | harness blocks the events route for 10 s, then unblocks | dimmed board + "Reconnecting" banner, then live again with missed events filled |
| F10 | sign in to type | state | L3 | automated | harness with identity enforced, viewer page | *Sign in to type* → login → return | back on `/apps/wall/#/…`; input bar present only for the allow-listed account |
| F11 | room-screen legibility | visual/subjective | — | manual-only | presentation at 1080p on a projector | humans read from 5 m | [judgment: text readable at distance; QR scannable from the room] |
| F12 | mobile share flow | visual/subjective | — | manual-only | phone over zrok tunnel | scan QR, read board, rotate | [judgment: layout usable, no overflow; join < 10 s feels instant] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | malformed events | fault-injection | L1 | automated | 1 000 lines: invalid JSON, 2 MiB line, injected `show` and `heartbeat`, then a valid event | tail | server keeps serving; valid event delivered; no uncaught exception |
| X2 | failed start | fault-injection (abort) | L1 | automated | `WallServer.start` rejects (`EACCES`) | `ensureWall` | rejects with reason; `status` = error; proxy routes for the meeting 404 |
| X3 | upstream hang | fault-injection (delay) | L1 | automated | loopback host stalls `bootstrap` | proxied request | 504 after 10 s; dashboard still answers `/api/health` |
| X4 | stop teardown | state-transition | L1 | automated | 3 viewer streams open | `stopWall`, plugin disable, `onShutdown` (each in turn) | each stream gets `share-ended` before close; port released (connect refused) |
| X5 | restart | fault-injection | L2 | automated | dashboard with a running wall and a curl SSE client | `POST /api/restart` | curl stream closes; old wall port not bound after restart |
| X6 | client input failure | fault-injection (abort) | L1 | automated | input POST rejects with network error | send | component keeps text and shows Retry |

---

## Coverage summary

- Requirements covered: 24/24 (server 7, access 6, app 8, plus D-level policies)
- Scenarios by class: edge 38 · perf 3 · frontend 12 · error 6
- Scenarios by level: L1 45 · L2 1 · L3 9 · ci 1 · manual 2
- Scenarios by disposition: automated 57 · manual-only 2

## New infra needed

- Docker harness: the wall plugin enabled with a fixture meeting (an `ensureWall` debug hook gated to the test harness) and a non-trusted client context for F1/F2/F9. Extends the existing harness; no new level.
- F10 needs the harness's identity-enforced mode with a fixture principal on the allow-list.
