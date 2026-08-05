# Design — plugin-settings-pages

## Context

`SettingsSectionSlot` renders plugin `settings-section` contributions as a bare fragment: `legacyClaims.map(renderClaim)` plus `intents.map(renderIntent)` wrapped in `<>…</>`, no chrome (`packages/dashboard-plugin-runtime/src/slot-consumers.tsx:338-359`). Everything a reader needs to orient — which plugin owns this, is it healthy, where does it end — is delegated to the plugin author, and all eight monorepo claimants target `tab: "general"` while framing themselves differently (see `proposal.md`). The failure is unbounded: a third-party plugin can render a naked `<div>` and the host has no say.

### The specs already contradict each other

This change is partly a reconciliation, not only a feature:

| Spec | Says |
|---|---|
| `dashboard-plugin-loader/spec.md:1043` | "`settings-section` claims SHALL render ONLY under the owning plugin's row"; "`SettingsPanel.tsx` SHALL NOT import or render `SettingsSectionSlot`"; "`claim.tab` … SHALL be inert at runtime" |
| `settings-panel/spec.md:97` | "The plugin `settings-section` slot SHALL continue to target a page via its `tab` field, defaulting to `general`"; "Each settings page SHALL mount `<SettingsSectionSlot tab={page} />`" |
| `dashboard-shell-slots/spec.md:32` | "Unknown `tab` values SHALL be rejected at manifest validation time" |

`add-plugin-activation-ui` made `tab` inert; `reorganize-settings-into-pages` later re-activated it. The code follows the *second* — 15 `SettingsSectionSlot` mounts live in `SettingsPanel.tsx` today, and `SettingsSectionByPluginSlot` exists for the activation tab. Both render paths are live, which is why identical claims can appear in two places.

### Constraints

- The draft/save machinery (`SettingsDraftProvider`, `SettingsDraftRegistry`, Save Bar, per-page dirty indicators, unsaved-navigation guards) is specified and working. This change MUST NOT alter its semantics.
- `PluginsSection.tsx` already owns toggle + cascade-confirm + requirement probes + error rendering. Duplicating any of it is a defect, not a feature.
- Plugin components are third-party React. The host cannot rely on them cooperating.

## Goals / Non-Goals

**Goals**

- One addressable page per plugin with settings: `/settings/plugins/<id>`.
- Host-owned chrome that a plugin cannot skip, opt out of, or render around.
- A single, unambiguous render path for `settings-section` claims.
- Nav that reflects what the user runs, not what is merely installed.
- Save stays global; the user can see *which pages* a Save will commit.

**Non-Goals**

- Per-page save semantics. One Save, one fan-out — unchanged.
- A new slot, a new claim kind, or manifest schema changes.
- Styling the *interior* of a plugin's settings body. The host owns the frame; the plugin owns the contents.
- Migrating plugin config storage (`plugins.<id>.*` namespace unchanged).
- Fixing the built-in General page's own composition beyond removing the slot mount.
- **Performance/scale of the nav rail.** No workload, metric, or threshold is set for a large plugin count; no performance scenario is authored. If rail growth becomes a real problem it gets its own change (see Risks).
- **Bounding the Save Bar's page list.** It names every dirty page with no cap; wrapping is accepted.

## Decisions

### D1 — Host owns the chrome; no opt-out

`PluginSettingsPage` renders identity, status pill, enable toggle, metadata chips, error/requirement banners, then the plugin body. The plugin supplies only the body.

*Rejected: `chrome: "none"` escape hatch.* An opt-out reintroduces exactly the failure being fixed — the naked-`<div>` plugin simply sets the flag. If a plugin genuinely needs full-bleed layout, that is a future slot, not a hole in this one. Cost: a plugin that already renders its own `<section>` + `<h3>` (roles) now double-headers, so `RolesSettingsSection.tsx` must drop its self-header. One-time edit in a first-party package.

