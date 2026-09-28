## Context

See proposal.md — Why. Current wiring:

- `SettingsPanel.tsx` builds `navGroups` as a static array (Dashboard / Network / Extensions / Resources / Advanced); `providers` is an Extensions item.
- Plugin children come from `usePluginList()` rows, filtered by `contributesSettings(r)` (refs claim OR `settings-section` intent), rendered under the `plugins` item. Route `/settings/:page?/:sub?`; `activePluginId` only when `page === "plugins"`.
- `PluginSettingsPage.tsx` renders full host chrome (name, id, pill, toggle, deps, claimed slots) + `SettingsSectionByPluginSlot`.
- `/api/plugins` (`plugin-activation-routes.ts`) projects claims to `{slot, component, tab, command, toolName}` — `nav` would be dropped today.
- Manifest validator (`dashboard-plugin-runtime/src/manifest-validator.ts`) whitelists claim fields; unknown fields are dropped from the normalised claim.
- Two trust conventions exist on the server: `priority <= 100` gates spawn/abort hooks; the NEWER scope gate (`plugin.packageName.startsWith("@blackbelt-technology/")`, `server.ts` providerAuth, change `publish-quota-plugin`) was introduced precisely because `priority` is plugin-authored and doubles as render order. `DiscoveredPlugin.packageName` carries it; `/api/plugins` does not project it today.
- `PluginClaim` lives in `packages/shared/src/dashboard-plugin/manifest-types.ts`; the validator imports it from there.
- `PluginsSection.tsx` prints "not in Settings nav" (`plugin-disabled-note-<id>`) for every disabled row; it receives `{list, toggle, contributesSettings}` only.
- Draft sources on a plugin page are host-rewritten to page key `plugins/<id>` (`settings-draft-context.tsx`), whatever page they declare.

```mermaid
flowchart LR
  M[package.json claim\nnav hint] --> V[manifest-validator\nshape only, drop invalid]
  V --> R[/api/plugins row\nclaims[].nav + firstParty/]
  R --> P[resolvePromotions\nallowlist + row.firstParty\n+ label collision]
  P --> G[Models group entries]
  P --> X[Plugins subtree:\npointer rows]
  P --> C[PluginSettingsPage\ncompact chrome]
  P --> I[PluginsSection\nshown in Models]
```

## Goals / Non-Goals

**Goals:**
- One pure, unit-tested decision function owns "is this plugin promoted, where, with what label".
- Zero route changes; every existing deep link keeps working.

**Non-Goals:**
- Promoting Provider Quota / Cost now (the mechanism allows it later; both are first-party scope).
- Role-health badges in the rail (e.g. "1 unset"), per-role descriptions inside the roles editor, moving Default model off the Sessions page. Candidate follow-ups; the mockup shows them as ideas only.
- Promotion into any group other than `models`.

## Decisions

**D1 — Manifest `nav` hint + host allowlist (M1), not a host carve-out or a move to core.**
Alternatives: M2 hard-code a `roles` page in SettingsPanel (fast, but a one-off coupling host → plugin id); M3 move Roles into core (largest diff, loses enable/disable). M1 keeps the plugin as owner and generalises to future model-adjacent plugins.

**D2 — Gate = allowlisted group AND npm scope `@blackbelt-technology/`; server computes, client consumes.**
The server projects `firstParty: packageName.startsWith("@blackbelt-technology/")` on each `/api/plugins` row (one source of truth, same predicate as the providerAuth gate — extract a shared `isTrustedPluginPackage()` helper and use it at both sites). Named `firstParty`, not `trusted`, because the server already has a different `priority`-based "trusted" gate for spawn/abort — one row key must not carry a third meaning. The client resolver `resolveSettingsPromotions(rows, reservedLabels) → Map<pluginId, {group,label,description,order}>` is pure and never re-derives first-party status; `reservedLabels` is a STATIC set built once from the i18n catalogs — every built-in page label and every nav group label, in the English source and every shipped locale — never from the live `navGroups` array (which would contain promoted entries and make a label collide with itself). Static-across-locales keeps promotion independent of the active language. Alternatives: `priority <= 100` — rejected, plugin-authored and already disfavoured in-repo (a third-party can simply declare 100; a late-rendering plugin would have to change render order to gain it); client-side scope check — rejected, duplicates the predicate and `packageName` isn't on the row.
Resolver rules: consider only `settings-section` claims; the first claim whose hint passes group allowlist + first-party + reserved-label collision (NFKC, trim, case-fold) wins; then across plugins, sort by `order`, plugin id and drop any later hint whose label collides with an earlier promoted one; final display order `order`, `label`, plugin id. `nav.order` is its own axis — unrelated to manifest `priority` (render order), though both default to 1000.
The gate is display-only and lives in the client: the server projects `nav` for every plugin and `firstParty` beside it. That is sufficient because honouring a hint grants no capability — it only moves the rail entry of a page the plugin already owns. `firstParty` means exactly "npm scope `@blackbelt-technology/`"; a plugin discovered via a bare `dashboard-plugin.json` (no `package.json#name`, `packageName === ""`) is not first-party and simply isn't promoted.

**D3 — Keep URL `/settings/plugins/<id>`; promotion is placement only.**
Alternative: a new `/settings/model-roles` route — would reopen the closed `VALID_SETTINGS_TABS` contract and need redirects. Rejected: no user value over a correct active-entry highlight.

