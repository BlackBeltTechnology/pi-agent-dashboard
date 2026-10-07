# Test Plan — add-focus-mode-and-card-block-toggles

Stage: design   Generated: 2026-10-07

No open clarifications.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | visibility: resolution order | decision-table | L1 | automated | prefs combos over {focus on/off × profile set/unset} × {folder set/unset} × {global set/unset} × {parent set/unset} for id `openspec-badge` | `resolveCardSectionVisible` | each of the 16 reachable rows returns the value of the highest set layer (focus → folder → global → parent → `true`) |
| E2 | visibility: legacy parent | EP | L1 | automated | stored global `openspec=false`, no `openspec-badge`, no `badge-goal`; `status=false` | resolve `openspec-badge`, `badge-goal` | both `false`; after setting `openspec-badge=true` → `true` while `openspec` stays `false` |
| E3 | visibility: per-plugin ids | BVA | L1 | automated | pluginIds `automation`, `mcp-client`, `a`, 58-char id, 59-char id, `Bad_Id` | `pluginSectionId("badge", id)` | valid ids → `badge-<id>`; `badge-`+59 chars (65) and `Bad_Id` → `null` |
| E4 | card-visual-effects: global only | decision-table | L1 | automated | folder `/a` override `fx-status-animation=false` (forced into prefs), global unset | resolve for `/a` | `true` (folder override ignored for `fx-*`) |
| E5 | focus-mode: built-in profile | EP | L1 | automated | no stored profile, focus on, plugin ids `automation`,`goal` | resolve `git`, `process`, `pill-automation`, `badge-goal`, `fx-selected-glow`, folder list mode | `false`,`true`(normal),`false`,`false`,`false`,`accordion` |
| E6 | focus-mode: save current | EP | L1 | automated | global `git=false`, `flows=true`, `openspec=false`, `openspec-badge` unset, config mode `classic` | build profile via save-current helper | profile has `git=false`,`flows=true`,`openspec-badge=false`,`folderListMode=classic`; later global `git=true` leaves profile `git=false` |
| E7 | focus-mode: validation cap | BVA | L1 | automated | profiles with 255, 256, 257 keys; key `../x`; value `"yes"`; `folderListMode:"grid"` | `set_focus_profile` to handler | 255/256 accepted + broadcast; 257, `../x`, `"yes"`, `"grid"` → state unchanged, no broadcast |
| E8 | card-visual-effects: folder write rejected | EP | L1 | automated | `set_card_section_visibility {path:"/a", section:"fx-status-animation", visible:false}` | handler | prefs unchanged, no broadcast; same message without path → accepted |
| E9 | folder-focus: render-mode table | decision-table | L1 | automated | all 16 combos of focused × collapsed × pinned × hasAttention, plus peek off | `resolveGroupRenderMode` | matches spec table; peek off + attention + unfocused → `compactEmpty` |
| E10 | session-filtering: attention predicate | EP | L1 | automated | sessions: `currentTool:"ask_user"`; `status:"streaming"`; `status:"active"`; `unread:true`; idle+read; ended+read | `demandsAttention` | true,true,true,true,false,false |
| E11 | folder-focus: active folder | state-transition | L1 | automated | selected session cwd `/repo/.worktrees/feat` main `/repo`; header click `/bar` | `resolveActiveCwd` | `/repo`; deselect → `/bar`; `/bar` group removed → `null` |
| E12 | folder-focus: pin/collapse exclusion | state-transition | L1 | automated | `/foo` collapsed | `set_folder_expanded(/foo,true)` then `set_folder_collapsed(/foo,true)` | after 1st: in expanded, not collapsed; after 2nd: in collapsed, not expanded; prefs file round-trips both lists |
| E13 | folder-focus: mode setting | EP | L1 | automated | config `folderListMode` values `classic`,`accordion`,`grid`,absent; `folderAttentionPeek` absent | config parse | `classic`,`accordion`,`classic`,`classic`; peek `true` |
| E14 | visibility: OpenSpec phase once | decision-table | L1 | automated | session with phase, tags `[]` / `["x"]`, `openspec-badge` on/off, `tags` on | render desktop + mobile `SessionCard` | phase text appears exactly once when badge on, zero times when off; tags strip only when `["x"]` and never contains phase |
| E15 | visibility: per-plugin badge | EP | L1 | automated | badge claims from `automation` and `goal`; `badge-automation=false` | render `SessionCard` | automation badge absent, goal badge present; with both hidden no STATUS subcard frame |
| E16 | visibility: slot filter (runtime) | EP | L1 | automated | `SessionCardBadgeSlot` with one legacy claim (`automation`) + one intent (`browser`); `isPluginVisible` hides both / none / prop absent | render | hidden → neither; none hidden or prop absent → both |
| E17 | visibility: directory card blocks | decision-table | L1 | automated | folder `/a` with git, banner-needed=false, plugin pills `automation`,`kb`, openspec data, ended sessions; each `folder-*` / `pill-*` toggled off one at a time, then all | render `SessionList` | only the toggled block disappears; group-by chip remains when `folder-git` off; all off → header + session cards only, no empty grid / dividers |
| E18 | visibility: folder banner chip | state-transition | L1 | automated | `folder-banner=false`, folder requires re-trust → then healthy | render, click chip | chip shown, click shows full banner; healthy → neither |
| E19 | visibility: settings rows | EP | L1 | automated | registry with claims `automation` (badge + pill), `goal` (badge + actionbar + pill), no memory claim | render `CardSectionsPage` and `CardSectionsSection` | Directory card group lists git/banner/openspec/create/ended + `Automations`/`Goals` pills; no MEMORY row; Effects group only in global block; `openspec-badge` row shows `Default (Hide)` when `openspec=false` |
| E20 | card-visual-effects: CSS gate | EP | L1 | automated | `data-fx-status="off"` / `data-fx-glow="off"` on root | inspect `index.css` rules (CSS parse test) | `.card-stripes-fx` under off has `animation: none` and no `repeating-linear-gradient`; `.card-ring-fx` / `.card-glow-mask` under glow-off `display: none` |
| E21 | card-visual-effects: reduced motion unaffected | EP | L1 | automated | `index.css` with effects on (no `data-fx-*` attrs) | CSS parse test of `@media (prefers-reduced-motion: reduce)` blocks | the existing reduced-motion selectors and declarations are byte-identical to pre-change; off-rules are scoped under `[data-fx-*="off"]` only |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | visibility: hide automations pill | state-convergence | L3 | automated | harness folder with automation plugin pill | Settings → Session card sections → switch `pill-automation` off | folder card has no Automations pill; other pills still present; reload → still absent |
| F2 | focus-mode: on/off round-trip | state-convergence | L3 | automated | folder `/a` override `git=visible`, global `flows=visible` | click sidebar Focus toggle on, then off | on: `aria-pressed=true`, no GIT/FLOWS subcards, directory card = header + cards; off: GIT/FLOWS back, `/api` prefs show `/a.git=true` unchanged |
| F3 | focus-mode: sync | state-convergence | L3 | automated | two browser contexts | context A toggles Focus on | context B converges to Focus on (toggle pressed, minimal sidebar) without reload |
| F4 | card-visual-effects: status off | state-convergence | L3 | automated | streaming session card | switch `fx-status-animation` off | card overlay `getAnimations().length === 0`, computed background has no `repeating-linear-gradient`, overlay class still `card-stripes-running`; board row identical |
| F5 | card-visual-effects: glow off | state-convergence | L3 | automated | selected session card | switch `fx-selected-glow` off | `.card-ring-fx` computed `display: none`; selected border still present; status stripes on other cards still animate |
| F6 | collapsible-groups / folder-focus: accordion clicks | state-transition | L3 | automated | accordion mode, folders `/a` (focused), `/b` (unfocused, 1 streaming + 3 idle) | click `/b` chevron; click `/b` chevron again; click `/a` header body | `/b` pinned → all 4 cards; unpinned → 1 card; `/a` header click leaves chevron unchanged |
| F7 | session-filtering: attention clears | state-convergence | L3 | automated | accordion, unfocused `/b` with streaming read session | session ends turn (idle) | card leaves `/b`; `/b` shows `N sessions — click to view`; click → `/b` focused, full list |
| F8 | folder-focus: classic unchanged | state-convergence | L1 | automated | classic mode, existing `SessionList` collapse tests | run existing suites | all existing `SessionList.*` and `folder-collapse-*` tests pass unchanged |
| F9 | card-visual-effects: look and feel | visual/subjective | — | manual-only | sidebar with running / unread / ask_user / selected cards, effects off, dark + light themes | human looks | [judgment: static tints readable and distinct, nothing looks broken] |
| F10 | focus-mode: minimal UX | visual/subjective | — | manual-only | 4+ folders, Focus on, desktop + mobile viewport | human uses sidebar | [judgment: "only cards and chat", nothing important unreachable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | focus-mode: state and sync | fault-injection (abort) | L1 | automated | preferences file contains `cardSections.focus = {enabled:"x", profile:{sections:{"__proto__":true,"git":"no"}}}` | server load | focus loads as off, profile empty, no prototype key, other prefs intact |
| X2 | focus-mode: survives restart | fault-injection (restart) | L1 | automated | Focus on + profile + `expandedFolders:["/a"]` written | recreate store from disk | snapshot has same focus + expandedFolders |
| X3 | visibility: socket gap | fault-injection (abort) | L1 | automated | `CardSectionsContext` `connected=false` | toggle Focus / effect switch | controls disabled, no message sent (matches existing `canWrite` rule) |

---

## Coverage summary

- Requirements covered: 32/32 (every delta requirement mapped to ≥1 row; REMOVED requirements need no scenario)
- Scenarios by class: edge 21 · perf 0 · frontend 10 · error 3
- Scenarios by level: L1 25 · L2 0 · L3 7 · manual 2
- Scenarios by disposition: automated 32 · manual-only 2

## New infra needed

- none (L3 reuses the docker harness; plugin pills come from the bundled automation/kb plugins already used by `tests/e2e/kb-folder-slot.spec.ts` / `automation-fanout.spec.ts`)
