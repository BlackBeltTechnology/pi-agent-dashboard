# Test Plan — promote-model-roles-settings

Stage: design   Generated: 2026-09-27

No clarifications outstanding — every Triple below is concrete (hard gate passed with zero gaps).

Levels: L1 = vitest (`packages/*/src/**/__tests__/*.test.ts[x]`, incl. React Testing Library component tests); L3 = Playwright vs docker harness (`tests/e2e/*.spec.ts`, port from `.pi-test-harness.json` `dashboardPort`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | loader: valid `nav` accepted + normalised | EP (valid class) | L1 | automated | `settings-section` claim `nav: { group: " models ", label: "  Model roles ", description: " Pick… ", order: 5 }` | `validateManifest()` | no throw, no warning; normalised claim `nav` = `{ group: "models", label: "Model roles", description: "Pick…", order: 5 }` |
| E2 | loader: `label` ≤ 40 after normalisation | BVA | L1 | automated | labels of length 1, 40, 41 (and 40 + surrounding spaces) | `validateManifest()` | 1/40/40+spaces → `nav` kept; 41 → manifest valid, claim has no `nav`, exactly one warning naming plugin id, claim index, `label` |
| E3 | loader: `description` ≤ 200 | BVA | L1 | automated | descriptions of length 200 and 201 | `validateManifest()` | 200 → kept; 201 → `nav` dropped whole, one warning naming `description`; plugin manifest still valid |
| E4 | loader: invalid hint shapes are dropped, never fatal | decision-table | L1 | automated | `nav` ∈ { `null`, `[]`, `"models"`, `{group:"models"}`, `{group:"", label:"X"}`, `{group:"models", label:"   "}`, `{…, description: 5}`, `{…, order: NaN}`, `{…, order: Infinity}`, `{…, order: "1"}` } on a manifest that also has a second valid claim | `validateManifest()` | every case: no throw; both claims present; `nav` absent on the first; one warning per case naming id + index + offending field |
| E5 | loader: Unicode Cc/Cf chars invalidate | EP (invalid class) | L1 | automated | `label` containing U+202E, U+200E, U+200B, U+FEFF, `\n`; `description` containing U+2066 | `validateManifest()` | each: `nav` dropped with one warning; plugin valid |
| E6 | loader: blank description dropped alone | EP | L1 | automated | `nav: { group: "models", label: "Model roles", description: "  " }` | `validateManifest()` | normalised `nav` = `{ group: "models", label: "Model roles" }`; no warning |
| E7 | loader: `nav` on a non-`settings-section` slot | EP | L1 | automated | `{ slot: "session-card-section", component: "X", nav: { group: "models", label: "X" } }` | `validateManifest()` | claim valid, no `nav` on it, zero warnings |
| E8 | loader: unknown group accepted | EP | L1 | automated | `nav: { group: "future-group", label: "X" }` | `validateManifest()` | valid; `nav.group === "future-group"` kept; no warning |
| E9 | loader: `nav` participates in registry hash | EP | L1 | automated | two discovered-plugin lists identical except `claims[0].nav.label` "A" vs "B" | `deterministicSerializePlugins()` | serialised strings differ (hash changes); identical `nav` → identical string |
| E10 | server: `/api/plugins` projects `nav` + `firstParty` | decision-table | L1 | automated | discovered plugins: `@blackbelt-technology/pi-dashboard-roles-plugin` with `nav`; `acme-dashboard-x` with `nav` + `priority: 100`; plugin with `packageName: ""` | `GET /api/plugins` | roles row `firstParty: true`, `claims[0].nav` deep-equals manifest; acme row `firstParty: false` with `nav` still projected; empty-name row `firstParty: false`; claims without `nav` have no `nav` key |
| E11 | server: providerAuth gate shares the scope helper | regression | L1 | automated | plugin `acme-x` and `@blackbelt-technology/y` | call `providerAuth.getCredential("anthropic")` from each plugin's server context | acme → `undefined`; scoped → auth.json entry (behaviour unchanged after helper extraction) |
| E12 | settings-panel: promotion gate | decision-table | L1 | automated | rows over `firstParty` ∈ {T,F} × `nav.group` ∈ {`models`, `dashboard`, `future-group`} × label ∈ {`Model roles`, `Security`} | `resolveSettingsPromotions(rows, reservedLabels)` | only (T, `models`, `Model roles`) is promoted; all 11 other combos absent from the map |
| E13 | settings-panel: reserved labels (static, all locales, NFKC) | EP | L1 | automated | first-party `models` hints labelled `" providers "`, `"Dashboard"`, `"Models"`, `"Szolgáltatók"` (hu Providers), `"提供商"` (zh-CN Providers), `"Ｐroviders"` (fullwidth) | resolver with the static reserved set; active locale `en` and then `hu` | every hint ignored under both locales; result identical across locales |
| E14 | settings-panel: first ELIGIBLE hint wins | state (claim order) | L1 | automated | first-party plugin with claim #1 `nav.group: "dashboard"`, claim #2 `nav: {group:"models", label:"Model roles"}`, claim #3 `nav: {group:"models", label:"Other"}` | resolver | promoted once with label `Model roles` |
| E15 | settings-panel: duplicate labels + ordering | BVA (tie-break) | L1 | automated | first-party `a` and `b` both `{models, "Budget", order 1000}`; `c` `{models, "Alpha", order 1000}`; `d` `{models, "Zed", order 1}` | resolver | map holds `a` (Budget), `c`, `d`; `b` absent; display order `d`, `c`, `a` |
| E16 | settings-panel: disabled plugin still promoted | EP | L1 | automated | roles row `status.enabled: false`, first-party, valid `nav` | resolver | roles present in the promotion map |
| E17 | roles-settings-ui: roles manifest requests promotion | EP | L1 | automated | `packages/roles-plugin/package.json` | `validateManifest()` on it | `settings-section` claim `BuiltInRolesSettings` has `nav.group === "models"`, `nav.label === "Model roles"`, non-empty `description`, `tab === "general"`; no warning |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | settings-panel: Models group first, holds Providers | EP | L1 | automated | plugin list with enabled first-party roles (`nav` models) | render `SettingsPanel` at `/settings/general` | first rail group heading `Models`; its items in order `Providers`, `Model roles`; `Extensions` group has no `Providers`; General is the active page |
| F2 | settings-panel: pointer row + single active entry | state-transition | L1 | automated | enabled promoted roles + enabled non-promoted `flows`, `goal` | render at `/settings/plugins/roles` | Plugins subtree shows `Flows`, `Goal`, `Roles ↗ Models` sorted by display name; exactly one element with `aria-current="page"` = the Models `Model roles` entry; clicking the pointer keeps URL `/settings/plugins/roles` |
| F3 | settings-panel: disabled promoted plugin | state-transition | L1 | automated | roles row `status.enabled: false` | render at `/settings/plugins/roles` | Models entry present with `off` marker; no `Roles` pointer in Plugins subtree; page shows disabled notice + re-enable control; `BuiltInRolesSettings` not mounted |
| F4 | settings-panel: health dot on promoted entry | EP | L1 | automated | roles `status: { enabled: true, loaded: false, error: "boom" }` | render `/settings/general` | Models `Model roles` entry carries the `error` health dot (same testid/class as a Plugins child error dot) |
| F5 | settings-panel + roles: dirty label follows placement | state-convergence | L1 | automated | promoted roles page with a registered draft source that reports dirty | render at `/settings/plugins/roles`, mark dirty | Save Bar dirty list contains `Models › Model roles` (not `Plugins › Roles`); dirty dot rendered on the Models entry; no dirty dot on any Plugins row |
| F6 | loader: compact chrome (healthy) | EP | L1 | automated | promoted, enabled, loaded roles row, no missing requirements | render `PluginSettingsPage` with `promotion` | heading `Model roles`; lede = `nav.description`; text `Provided by the Roles plugin` with enable toggle; no status pill; plugin id / `dependsOn` / dependents / slot ids NOT visible until the details disclosure is opened, then all four visible |
| F7 | loader: compact pill decision table | decision-table | L1 | automated | promoted rows: disabled; `error`; `loaded:false`; `status: null`; `missingRequirements` non-empty; healthy | render `PluginSettingsPage` with `promotion` | pill in the header (not inside disclosure) for the 5 unhealthy rows with labels disabled / error / not loaded / unknown / requirements; none for healthy |
| F8 | loader: text-only render + provenance sanitising | EP (hostile input) | L1 | automated | promoted row `nav.label: "<b>x</b>"`, `displayName: "Ro\u202Eles"` | render page + rail | rail and heading show the literal `<b>x</b>` (no `<b>` element); provenance text contains `Roles` with no U+202E |
| F9 | loader: disable while open converges | state-convergence | L1 | automated | promoted roles page open, body mounted | toggle enable → off (enabled-set update) | body unmounts and disabled notice appears without navigation; chrome remains; Models entry remains with `off` marker |
| F10 | settings-panel: activation-index marker | EP | L1 | automated | `PluginsSection` rows: disabled promoted roles, disabled non-promoted `subagents` | render `PluginsSection` with the promotion map | roles row marker text contains `Models` and no `not in Settings nav`; subagents row keeps `not in Settings nav` |
| F11 | settings-panel: end-to-end navigation (desktop) | state-transition | L3 | automated | docker harness, roles plugin enabled, viewport 1440×900 | open `/settings`; click `Model roles` | first rail group `Models`; URL `/settings/plugins/roles`; heading `Model roles`; role editor (`@planning` row) visible; Plugins subtree shows `Roles ↗ Models`; direct `goto('/settings/plugins/roles')` renders the same page |
| F12 | settings-panel: mobile strip order | state-transition | L3 | automated | docker harness, viewport 375×812 | open `/settings` | horizontal nav strip's first two entries are `Providers`, `Model roles`; tapping `Model roles` opens `/settings/plugins/roles` with non-zero content width |
| F13 | settings-panel + roles: dirty → Save end-to-end | state-convergence | L3 | automated | docker harness, a role (e.g. custom `@e2e-role`) with a model | change the role's model on `/settings/plugins/roles` | Save Bar lists `Models › Model roles`; clicking Save clears it and the new model persists after reload |
| F14 | visual hierarchy of Models group + compact chrome | visual/subjective | — | manual-only | studio + light themes at 375 / 768 / 1440 | human compares to `mockups/index.html` view A | [judgment: Models reads as primary, compact header is scannable, dimmed pointer/off states legible — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | settings-panel: older server (no `nav`/`firstParty`) | fault-injection (degraded API) | L1 | automated | `/api/plugins` rows without `firstParty` and without `claims[].nav` | render `SettingsPanel` | Models group contains only `Providers`; `Roles` is an ordinary Plugins child; no console error |
| X2 | settings-panel: promoted plugin not installed | fault-injection (missing dep) | L1 | automated | no `roles` row in `/api/plugins` | render at `/settings/plugins/roles` | Models has only `Providers`; page falls back to the activation index + plugin-not-found notice |
| X3 | loader: promoted page with load error | fault-injection (abort) | L1 | automated | roles `status: { enabled: true, loaded: false, error: "Bridge path conflict: x" }` | render `PluginSettingsPage` with `promotion` | compact header shows `error` pill; full error text in a copy-on-click block; body not mounted |
| X4 | loader: malformed `nav` never unloads plugin (discovery) | fault-injection (bad input) | L1 | automated | plugin dir whose manifest has `nav: null` plus a valid `settings-section` claim | `discoverPlugins()` | plugin is in the discovered list with its claims; one warning logged; no `ManifestValidationError` |

---

## Coverage summary

- Requirements covered: 5/5 (settings-panel: Models nav group, Settings panel view, Plugins nav group; dashboard-plugin-loader: settings-section render/nav/compact chrome; roles-settings-ui: registration + deferred persistence)
- Scenarios by class: edge 17 · perf 0 · frontend 14 · error 4
- Scenarios by level: L1 31 · L2 0 · L3 3 · manual 1
- Scenarios by disposition: automated 34 · manual-only 1
- Performance: none — the change adds an O(plugins) pure resolver on an existing fetch; no latency/throughput requirement exists to test against.

## New infra needed

- none (all rows extend existing test files or add a sibling in an existing `__tests__` dir / `tests/e2e/`)