**D4 — Move + pointer; one identity for active and dirty.** The promoted rail entry is keyed by the plugin page key `plugins/<id>` (the key `useSettingsDraftSource` files dirty state under), so the dirty dot works unchanged; its active test is `activeTab === "plugins" && activePluginId === id`. The Save Bar label branch (`page.startsWith("plugins/")` → `Plugins › <displayName>`) DOES change: it consults the promotion map first and emits `<Group> › <nav.label>`. Promoted entries render the host's generic plugin icon (the hint carries no icon) and the same health dot as Plugins children. Pointer rows sort by display name together with ordinary children. While the plugin is enabled, the Plugins subtree renders a dimmed pointer row (`Roles ↗ Models`) through a separate branch that NEVER sets `aria-current` (no pointer when disabled — base rule "disabled → no nav child" holds) — `pluginNavChildren` excludes promoted ids so the existing `childActive` logic cannot light it. Pointer keeps discoverability for users who look under Plugins.

**D5 — Compact chrome is a host variant, not a plugin opt-out.** `PluginSettingsPage` gets a `promotion` prop (from D2's resolver). Health-first: pill in the header only when disabled / error / not loaded / unknown (`status === null`) / unmet requirements — `StatusPill` alone is insufficient (it shows green "enabled" despite unmet requirements), so the compact variant computes "healthy" explicitly; errors/requirement banners unchanged; id, `dependsOn`, dependents, claimed slots behind a `<details>` disclosure. Dependents are not rendered by the full chrome today (pre-existing gap vs base spec); the compact disclosure renders them from the row. The plugin still cannot suppress chrome — satisfies the existing "no opt-out" invariant.

**D6 — Disabled promoted plugin stays listed.** Diverges from the Plugins-children rule (disabled → omitted) on purpose: a core-importance entry vanishing is worse than a dimmed "off" entry whose page offers re-enable. Membership keys on "installed + promoted hint honoured", not on `enabled`. For promoted rows only, `PluginsSection`'s "not in Settings nav" marker is replaced by "shown in Models"; SettingsPanel passes it the promotion map (new prop).
Note: the resolver must read the hint from the MANIFEST claims on the row (always present), not from the slot registry (which drops disabled plugins' claims).

**D7 — Validator: shape-check, drop-don't-throw.** An invalid `nav` is dropped with a warning; the plugin loads. Throwing would unload the whole plugin (server hooks, client bundle) over a rail label, and would newly break any existing manifest that carried a stray `nav` key (previously silently dropped). Checks: plain object (`null`/array rejected before any property read); `label`/`group` non-empty after trim; label ≤ 40 / description ≤ 200 after NFKC; no Unicode Cc or Cf chars (one class check covers bidi overrides, LRM/RLM, ZWSP, BOM — a range denylist leaks); finite `order`. Stored NFKC + trimmed; a blank `description` is dropped alone, never the whole hint. `nav` on non-`settings-section` slots dropped silently. Rendered as React text nodes only. Unknown `group` accepted (mirrors inert-`tab` forward-compat). `nav` is specified beside `tab` in the settings-section requirement, not in the illustrative `PluginClaim` block of the "Plugin manifest format" SPEC prose (already non-exhaustive — omits `tab`, `toolName`, `path`). The real TS type in `manifest-types.ts` DOES gain `nav`. `group` is stored NFKC + trimmed like `label`. Warnings go through the validator's existing server-log warning path. `deterministicSerializePlugins` (`loader.ts`, plugin-registry hash) adds `nav` beside `tab`/`toolName`/`path` so a nav-only manifest edit invalidates the registry hash like every other claim field.

## Risks / Trade-offs

- [A package side-loaded into `~/.pi/dashboard/plugins/` can self-name into the `@blackbelt-technology/` scope] → same exposure as the existing providerAuth gate, which guards raw OAuth tokens (a far bigger prize); the side-loader already has local code execution. Here the blast radius is a rail label on the plugin's own page; allowlist limits it to `models`; built-in-label collision blocked; provenance line always names the real plugin.
- [The roles manifest keeps inert `tab: "general"`] → kept because the base roles scenario pins it; harmless.
- [Models is first but General stays the default landing page] → deliberate: deep links, muscle memory and the first-launch flow assume General; importance is signalled by position, not by hijacking the landing page.
- [`nav.label`/`description` are manifest strings, not localised, while the group label is] → accepted for now; roles ships English only in its title. Follow-up: an optional `labelKey` resolved against the plugin's i18n catalog.
- [Pointer row keeps the plugin's `displayName` ("Roles")] → under Plugins the row identifies the plugin, not the feature; the arrow + group name carry the new location.
- [Provenance line renders manifest `displayName`] → Cc/Cf characters are stripped at render on the compact chrome (cheap, local); hardening `displayName` across the rail/activation index is a separate follow-up.
- [Homoglyph/confusable labels (Cyrillic `Р`, combining marks) are not folded] → gate already requires the `@blackbelt-technology/` scope; confusable skeletons (UTS #39) are out of proportion for a display label.
- [Full plugin chrome still omits `dependents` (pre-existing base-spec gap)] → compact disclosure renders them; fixing the full chrome is left to a separate change to stay surgical.
- [Rail gets a 6th group] → Models has only 2 entries; Providers leaving Extensions keeps total entry count unchanged.
- [Tests pinning the old group list / `Roles` child] → update in the same change (settings-panel scenarios already rewritten to `flows`).

## Migration Plan

Pure client/manifest change, no persisted config. Deploy: rebuild client + restart server (claim projection) per the implement skill's matrix. Rollback: remove `nav` from roles `package.json` → roles returns to the Plugins subtree; full rollback = revert the change (Models group + Providers move are client code). Older servers projecting neither `nav` nor `firstParty` degrade gracefully (`firstParty` absent ⇒ false ⇒ no promotion; Models shows Providers only).
