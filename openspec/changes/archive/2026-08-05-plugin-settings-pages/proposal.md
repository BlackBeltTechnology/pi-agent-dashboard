## Why

Settings ▸ General renders plugin-contributed `settings-section` claims through a bare fragment. `SettingsSectionSlot` (`packages/dashboard-plugin-runtime/src/slot-consumers.tsx:338`) maps claims → `renderClaim(...)` with **zero chrome**, so every scrap of framing — title, border, spacing, provenance — is delegated to the plugin author.

**Every** monorepo plugin that claims `settings-section` targets `tab: "general"` — all eight of them: `automation`, `demo`, `flows`, `flows-anthropic-bridge`, `goal`, `hermes-memory`, `roles`, `subagents`. General therefore stacks up to eight unlabelled plugin blocks below its built-in sections. Sampling three shows the divergence:

| Plugin | Component | Outer markup | Title | Frame |
|---|---|---|---|---|
| roles | `BuiltInRolesSettings` (`packages/roles-plugin/src/RolesSettingsSection.tsx:510`) | `<section>` + `<h3>` | yes | yes |
| goal | `GoalPluginSettings` (`packages/goal-plugin/src/client/GoalPluginSettings.tsx:19`) | bare `<div>` | no | no |
| hermes-memory | `HermesMemorySettings` (`packages/hermes-memory-plugin/src/client/HermesMemorySettings.tsx:143`) | bare `<div>` + `position: fixed` footer | no | no (footer escapes the tab) |

The result on General is visually incoherent: built-in `<Section>` blocks are titled and framed, then a run of plugin blocks with no separator and no indication of which plugin owns which control. The `fixed bottom-0` save bar in `HermesMemorySettings` overlays whatever settings page the user is on.

The inconsistency is **structural, not cosmetic** — no styling pass fixes it, because nothing stops the next (especially third-party) plugin from rendering a naked `<div>`. The host must own the chrome.

