# Design

## Context

`SettingsPanel.tsx` is a single component holding one config draft (`update((c) => …)`) shared across all tabs — this is load-bearing for the spec requirement "Save applies across all tabs". The plugin `settings-section` slot places contributions by a `tab` string via `forTab(claims, tab) = claims.filter(c => (c.tab ?? "general") === tab)`. The typed allow-list `VALID_SETTINGS_TABS` in `slot-types.ts` is the public contract plugins target — and it is already out of sync with the panel (no `plugins`, panel has 7 tabs, list has 6).

## Decisions

### Decision 1 — Left-nav rail, not rebalanced top-tabs
Top-tabs wrap badly past ~7 labels; we are going to 10 pages. A left nav rail scales vertically, groups related pages under labels, and fills the dead left gutter the `max-w-2xl` content created. Pattern matches VS Code / GitHub / Slack settings.

### Decision 2 — Additive registry contract (keep `tab`, extend the allow-list)
Considered renaming the field to `page` and migrating every plugin. Rejected: high churn and breaks third-party plugins unless an alias layer is kept anyway. Chosen: keep the `tab` field and `forTab`'s `"general"` default. Extend `SettingsTab` / `VALID_SETTINGS_TABS` to the full page-id set and reconcile the existing `plugins`/`advanced` drift.

Consequences:
- `general` MUST remain a real page — it is the `forTab` fallback. Removing it would orphan every unmigrated and third-party claim.
- Plugins MAY target any page id; default lands on `general`. Bundled plugins (all target `general` today) keep working with no manifest change.
- New page ids (`server`, `sessions`, `remote`, `openspec`, `developer`) are added to the allow-list so claims targeting them render.

### Decision 3 — Plugin claims render where the plugin targets; `general` is default
Per product decision, each plugin chooses its target page via `tab`; unset → `general`. The Plugins page keeps its existing activation rows with inline settings (`SettingsSectionByPluginSlot`) as the discover/enable affordance, independent of the per-page `forTab` render. We do NOT force all plugin sections onto the Plugins page.

### Decision 4 — Dual-URL routing, single mounted panel
`/settings/:page?` is canonical (bookmarkable, real back/forward per page). Legacy `/settings?tab=<id>` is supported permanently. Resolution inside the one mounted `SettingsPanel`:

1. route param `:page` ∈ `VALID_SETTINGS_TABS` → use it.
2. else `?tab=<id>` valid → `navigate("/settings/"+id, { replace: true })` (one-time upgrade, no extra history entry).
3. else → `navigate("/settings/general", { replace: true })`.

Alias map for moved ids: `advanced → developer`, `servers → remote` (applied in steps 1–2 before validation).

**Trap avoided**: do NOT split into one route-component per page — that remounts on nav and discards the shared unsaved draft, breaking save-across-pages. Keep one `SettingsPanel`; feed the resolved page string into the existing page-switch (today's `activeTab`).

The resolved page id is the same string passed to `<SettingsSectionSlot tab={page} />`, so the registry matches identically regardless of which URL form the user arrived through — no registry change needed for compat.

### Decision 5 — Deduplicate Advanced
Drop the duplicate renders that `advanced` currently emits (Known Servers → `remote` only; Display Prefs → `general` only; Trusted Networks → `security` only). Each section gets exactly one home.

## Page → section map

| Page | Group | Sections |
|---|---|---|
| general | Dashboard | Interface (language), Display prefs |
| server | Dashboard | Ports (`port`,`piPort`), `autoShutdown`/`shutdownIdleSeconds`, Tunnel, Memory Limits |
| sessions | Dashboard | `spawnStrategy`, `defaultModel`, reattach/ordering, `askUserPromptTimeoutSeconds`, `spawnRegisterTimeoutMs`, `gitWorktreeEnabled`, `dashboardName` |
| remote | Network | Known Servers, Network Discovery |
| security | Network | Auth providers, allowed users, bypass urls, Trusted Networks |
| providers | Extensions | Provider Auth, LLM Providers, API Proxy |
| packages | Extensions | Unified Packages |
| plugins | Extensions | Plugin activation + inline settings |
| openspec | Extensions | `openspec.enabled` polling, OpenSpec Workflow Profile |
| developer | Advanced | Diagnostics, Tools, Spawn Failures, `devBuildOnReload`, Editor, Chat-display debug events, capture-pi-output |

## Open questions
- Bundled plugins (target `general`) now land on the slim General page by default. Acceptable per Decision 3, but if it clutters General we may retarget some to `developer`/`openspec` in a follow-up (manifest-only change).
- Mobile: the left rail collapses to the existing tab/drawer pattern; exact mobile affordance TBD in implementation.
