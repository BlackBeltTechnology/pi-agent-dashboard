# Test Plan — add-live-component-mock-site

Stage: design   Generated: 2026-11-03

Clarifications resolved at the hard gate (2026-11-03):
- Rendered UI → Playwright `tests/e2e/mock-site/*.spec.ts` under a separate
  config `playwright.mock-site.config.ts` whose globalSetup starts the mock site
  itself on a free port (no docker harness); the default `playwright.config.ts`
  must ignore `tests/e2e/mock-site/**` (config-owned, like `dist-only`).
  Plugin / endpoint / CLI → vitest in `packages/mockup-loop/src/__tests__/` via
  real HTTP against a real Vite dev server started in-test.
- Install-from-tarball → opt-in qa L2 shell smoke `qa/tests/56-mock-site-tarball.sh`.

Notation: "fixture project" = temp dir with `mockups/mock-site.config.ts`,
`mockups/mock-site.app.tsx`, `mockups/mock-site.css`, and mock dirs, created per
test (L1) or by the mock-site globalSetup (L3, using the dashboard example mock
`mockups/2026-11-03-session-pills/` plus a phone frame). "site" = Vite dev server
started from the fixture's config. Ids are dates like `2026-11-03-a`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Reference grammar / CLI deep ref | EP | L1 | automated | inputs: `2026-11-03-a`, `#2026-11-03-a`, `#2026-11-03-a/1`, `#2026-11-03-a/1/proposed`, `#2026-11-03-a/1/proposed/2`, `http://localhost:5299/#2026-11-03-a/1/current/x-1`, `http://localhost:5299/?pane=2026-11-03-a/1/current#2026-11-03-a/2` | `parseRef(input)` | `{id:"2026-11-03-a"}` plus `frame`/`side`/`ring` exactly as given; `?pane=` ignored (last → frame 2) |
| E2 | Reference grammar (invalid) | EP | L1 | automated | `""`, `http://localhost:5299/` (no hash), `#2026-1-3-a`, `#2026-11-03-a/0`, `#2026-11-03-a/1/left`, `#2026-11-03-a/1/proposed/a/b`, `#2026-11-03-A` | `parseRef(input)` | each throws/returns error naming the bad segment; none yields an id |
| E3 | Mock layout and discovery | decision-table | L1 | automated | fixture: `mockups/2026-11-01-a/mock.tsx`, `mockups/2026-11-03-b/mock.tsx`, `openspec/changes/x/mockups/2026-11-02-c/mock.tsx`, `openspec/changes/archive/2026-01-01-y/mockups/2026-01-01-d/mock.tsx`, `mockups/notes/` (no mock.tsx), `mockups/attention.html` | `discoverMocks(root)` | ids `[2026-11-03-b, 2026-11-02-c, 2026-11-01-a]` in that order; `d`, `notes`, html absent; `errors` empty |
| E4 | Mock layout (invalid + duplicate) | decision-table | L1 | automated | `mockups/Bad_Id/mock.tsx`; `mockups/2026-11-01-a/mock.tsx` and `openspec/changes/x/mockups/2026-11-01-a/mock.tsx` | `discoverMocks(root)` | neither `Bad_Id` nor `2026-11-01-a` listed; `errors` has 2 entries naming `Bad_Id` path and both duplicate paths |
| E5 | Decide endpoint safety — note size | BVA | L1 | automated | site; POST `{id, status:"rejected", note}` with note of 499, 500, 501 code points (501 using one astral emoji) | POST `/__mock/decide` | 200, 200, 400; file holds note for first two only |
| E6 | Decide endpoint safety — body size | BVA | L1 | automated | POST bodies of 4095, 4096, 4097 bytes (padding field) | POST `/__mock/decide` | 4095/4096 not 413 (400 for unknown field allowed), 4097 → 413; no file for 4097 |
| E7 | Decide endpoint safety — method/type | decision-table | L1 | automated | GET, PUT with JSON; POST with `text/plain`; POST with `application/json; charset=utf-8` valid body | request `/__mock/decide` | 405, 405, 415, 200 |
| E8 | Decide endpoint safety — id allow-list | EP | L1 | automated | ids `../../etc`, `2026-11-03-a/../../x`, `2099-01-01-unknown`, `` | POST valid otherwise | 400 each; no file created anywhere under the fixture (recursive listing unchanged) |
| E9 | Decide endpoint safety — status enum | EP | L1 | automated | status `accepted`, `rejected`, `open`, `ACCEPTED`, `approved`, missing | POST | 200,200,200,400,400,400; `open` deletes `decision.json` |
| E10 | Decide endpoint safety — Origin | decision-table | L1 | automated | Origin absent; `http://localhost:<port>`; `http://127.0.0.1:<port>`; `http://evil.example`; `http://localhost:9999` | POST valid body from loopback | 200,200,200,403,403 |
| E11 | Decide endpoint safety — LAN client | decision-table | L1 | automated | site with `lan: true`; request from a non-loopback local interface address (bind client socket to the host's LAN IPv4; skip with reason if none) | POST valid, and GET `/__mock/decisions` | POST 403, no file; GET JSON `canDecide:false`; same from 127.0.0.1 → `canDecide:true` |
| E12 | Decide endpoint safety — symlink | EP | L1 | automated | `mockups/2026-11-03-a/decision.json` symlink → `outside.json` (content `X`) | POST accept | 400; `outside.json` still `X` |
| E13 | Decide endpoint safety — default bind | EP | L1 | automated | site started without `lan` | inspect `server.httpServer.address()` | address `127.0.0.1` |
| E14 | Page-level decisions — file shape | EP | L1 | automated | `writeDecision(mock, {status:"accepted", by:"user"})` then `{status:"rejected", by:"agent", note:"n"}` then `{status:"open"}` | call in order | file JSON `{status:"accepted",by:"user",at:<ISO>}` (no note key); then `{status:"rejected",by:"agent",note:"n",at}`; then file absent; no `.decision.json.tmp-*` left |
| E15 | Malformed decision file | EP | L1 | automated | `decision.json` contents: `{`, `{"status":"maybe"}`, `[]`, `<<<<<<< HEAD` | `readDecisions` | each → status `open` + one warning naming the path; no throw |
| E16 | Agent decision CLI | decision-table | L1 | automated | fixture with mock `2026-11-03-a`; argv: `list`; `accept <full deep URL> ok`; `reject 2026-11-03-a`; `reject 2026-11-03-a "dup"`; `reopen #2026-11-03-a/1`; `accept 2099-01-01-zz` | spawn `node src/mock-site/cli.mjs …` with cwd = fixture `mockups/` subdir | exit 0 / 0 (file `accepted`,`by:"agent"`,`note:"ok"`) / ≠0 and file unchanged / 0 (`rejected`) / 0 (file gone) / ≠0 naming `2099-01-01-zz`, nothing written |
| E17 | Agent decision CLI — root discovery | EP | L1 | automated | fixture nested in git repo; cwd = `<fixture>/openspec/changes/x`; second fixture without `mock-site.config.ts` | `mock-decide list` | first lists fixture mocks; second uses git toplevel and lists its `mockups/*` (or reports none) — exit 0 |
| E18 | Serve tool | decision-table | L1 | automated | `serve_mock_site` with: `port:8000`; `PI_DASHBOARD_PORT=5310` + `port:5310`; dir without config; dir with config but no vite resolvable | execute | each returns error text naming the reason (forbidden port / missing `mockups/mock-site.config.ts` path / vite not found); no child spawned (child map empty) |
| E19 | Serve tool — LAN text | EP | L1 | automated | fixture; `lan:false` then `lan:true` | start, read result, stop | first text has `http://localhost:<p>` and no LAN URL; second has LAN URL + "view-only" + "project sources readable on the LAN" warning |
| E20 | Numbered rings — n validation / tip lint | EP | L3 | automated | mock with rings `n=1` tip 40 chars, `n="x-2"` tip 41 chars, `n="a/b"` | render site | ring 1: no lint badge, ref `…/1`; ring `x-2`: `TIP > 40` badge; `a/b`: `BAD N` badge and no `id="r-…a/b"` |
| E21 | Adoption — decision filter | decision-table | L1 | automated | `mockups/AGENTS.md` with 4 marked rows: live mock accepted, live mock open (no file), live mock rejected, live mock malformed, plus HTML board `x.html` marked | adoption-offer helper used by rules text (`listAdoptable(root)` in `src/mock-site/discover.mjs`) | options in order: accepted `(accepted)`, then others; open `(open)`, malformed `(open)` + warning; html unlabelled; rejected absent and in `skipped` with reason `rejected` |
| E22 | Adoption — move as unit | state-transition | L1 | automated | git repo fixture: `mockups/2026-11-03-a/mock.tsx` tracked, `decision.json` untracked; variant: both untracked; variant: destination exists | `moveMockDir(src, changeDir)` (`src/mock-site/discover.mjs`) | both files at `openspec/changes/<n>/mockups/2026-11-03-a/`, `git status` shows them added, source dir absent; fully-untracked variant same; destination-exists variant refused, source untouched |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Numbered rings — no scroll lag | invariant sampling | L3 | automated | example mock, 1440×900, `page.mouse.wheel` 20 steps of 120px with one `requestAnimationFrame` sample per step | max \|badge.top − ring.top − (−15)\| and same for left across all rings and samples = 0px (±0.5 rounding) | 20 frames |
| P2 | Serve tool — readiness | threshold | L1 | automated | fixture project, cold `cacheDir` | `serve_mock_site` start → resolved | < 30 s, else error result (and child killed) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Numbered rings — under sticky bar | invariant | L3 | automated | example mock; scroll until frame-1 ring 1 top is 10px below viewport top | `document.elementFromPoint` at badge centre with `pointer-events` read via `getComputedStyle` toggled to auto in test | element at badge point is inside `.mk-bar` (bar paints over badge) |
| F2 | Numbered rings — hover tip | state-transition | L3 | automated | hover ring 2 (Proposed) | `mouse.move` in, then `mouse.wheel(0,100)`, then hover again + `mouse.move` out | tip visible with text = tip prop, `z-index` > bar; after wheel tip count 0; after leave count 0 |
| F3 | Frames — phone viewport | invariant | L3 | automated | frame with `phone:true` | read `iframe.contentWindow.innerWidth` and iframe height vs `documentElement.scrollHeight` | `innerWidth === 375`; height equals content height ±1 |
| F4 | Rings — badge inside phone pane | invariant | L3 | automated | phone frame whose ring touches pane left/top edge | measure badge rect in iframe | badge rect fully within `[0, 375] × [0, height]` |
| F5 | Themes — system default | decision-table | L3 | automated | fresh context `colorScheme:"light"`; second fresh context `"dark"` | load site | light: `data-theme="light"` on root, System button `aria-pressed=true`; dark: no `data-theme`; same inside phone iframes |
| F6 | Themes — OS switch | state-transition | L3 | automated | System selected, light | `page.emulateMedia({colorScheme:"dark"})` | root + every phone iframe lose `data-theme` without navigation (no `load` event) |
| F7 | Themes — bar matches page | invariant | L3 | automated | each theme System/Dark/Light | `getComputedStyle(body).backgroundColor` vs `.mk-bar` | equal strings in all 3 themes |
| F8 | Page-level accept — UI | state-transition | L3 | automated | open example mock (fixture copy), Show accepted unchecked | click `Accept page` | file `decision.json` `status:"accepted",by:"user"`; page still shown with `Reopen`; sidebar no longer lists it; click `Reopen` → file gone, listed again |
| F9 | Live refresh — CLI create/delete | convergence | L3 | automated | tab showing open mock | run `mock-decide reject <id> "why"`, then `mock-decide reopen <id>` | header converges to `rejected by agent` + note without `load` event; then to open |
| F10 | Deep link — ring | convergence | L3 | automated | goto `/#<id>/1/proposed/2` | load | `#r-<id>/1/proposed/2` in viewport and has class `mk-hit` |
| F11 | Deep link — ring in phone iframe | convergence | L3 | automated | goto `/#<id>/2/current/1` (phone frame) | load | top page scrolled so the iframe's ring 1 rect (offset by iframe rect) is within viewport; ring in iframe has `mk-hit` |
| F12 | Ref links — copy + iframe click | state-transition | L3 | automated | context with clipboard permission | click frame `#ref`; click ring badge inside phone iframe | clipboard = `<origin>/#<id>/1`; top `location.hash` = `#<id>/2/current/1` and ring highlighted |
| F13 | Reference grammar — ids | invariant | L3 | automated | example mock | collect `[id^="r-"]` in top document | contains `r-<id>/1`, `/1/current`, `/1/proposed`, `/1/current/1`, `/1/current/2`, `/1/proposed/1`, `/1/proposed/2`, `/2`, `/2/current`, `/2/proposed` |
| F14 | Pane styling — Tailwind | invariant | L3 | automated | fixture mock using class `mt-[13px]` (only in mock) and an app component using a class only present in `packages/client/src` | render | computed `margin-top: 13px`; app component's class has its computed style |
| F15 | Pane containment — fixed child | invariant | L3 | automated | mock rendering inline `<div class="fixed top-0 left-0 z-50 w-full h-10">` in a pane | scroll + measure | div rect within its `.mk-canvas` rect; bar still topmost at bar centre |
| F16 | Mock discovery — reload | convergence | L3 | automated | site running | create new mock dir with `mock.tsx`, then delete it | sidebar converges to include then exclude the new title (full reload allowed) |
| F17 | Visual parity with invoice-bot site / anti-slop | visual | — | manual-only | site in light + dark at 1440 | human compares against invoice-bot mock site | [judgment: layout/spacing "looks as good as invoice-bot" — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Serve tool — port busy | fault-injection (abort) | L1 | automated | plain `http.createServer` answering 200 on 5299 (test port) | `serve_mock_site{port}` | error result naming the port within 30 s; foreign server still answers; no child left |
| X2 | Serve tool — child crash during start | fault-injection (abort) | L1 | automated | fixture config that throws on load | `serve_mock_site{}` | error result before the 30 s timeout containing child exit; child map empty |
| X3 | Serve tool — stop + shutdown | state-transition | L1 | automated | started site | `stop:true`; second start then emit `session_shutdown` on fake pi | port free after each (connect refused); child `exitCode`/`signalCode` set |
| X4 | Decide — concurrent writes | fault-injection (race) | L1 | automated | 20 parallel POSTs alternating accepted/rejected + 5 CLI accepts | run concurrently | final `decision.json` parses as one valid decision; no `.decision.json.tmp-*` remains |
| X5 | Frames — bad pane spec | EP | L3 | automated | goto `/?pane=<id>/9/current` and `/?pane=<id>/x/current` | load | error panel naming the spec; no blank page |
| X6 | Discovery — invalid/duplicate shown | EP | L3 | automated | fixture with duplicate id | load site | visible error naming both paths; other mocks still listed |
| X7 | Malformed decision — UI | EP | L3 | automated | `decision.json` = `{` for a listed mock | load site | mock listed as open + warning naming the file |
| X8 | Extension loads without Vite | fault-injection (abort) | L1 | automated | import `src/extension.ts` with `vite` import resolution mocked to throw | register tools | all 6 tools registered; only `serve_mock_site` execution reports vite missing |
| X9 | Install from tarball | install smoke | L2 | automated | `npm pack` of `packages/mockup-loop` into temp React+Vite project (vite 6, react 18/19, tailwind 4) with one mock | `qa/tests/56-mock-site-tarball.sh` starts the site via the CLI path (node script calling the tool) and curls `/`, `/__mock/decisions`, and the transformed `main.tsx` | HTTP 200 each; `/__mock/decisions` JSON has `mockSite:true`; `main.tsx` response contains no JSX `<`-tag syntax (transformed); `npm pack --dry-run` listing has `site/` + `src/mock-site/*.mjs`, no `__tests__` |

---

## Coverage summary

- Requirements covered: 12/12 ADDED+MODIFIED (discovery, frames, styling/containment, rings, decisions, CLI, endpoint safety, ref grammar, ref links, themes, serve tool, adoption ×2 deltas)
- Scenarios by class: edge 22 · perf 2 · frontend 17 · error 9
- Scenarios by level: L1 27 · L2 1 · L3 21 · — 1
- Scenarios by disposition: automated 49 · manual-only 1

## New infra needed

- `playwright.mock-site.config.ts` + `tests/e2e/mock-site/global-setup.ts` /
  `global-teardown.ts` (start/stop the mock site on a free port against a fixture
  copy of `mockups/`) + root script `test:e2e:mock-site`; default
  `playwright.config.ts` `testIgnore` adds `tests/e2e/mock-site/**`.
  Exemplar: `playwright.dist-only.config.ts`, `tests/e2e/dist-only/global-setup.ts`.
- `qa/tests/56-mock-site-tarball.sh` (opt-in). Exemplar:
  `qa/tests/35-plugin-install-load.sh`.
