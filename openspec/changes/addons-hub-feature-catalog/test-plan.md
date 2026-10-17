# Test Plan — addons-hub-feature-catalog

Stage: design   Generated: 2026-10-17

Hard gate passed: one clarification answered and folded into the spec — latency budget (catalog p95 < 300 ms with 40 packages + 30 plugins; dry run p95 < 500 ms with 50 known dirs). Product decisions fixed during doubt-review: feature-level cascade, `stillLoadedIn` report (no folder writes), chip set (text + Local source + origin/kind/Disabled; no `Update available`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | catalog: join rules (Goal) | decision-table | L1 | automated | plugin `goal` (`requires.piExtensions: ["@ricoyudog/pi-goal-hermes"]`, `bridgeEntryPath` `/r/goal-plugin/src/bridge/index.ts`); installed `npm:@ricoyudog/pi-goal-hermes` + `dashboardManaged` row at the bridge path | `buildAddonCatalog(inputs)` | exactly one feature `plugin:goal` holding plugin + bridge + package; kind `agent-and-dashboard`; package and bridge appear in no other feature |
| E2 | catalog: own package (apple-tools) | EP | L1 | automated | plugin `apple-tools` with `packageName` `@blackbelt-technology/pi-dashboard-apple-tools`; installed `npm:` of that name | build | `plugin:apple-tools` owns the package; origin `first-party` |
| E3 | catalog: precedence decision table | decision-table | L1 | automated | 4 fixtures: (a) `x` required by `a`+`b`; (b) `p` = own package of `a` and required by `b`; (c) `x` linked `dashboardPlugin: a` and required by `a`+`b`; (d) `x` required by `a` only | build | (a) `pkg:x` with `requiredBy` [a,b]; (b) `p` in `plugin:a`, listed under `plugin:b.requires`, not owned; (c) `pkg:x` with `requiredBy` [a,b]; (d) `x` in `plugin:a` |
| E4 | catalog: one-package-one-feature invariant | EP (property) | L1 | automated | randomized 40-package / 30-plugin fixture (seeded) incl. duplicates of name across npm + local | build | every non-orphan installed package id occurs in exactly one feature; orphan `dashboardManaged` rows in none; empty `packageName` plugins claim nothing by rule 1 |
| E5 | catalog: kind derivation | decision-table | L1 | automated | plugin only; plugin + bridge only; plugin + package; package only; `core:pi`; `@blackbelt-technology/pi-dashboard-extension` | build | `dashboard-only`, `dashboard-only`, `agent-and-dashboard`, `agent-only`, `core`, `core:dashboard-bridge` kind `core` origin `first-party` |
| E6 | catalog: origin + author label | decision-table | L1 | automated | first-party plugin + `@ricoyudog/pi-goal-hermes`; community plugin + `@blackbelt-technology/x`; first-party plugin + `git:github.com/alice/pi-tool@v1`; local `/repo/packages/eng-disciplines` named `@blackbelt-technology/pi-dashboard-eng-disciplines`; feature with two community parts `@a/x` + `@b/y`; `core:pi` | build | `mixed`/`@ricoyudog`; `mixed`/community plugin's label; `mixed`/`alice/pi-tool`; `first-party`; `mixed` or `community` with label `@a, @b`; `upstream` |
| E7 | catalog: ordering + no extra registry call | EP | L1 | automated | features with displayNames `zeta`, `Alpha`, `alpha` (ids differ) + core features; spy on enricher npm lookup | `GET /api/addons/catalog` route test | order core:* → `Alpha`/`alpha` by id → `zeta`; npm lookup calls equal the enricher's own count (no added call); no `updateAvailable` field emitted by the catalog |
| E8 | toggle: disable Goal writes filter in place | state-transition | L1 | automated | settings `packages: ["npm:a", "npm:@ricoyudog/pi-goal-hermes", "npm:b"]`; plugin `goal` enabled | `POST /api/addons/plugin:goal/toggle {enabled:false}` | index 1 becomes `{source, extensions:[], skills:[], prompts:[], themes:[]}`; indices 0/2 unchanged; plugin config `goal.enabled=false`; restore file holds original string + filtered value; 200 `restartRequired: true` |
| E9 | toggle: exact restore | state-transition | L1 | automated | original entry `{source:"npm:g", skills:["!skills/legacy"]}`; off then on | two toggles | entry JSON-value equal to original; record removed; plugin enabled |
| E10 | toggle: enable rule table | decision-table | L1 | automated | 5 states: record + entry=filtered; record + entry=original; record + hand-edited entry; no record + all-empty form; no record + plain string | `{enabled:true}` | restored+record deleted; record deleted, reported restored; unchanged + `restoreSkipped:edited` + record kept; unchanged + `restoreSkipped:no-record`; unchanged |
| E11 | toggle: repeat off keeps record | state-transition | L1 | automated | feature already off with record holding original | `{enabled:false}` again | settings file and restore file byte-identical before/after |
| E12 | toggle: keptOn → partial | decision-table | L1 | automated | `p` owned by `plugin:a`, required by enabled plugin `b` | off `plugin:a` | `p` entry unchanged; `keptOn: [{source:p, by:["plugin:b"]}]`; catalog then reports `plugin:a.state = partial` |
| E13 | toggle: feature-level cascade off | state-transition | L1 | automated | `apple-tools.dependsOn = ["mcp-client"]`, both on, both own a package | off `plugin:mcp-client` | both plugins disabled in ONE config write; both packages filtered; `cascaded: ["plugin:apple-tools"]` |
| E14 | toggle: cascade on restores cascaded | state-transition | L1 | automated | state after E13 | on `plugin:apple-tools` | both plugins enabled; both entries restored; both records deleted |
| E15 | toggle: `pkg:` feature with requiredBy | EP | L1 | automated | `pkg:x` `requiredBy` [a,b], plugins on | off `pkg:x` | `x` filtered; plugin config untouched; response `requiredBy: ["plugin:a","plugin:b"]` |
| E16 | toggle: stillLoadedIn scan | decision-table | L1 | automated | 4 known dirs: `/r1` lists `npm:g`; `/r2` lists `npm:g` with `autoload:false`; `/r3` lists `npm:g` in all-empty form; `/r4` lists `./vendor/g` (local, resolves to the filtered local identity against `/r4/.pi`); `/r5` unparseable | off feature owning `npm:g` and that local path | `stillLoadedIn` lists `/r1` and `/r4` only; no folder file mtime changes; no throw on `/r5` |
| E17 | toggle: dry run + confirm token | state-transition | L1 | automated | Goal on | `{enabled:false, dryRun:true}` then `{enabled:false, confirmToken}` | dry run: report + token, settings/plugin/restore files unchanged; real call with same token succeeds |
| E18 | toggle: input validation | EP | L1 | automated | `core:pi`, `core:dashboard-bridge`, `plugin:nope`, body `{enabled:"yes"}` | POST each | 400 / 400 / 404 / 400; no file writes |
| E19 | toggle: duplicate identity | EP | L1 | automated | `packages: ["npm:x", "npm:x@1"]`, feature owns `x` | off | 409 `duplicate-entries`; no writes |
| E20 | restore store: stale record GC | state-transition | L1 | automated | record for `npm:x`; `npm:x` removed from settings (uninstall) / replaced by `npm:x` from local (reset) | build catalog | record deleted |
| E21 | Installed tab: Goal row | EP | L1 | automated | catalog fixture with `plugin:goal` (mixed, `@ricoyudog`) | render `UnifiedPackagesSection` | one row; badge `dashboard UI · ext by @ricoyudog`; chips `dashboard UI`, `bridge`, `extension`; no separate row for the package or bridge |
| E22 | Installed tab: per-part actions | decision-table | L1 | automated | feature with npm part + local part (with `publishedVariantSource`) + bridge; dashboard-only plugin; `core:pi` | open `⋮` | Update/Move/Uninstall per package part; one Reset item naming the local part; no Uninstall on bridge, core, or dashboard-only feature |
| E23 | Installed tab: grouping headings | decision-table | L1 | automated | fixture with one feature per origin + per source type | select each of 4 grouping modes | headings exactly as spec per mode; origin→heading mapping; install-source precedence local > git > npm; A–Z has no headings; each feature once |
| E24 | addons-hub: filter chips | decision-table | L1 | automated | features across origins/kinds/states incl. `partial`, a local part, a bridge path containing `memory` | toggle each chip; `From pi-dashboard`+`Community`; type `memory` | AND semantics; both origin chips → only `mixed`; `Disabled` includes off+partial; text filter ignores bridge path; no `Update available` chip; empty groups hidden |
| E25 | addons-hub: local banner counts features | EP | L1 | automated | 13 features with a local part, 9 local bridges | render; click `Show` with text filter active | banner says 13; filters reset, `Local source` on; 13 rows visible |
| E26 | addons-hub: recommended once / Discover | decision-table | L1 | automated | `pi-flows` global+active; `pi-flows` turned off by hub (all-empty form); global but inactive for other reason; folder-only `pi-simplify`; not installed `pi-image-fit` | render Discover tab | no card; no card (Installed shows off row); Activate card; folder-state card; Install card |
| E27 | addons-hub: explainer example | EP | L1 | automated | catalog with `plugin:goal` first agent-and-dashboard; catalog with none | render explainer | names Goal + its extension; static fallback uses entry + its `dashboardPlugin` plugin |
| E28 | addons-hub: part tooltips | EP | L1 | automated | chips `dashboard UI`, `extension`, `bridge`, `skills`, `prompts`, `themes` | query accessible description | each equals its plain-language definition; legend lists the six labels, no `tools` |
| E29 | tabs: URL state + counts | state-transition | L1 | automated | `/settings/add-ons`, `?tab=discover`, `?tab=bogus` | mount / click tab | Installed default; Discover selected; bogus → Installed; tab labels show feature count + update count |
| E30 | Updates tab: Update all | EP | L1 | automated | 3 updatable package parts in 2 features + pi core update | click Update all | 4 enqueues in FIFO order in the package queue (core via `coreUpdate`); row states running/queued |
| E31 | ui-terminology + tokens | EP | L1 | automated | new i18n strings (tabs, confirmation, chips, headings, partly on) | terminology scan + `node scripts/theme-token-guard.mjs` | no forbidden words; zero raw colour literals |
| E32 | refactor: plugin toggle unchanged | EP (regression) | L1 | automated | existing `plugin-activation-routes` suite | run after extracting `setPluginsEnabled` + adding lock | all existing cascade/blocker/409 cases pass unchanged |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | catalog latency budget | tail-latency (timed unit) | L1 | automated | route with 40 installed packages, 30 discovered plugins, 9 bridges, warm enricher cache (mocked npm) | p95 < 300 ms | 50 sequential requests |
| P2 | dry-run latency budget | tail-latency (timed unit) | L1 | automated | 50 temp known dirs, each with a 20-entry `.pi/settings.json`, Goal feature | p95 < 500 ms | 30 sequential dry runs |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Installed tab: partial control | state-transition | L1 | automated | `plugin:goal` partial | render; activate control | `role="checkbox"`, `aria-checked="mixed"`, visible "partly on"; activation opens off confirmation (dry run requested) |
| F2 | confirmation before combined off | state-transition | L1 | automated | Goal on; dry run returns cascaded + keptOn + stillLoadedIn | switch off → cancel; switch off → confirm | cancel: no toggle POST; confirm: POST carries `confirmToken`; dialog text names dashboard UI + AI-agent part, cascaded feature, kept-on package with link, folders |
| F3 | stale confirmation re-shows | state-transition | L1 | automated | server answers 409 `stale-confirmation` with new report | confirm | dialog re-renders with the fresh report; nothing marked toggled |
| F4 | catalog refresh on events | state-convergence | L1 | automated | `useAddonCatalog` mounted | emit `package_operation_complete` and `plugin_config_update` | exactly one refetch per event (debounced burst → one); rows converge to new state |
| F5 | session-reload offer | state-transition | L1 | automated | toggle succeeds with `restartRequired: true` | toggle | existing reload prompt shown once |
| F6 | end-to-end Goal off/on in a browser | state-transition | L3 | automated | docker harness at its derived port, Goal installed with `pi-goal-hermes` | open `/settings/add-ons`, switch Goal off, confirm, reload, switch on | row shows off after reload; `GET /api/addons/catalog` reports `off`; settings entry in filter form; after on, entry equals original and row on |
| F7 | tabs survive reload in a browser | state-transition | L3 | automated | docker harness | click Discover, reload | Discover selected, URL `?tab=discover`; recommended cards render there |
| F8 | Add-ons hub visual fit | visual/subjective | — | manual-only | Installed/Updates/Discover, base dark + light + one palette, 375/1440 | human compares to `mockups/extensions-hub/index.html` | [judgment: hierarchy, chip density, badge readability look right] |
| F9 | agent part actually stops | runtime/agent behaviour | — | manual-only | isolated env (non-8000 ports), Goal off from hub | start a new pi session | [judgment: `pi-goal-hermes` tools absent in the new session; re-enable → present; needs a live model session] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | unparseable settings | fault-injection (abort) | L1 | automated | `settings.json` = `{ "packages": [` | off Goal | 409; plugin config unchanged; no restore record |
| X2 | package op running | fault-injection (busy) | L1 | automated | `runExclusive` held by an install | off Goal | 409 busy; no writes |
| X3 | plugin step fails on off | fault-injection (abort) | L1 | automated | `setPluginsEnabled` throws after entries filtered | off Goal | entry restored to original; record deleted; 500 |
| X4 | restore step fails on on | fault-injection (abort) | L1 | automated | settings write throws after plugin enabled | on Goal | plugin disabled again; 500 |
| X5 | compensation fails | fault-injection (double abort) | L1 | automated | plugin step throws and compensating settings write throws | off Goal | 500 `consistent:false`; restore record kept; one error log line |
| X6 | enable blocked by missing dep | fault-injection | L1 | automated | `apple-tools` needs `mcp-client` which is not discovered | on `plugin:apple-tools` | 409 with `blockers`; no settings write |
| X7 | malformed restore file | fault-injection (corrupt) | L1 | automated | `addon-toggle-restore.json` = `not json` | on Goal (entry in filter form) | treated as empty: `restoreSkipped:no-record`; warning logged; no throw |
| X8 | concurrent toggles serialise | fault-injection (race) | L1 | automated | two parallel hub toggles + one `POST /api/plugins/goal/toggle` | fire concurrently | final settings + plugin config equal a serial order; no lost write; restore file valid JSON |
| X9 | stale confirmation | fault-injection (TOCTOU) | L1 | automated | dry run token; then enable plugin `b` requiring the package | real toggle with old token | 409 `stale-confirmation` + fresh report; no writes |
| X10 | toggle logging | observability | L1 | automated | off Goal | capture logger | exactly one info line naming feature, cascaded, plugins, filtered sources, keptOn, stillLoadedIn; dry run logs nothing |

---

## Coverage summary

- Requirements covered: 12/12 (addons-feature-catalog 6, addons-hub 5 MODIFIED, pi-core-version-ui 1 MODIFIED)
- Scenarios by class: edge 32 · perf 2 · frontend 9 · error 10
- Scenarios by level: L1 49 · L2 0 · L3 2 · manual 2
- Scenarios by disposition: automated 51 · manual-only 2

## New infra needed

- none (L1 = vitest siblings under `packages/server/src/__tests__/`, `packages/client/src/components/__tests__/`; L3 = existing docker harness + `tests/e2e/addons-hub.spec.ts`).