**Chrome is limited to data the API already returns.** `PluginRow` (`packages/client/src/lib/package/plugins-api.ts:24`) carries `id`, `displayName`, `priority`, `hasServer/hasBridge/hasClient`, `claims`, `requires`, `dependsOn`, `dependents`, `status`. It has **no** `version`, `description`, `source`, or `icon`, and neither does the `PluginManifest` spec. The chrome renders what exists; adding manifest metadata to `GET /api/plugins` is a separate change, not smuggled in here.

### D2 — Route shape `/settings/plugins/<id>`; `SettingsTab` stays flat

The settings route is single-segment today — `useRoute("/settings/:page?")` in `App.tsx:384` and `SettingsPanel.tsx:360`. A three-segment URL does not match, and `SettingsPanel`'s resolution effect then `replace`-navigates to `/settings/general` (`SettingsPanel.tsx:399`) — so today a bookmarked plugin page silently bounces to General.

**The global settings patterns gain a second optional segment** (`/settings/:page?/:sub?`). `activeTab` remains the flat `SettingsTab` union; a sibling `activePluginId: string | null` carries `:sub`. Resolution order is unchanged and explicit: alias map → legacy `?tab=` → `:page` validation → `:sub` interpreted **only** when `:page === "plugins"` (ignored otherwise, so no other page grows an accidental sub-route). `plugins` with no id → activation index; `plugins/<id>` → plugin page. Two consecutive optional segments must be verified against wouter's compiled pattern so `/settings/plugins` and `/settings/plugins/roles` split unambiguously — a one-line test, not an assumption.

**The folder-scoped route is explicitly out of scope.** `/folder/:encodedCwd/settings/:page?` renders `DirectorySettings`, not `SettingsPanel` (`App.tsx:2143`, `:2261`), and `VALID_FOLDER_SETTINGS_PAGES` (`App.tsx:422-426`) does not contain `plugins` — a raw `plugins` already falls back to `packages`. Plugin configuration is global, not per-folder, so folder-scoped plugin pages are not a goal; adding the segment there would render the wrong component.

*Rejected: adding each `plugins/<id>` to `VALID_SETTINGS_TABS`.* That set is a closed, statically-enumerated contract consumed by the registry lint and the claim validator; plugin ids are open and runtime-discovered. Widening it would make the lint unenforceable.

An unknown or uninstalled `<id>` resolves to the activation index with a "not found" notice rather than a blank page — plugin ids come from URLs users paste.

### D3 — `tab` is inert; hard cutover, no deprecation window

`SettingsSectionSlot` stops rendering `settings-section` entirely. `SettingsSectionByPluginSlot` becomes the only consumer.

*Rejected: a deprecation window where `tab` still works for external plugins.* Two live render paths is the present bug; a window institutionalises it.

The supporting argument that "`dashboard-plugin-loader` already declared `tab` inert, so authors were warned" is **weaker than it looks** and is not load-bearing: the enforcing scenario reads `packages/client/src/components/SettingsPanel.tsx`, a path that does not exist (the file lives under `components/settings/`), so the lint has been a no-op and 15 live mounts contradict the requirement text. The delta fixes the path. The cutover rests on the two-render-paths argument alone.

The manifest schema keeps accepting `tab`, but this **relaxes** validation: `manifest-validator.ts` currently throws on a value outside `VALID_SETTINGS_TABS`, so previously-rejected manifests will start loading. `dashboard-shell-slots`' "unknown `tab` values rejected at validation" requirement is dropped, because rejecting a value nobody reads is noise.

Consequence to accept explicitly: a third-party plugin shipping `tab: "security"` relocates on upgrade without acting. It moves to a *more* discoverable place (its own page, named, in the nav), so this is judged acceptable — and is the only behaviour consistent with the loader spec.

### D4 — Nav children = `enabled AND claims settings-section`

