# Test Plan — card-sections-global-pointer

Stage: design   Generated: 2026-11-23

No clarifications needed: every Triple slot is concrete (routes, testids and labels are pinned in the delta specs and design D1–D4).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | session-card-section-visibility › Session cards page (pointer) | EP | L1 | automated | `CardSectionsPage` for `/a`, 0 overrides, `canWrite=false` | click `card-sections-open-global` | `navigate` called once with `/settings/general?scroll=card-sections-settings` and no `{replace:true}`; the button is enabled even though `card-sections-reset` is disabled |
| E2 | Session cards page (strip copy) | EP | L1 | automated | `/a` with 2 overrides; then with 0 overrides | render | `card-sections-override-summary` text contains `follows the global defaults` (2 overrides) / `Using the global defaults` (0 overrides) |
| E3 | Session cards page (inherit label) | decision-table | L1 | automated | global `git` hidden, no `/a` override; global `tags` visible | render | `git` inherit option reads `Global (Hide)`; `tags` inherit option reads `Global (Show)`; option testid ends `-inherit`; no text `Default (` anywhere on the page |
| E4 | Session cards page (legacy-parent child) | decision-table | L1 | automated | `/a` folder override hides the legacy parent of a child row; child has no own override | render | child inherit option reads `Global (Hide)` (inherited value); selecting it writes no child key |
| E5 | Session cards page (i18n) | EP | L1 | automated | locale `hu`, then `zh-CN` | render `CardSectionsPage` | the inherit option and `card-sections-open-global` render the hu/zh-CN `cardSections.globalShow`/`globalHide`/`editGlobalDefaults` strings (not the English fallback); `cardSections.defaultShow`/`defaultHide` are absent from both locale tables |
| E6 | settings-panel › external scroll param | state-transition | L1 | automated | `/settings/general?scroll=card-sections-settings`, `/api/config` pending | resolve config | `scrollIntoView` called exactly once on `[data-testid=card-sections-settings]`, only after loading ends; then `navigate("/settings/general",{replace:true})` |
| E7 | settings-panel › unknown target | EP | L1 | automated | `/settings/general?scroll=does-not-exist` | config resolves | no `scrollIntoView` call; param removed via replace to `/settings/general` |
| E8 | settings-panel › hostile value | EP+BVA | L1 | automated | `?scroll=` values `"]`, `a"],body[x="`, 65×`a`, `UPPER` | config resolves | no throw (panel renders General, no error boundary); no `querySelector` call for values outside `^[a-z0-9-]{1,64}$`; param removed; 64×`a` is accepted and queried |
| E9 | settings-panel › no param regression | EP | L1 | automated | `/settings/general` (no query) | config resolves | no `scrollIntoView`, no replace navigation; the internal `requestRailNavigate("/settings/developer","pi-runtime-section")` still scrolls `pi-runtime-section` and leaves URL `/settings/developer` |
| E10 | session-actions-menu › VIEW group | EP | L1 | automated | `deriveSessionMenu` for a plain session and a worktree session | derive | VIEW item ids equal exactly `["card-sections"]`; no `card-defaults`; `SessionMenuActions` has no `openCardDefaults` |
| E11 | session-actions-menu › rendered menu | EP | L1 | automated | desktop `SessionCard` in `/a` | open `⋯` menu | `session-menu-item-card-sections` present; `session-menu-item-card-defaults` absent; activating card-sections navigates to `/a`'s cards page and does not select the session |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | settings-panel › consumed once | state-transition | L1 | automated | E6 setup rendered inside `<React.StrictMode>` | config resolves | `scrollIntoView` call count stays 1 (double effect does not re-scroll) |
| F2 | Session cards page › Back returns | state-transition | L3 | automated | docker harness; folder `FIXTURE_GIT` cards page `/folder/<cwd>/settings/cards` | click `card-sections-open-global`, then `page.goBack()` | after click: URL settles at `/settings/general` (no `scroll=`), `card-sections-settings` is in viewport; after goBack: URL is `/folder/<cwd>/settings/cards` and `card-sections-override-summary` visible |
| F3 | Session cards page › in-panel dismiss | state-transition | L3 | automated | same as F2, Settings reached via the link | press `Escape` (overlay dismiss) | lands on `/folder/<cwd>/settings/cards`, not `/` or the session |
| F4 | visual fit of the strip | visual/subjective | — | manual-only | cards page strip in dark + light theme, 375px and 1440px | human looks | [judgment: link and `Reset to global` wrap as a pair, match the accepted mock frame 1] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | settings-panel › external scroll param | fault-injection (abort) | L1 | automated | `/api/config` rejects | navigate to `/settings/general?scroll=card-sections-settings` | no throw; no `scrollIntoView`; no replace navigation while the panel never reaches the loaded state |

---

## Coverage summary

- Requirements covered: 5/5 (Session cards page, Inline legend menu, Menu groups taxonomy, settings-panel scroll target, i18n)
- Scenarios by class: edge 11 · perf 0 · frontend 4 · error 1
- Scenarios by level: L1 13 · L2 0 · L3 2 · manual 1
- Scenarios by disposition: automated 15 · manual-only 1

## New infra needed

- none (L3 reuses `tests/e2e/helpers/card-sections.js` + `helpers/index.js`)
