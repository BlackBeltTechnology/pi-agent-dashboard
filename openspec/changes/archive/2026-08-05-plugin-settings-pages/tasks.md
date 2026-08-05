## 1. Extract shared activation-row internals (no behaviour change)

- [x] 1.1 Create `packages/client/src/components/packages/plugin-row-parts.tsx` and move `StatusPill`, `CopyableErrorBlock`, and `MissingRequirementsBlock` out of `PluginsSection.tsx` verbatim (including the `WARN_*`/`ERR_*`/`OK_*`/`LINK_*` theme-token fragments they depend on).
- [x] 1.2 Extract the toggle path — `previewCascade`, `performToggle`, `handleToggle`, `CascadeDialog`, and the restart-required banner state — into a `usePluginToggle()` hook in `packages/client/src/hooks/`, so the plugin page and the activation index share one implementation.
- [x] 1.3 Re-point `PluginsSection.tsx` at the extracted parts; confirm `packages/client/src/components/__tests__/PluginsSection.test.tsx` passes untouched (green before any behaviour change is the proof the extraction was mechanical).
- [x] 1.4 Verify `PluginsSection.tsx` shrank; record before/after line counts in the PR body (design D6 — the file must end up smaller, not merely rearranged).

## 2. Plugin settings page (added alongside the existing render path)

- [x] 2.1 Author the L1 page + route scenarios from section 9 before implementing (rows E1-E7, E11) and verify they fail.
- [x] 2.2 Implement `packages/client/src/components/settings/PluginSettingsPage.tsx`: identity (icon, display name, `id`), status pill, enable toggle via `usePluginToggle()`, metadata chips (`depends on`, claimed slots), error + `MissingRequirementsBlock` banners, then `<SettingsSectionByPluginSlot pluginId={id} />`. NOTE: `version`, `description`, and `source` are NOT rendered — `PluginRow` does not carry them (design D1); adding them to `GET /api/plugins` is a separate change.
- [x] 2.3 Enforce D1 (no opt-out): the page SHALL construct the chrome unconditionally and pass the plugin no prop that could suppress it. Add an assertion that a plugin component returning `null` still yields a full chrome header.
- [x] 2.4 Widen the canonical settings route pattern to `/settings/:page?/:sub?` in `App.tsx:384` and `SettingsPanel.tsx:360`; parse into `activeTab = "plugins"` + `activePluginId`, leaving `VALID_SETTINGS_TABS` untouched (design D2). Interpret `:sub` only when `:page === "plugins"`. Unknown id → activation index with a not-found notice.
- [x] 2.5 Add a route-pattern test asserting wouter splits `/settings/plugins` and `/settings/plugins/roles` unambiguously with two consecutive optional segments, and that `/settings/server/anything` still resolves to Server.
- [x] 2.6 Confirm a hard reload on `/settings/plugins/roles` resolves instead of `replace`-redirecting to `/settings/general` (`SettingsPanel.tsx:399`).
- [x] 2.7 Leave the folder-scoped route alone: `/folder/:cwd/settings/:page?` renders `DirectorySettings` and `VALID_FOLDER_SETTINGS_PAGES` (`App.tsx:422-426`) excludes `plugins`. Add a test asserting `/folder/<cwd>/settings/plugins/flows` uses the existing invalid-page fallback and does NOT render a plugin page.
- [x] 2.8 Add `PluginSettingsPageContext` (provided by `PluginSettingsPage`, carrying the owning plugin id), make `SettingsDraftSource.page` optional (`settings-draft-context.tsx:25`), and make `useSettingsDraftSource` (`:40-56`) rewrite `page` → `plugins/<pluginId>` before calling `registry.upsert`. The rewrite must live in the hook, NOT in the registry closure — `draftRegistry` is memoized in `SettingsPanel` scope and cannot read a descendant's context (design D5).
- [x] 2.9 Drop the hardcoded `page` argument from `useSettingsDraftSource` in `flows-plugin/src/client/FlowsSettings.tsx`, `automation-plugin/src/client/AutomationSettings.tsx`, `roles-plugin/src/RolesSettingsSection.tsx`, and `subagents-plugin/src/client/SubagentsSettings.tsx`.
- [x] 2.10 Add a `useSettingsDraftSource` to `HermesMemorySettings.tsx` whose `commit` performs the save its own button does today (prerequisite for 6.3 — removing the footer first would strand its edits).

## 3. Flip the render path (the one user-visible change)

