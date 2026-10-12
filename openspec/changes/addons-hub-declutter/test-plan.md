# Test Plan — addons-hub-declutter

Stage: design   Generated: 2026-10-12

Hard gate passed: two clarifications answered by the user and folded into the specs (`Update available` chip disabled until a check completes; the mobile settings list follows the same Plugins-collapse rule).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | enrichment: Flag dashboard-managed bridge entries | decision-table | L1 | automated | user-scope row `/r/goal-plugin/src/bridge/index.ts`; path present in `dashboardPluginBridges` only / `_dashboardManagedPackages` only / both / neither | `enrichInstalledRows(rows, undefined, { managedPaths })` | `dashboardManaged` = true, true, true, absent respectively |
| E2 | enrichment: canonical path match | EP | L1 | automated | registry path `~/p/bridge/index.ts`; row source `/home/u/p/bridge/index.ts`; second case: home is a symlink to `/private/home/u` | enrich | both rows `dashboardManaged: true` |
| E3 | enrichment: project rows never flagged | decision-table | L1 | automated | project-scope row whose path equals a registry path | enrich | no `dashboardManaged` field; `isBundled` value equals the result without `managedPaths` |
| E4 | enrichment: registry absent | EP | L1 | automated | settings without both maps | `GET /api/packages/installed?scope=global` route test | 200; no row flagged; no throw |
| E5 | settings-panel: Canonical and legacy URLs | state-transition | L1 | automated | entry URLs `/settings/add-ons`, `/settings/packages`, `/settings?tab=packages` | mount SettingsPanel | URL becomes `/settings/add-ons` via replace (history length unchanged); Add-ons page renders |
| E6 | settings-panel: unknown page still falls back | BVA | L1 | automated | `/settings/package` (near-miss) and `/settings/add-on` | mount | replace to `/settings/general` |
| E7 | directory-settings-page: page ids | state-transition | L1 | automated | `/folder/<enc>/settings` (no page), `/settings/packages`, `/settings/add-ons`, `/settings/cards`, `/pi-resources` | render through `ShellContent` | default `add-ons`; `packages` replace-redirects to `add-ons`; `cards` renders Session cards; pi-resources lands on `add-ons` |
| E8 | addons-hub: bridges hidden | EP | L1 | automated | fixture: 38 rows = 9 `dashboardManaged` + 13 local + 16 npm | render Add-ons section | 0 rows named `index.ts`; installed count 29; banner says 13 |
| E9 | addons-hub: recommended once | decision-table | L1 | automated | entries: `pi-flows` installed global; `pi-simplify` installed only in folder; `pi-image-fit` not installed; all-installed fixture | render `RecommendedExtensions hideGlobalInstalled` | no `pi-flows` card; `pi-simplify` card with folder state; `pi-image-fit` Install card; all-installed → single "all recommended add-ons are installed" line |
| E10 | addons-hub: filter | EP + decision-table | L1 | automated | rows incl. "Hermes Memory" (desc contains "memory"), local rows, rows with `updateAvailable` | type `MEMORY`; toggle `Local source`; toggle both; type `zzz` | case-insensitive match; AND combination; empty sub-groups hidden while filtering; `zzz` → "nothing matches" + npm-search link carrying `zzz` |
| E11 | addons-hub: Update chip gating | state-transition | L1 | automated | page loaded, no check completed | render → complete check (mock `check-updates`) | chip `disabled` + description "Check for updates first" → enabled after completion |
| E12 | addons-hub: banner `Show` | state-transition | L1 | automated | 13 local rows; text filter `flows` active | click banner `Show` | text filter cleared, other chips off, `Local source` on; exactly 13 rows visible |
| E13 | pi-core-version-ui: no filter → all sub-groups | EP | L1 | automated | fixture with zero Core rows, no filter | render | Core sub-group renders with its empty hint |
| E14 | pi-core-version-ui: local row + menu reset | decision-table | L1 | automated | local row with `publishedVariantSource` + version 0.9.0; same without version; npm row | render row, open `⋮` | single source line; `local` badge description names target (and version only when known); menu label "Reset to published version (0.9.0)" / "Reset to published version"; npm row has no badge, no reset |
| E15 | pi-core-version-ui: reset gating | state-transition | L1 | automated | local row; queue running another source (`locked`) | open `⋮` | reset item disabled with locked reason; after queue idle + click → confirm dialog; reset runs only after confirm |
| E16 | settings-panel: reserved labels | EP | L1 | automated | `RESERVED_SETTINGS_LABELS` for en/hu/zh | assert | contains folded `add-ons` (and the localized `ADD-ONS`/`Add-ons` values); a promoted plugin labelled `Add-ons` is rejected by the existing collision check |
| E17 | ui-terminology + tokens | EP | L1 | automated | new i18n strings (explainer, legend, banner, chips, empty state) | existing terminology scan + `node scripts/theme-token-guard.mjs` | no `spawn*` words; zero new raw colour literals |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | addons-hub: explainer persistence | state-transition | L1 | automated | empty localStorage | render → dismiss → remount → click header link | expanded → collapsed after remount (`dashboard:addons-explainer-dismissed` set) → expanded and focused; toggle exposes `aria-expanded` |
| F2 | addons-hub: tooltips | EP | L1 | automated | row with `extension`, `skills`, `tools`, `dashboard UI` chips | query accessible description | each chip's description equals its plain-language definition |
| F3 | settings-panel: Plugins collapse (desktop) | state-transition | L1 | automated | no persisted choice | render `/settings/general` → navigate `/settings/plugins/flows` → back to `/settings/general` → click toggle → remount | collapsed with count → auto-expanded, `Flows` active, storage untouched → collapsed again → expanded and persisted across remount |
| F4 | settings-panel: Plugins collapse (mobile) | state-transition | L3 | automated | 375px viewport, docker harness, fresh browser storage | open settings list → tap `Plugins` → reload | row collapsed with count → children expand in place, URL unchanged → still expanded after reload |
| F5 | settings-panel: rail rename + redirect in a real browser | state-transition | L3 | automated | docker harness at its derived port | `goto('/settings/packages')` | final URL `/settings/add-ons`; rail shows `ADD-ONS` › `Add-ons` active; heading `Add-ons`; no element text `index.ts` in the installed list |
| F6 | addons-hub visual fit | visual/subjective | — | manual-only | Add-ons page, base dark, base light, one non-base palette, 375/768/1440 | human compares to `mockups/extensions-hub/index.html` | [judgment: spacing, hierarchy and explainer readability look right — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | enrichment: unreadable settings | fault-injection (abort) | L1 | automated | `listManagedBridges` reader throws / settings JSON invalid | `GET /api/packages/installed?scope=global` | 200 with rows unflagged; one warning logged; no 500 |
| X2 | enrichment: registry/package-list divergence | fault-injection | L1 | automated | registry lists 9 bridge paths, installed list contains none of them | route call | rows unflagged; exactly one warning line naming the count of unmatched registry paths |
| X3 | addons-hub: check-updates fails | fault-injection (abort) | L1 | automated | `/api/packages/check-updates` returns 500 | page load auto-check | `Update available` chip stays disabled with its description; no crash; other filters still work |

---

## Coverage summary

- Requirements covered: 15/15 (addons-hub 7, settings-panel 5 incl. view + resources-group text, url-routing 1, package-browse 1 via E8, directory-settings-page 2 via E7, pi-core-version-ui 1, enrichment 1)
- Scenarios by class: edge 17 · perf 0 (no latency requirement in the change) · frontend 6 · error 3
- Scenarios by level: L1 23 · L2 0 · L3 2 · manual 1
- Scenarios by disposition: automated 25 · manual-only 1

## New infra needed

- none (L1 = vitest siblings; L3 = existing docker harness + Playwright).
