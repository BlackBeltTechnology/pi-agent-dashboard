# Test Plan — plugin-settings-pages

Stage: design   Generated: 2026-07-09

HARD gate resolved before writing: three unfillable Triples were put to the user
(no-settings plugin URL · rail perf threshold · Save Bar page-list bound). All
three answered; the answers are folded into the specs and Non-Goals. No
`[NEEDS CLARIFICATION]` markers remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | settings-panel · page-id registry | state-transition (legal edge) | L1 | automated | route `/settings/plugins/roles`, plugin `roles` installed + enabled + claims `settings-section` | route resolution runs | `activeTab === "plugins"` AND `activePluginId === "roles"`; no `replace` navigation fires |
| E2 | settings-panel · page-id registry | EP (valid partition) | L1 | automated | route `/settings/plugins` | route resolution runs | `activeTab === "plugins"`, `activePluginId === null`; activation index renders |
| E3 | settings-panel · page-id registry | EP (invalid partition) | L1 | automated | route `/settings/plugins/not-installed` | route resolution runs | activation index renders + not-found notice node present; no blank page, no crash |
| E4 | settings-panel · page-id registry | EP (invalid partition) | L1 | automated | route `/settings/plugins/demo`, `demo` enabled with zero `settings-section` claims | route resolution runs | activation index + notice renders; NO plugin page with empty body |
| E5 | settings-panel · page-id registry | BVA (segment count) | L1 | automated | route `/settings/server/anything` (3 segments, non-plugin page) | route resolution runs | Server page renders; trailing segment ignored; no redirect to General |
| E6 | settings-panel · page-id registry | BVA (segment count) | L1 | automated | wouter pattern `/settings/:page?/:sub?` compiled | match `/settings/plugins` then `/settings/plugins/roles` | first yields `{page:"plugins", sub:undefined}`, second `{page:"plugins", sub:"roles"}`; no ambiguous split |
| E7 | settings-panel · folder route excluded | EP (invalid partition) | L1 | automated | route `/folder/<encodedCwd>/settings/plugins/flows` | route resolution runs | `DirectorySettings` renders with its existing invalid-page fallback (`packages`); NO plugin settings page |
| E8 | settings-panel · nav group membership | decision-table | L1 | automated | 4 plugins: `{enabled:T,claims:T}`, `{enabled:T,claims:F}`, `{enabled:F,claims:T}`, `{enabled:F,claims:F}` | rail renders | exactly one child rendered (the T/T plugin); other three absent |
| E9 | settings-panel · nav group membership | decision-table (health axis) | L1 | automated | plugin `automation` `{enabled:true, loaded:false, error:"..."}` | rail renders | `Automation` child IS present with an error-state status dot — membership keys on `enabled`, not `loaded` |
| E10 | settings-panel · nav ordering | EP | L1 | automated | children `Roles`, `Automation`, `Flows` enabled with claims | rail renders | rendered order is `Automation, Flows, Roles` (alphabetical by display name) |
| E11 | loader · chrome field set | EP | L1 | automated | `PluginRow` for `flows` (no `version`/`description`/`source`/`icon` fields exist) | `PluginSettingsPage` renders | chrome renders displayName, id, status pill, deps, slot ids; no `undefined`/`NaN`/empty-label artifacts |
| E12 | loader · `tab` inert | EP (previously-invalid partition) | L1 | automated | manifest claim `{slot:"settings-section", tab:"nonexistent"}` | `validateManifest` runs | returns valid; throws nothing; emits no warning |
| E13 | loader · `tab` inert | decision-table | L1 | automated | claims with `tab` = `"general"`, `"security"`, absent | page resolution for each | all three render on `/settings/plugins/<id>`; General/Security render none |
| E14 | shell-slots · ordering | BVA (priority) | L1 | automated | one plugin, two claims: `priority` 10 and 500 | page renders | claim with `priority:10` renders before `priority:500` (ascending, per registry comparator) |
| E15 | shell-slots · ordering | EP (tie-break) | L1 | automated | two claims, equal priority, differing `pluginId` | registry sorts | tie broken by `pluginId.localeCompare` — NOT registration order |
| E16 | shell-slots · claims-then-intents | state-transition | L1 | automated | plugin `flows` with one claim AND one intent | page renders | claim node precedes intent node in DOM order; intent NOT interleaved as priority 1000 |
| E17 | settings-panel · dirty page id | EP | L1 | automated | plugin draft source declaring `page:"general"`, registered inside `/settings/plugins/roles` | `useSettingsDraftSource` upserts | registry entry has `page === "plugins/roles"`; General shows no dirty dot for it |
| E18 | settings-panel · dirty page id | EP (omitted value) | L1 | automated | plugin draft source omitting `page` entirely | `useSettingsDraftSource` upserts | entry filed under `plugins/<id>`; no type error (field is optional) |
| E19 | loader · repo lint | static analysis | L1 | automated | file `packages/client/src/components/settings/SettingsPanel.tsx` | lint test reads it | file does not contain the string `SettingsSectionSlot` |
| E20 | loader · single render path | static analysis | L1 | automated | `slot-consumers.tsx` after the flip | lint/unit test | `SettingsSectionSlot` returns no `settings-section` content for any `tab`; `forTab` export is gone |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | loader · disabled page chrome-only | state-transition | L3 | automated | `/settings/plugins/subagents`, `subagents` disabled in config | page loads | converges to: chrome + `disabled` pill + re-enable affordance present; plugin settings body absent; plugin component never mounted (no plugin-side network call fires) |
| F2 | loader · live disable collapses body | state-transition (illegal-edge-adjacent) | L3 | automated | user on `/settings/plugins/flows`, body rendered | toggle `flows` off (broadcasts `plugin_config_update`) | converges to: body removed, disabled notice shown, chrome still rendered — without a page reload |
| F3 | shell-slots · intents enabled-filtered | state-transition | L1 | automated | `flows` disabled, a `settings-section` intent for `flows` still present in the intent store | page renders | intent NOT rendered (consumer applies `isPluginEnabled`); disabled notice shown instead |
| F4 | shell-slots · intent path survives the flip | state-transition | L1 | automated | plugin contributing via intent broadcast only (no refs claim) | page renders | contribution renders beneath chrome — proving the flip did not amputate the intent path |
| F5 | settings-panel · nav active state | state-transition | L3 | automated | route `/settings/plugins/roles` | rail renders | exactly one entry carries the active marker: the `Roles` child; parent `Plugins` is not active |
| F6 | settings-panel · nav active state | state-transition | L3 | automated | route `/settings/plugins` | rail renders | parent `Plugins` active; zero children active |
| F7 | settings-panel · rail updates live | state-transition | L3 | automated | rail showing `Flows` child | disable `flows` from the activation index | `Flows` child removed from rail without reload; converges with no stale entry |
| F8 | settings-panel · dirty child dot | state-transition | L3 | automated | edit a control on `/settings/plugins/hermes-memory`, navigate away via the guard's Cancel-free path | rail re-renders | `Hermes Memory` child shows a dirty dot; parent `Plugins` shows none on its own behalf |
| F9 | settings-panel · Save Bar attribution | state-convergence | L3 | automated | unsaved Server edits, then open `/settings/plugins/goal` and edit a control | Save Bar renders | bar names BOTH pages (no cap, wrapping accepted); clicking `Plugins › Goal` navigates to that page |
| F10 | settings-panel · one Save commits all | state-convergence | L3 | automated | two pages dirty per F9 | click Save once | single fan-out; both pages' dirty indicators clear; bar dismisses |
| F11 | settings-panel · deep link survives reload | state-transition | L3 | automated | browser on `/settings/plugins/roles` | hard reload | `roles` page renders; URL unchanged; NOT redirected to `/settings/general` |
| F12 | loader · activation index has no inline body | state-transition | L3 | automated | `/settings/plugins`, `roles` row | click the settings affordance | navigates to `/settings/plugins/roles`; no `settings-section` content ever renders inside the activation list |
| F13 | General is clean of plugin content | state-transition | L3 | automated | all 8 monorepo claimants enabled (all declare `tab:"general"`) | open `/settings/general` | only built-in framed sections render; zero plugin-contributed nodes |
| F14 | hermes footer removed | state-transition | L3 | automated | `/settings/general` (or any page) with `hermes-memory` enabled | page renders | no `position: fixed` bottom bar from the plugin overlays the viewport |
| F15 | roles double-header removed | visual/subjective | — | manual-only | `/settings/plugins/roles` | human looks at the header area | [judgment: single coherent header, no visual duplication — no automatable observable beyond node counting] |
| F16 | overall chrome consistency | visual/subjective | — | manual-only | each of the 5 page states (healthy / not-loaded / disabled / errored / index) | human compares against `mockups/plugin-settings-pages/index.html` | [judgment: framing, spacing, and hierarchy read as one system] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | loader · error surface on page | fault-injection (load failure) | L3 | automated | plugin `automation` status `{loaded:false, error:"Bridge path conflict: ..."}` | open `/settings/plugins/automation` | `error` pill + full error text in a copy-on-click block; page still renders chrome, does not crash |
| X2 | loader · missing requirements | fault-injection (unsatisfied dep) | L3 | automated | plugin `goal` with `missingRequirements:["pi-goal"]` | open `/settings/plugins/goal` | `not loaded` pill + missing-requirement banner + `Install` affordance for the recommended extension |
| X3 | settings-panel · rail guard (plugin) | fault-injection (nav interrupt) | L3 | automated | dirty edits on `/settings/plugins/flows` | click another rail entry | confirm dialog appears BEFORE the plugin page unmounts; Cancel keeps the user on the page with edits intact |
| X4 | settings-panel · rail guard scope | fault-injection (nav interrupt) | L3 | automated | dirty edits on the Server page (built-in), plugin pages clean | click another rail entry | NO confirm dialog; Server edits persist in the draft; its dirty indicator persists |
| X5 | settings-panel · disable-while-dirty | fault-injection (state race) | L3 | automated | dirty edits on `/settings/plugins/flows` | toggle `flows` off from that page | unsaved-changes confirm resolves BEFORE the rail drops the child; no source is left filed under a page with no nav entry |
| X6 | shell-slots · plugin component throws | fault-injection (render abort) | L1 | automated | plugin settings component that throws on render | page renders | `SlotErrorBoundary` catches; host chrome still renders; other pages unaffected |
| X7 | settings-panel · API failure | fault-injection (abort) | L3 | automated | `GET /api/plugins` returns 500 for the nav fetch | open Settings | rail renders without plugin children (no crash, no infinite spinner); the rest of Settings remains usable |

---

## Coverage summary

- Requirements covered: 14/14 (loader 5 · settings-panel 6 · shell-slots 3)
- Scenarios by class: edge 20 · perf 0 · frontend 16 · error 7
- Scenarios by level: L1 23 · L2 0 · L3 18 · manual-only 2
- Scenarios by disposition: automated 41 · manual-only 2

Perf is 0 by explicit decision, not omission: the HARD gate asked for a workload
+ metric + threshold for rail scale and the answer was "performance is out of
scope for this change". Recorded as a Non-Goal in `design.md`.

L2 is 0 because nothing in this change touches install, spawn, or multi-OS
runtime behaviour — it is entirely client-side rendering and routing.

## New infra needed

None. L1 rows extend existing vitest suites in
`packages/client/src/components/**/__tests__/` and
`packages/dashboard-plugin-runtime/src/__tests__/`; L3 rows extend the existing
Playwright + docker-harness setup in `tests/e2e/`.