- [x] 3.1 Author the L1 slot/ordering/intent scenarios from section 9 before implementing (rows E12-E16, E19, E20, F3, F4, X6) and verify they fail.
- [x] 3.2 Make `SettingsSectionSlot` stop rendering `settings-section` claims; delete `forTab` once it has no callers.
- [x] 3.2z Add an `isPluginEnabled(id: string): boolean` accessor to `SlotRegistry` (`slot-registry.ts:96-117`) — it exposes `setEnabledSet` but no getter, and `getAllPluginsForActivationUi()` deliberately ignores the filter, so no consumer can read the set today. Must land before 3.2a. Do NOT derive enablement from non-empty `getClaims("settings-section")`: a plugin contributing only an intent would be wrongly dropped.
- [x] 3.2a Add intent consumption to `SettingsSectionByPluginSlot`, filtered by owning plugin id AND by `isPluginEnabled` (`useSlotIntents` reads `intent-store.ts:100-119` with no enabled-set awareness, and nothing clears a disabled plugin's intents). Without this, deleting `SettingsSectionSlot` silently drops every intent-driven and descriptor contribution, and a plugin disabled mid-session keeps an intent-rendered body (design D6, D7).
- [x] 3.2b Render claims first in registry-comparator order (ascending `priority`, tie-break `pluginId`), then intents in store order; fix the stale "descending priority" comment at `slot-consumers.tsx:365` (design D8).
- [x] 3.3 Remove all `<SettingsSectionSlot tab="…" />` mounts from `SettingsPanel.tsx` (~15 call sites across general, server, sessions, remote, security, providers, packages, plugins, openspec, developer, skills, agents, extensions, prompts, themes).
- [x] 3.4 Apply the slot-fallback guardrail: no JSX element may be constructed inside a `??` chain before a claims-length check. Add `SettingsPanel.tsx` to `SCAN_FILES` in `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts` if absent (see `fix-slot-fallback-masks-content`).
- [x] 3.5 Add the repo-lint assertion that `packages/client/src/components/settings/SettingsPanel.tsx` does not contain the string `SettingsSectionSlot`.
- [x] 3.6 Stop rejecting unknown `tab` values in `packages/shared/src/dashboard-plugin/manifest-validator.ts:109-116` (it currently throws); keep accepting the field with no warning. Update `manifest-validator.test.ts`, which asserts the rejection.
- [x] 3.7 Update `packages/shared/src/__tests__/plugin-activation-contracts.test.ts` — it asserts the presence of the `SettingsSectionSlot` mounts this change removes.
- [x] 3.8 Update `slot-registry-enabled-set.test.ts` if its disabled-plugin `settings-section` assertions collide with the new page behaviour (chrome renders, body does not).

## 4. Navigation rail

- [x] 4.1 Author the L1 nav-membership scenarios from section 9 before implementing (rows E8, E9, E10) and verify they fail.
- [x] 4.2 Give `SettingsPanel` its own `GET /api/plugins` fetch + `plugin-config-update` subscription (today only `PluginsSection` holds this data) to populate the nav children.
- [x] 4.3 Make the `plugins` nav entry expandable in `navGroups` (`SettingsPanel.tsx` ~line 722); children = plugins where `enabled === true` AND at least one `settings-section` claim, sorted by display name, each with a health status dot.
- [x] 4.4 Wire the existing per-page dirty indicator to plugin children via the `plugins/<id>` page id; confirm the parent `Plugins` entry does not inherit a child's dirty dot.
- [x] 4.5 Guard rail navigation ONLY when leaving a plugin page whose own sources are dirty — replace the raw `navigate("/settings/" + id)` (`SettingsPanel.tsx:803`) with a scoped check, NOT the panel-level `isDirtyRef` that `requestNavigate` uses (`:610-613`). Keying off aggregate dirtiness would block a user with unsaved Server edits from opening any other page and would break the "Bar names every dirty page" scenario (design D5a).

- [x] 4.7 Give the rail a child-level active state: compare children against `activePluginId` and top-level entries against `activeTab`, so exactly one entry is active on `/settings/plugins/roles` and the parent is active only on `/settings/plugins` (design D8a).
- [x] 4.6 Handle the disabled-while-dirty case: block the toggle with the existing unsaved-changes confirm rather than silently discarding edits, and ensure the confirm resolves BEFORE the rail drops the nav child (design Open Question 3).

## 5. Save Bar attribution

- [x] 5.1 Author the L1 draft-page-id scenarios from section 9 before implementing (rows E17, E18) and verify they fail.
- [x] 5.2 Extend the Save Bar to render each dirty page as a navigating affordance, labelled `Plugins › <Display Name>` for plugin pages. No change to the fan-out or to `SettingsDraftRegistry` semantics.
- [x] 5.3 Add the header changed-page count badge.

## 6. Retire the old surfaces

- [x] 6.1 Remove the inline settings expander from `PluginsSection.tsx` (`state.expanded`, the `PluginSettingsHost` mount, and the expand/collapse title logic); repoint the cog affordance to navigate to `/settings/plugins/<id>`, keeping its disabled state for plugins with no settings. Update `PluginsSection.test.tsx:125` ("expanding a row mounts PluginSettingsHost").
- [x] 6.2 Mark disabled plugins in the activation index so their absence from the rail is explained where the user looks for them.
- [x] 6.3 Delete the `position: fixed` save footer from `packages/hermes-memory-plugin/src/client/HermesMemorySettings.tsx`; its state now belongs to the global Save Bar (design D5).
- [x] 6.4 Drop the self-rendered `<section>` + `<h3>` header from `packages/roles-plugin/src/RolesSettingsSection.tsx` (~line 510) so it does not double-header under the host chrome (design D1).
- [x] 6.5 Inline or delete `PluginSettingsHost.tsx` if it no longer earns its indirection after the expander is gone.

## 7. Verify

- [x] 7.1 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` — full suite green, including every section 9 row.
- [x] 7.1a `npm run test:e2e` against the docker harness — every section 10 row green. Read the harness port from `.pi-test-harness.json` (`dashboardPort`); never hardcode `:18000`.
- [x] 7.2 `npm run quality:changed` — Biome clean on the diff.
- [x] 7.3 `npm run build && curl -X POST http://localhost:8000/api/restart` (client + server changed), then walk all five states in the browser against the mockup `mockups/plugin-settings-pages/index.html`: activation index, healthy page, not-loaded page, disabled page, errored page.
- [x] 7.4 Confirm no plugin settings content renders on General, and that General shows only built-in framed sections. All eight monorepo claimants (`automation`, `demo`, `flows`, `flows-anthropic-bridge`, `goal`, `hermes-memory`, `roles`, `subagents`) declare `tab: "general"` today, so General is the highest-signal check.
- [x] 7.5 Confirm the `HermesMemorySettings` fixed footer no longer overlays any settings page.
- [x] 7.6 Deep-link check: hard-reload `/settings/plugins/roles`, `/settings/plugins/subagents` (disabled), and `/settings/plugins/not-installed`.
- [x] 7.7 Invoke the `review-code` discipline skill on the full diff before commit.
- [x] 7.8 Invoke `doubt-driven-review` specifically on the `tab`-inert hard cutover (design D3) — it is a one-way door for third-party plugins.

## 8. Documentation

- [x] 8.1 Delegate to `DocScribe` (caveman style): update `docs/architecture.md` with the plugin settings placement contract — `/settings/plugins/<id>`, host-owned chrome, `tab` inert.
- [x] 8.2 Add/refresh directory `AGENTS.md` rows for `PluginSettingsPage.tsx`, `plugin-row-parts.tsx`, and the `usePluginToggle` hook; update the `PluginsSection.tsx` row with `See change: plugin-settings-pages`.
- [x] 8.3 Add a release note entry stating that third-party `settings-section` claims relocate from their `tab` to their own plugin page.
- [x] 8.4 Run `kb dox lint` and clear any `stale`/`missing` rows this change introduced.

## 9. Automated scenarios — L1 unit (vitest)

Harness exemplars: page/nav rows copy glue from `packages/client/src/components/__tests__/PluginsSection.test.tsx`; slot/intent rows from `packages/dashboard-plugin-runtime/src/__tests__/slot-consumers.test.tsx` + `intent-end-to-end.test.tsx`; validator rows from `manifest-validator.test.ts`; lint rows from `packages/shared/src/__tests__/plugin-activation-contracts.test.ts`.

- [x] 9.1 Route resolves to a plugin page — route `/settings/plugins/roles` with `roles` installed+enabled+claiming · route resolution runs · `activeTab==="plugins"` and `activePluginId==="roles"`, no `replace` fires. See `PluginsSection.test.tsx`. (test-plan #E1)
- [x] 9.2 Bare plugins route — route `/settings/plugins` · resolution runs · `activePluginId===null`, activation index renders. See `PluginsSection.test.tsx`. (test-plan #E2)
- [x] 9.3 Unknown plugin id — route `/settings/plugins/not-installed` · resolution runs · index + not-found notice node, no blank page. See `PluginsSection.test.tsx`. (test-plan #E3)
- [x] 9.4 Installed plugin without settings — route `/settings/plugins/demo`, `demo` enabled with zero claims · resolution runs · index + notice, NOT an empty-bodied plugin page. See `PluginsSection.test.tsx`. (test-plan #E4)
- [x] 9.5 Trailing segment ignored off-plugins — route `/settings/server/anything` · resolution runs · Server page renders, no redirect to General. See `PluginsSection.test.tsx`. (test-plan #E5)
- [x] 9.6 Two optional segments split unambiguously — compiled wouter pattern `/settings/:page?/:sub?` · match `/settings/plugins` then `/settings/plugins/roles` · yields `{plugins, undefined}` then `{plugins, roles}`. See `PluginsSection.test.tsx`. (test-plan #E6)
- [x] 9.7 Folder route excluded — route `/folder/<cwd>/settings/plugins/flows` · resolution runs · `DirectorySettings` invalid-page fallback, NO plugin page. See `PluginsSection.test.tsx`. (test-plan #E7)
- [x] 9.8 Nav membership decision table — 4 plugins across `{enabled}×{claims}` · rail renders · exactly the enabled+claiming one is a child. See `PluginsSection.test.tsx`. (test-plan #E8)
- [x] 9.9 Membership keys on enabled not loaded — `automation` `{enabled:true, loaded:false, error}` · rail renders · child present with error-state dot. See `PluginsSection.test.tsx`. (test-plan #E9)
- [x] 9.10 Children alphabetical — `Roles`,`Automation`,`Flows` enabled+claiming · rail renders · order `Automation, Flows, Roles`. See `PluginsSection.test.tsx`. (test-plan #E10)
- [x] 9.11 Chrome tolerates the real field set — `PluginRow` for `flows` (no version/description/source/icon) · page renders · no `undefined`/`NaN`/empty-label artifacts. See `PluginsSection.test.tsx`. (test-plan #E11)
- [x] 9.12 Validator accepts unknown tab — claim `{slot:"settings-section", tab:"nonexistent"}` · `validateManifest` runs · valid, no throw, no warning. See `manifest-validator.test.ts`. (test-plan #E12)
- [x] 9.13 Every tab value routes identically — claims with `tab` general/security/absent · page resolution · all render on the plugin page; General and Security render none. See `slot-consumers.test.tsx`. (test-plan #E13)
- [x] 9.14 Claim priority ascending — one plugin, claims `priority` 10 and 500 · page renders · 10 precedes 500. See `slot-consumers.test.tsx`. (test-plan #E14)
- [x] 9.15 Priority tie-break — equal priority, differing `pluginId` · registry sorts · `localeCompare` order, not registration order. See `slot-consumers.test.tsx`. (test-plan #E15)
- [x] 9.16 Claims precede intents — plugin with one claim and one intent · page renders · claim node before intent node, no priority interleave. See `intent-end-to-end.test.tsx`. (test-plan #E16)
- [x] 9.17 Host overrides plugin-declared page — source declaring `page:"general"` registered inside `/settings/plugins/roles` · upsert runs · entry `page==="plugins/roles"`, General shows no dot for it. See `PluginsSection.test.tsx`. (test-plan #E17)
- [x] 9.18 Omitted page is filled by host — source omitting `page` · upsert runs · filed under `plugins/<id>`, no type error. See `PluginsSection.test.tsx`. (test-plan #E18)
- [x] 9.19 SettingsPanel lint — file `settings/SettingsPanel.tsx` · lint test reads it · does not contain `SettingsSectionSlot`. See `plugin-activation-contracts.test.ts`. (test-plan #E19)
- [x] 9.20 Single render path — `slot-consumers.tsx` post-flip · unit test · `SettingsSectionSlot` yields no `settings-section` content for any tab; `forTab` export gone. See `slot-consumers.test.tsx`. (test-plan #E20)
- [x] 9.21 Disabled plugin intent filtered — `flows` disabled, its `settings-section` intent still in the store · page renders · intent NOT rendered, disabled notice instead. See `intent-store.test.ts`. (test-plan #F3)
- [x] 9.22 Intent-only contribution survives the flip — plugin contributing via intent broadcast only · page renders · contribution renders beneath chrome. See `intent-end-to-end.test.tsx`. (test-plan #F4)
- [x] 9.23 Throwing plugin component contained — settings component that throws on render · page renders · `SlotErrorBoundary` catches, chrome still renders, other pages unaffected. See `slot-consumers.test.tsx`. (test-plan #X6)

## 10. Automated scenarios — L3 Playwright e2e (docker harness)

Harness exemplars: routing/nav rows copy glue from `tests/e2e/navigation.spec.ts`; plugin-activation rows from `tests/e2e/anthropic-bridge-activation.spec.ts`. Read the harness port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.

- [x] 10.1 Disabled page is chrome-only — `/settings/plugins/subagents` with `subagents` disabled · page loads · converges to chrome + `disabled` pill + re-enable affordance, no settings body, plugin component never mounted. See `anthropic-bridge-activation.spec.ts`. (test-plan #F1)
- [x] 10.2 Live disable collapses body — user on `/settings/plugins/flows` with body rendered · toggle `flows` off · converges to body removed + disabled notice, chrome retained, no reload. See `anthropic-bridge-activation.spec.ts`. (test-plan #F2)
- [x] 10.3 Active nav child — route `/settings/plugins/roles` · rail renders · exactly one active entry, the `Roles` child; parent not active. See `navigation.spec.ts`. (test-plan #F5)
- [x] 10.4 Active parent on index — route `/settings/plugins` · rail renders · parent active, zero children active. See `navigation.spec.ts`. (test-plan #F6)
- [x] 10.5 Rail updates live on toggle — rail showing `Flows` · disable `flows` from the index · child removed without reload, no stale entry. See `anthropic-bridge-activation.spec.ts`. (test-plan #F7)
- [x] 10.6 Dirty dot on the child — edit a control on `/settings/plugins/hermes-memory`, leave the page · rail re-renders · child shows dirty dot, parent shows none on its own behalf. See `navigation.spec.ts`. (test-plan #F8)
- [x] 10.7 Save Bar names both pages — unsaved Server edits, then open `/settings/plugins/goal` and edit · Save Bar renders · names BOTH pages (no cap), `Plugins › Goal` navigates there. See `navigation.spec.ts`. (test-plan #F9)
- [x] 10.8 One Save commits both — two pages dirty · click Save once · single fan-out, both indicators clear, bar dismisses. See `navigation.spec.ts`. (test-plan #F10)
- [x] 10.9 Deep link survives reload — browser on `/settings/plugins/roles` · hard reload · page renders, URL unchanged, no redirect to General. See `navigation.spec.ts`. (test-plan #F11)
- [x] 10.10 Index never renders settings inline — `/settings/plugins`, `roles` row · click the settings affordance · navigates to the plugin page; no `settings-section` content inside the list. See `anthropic-bridge-activation.spec.ts`. (test-plan #F12)
- [x] 10.11 General is clean — all 8 claimants enabled (all declare `tab:"general"`) · open `/settings/general` · only built-in framed sections, zero plugin-contributed nodes. See `navigation.spec.ts`. (test-plan #F13)
- [x] 10.12 No fixed footer overlay — any settings page with `hermes-memory` enabled · page renders · no `position: fixed` bottom bar from the plugin overlays the viewport. See `navigation.spec.ts`. (test-plan #F14)
- [x] 10.13 Load error on the page — `automation` status `{loaded:false, error:"Bridge path conflict: ..."}` · open its page · `error` pill + full text in a copy-on-click block, chrome renders, no crash. See `anthropic-bridge-activation.spec.ts`. (test-plan #X1)
- [x] 10.14 Missing requirement on the page — `goal` with `missingRequirements:["pi-goal"]` · open its page · `not loaded` pill + requirement banner + `Install` affordance. See `anthropic-bridge-activation.spec.ts`. (test-plan #X2)
- [x] 10.15 Rail guard fires for a dirty plugin page — dirty edits on `/settings/plugins/flows` · click another rail entry · confirm dialog appears BEFORE unmount; Cancel keeps edits intact. See `navigation.spec.ts`. (test-plan #X3)
- [x] 10.16 Rail guard does NOT fire for a dirty built-in page — dirty Server edits, plugin pages clean · click another rail entry · no dialog, Server edits and dirty indicator persist. See `navigation.spec.ts`. (test-plan #X4)
- [x] 10.17 Disable-while-dirty ordering — dirty edits on `/settings/plugins/flows` · toggle `flows` off from that page · confirm resolves BEFORE the rail drops the child; no source filed under a page with no nav entry. See `anthropic-bridge-activation.spec.ts`. (test-plan #X5)
- [x] 10.18 Nav survives an API failure — `GET /api/plugins` returns 500 · open Settings · rail renders without plugin children, no crash, no infinite spinner, rest of Settings usable. See `navigation.spec.ts`. (test-plan #X7)

## 11. Manual verification (deferred post-merge)

- [x] 11.1 Roles header reads as one coherent header under the host chrome, with no visual duplication, on `/settings/plugins/roles` (test-plan: manual-only)
- [x] 11.2 All five page states (healthy / not-loaded / disabled / errored / index) read as one system when compared against `mockups/plugin-settings-pages/index.html` (test-plan: manual-only)
