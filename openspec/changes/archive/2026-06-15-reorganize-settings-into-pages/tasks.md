# Tasks

## 1. Registry page-id contract (shared)

- [x] 1.1 Extend `SettingsTab` + `VALID_SETTINGS_TABS` in `packages/shared/src/dashboard-plugin/slot-types.ts` to the full page-id set: `general, server, sessions, remote, security, providers, packages, plugins, openspec, developer`. Reconcile the existing `plugins`/`advanced` drift.
- [x] 1.2 Keep `forTab` default `"general"` (verify) — third-party/unset claims still land on General.
- [x] 1.3 Update any manifest/test that asserts the old tab id set.

## 2. Routing (dual-URL)

- [x] 2.1 Add `/settings/:page?` route; redirect `/settings` → `/settings/general`.
- [x] 2.2 Implement page resolution in `SettingsPanel`: route param → `?tab=` alias (replace-redirect) → default general. Apply alias map `advanced→developer`, `servers→remote`.
- [x] 2.3 Keep a single mounted `SettingsPanel`; drive page-switch from resolved page string (no per-page remount).
- [x] 2.4 Update internal links that point to `/settings?tab=…` to canonical `/settings/<page>`.

## 3. Left-nav layout

- [x] 3.1 Replace top tab-bar with a left nav rail; group items (Dashboard / Network / Extensions / Advanced).
- [x] 3.2 Keep fixed header (back, title, Restart, Save). Content area fills width (drop forced `max-w-2xl`, or widen).
- [x] 3.3 Active-item indicator; keyboard navigable (a11y).
- [x] 3.4 Mobile: collapse rail to existing drawer/tab affordance.

## 4. Regroup + deduplicate sections

- [x] 4.1 Split `general` → `general` (language + display), `server`, `sessions` pages.
- [x] 4.2 Move Memory Limits + Tunnel onto `server`.
- [x] 4.3 Create `remote` page (Known Servers, Network Discovery); remove their duplicate render from old `advanced`.
- [x] 4.4 Create `openspec` page (polling toggle, OpenSpec Workflow Profile).
- [x] 4.5 Create `developer` page (Diagnostics, Tools, Spawn Failures, dev build, Editor, debug events, capture-pi-output).
- [x] 4.6 Remove duplicate Display Prefs and Trusted Networks renders from old `advanced`.
- [x] 4.7 Mount `<SettingsSectionSlot tab={page} />` on each page so plugin claims render on their targeted page.

## 5. Testing

- [x] 5.1 `/settings/<page>` renders the right page; `/settings` redirects to general.
- [x] 5.2 `?tab=<id>` (incl. `advanced`, `servers`) replace-redirects to canonical page.
- [x] 5.3 Save-across-pages: edit fields on two pages, navigate between them, Save sends all changes (draft preserved).
- [x] 5.4 Registry: claim with `tab` unset renders on General; claim targeting a new page id renders there; invalid id falls back.
- [x] 5.5 No section renders on two pages (dedup verified).
- [x] 5.6 Existing settings tests pass (or are updated to the page model).