The filter keys on `enabled`, **not** `loaded`. A plugin that is enabled but failed to load, or is missing a requirement, stays in the rail — that is precisely when the user needs to reach its page to read the error and act on it. A disabled plugin leaves the rail entirely.

*Rejected: listing all installed plugins.* Rail length would track installation, not usage.
*Rejected: hiding failed plugins too.* It hides the error behind two clicks at the moment it matters most.

Disabled plugins remain reachable from the activation index, which marks them so the absence is explained where the user goes looking. Their deep link keeps resolving, read-only, with a re-enable affordance — bookmarks must not 404 because of a toggle.

### D5 — Save stays global; the host assigns the page id

The Save Bar (`settings-panel/spec.md:450`) and per-page dirty indicators (`:478`) already exist, but they are **not** free to reuse: the `page` a source is filed under is supplied by the source itself, and today every plugin hardcodes its own — `flows` → `"plugins"`, `automation` → `"plugins"`, `roles` → `"general"`, `subagents` → `"general"`. Left alone, half the plugins would mark the parent `Plugins` entry, half would mark `General` (a page their settings no longer appear on), and a third-party plugin could point its dirty dot at any page it likes.

**The host overrides `page` for any draft source registered from inside a plugin settings page**, to `plugins/<pluginId>`; plugins stop passing `page` at all.

`SettingsDraftSource.page` (`settings-draft-context.tsx:25`) becomes optional so plugins can omit it entirely; the host supplies it.

The override lives in **`useSettingsDraftSource`**, not in the registry. `draftRegistry` is a `useMemo`'d closure created in `SettingsPanel` scope, *above* where `PluginSettingsPage` mounts — an ancestor's closure cannot read a context a descendant provides. So: `PluginSettingsPage` provides a new `PluginSettingsPageContext` carrying the owning plugin id; `useSettingsDraftSource` (`settings-draft-context.tsx:40-56`) reads it and rewrites `page` **before** calling `registry.upsert`. Commit semantics, fan-out, and re-baselining are untouched — only the label the source is filed under changes.

*Rejected: per-page Save.* It would fork the single-fan-out contract and the unsaved-navigation guards for one cosmetic gain.
*Rejected: asking each plugin to pass `page: "plugins/<id>"`.* Unenforceable for third-party plugins — the same delegation failure as the chrome.

The Save Bar additionally names each dirty page as an affordance that navigates to it.

### D5a — Rail navigation must guard, because plugin draft state does not survive unmount

Built-in draft sources hold their state in `SettingsPanel`'s own `useState`, so they survive rail navigation. A plugin's state lives in the plugin component, which unmounts when the user leaves its page; `useSettingsDraftSource`'s cleanup then calls `registry.remove(id)` (`settings-draft-context.tsx:58-65`) and the edits are gone. The rail's buttons call raw `navigate("/settings/" + id)` (`SettingsPanel.tsx:803`), **not** `requestNavigate`, so no guard fires — today a dirty `flows` or `automation` section loses its edits silently on a page switch. That is a pre-existing bug the new attribution feature would otherwise advertise.

**Rail navigation guards only when the page being left is a plugin page with dirty sources.** The guard must NOT key off the panel-level `isDirty` (`SettingsPanel.tsx:489`, `requestNavigate` at `:610-613`), which aggregates every source: a user with unsaved Server edits would then be blocked from opening any other page, killing the multi-page Save Bar this change adds. Built-in→built-in navigation stays unguarded because built-in draft state lives in `SettingsPanel`'s own `useState` and survives the switch.

So: leaving `plugins/<id>` while that page's sources are dirty offers Save / Discard / Cancel; every other rail transition is unchanged. This bounds the Save Bar honestly — it can name every dirty built-in page plus the plugin page currently mounted, and cannot accumulate two plugin pages dirty at once, because the guard resolves the first before the second mounts.

