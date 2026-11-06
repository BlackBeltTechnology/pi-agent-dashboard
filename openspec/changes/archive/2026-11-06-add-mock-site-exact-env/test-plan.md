# Test Plan — add-mock-site-exact-env

Stage: design   Generated: 2026-11-07

Levels: L1 = vitest (`packages/mockup-loop/src/**/__tests__/`, `scripts/__tests__/`),
L3 = Playwright (`tests/e2e/mock-site/`, own global-setup, no docker port).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | env: inherits build shape | EP | L1 | automated | fixture app config with `root:"src"`, `publicDir:"../public"`, `server.port:5173`, `build.outDir:"dist"`, one alias | merge into mock config | merged config has the alias, no `server`/`build`/`root`, and `publicDir` = `<fixture>/public` absolute |
| E2 | env: inherits build shape | EP | L1 | automated | this repo's `packages/client/vite.config.ts` | merge | `publicDir` equals `<repo>/public` |
| E3 | env: launcher adapter | decision-table | L1 | automated | 5 fixture projects: declared `mockSite`, detected vite, unsupported tool (webpack only), no config, launcher declared | resolve launcher | declared wins; detected uses vite; unsupported/missing return an error listing supported adapters and the "declare launcher/config" next step; nothing spawned |
| E4 | env: launcher safety | BVA (path) | L1 | automated | launcher `../outside.mjs`; launcher `./link.mjs` symlinked to `/tmp/x.mjs`; launcher `./scripts/ok.mjs` | resolve | first two refused with the real path named; third accepted |
| E5 | env: mock options not build config | EP | L1 | automated | `mock-site.options.ts` exporting `{ plugins: [...] }` | load options | error says options are not a build config; site not started |
| E6 | live-site: discovery | EP | L1 | automated | `node_modules/pkg/mockups/2026-01-01-x/mock.tsx` plus `mockups/2026-01-02-y/mock.tsx` | discover | only `2026-01-02-y` listed |
| E7 | live-site: reference grammar | EP | L1 | automated | `#m/1/proposed/step-3`, `#m/1/current/step-1`, `#m/1/proposed/2`, ring `n="step-1"` | `refs.mjs` parse / validate | step 3 proposed; step 1 current; ring 2; ring flagged invalid-`n` |
| E8 | live-site: reference grammar | EP | L1 | automated | `step-0`, `step-x` | parse | both rejected as invalid refs |
| E9 | live-site: decide CLI | BVA | L1 | automated | note of 500 chars; note of 501 chars | `mock-decide accept` | 500 accepted; 501 exits non-zero naming the 500 limit; `decision.json` unchanged |
| E10 | live-site: legacy decisions | EP | L1 | automated | `decision.json` entry `by:"user"` | load + adoption read | entry renders and counts as decided |
| E11 | scripted: bounded wait | BVA | L3 | automated | target inserted at 3000 ms; target never inserted; per-step timeout 1000 ms with target at 1500 ms | run step (default 4000 ms) | 3000 ms passes; never fails at step N naming selector; 1500 ms with 1000 ms timeout fails |
| E12 | scripted: steps assert state | state-transition | L3 | automated | step with `unless` already true; step with `expect` false | run | `unless` step skipped; `expect` step fails naming step and expectation |
| E13 | scripted: deterministic time | BVA | L1 | automated | `clockAt:"2026-01-01T12:00:00Z"`, fixture run started 18 min earlier; no `clockAt` | render loop 1 and loop 3 | both loops show "18m ago"; no `clockAt` uses page-load time |
| E14 | scripted: health | BVA | L1 | automated | `mock-check <ref>` with no `--loops`; `--loops 10` | run | 3 loops run by default; 10 when given; summary prints completed/failed counts |
| E15 | repo: mock check | decision-table | L1 | automated | vs base: dated dir with `mock.tsx`; slug dir without `STATIC.md`; same with `STATIC.md`; loose `mockups/a.html`; `STATIC.md` dir after `cli.mjs move` into a change | `check-mockups.mjs --base` | pass; report; pass; report with "move into a dir with STATIC.md"; pass |
| E16 | skill: host-agnostic text | EP | L1 | automated | `packages/mockup-loop` tree minus `node_modules` | grep `dashboard\|canvas\(\|pi-dashboard-ensure` | hits only `mk-canvas`, repository URL, `forbiddenPorts()` body |
| E17 | preview: serve result text | EP | L1 | automated | `serve_mockup` and `serve_mock_site` start | read result text | says "show the URL to the user", names no host tool |
| E18 | repo: adapter + routing | EP | L1 | automated | `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md`, root `AGENTS.md` | grep | adapter names the workspace skill path and has no `<name>.html`; root has the routing line |
| E19 | repo: no single-package publish | EP | L1 | automated | `packages/mockup-loop/package.json` | diff vs `develop` | `version` unchanged |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | env: startup budget | tail-latency | L1 | automated | `serve_mock_site` start→stop on this repo, cold | p95 call→URL serving `200` < 10 s | 5 starts |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | env: framework adapter | EP | L3 | automated | mock exporting `framework:"solid"` beside a valid mock | open site | that page shows error naming `solid` and supported adapters; other mock still renders |
| F2 | live-site: frames render real components | state-convergence | L3 | automated | example mock | open page | Current and Proposed panes are iframes on the same origin, each mounting real components |
| F3 | env: network fixtures | state-convergence | L3 | automated | two panes, fixture factory with a POST that mutates state | POST in Proposed | Proposed state changes; Current state unchanged |
| F4 | env: network fixtures (WS) | state-convergence | L3 | automated | hand-written WS fixture emitting one message | pane mounts | component shows the message |
| F5 | env: missing fixtures | EP | L3 | automated | pane fetches `GET /api/unmocked` | render | missing-fixtures panel lists `GET /api/unmocked` once, with the frame ref |
| F6 | env: shared surroundings | invariant | L1 | automated | frame with `surroundings`; frame without | render both panes | serialised DOM outside the slot identical across panes; without, both bare |
| F7 | scripted: isolated panes | state-convergence | L3 | automated | page with two scripted frames running together | run both | each completes its steps; no typing/clicks/fixture writes cross over |
| F8 | scripted: loop reset | state-transition | L3 | automated | script that toggles a flag, 2 loops | loop boundary | loop 2 starts from fresh fixture state (flag off) |
| F9 | scripted: cursor + captions | EP | L3 | automated | 3-step script | run | pointer element moves to each target before the act; caption text per step |
| F10 | scripted: reduced motion | EP | L3 | automated | 3-step script, emulated `prefers-reduced-motion` | open page | no pointer animation; 3 labelled live panes paused after step k; `#…/proposed/step-2` scrolls and flashes |
| F11 | live-site: no accept/reject UI | EP | L3 | automated | page with a decided and an undecided frame | open page | no accept/reject buttons; status badges show; `POST /__mock/decide` → 404 |
| F12 | live-site: mock looks like the app | visual | — | manual-only | live board mock vs running app at same route | human compares side by side | [judgment: Current indistinguishable from today's app] |
| F13 | scripted: animation reads naturally | visual | — | manual-only | exported loop video | human watches | [judgment: cursor/typing pace understandable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | live-site: serve tool | fault-injection (abort) | L1 | automated | port 5299 held by another HTTP server | `serve_mock_site{}` | error names 5299; other server untouched and not reported as the site |
| X2 | live-site: serve tool | EP | L1 | automated | `port:8000` | `serve_mock_site` | refused with "reserved" text; nothing started |
| X3 | live-site: serve tool | fault-injection | L1 | automated | launcher binary missing | start | actionable error naming the launcher; nothing started |
| X4 | env: launcher bind | EP | L1 | automated | start without `lan`; with `lan:true` | start | binds `127.0.0.1`; with lan `0.0.0.0` and LAN URL returned |
| X5 | env: capture redaction | EP | L1 | automated | HAR with `Authorization: Bearer abc`, body `{"password":"x"}`, `--redact apiSecret` key | `mock-capture` | values replaced by redaction marker; extra key redacted |
| X6 | env: capture refuses secrets | EP | L1 | automated | body containing `ghp_`, `sk-`, a JWT, `AKIA` strings in a non-redacted key | `mock-capture` | exits non-zero naming the key path; no fixture file written |
| X7 | scripted: video export | fault-injection | L1 | automated | Playwright pinned browser missing | `mock-video` | error names `npx playwright install chromium`; no host helper named |
| X8 | preview: Playwright absent | fault-injection | L1 | automated | `playwright` unresolvable | `score_mockup` | install guidance returned, no throw |
| X9 | scripted: video export | EP | L1 | automated | `mock-video <ref>` without output path | run | `.webm` under project cache dir, path printed; nothing under `mockups/` |
| X10 | env: options file | fault-injection | L1 | automated | options file that throws on import | start | error names the options file; nothing started |
| X11 | live-site: install from tarball | EP | L3 | automated | packed tarball into a fresh vite+react project with one mock | `serve_mock_site` | mock renders with its rings |

---

## Coverage summary

- Requirements covered: 34/34
- Scenarios by class: edge 19 · perf 1 · frontend 13 · error 11
- Scenarios by level: L1 29 · L3 13 · — 2
- Scenarios by disposition: automated 42 · manual-only 2

## New infra needed

- none (L3 reuses `tests/e2e/mock-site/` global-setup; P1 times the existing serve path in vitest)
