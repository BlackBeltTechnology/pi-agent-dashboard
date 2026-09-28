## Why

Model roles (`@planning`, `@coding`, `@fast`, …) decide which model every agent, flow and skill actually runs on, yet the page sits five levels deep: Settings ▸ Extensions ▸ Plugins ▸ 16 plugin rows ▸ Roles. Its label "Roles" reads like RBAC next to Security/Access, and its host chrome is developer-facing (`roles`, `claims: settings-section`). Providers — the credentials those roles draw from — lives in a different group. Plugin settings pages can only be reached as children of the Plugins nav entry, so no plugin page can be surfaced where its importance warrants.

## What Changes

- New **Models** navigation group, rendered FIRST in the settings rail. It holds the built-in **Providers** page (moved from Extensions) and any promoted plugin page.
- `settings-section` claims gain an optional `nav` hint: `{ group, label, description?, order? }`. The host honours it only for an allowlisted group (`models`) AND a first-party plugin — npm scope `@blackbelt-technology/`, the host's existing scope-based identity signal (not `priority`, which plugins author themselves). The server computes `firstParty` once and projects it on `/api/plugins` rows. A label colliding with any built-in page label is ignored. Otherwise the hint is ignored and the plugin stays under Plugins. A malformed hint is dropped with a warning; it never fails plugin load.
- A promoted plugin's rail entry moves into its group; while enabled, the Plugins subtree keeps a dimmed, never-active "↗ Models" pointer to the same URL. URL stays `/settings/plugins/<id>`.
- Promoted pages render a **compact host chrome**: `nav.label` as title, `nav.description` as lede, a "Provided by the <displayName> plugin" line with the enable toggle; status pill shows only when not healthy (disabled / error / not loaded / unknown / unmet requirements); id, dependencies, dependents and claimed slots move behind a details disclosure. The host still owns the chrome — the plugin cannot opt out.
- A promoted plugin that is DISABLED stays in its group (dimmed, "off") and its page shows the disabled notice + re-enable — the core-importance entry must not vanish. Its activation-index row says "shown in Models" instead of "not in Settings nav".
- Roles plugin declares `nav: { group: "models", label: "Model roles", description: … }`.
- `/api/plugins` rows pass the claim `nav` field through and gain a `firstParty` boolean.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `dashboard-plugin-loader`: `settings-section` claims accept an optional, non-fatal `nav` hint; `/api/plugins` projects `nav` + `firstParty`; promoted pages get compact host chrome. The content rule (settings render only on `/settings/plugins/<id>`) is unchanged — only the page's nav placement moves.
- `settings-panel`: new first **Models** nav group holding Providers + promoted plugin pages; Plugins nav children exclude promoted plugins; disabled promoted plugins stay listed.
- `roles-settings-ui`: Roles plugin promotes itself into Models as "Model roles"; its draft source is documented as filed under `plugins/roles` (stale `general` wording corrected).

## Discipline Skills

- `security-hardening` — `nav` is untrusted plugin-manifest input that places UI in host-owned navigation; the gate (allowlisted group + `@blackbelt-technology/` scope), cross-group built-in-label collision check (NFKC + case-fold, English + active locale), and label sanitisation (trim, length, reject Unicode Cc/Cf, text-only render) must hold so a third-party plugin cannot masquerade as a core page.
- `doubt-driven-review` — the `nav` manifest field is a public plugin API; review its shape before it ships, since removing a field later breaks third-party manifests.

## Impact

- `packages/dashboard-plugin-runtime/src/manifest-validator.ts` (+ README slot-claims docs incl. stale `tab` row); `server/loader.ts` `deterministicSerializePlugins` adds `nav`
- `packages/shared/src/dashboard-plugin/manifest-types.ts` (`PluginClaim`) and the client `PluginRow` type in `plugins-api.ts`
- `packages/server/src/routes/plugin-activation-routes.ts` (claim `nav` projection + row `firstParty`); `server.ts` providerAuth gate reuses the shared scope helper
- `packages/client/src/components/settings/SettingsPanel.tsx` (nav groups, rail rendering, active-entry logic)
- `packages/client/src/components/settings/PluginSettingsPage.tsx` (compact chrome variant)
- `packages/client/src/components/packages/PluginsSection.tsx` (disabled-row marker "shown in Models" for promoted rows; receives the promotion map)
- `packages/roles-plugin/package.json` (claim `nav`)
- i18n keys `settings.groupModels`, promoted-chrome strings, activation-index "shown in Models" marker (en-source, hu, zh-CN)
- No server config migration; no route change. Rollback: drop `nav` from the roles manifest → roles returns under Plugins; full rollback = revert the change (Models group + Providers move are client code).
- Mockup: `mockups/index.html` in this change (View: Today / A / B / Mechanism; State: configured / unset role / disabled; Light + Studio).