*Rejected: hoisting plugin draft state into `SettingsPanel` so it survives unmount.* The host would have to own arbitrary third-party state shape — far larger than this change, and it re-couples exactly what the plugin boundary exists to separate.

Two corollaries in `HermesMemorySettings.tsx`: it renders a `position: fixed; bottom: 0` save footer that overlays every settings page — removed. And it has **no** `useSettingsDraftSource` at all; it saves through its own button inside that footer. Removing the footer alone would strand its edits with no save affordance, so a draft source must be added in the same step.

### D6 — Disabled plugin page: chrome only, no body

The slot registry applies the enabled-set filter inside `getClaims` (`slot-registry.ts:138-152`), so a disabled plugin yields zero claims to any consumer. A disabled plugin's page therefore renders the host chrome (which reads `PluginRow.status`, not claims), a notice that the plugin is disabled, and a re-enable affordance — **no settings body**.

**The filter covers claims only — intents must be filtered at the consumer.** `useSlotIntents` reads `intentStore.getForSlot` directly (`intent-store.ts:100-119`) with no enabled-set awareness, and `usePluginEnabledSet` only calls `registry.setEnabledSet(...)` on `plugin_config_update`; nothing clears a disabled plugin's intents. Since D7 newly routes intents through this consumer, `SettingsSectionByPluginSlot` MUST apply the enabled set to intents itself, or a plugin disabled while its page is open keeps an intent-rendered body mounted — defeating this decision's whole point.

**This requires a new registry read accessor.** `SlotRegistry` (`slot-registry.ts:96-117`) exposes `setEnabledSet` but no getter, `getAllPluginsForActivationUi()` deliberately ignores the filter, and `usePluginEnabledSet` returns only `{ startedAt }` — so today no consumer can read the set. Add `isPluginEnabled(id: string): boolean` to the registry (additive runtime API; not a manifest schema change, so the non-goal holds).

*Rejected: deriving enablement from `getClaims("settings-section")` being non-empty.* An enabled plugin that contributes only an intent and no refs claim would be wrongly treated as disabled.

*Rejected: bypassing the filter via `getAllPluginsForActivationUi()` to render the body read-only.* Rendering a disabled plugin's controls means mounting its React component, which may open sockets, poll, or write config on mount — "disabled" would stop meaning disabled. Chrome-only keeps one meaning of the word.

This also settles the live case: `usePluginEnabledSet` re-filters on `plugin_config_update`, so toggling a plugin off while its page is open collapses the body immediately. That is the specified behaviour, not a glitch — the notice replaces it in the same render.

### D7 — Intent-driven and descriptor contributions must move with the claims

`SettingsSectionSlot` is the **only** consumer of `useSlotIntents("settings-section", null)`; `SettingsSectionByPluginSlot` deliberately reads claims only, its comment pointing at the legacy consumer as the intent path — the exact code this change deletes. Deleting it as-is would silently drop every intent-driven section and every JSON-Schema descriptor contribution (descriptors flow through `renderIntent`), violating the canonical "consumers SHALL accept BOTH refs-registry claims AND intent broadcasts".

`SettingsSectionByPluginSlot` therefore **gains intent consumption**, filtered to the owning plugin id *and* to the enabled set (see D6). The intent store is already keyed by plugin id (`Map<pluginId, intent>`), so the plugin filter is a lookup, not a scan. "Exactly one render path" must mean consolidated, not amputated.

### D8 — Sort order follows the registry, not the comment

`compareClaims` (`slot-registry.ts:120-125`) sorts **ascending** `priority` (default 1000), tie-broken by `pluginId.localeCompare`. The existing comment in `SettingsSectionByPluginSlot` claims "descending priority" and is wrong. Every spec delta states the registry's actual order; no sort is reimplemented at the call site.

**The comparator governs claims only.** `IntentNode` carries no priority, and adding one would be a manifest schema change (a stated non-goal). The merged render order is therefore: claims first, ordered by the comparator, then intents in store order — stated explicitly in the deltas rather than implied to be one unified sort, which the data cannot support.

