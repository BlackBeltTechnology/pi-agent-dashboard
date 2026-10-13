# Test Plan — add-skill-atlas-screen

Stage: design (HARD gate — clarification C0 answered: performance thresholds added to `specs/skill-atlas/spec.md` "Atlas performance budget")   Generated: 2026-10-11

Sources: `proposal.md`, `design.md` (D1–D9), `specs/{skill-atlas,dashboard-shell-slots,dashboard-plugin-loader,pi-resources-view,settings-panel}/spec.md`, `mockups/ui-plan.md`.
Levels: L1 = vitest (`packages/*/src/**/__tests__/`), L3 = Playwright vs docker harness (`tests/e2e/`, port from `.pi-test-harness.json`). No L2 rows: nothing here is install/spawn/multi-OS runtime.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | skill-atlas: deterministic function | invariant | L1 | automated | 20 skills with bodies, given in two different input orders | `buildSkillGraph` on each order | `JSON.stringify` of both outputs identical; nodes sorted by id; links sorted (source,target,type) |
| E2 | deterministic function: disabled excluded | EP | L1 | automated | 3 resolved skills, one `enabled:false` and named by the other two | build via the plugin server's input mapping | 2 nodes; no link touches the disabled id |
| E3 | deterministic function: duplicate id | decision-table | L1 | automated | id `review-code` as (project,`/a/SKILL.md`)+(package)+(global); separately two global copies `/z/…` and `/b/…` | build | one node, origin `project`; in the global-only case, the kept `filePath` is `/b/…` |
| E4 | references: hyphenated boundary | BVA | L1 | automated | bodies: `review-code-extra`, `(review-code)`, text starting `review-code`, text ending `review-code` | build with skill `review-code` present | link for the last 3 bodies only |
| E5 | references: case-insensitive hyphenated | EP | L1 | automated | body "see Doubt-Driven-Review" | build | link → `doubt-driven-review` |
| E6 | references: single-word forms | decision-table | L1 | automated | bodies: "`doctor`, `archive`", "/skill:doctor", "skill: doctor", "browser skill", "Browser Skill" | build with skills `doctor`,`browser` | no link for the first; links for the other four |
| E7 | references: short ids | BVA | L1 | automated | skill ids `kb` (2), `abc` (3), `abcd` (4); bodies "/skill:kb", "/skill:abc", "/skill:abcd" | build | only the `abcd` link exists |
| E8 | references: unsafe id | fault-injection (input) | L1 | automated | skill ids `Nano Banana Image Generation` and `c++-tool`; body contains `c++-tool` | build | no throw; link → `c++-tool`; no spurious links |
| E9 | references: self | EP | L1 | automated | skill `plan-proposal` body names `plan-proposal` | build | no self-link |
| E10 | bundle: size band | BVA | L1 | automated | packages contributing 1, 2, 14, 15 skills | build | bundle links per package: 0, 1, 91, 0 |
| E11 | bundle: loose skills | EP | L1 | automated | 5 skills with `pkg` undefined | build | 0 bundle links |
| E12 | shares-tool: count band | BVA | L1 | automated | token `` `ctx_execute` `` mentioned by 1, 2, 6, 7 skills (separate fixtures) | build | shares-tool links: 0, 1, 15, 0 |
| E13 | shares-tool: token shape | EP | L1 | automated | skills mentioning `` `npm` ``, `` `README.md` ``, `` `Bash` ``, `` `ctx_execute()` `` vs `` `ctx_execute` `` | build | no link from the first three; the `()` and plain forms count as one token and link |
| E14 | shares-tool: one link per pair | EP | L1 | automated | A and B both mention `` `ctx_execute` `` and `` `ctx_search` `` | build | exactly one A–B `shares-tool` link; `why` names both tokens, sorted |
| E15 | link canonical form | invariant | L1 | automated | input order puts `zeta` before `alpha`, both in one package; plus mutual references | build | bundle link `source:"alpha", target:"zeta"`; mutual references remain 2 directed links |
| E16 | endpoint: param validation | EP | L1 | automated | requests: `scope=project` (no cwd), `cwd=rel/path`, `scope=global&cwd=/x`, host context without `getPiResources` | `fastify.inject` | 400, 400, 200 (cwd ignored), 501 |
| E17 | endpoint: membership | decision-table | L1 | automated | `PiResourcesResult` with 14 `local`, 39 `global`, 38 package skills (one package `scope:"local"`) | GET project / GET global | project: 91 skills, 14 origin `project`; global: no `project` origin; local-scope package skills not counted in global |
| E18 | endpoint: no bodies | invariant | L1 | automated | skill whose body contains the marker `BODY-ONLY-7f3a` | GET project | response JSON contains no `BODY-ONLY-7f3a` and no `body` key |
| E19 | body limit | BVA | L1 | automated | 300 KiB SKILL.md naming `review-code` at byte 10 KiB and `ship-it` at byte 280 KiB | GET | link → `review-code` exists, → `ship-it` absent; warning names the skill |
| E20 | fingerprint: what moves it | decision-table | L1 | automated | tmp skills dir; cases: no change; description change only; ctime-only change (same mtime/size via `utimes` restore); body edit | GET twice per case | fingerprint equal only in the no-change case; no `readFile` call in the no-change case (spy) |
| E21 | memo key | BVA | L1 | automated | requests for `/repo` and `/repo/`; then 33 distinct cwds | GET | one memo entry for both spellings; the oldest entry is evicted at 33 |
| E22 | affected keys | decision-table | L1 | automated | memo keys `global`, `project:/repo`, `project:/repo-2`; invalidations `"/repo/.worktrees/x"`, `"/repo"`, `undefined` | `onPiResourcesInvalidated` callback | `/repo/.worktrees/x` → `/repo` + global; `/repo` → `/repo` + global; never `/repo-2`; `undefined` → all |
| E23 | resource-page-section slot taxonomy | EP | L1 | automated | `SLOT_DEFINITIONS`, manifest with `{slot:"resource-page-section", resourceType:"skill"}` | taxonomy test + `validateManifest` | slot present, multiplicity `many`, react-only; manifest valid |
| E24 | slot consumer: filtering + props | decision-table | L1 | automated | claims with `resourceType:"skill"` and with none; pages Skills/Agents × folder(`/repo`)/global; folder page filter set to Global | render `ResourceGridPanel` | skill claim only on Skills pages; untyped claim on all; folder page props `{scope:"folder",cwd:"/repo"}` regardless of filter; global page has no `cwd` |
| E25 | settings promotion: resources | decision-table | L1 | automated | plugin rows: first-party `skill-atlas` nav resources "Skill Atlas"; third-party same hint; first-party label "Skills" | `resolveSettingsPromotions` + SettingsPanel nav render | Resources group = Skills, Agents, Extensions, Prompts, Themes, Skill Atlas; Plugins pointer `Skill Atlas ↗ Resources` never active; third-party + "Skills" hint stay ordinary Plugins children |
| E26 | detail: mutual reference | EP | L1 | automated | `plan-proposal` ⇄ `ship-it` references | select `plan-proposal` in detail panel | one `ship-it` row marked bidirectional (`↔`) |
| E27 | Cards/Links hide on focus | EP | L1 | automated | skill with 5 neighbours, 91 total | 1-hop focus, Cards then Links | 6 cards; status "Showing 6 of 91"; Links rows only within the focus set; Clear restores 91 |
| E28 | >300 nodes | BVA | L1 | automated | graphs of 300 and 301 skills | render atlas | 300: Graph tab enabled; 301: Graph tab `aria-disabled="true"` + explanation; Cards lists 301 |
| E29 | layout determinism + labels | invariant | L1 | automated | 91-node fixture graph, viewport 900×600 | layout twice; label placement | identical positions; no two placed label boxes intersect; the selected node is always labelled |
| E30 | summary section | EP | L1 | automated | graph with degree ties; empty graph | render section | top 5 by degree (tie → id asc); empty graph renders `null` (no DOM) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | perf budget: unchanged request | tail-latency | L1 | automated | 100 synthetic skills on tmp fs; memo warm | p95 server handling < 100 ms | 200 `fastify.inject` requests |
| P2 | perf budget: rebuild | threshold | L1 | automated | 300 skills, each 256 KiB with realistic mentions/tokens | rebuild < 500 ms | 1 cold build (median of 5) |
| P3 | perf budget: live update | convergence | L3 | automated | harness folder with atlas open | new skill visible < 5 s after `mkdir`+write | single event |
| P4 | perf budget: render | threshold | L3 | automated | harness with 300-skill fixture | `performance.measure` from Graph tab activation to `atlas-graph-rendered` mark < 500 ms | first render |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | entry points: folder menu | state-transition | L3 | automated | harness folder card | open the folder actions menu → "Skill Atlas" | URL `/folder/<enc>/atlas`; atlas content beside the sidebar; Back returns to `/folder/<enc>` |
| F2 | entry points: global + settings | state-transition | L3 | automated | harness with plugin enabled | open `/atlas` directly; then Settings → Resources → "Skill Atlas" → "Open atlas" | global atlas renders with no `project` origin; settings entry lives under Resources; Plugins has the pointer row |
| F3 | Skills page section | state-transition | L3 | automated | folder Skills page | load page; activate the most-connected chip | section above the grid; existing skill cards + test ids present; atlas opens with that skill selected, 1-hop focus |
| F4 | live update + stale view | state-convergence | L3 | automated | atlas open with one skill selected | add skill folder via harness exec | status shows "Updating…" (text) then "Up to date"; new skill appears; previous selection still selected |
| F5 | body edit on next request | state-convergence | L1 | automated | tmp project with skill `x`; plugin server with real fs | edit `x/SKILL.md` to mention `review-code`, no watcher event; GET | link `x → review-code` present; new fingerprint |
| F6 | keyboard access | state-transition | L1 | automated | atlas with 91 nodes | Tab to graph, ArrowRight, Enter; on tabs ArrowRight | the most-connected skill is selected + detail shown; tab focus moves Cards→Graph→Links with `aria-selected` |
| F7 | stale view during refetch | state-convergence | L1 | automated | `useSkillGraph` with a refetch delayed 1 s | dispatch `skill_atlas_changed` | old graph still returned and `updating:true` until resolve; then new graph and `updating:false` |
| F8 | mobile layout | state-transition | L3 | automated | 375×800 viewport, project atlas | load; select a skill | relation/origin toggles hidden behind "Filters · N on" (`aria-expanded=false`); detail panel precedes the main view in DOM order |
| F9 | theme parity (look) | visual/subjective | — | manual-only | atlas in base dark, base light, nord dark/light | human review vs `mockups/index.html` | [judgment: graph legibility and token parity look right; no automatable observable beyond E-row axe checks] |
| F10 | untrusted text | EP | L1 | automated | description `<img src=x onerror="window.__x=1">` | render card, detail, links table | literal text visible; no `img` element created; `window.__x` undefined |
| F11 | accessibility floor | invariant | L3 | automated | atlas Cards/Graph/Links + Skills section in base dark and base light | run axe-core (WCAG 2.2 AA) | 0 violations |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | getPiResources fresh vs in-flight | fault-injection (delay) | L1 | automated | scan of `/repo` held open via a controllable `scanPiResources` stub | add skill after the scan started; call `getPiResources("/repo",{fresh:true})` | resolves only after a second scan; result includes the added skill |
| X2 | racing GET still notifies | state-transition | L1 | automated | memo warm; fake timers | edit skill; GET rebuilds; then the invalidation fires | exactly 1 `skill_atlas_changed` broadcast |
| X3 | metadata-only silent | EP | L1 | automated | `touch` + `chmod` on a SKILL.md, content unchanged | invalidation | 0 broadcasts |
| X4 | reload silent | state-transition | L1 | automated | memo built by a GET; no file change | `commands_list` callback | 0 broadcasts (incl. the first reload after the GET) |
| X5 | burst coalescing | fault-injection (burst) | L1 | automated | 10 invalidations for `/repo` within 400 ms | advance fake timers 500 ms | 1 fresh rescan; ≤ 1 broadcast |
| X6 | file errors | fault-injection (abort) | L1 | automated | one SKILL.md deleted after the scan; another `chmod 000` | GET | 200; deleted skill absent + warning; unreadable skill present with no body-derived links + warning |
| X7 | seam handler isolation | fault-injection (abort) | L1 | automated | two subscribers, the first throws | watcher invalidation `/repo` | the second subscriber is called with `"/repo"`; the host continues; after unsubscribe, no further calls |
| X8 | commands_list sources | decision-table | L1 | automated | `commands_list` from a known session (cwd `/repo`) and from an unknown session id | event-wiring dispatch | known → handler called with `"/repo"`; unknown → not called |
| X9 | degraded scan | EP | L1 | automated | scan result `degraded:true` | GET + render section + atlas | response `degraded:true`; warning callout text visible in the section and atlas header |
| X10 | graph request failure | fault-injection (abort) | L1 | automated | fetch rejects / responds 500 | render section; click Retry after the fetch recovers | `role="alert"` error + Retry; after retry the summary renders |
| X11 | Open SKILL.md refused | fault-injection (abort) | L1 | automated | `/api/pi-resource-file` responds 403 | activate "Open SKILL.md" | inline error shown in the detail panel; no blank viewer |
| X12 | throwing section isolated | fault-injection (abort) | L1 | automated | `resource-page-section` component throws | render Skills page | grid renders; sibling sections render |
| X13 | plugin disabled | state-transition | L3 | automated | plugin toggled off, server restarted | load the folder menu, Skills page, Settings, `/atlas`, `/folder/<enc>/atlas` | no menu item, no section; Settings keeps a dimmed `Skill Atlas` entry with an "off" marker; atlas routes do not render the atlas |

---

## Coverage summary

- Requirements covered: 18/18. skill-atlas 12/12; dashboard-shell-slots 1/1; dashboard-plugin-loader 2/2 (getPiResources: E16, X1; invalidation: E22, X7, X8); pi-resources-view 1/1 (E24, F3, X12); settings-panel modified 1/1 (E25, F2); plus the perf budget.
- Scenarios by class: edge 30 · perf 4 · frontend 11 · error 13 (total 58)
- Scenarios by level: L1 48 · L2 0 · L3 9 · manual —1
- Scenarios by disposition: automated 57 · manual-only 1

## New infra needed

- L3 rows need the skill-atlas plugin enabled in the docker harness image and a way to write skill folders inside the harness workspace (reuse the harness `docker exec` helper used by the existing e2e specs).
- P4 needs the client to emit a `performance.mark("atlas-graph-rendered")` after the first graph paint (test-observable hook, no UI change).