A second problem compounds it: General is a dumping ground. Plugin configuration has no addressable home, so it cannot be linked, bookmarked, or reasoned about per plugin. The Plugins tab already solved presentation once (`PluginsSection.tsx` frames each plugin's settings in a bordered box with a "Plugin settings" label) but hides it behind an inline expander, which does not scale past a couple of controls.

## What Changes

- **NEW route family** `/settings/plugins/<pluginId>`. Every plugin that claims `settings-section` gets its own settings page, rendered with host-owned chrome. Deep-linkable and bookmarkable.
- **NEW** `PluginSettingsPage` component in `packages/client/src/components/settings/`. Renders, above the plugin's own body, **only fields `GET /api/plugins` already returns** (`PluginRow` in `packages/client/src/lib/package/plugins-api.ts` carries no `version`, `description`, `source`, or `icon` — the chrome does not invent them):
  - identity — display name + plugin id
  - status pill (`enabled` / `disabled` / `not loaded` / `error`) + enable toggle, reusing the existing toggle + cascade-confirm path from `PluginsSection.tsx`
  - metadata chips — `depends on` / `required by` (`dependsOn`, `dependents`), claimed `slots`, entry-point flags (`hasServer`/`hasBridge`/`hasClient`)
  - error / missing-requirement banners, reusing `CopyableErrorBlock` + `MissingRequirementsBlock` (extracted from `PluginsSection.tsx` into a shared module)
  - the plugin's `settings-section` contributions via `SettingsSectionByPluginSlot`, which gains **intent-store consumption filtered by plugin id** (today only `SettingsSectionSlot` reads intents; deleting it without this would silently drop every intent-driven and descriptor-based settings section)
- **CHANGED — nav.** The `plugins` nav item in `SettingsPanel.tsx` (`navGroups`, ~line 722) becomes expandable. Children = plugins that are **enabled AND claim `settings-section`**. Disabled plugins are omitted from the rail; a `loaded: false` / errored but *enabled* plugin stays listed (that is precisely when the user needs to reach its page). Each child row carries a status dot and the existing `dirtyPages` amber dot.
- **CHANGED — `tab` becomes inert.** `SettingsSectionSlot` stops rendering `settings-section` claims entirely. A claim renders on its owning plugin's page regardless of `tab: "general" | "providers" | …`. The field stays accepted by the manifest schema but no longer drives placement. Note this **relaxes** validation rather than leaving it untouched: `manifest-validator.ts` currently *throws* on a `tab` outside `VALID_SETTINGS_TABS`, so manifests that fail to load today will start loading.
- **REMOVED** `<SettingsSectionSlot tab="…" />` mounts from `SettingsPanel.tsx` for every tab (general, server, sessions, remote, security, providers, packages, plugins, openspec, developer, skills, agents, extensions, prompts, themes) — ~15 call sites.
- **CHANGED — Plugins index page.** `PluginsSection.tsx` keeps activation, health, dependency cascade, and the restart banner; the inline settings expander (`state.expanded` + `PluginSettingsHost` mount) is removed. The cog button becomes a navigation affordance to `/settings/plugins/<id>`. Disabled plugins render with a `not in nav` pill so their absence from the rail is explained where the user looks for them.
- **CHANGED — save model.** The single global Save is preserved (no change to the `SettingsDraftProvider` / `SettingsDraftRegistry` commit semantics). Two additions:
  - **attribution** — a header badge with the changed-page count, and a sticky save bar naming each changed page as a clickable chip that navigates to it.
  - **host-assigned page ids** — today each plugin hardcodes its own `page` in `useSettingsDraftSource` (`flows` → `"plugins"`, `automation` → `"plugins"`, `roles` → `"general"`, `subagents` → `"general"`), so dirty dots land on whatever string the plugin chose and a third-party plugin can point at any page. The host SHALL override the `page` of any source registered from within a plugin settings page to `plugins/<id>`. Plugins stop declaring `page`.
- **NEW** draft source in `HermesMemorySettings.tsx`. It has **no** `useSettingsDraftSource` today — it saves through its own button in the `position: fixed` footer. Removing the footer without adding a source would leave its edits with no save affordance at all.
- **REMOVED** the `position: fixed` save footer from `HermesMemorySettings.tsx`. Its state folds into the global save bar.

## Capabilities

### Modified Capabilities

- `dashboard-plugin-loader` — the requirement "Plugin-contributed `settings-section` claims SHALL render ONLY under the owning plugin's row" is superseded: claims render on the owning plugin's *page*. The `tab`-is-inert scenario is retained and strengthened (inert everywhere, not just on the activation tab).
- `settings-panel` — the page-id registry gains the `plugins/<id>` route family. The "unset claim lands on General" requirement is removed; there is no General fallback for plugin claims.
- `dashboard-shell-slots` — "settings-section claims target a specific settings tab" is removed. The slot keeps its name and payload; only placement changes.

### New Capabilities

None. This reuses the existing slot, registry, and draft-registry mechanisms.

## Discipline Skills

- `review-code` — non-trivial multi-package change touching the shared slot runtime; review before commit.
- `code-simplification` — the extraction of `CopyableErrorBlock` / `MissingRequirementsBlock` out of `PluginsSection.tsx` should leave that file smaller, not merely rearranged.
- `doubt-driven-review` — `tab` going inert is a one-way door for third-party plugins already shipping `tab: "security"` etc.; stress-test before it stands.

## Impact

- `packages/client/src/components/settings/SettingsPanel.tsx` — expandable `plugins` nav group; ~15 `SettingsSectionSlot` mounts removed; header dirty badge; global save bar. Also needs a `GET /api/plugins` fetch + `plugin-config-update` subscription of its own (today only `PluginsSection` holds that data) to populate the nav children.
- `packages/client/src/App.tsx` — the canonical settings route pattern is single-segment (`useRoute("/settings/:page?")`, `:384`), so `/settings/plugins/roles` does not match and currently `replace`-redirects to `/settings/general` (`SettingsPanel.tsx:399`). That pattern gains a second optional segment. The folder-scoped route (`/folder/:encodedCwd/settings/:page?`) is **unchanged** — it renders `DirectorySettings`, not `SettingsPanel`, and `VALID_FOLDER_SETTINGS_PAGES` excludes `plugins`; plugin config is global, not per-folder.
- `packages/client/src/components/settings/PluginSettingsPage.tsx` — NEW.
- `packages/client/src/components/packages/PluginsSection.tsx` — expander removed, cog → navigation; `CopyableErrorBlock` + `MissingRequirementsBlock` extracted to a shared module for reuse by the new page.
- `packages/client/src/components/packages/PluginSettingsHost.tsx` — consumed by the new page instead of the inline expander; may be inlined if it earns nothing.
- `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` — `SettingsSectionSlot` no longer renders `settings-section` claims; `SettingsSectionByPluginSlot` becomes the only consumer and gains intent-store consumption. `forTab` loses its last caller and is deleted.
- `packages/dashboard-plugin-runtime/src/slot-registry.ts` — add an `isPluginEnabled(id)` read accessor; the registry exposes `setEnabledSet` but no getter today, so no consumer can enabled-filter intents.
- `packages/dashboard-plugin-runtime/src/settings-draft-context.tsx` — `SettingsDraftSource.page` becomes optional; `useSettingsDraftSource` rewrites it from `PluginSettingsPageContext`.
- `packages/shared/src/dashboard-plugin/manifest-validator.ts` — stop throwing on a `tab` value outside `VALID_SETTINGS_TABS`.
- `packages/{flows,automation,roles,subagents}-plugin/**` — drop the hardcoded `page` argument from `useSettingsDraftSource`.
- `packages/hermes-memory-plugin/src/client/HermesMemorySettings.tsx` — `fixed` save footer removed; a `useSettingsDraftSource` added so its edits reach the global Save.
- `packages/hermes-memory-plugin/src/client/HermesMemorySettings.tsx` — `fixed` save footer removed.
- Client route whitelist + any `VALID_SETTINGS_TABS` consumer — must accept `plugins/<id>`.
- Tests: `packages/client/src/components/__tests__/PluginsSection.test.tsx`; `packages/dashboard-plugin-runtime/src/__tests__/slot-consumers.test.tsx` (tab-filtering assertions invert); `packages/shared/src/__tests__/plugin-activation-contracts.test.ts` (asserts the very `SettingsSectionSlot` mounts this change removes); `manifest-validator.test.ts` (unknown-tab rejection); `slot-registry-enabled-set.test.ts` (disabled-plugin claim exclusion); plus new page + nav tests.
- `docs/architecture.md` — plugin settings placement section.
- Mockup: `mockups/plugin-settings-pages/index.html` (all five states: index, healthy, not-loaded, disabled, errored).

## Migration Risks

- **Third-party relocation.** A plugin shipping `tab: "security"` today renders on Security; after this change it renders on its own page. No breakage, but its UI moves without the author acting. Mitigation: release note + the manifest schema keeps accepting `tab`.
- **Nav length.** Enabled-only filtering keeps the rail bounded today (5 of 7 in the current monorepo set), but a user with many plugins still grows it. The group is collapsible; default-collapsed is the escape hatch if it proves noisy.
- **Discoverability of disabled plugins.** Omitting them from the rail is the point, but a user who disabled a plugin and then goes looking for its settings must find the Plugins index. Mitigation: the `not in nav` pill on that index, plus the deep link continuing to resolve (read-only page with a re-enable affordance).
- **Save-scope confusion.** One Save spanning multiple plugin pages is unchanged behaviour, but the new per-page framing may imply per-page commit. Mitigation: the save bar explicitly enumerates every changed page.
- **Slot fallback guardrail.** Removing slot mounts from `SettingsPanel.tsx` must not leave a `??` fallback chain constructing JSX unconditionally — see `fix-slot-fallback-masks-content` and the `no-jsx-slot-nullish-fallback` lint test.

## References

- Mockup: `mockups/plugin-settings-pages/index.html`
- Prior art for the page chrome: `packages/client/src/components/packages/PluginsSection.tsx` (activation row + inline settings frame)
- Canonical specs: `openspec/specs/dashboard-plugin-loader/spec.md`, `openspec/specs/settings-panel/spec.md`, `openspec/specs/dashboard-shell-slots/spec.md`
- Nav-group precedent: `reorganize-settings-into-pages`