### D8a — The rail needs a child-level active state

`navGroups` is flat (`SettingsPanel.tsx:704`) and the active test is `activeTab === item.id` (`:799`). With every plugin child living under `activeTab === "plugins"`, an `id` of `"plugins"` highlights all children and `"plugins/<id>"` highlights none. The rail therefore compares against `activePluginId` for children, and against `activeTab` for top-level entries; the parent `Plugins` entry is active only on the activation index.

### D9 — Extract, don't duplicate, the activation-row internals

`CopyableErrorBlock`, `MissingRequirementsBlock`, `StatusPill`, and the toggle+cascade handler currently live inside `PluginsSection.tsx`. The page needs all four. They move to a shared module consumed by both. `PluginsSection.tsx` must end up smaller.

## Risks / Trade-offs

- **Third-party UI relocates silently on upgrade** → release note; manifest keeps accepting `tab`; the destination is strictly more discoverable than an unlabelled block on General.
- **Rail growth with many plugins** → enabled-only filter bounds it (5 of 7 in the current monorepo set); group is collapsible; default-collapsed is the fallback if it proves noisy in practice.
- **Roles double-header during the transition** → `RolesSettingsSection.tsx` drops its own `<section>`/`<h3>` in the same change; a visual test covers it.
- **Removing 15 slot mounts touches `??` fallback chains** → apply the `no-jsx-slot-nullish-fallback` guardrail (`fix-slot-fallback-masks-content`); JSX must not be constructed before a claims-length check.
- **Spec reconciliation could strand a third consumer** → `forTab` loses its last caller; delete it so no future code re-derives tab routing.
- **Deep-linking a disabled plugin** → resolves to a chrome-only page rather than 404; the page states why and offers re-enable (D6).
- **Relaxing the validator lets previously-rejected manifests load** → accepted deliberately (D3); a manifest with a nonsense `tab` is no longer a load failure, and nothing reads the field.
- **Migration step 2 runs both render paths briefly** → the dual-render bug this change exists to fix is momentarily reintroduced. Bounded to one commit and never released: steps 2 and 3 land together, with step 2 separate only to keep the diff reviewable.

## Migration Plan

1. Extract shared activation-row internals (no behaviour change; tests stay green).
2. Add `PluginSettingsPage` + route parsing, still alongside the existing slot mounts. Both paths render — temporarily duplicated, deliberately.
3. Flip the slot: `SettingsSectionSlot` stops rendering `settings-section`; remove the 15 mounts; delete `forTab`.
4. Nav expansion + save-bar attribution.
5. Remove the inline expander from `PluginsSection.tsx`; cog becomes navigation.
6. Delete the `fixed` footer from `HermesMemorySettings.tsx`; drop the self-header from `RolesSettingsSection.tsx`.

Rollback: steps are ordered so 3 is the only user-visible flip. Reverting 3 alone restores the current placement while keeping the new pages reachable.

## Open Questions

- Should the plugins nav group default expanded or collapsed on first visit, and is that state persisted per-user? (Mockup assumes expanded, not persisted.)
- Does the activation index keep a settings affordance per row, or does the nav become the only route in? (Mockup keeps both; two doors to one page is mild redundancy, not a conflict.)
- When a plugin page is dirty and the user disables that plugin, do the pending edits get discarded or committed? Proposed: block the toggle with the existing unsaved-changes confirm. Note this interacts with the ADDED scenario "Toggling a plugin updates the rail", which assumes disable removes the nav child unconditionally — the confirm must resolve *before* the rail updates, or a dirty source ends up filed under a page with no nav entry.
- Should `GET /api/plugins` grow `version` / `description` / `source` so the chrome can show provenance (D1 currently omits them for lack of data)? Deliberately out of scope here; worth its own change.
