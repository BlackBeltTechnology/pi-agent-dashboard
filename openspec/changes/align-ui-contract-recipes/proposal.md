## Why

`ui-contract.md` was last updated on 2026-10-14. Since then, core changes have settled several patterns: the services settings UI, the session actions flyout, the add-ons hub, compact session card header, pi settings coverage, and the in-flight `add-pi-spec-driven-schema`. None of those patterns was written back to the contract, so the same parts now exist many times over:

- **Status pills: 7 implementations.**
  - `StatePill` in `settings/services/services-ui.tsx`.
  - `StatusPill`, `GrantStatusPill` and `BindingStatePill` in `settings/vault/vault-ui.tsx`.
  - `ProviderHealthPill`.
  - `plugin-row-parts`.
  - `OpenSpecBoardView`.
  - The plugin-facing `ui:status-pill` in `client-utils/src/StatusPill.tsx`.
- **Callouts and notices: 3 implementations.** `ServicesOperateCallout`, vault `Callout` and `OperateRequiredCallout`.
- **Inline action errors: 2 implementations.** `ActionFailure` and vault `ErrorLine`.
- **Tabs: 5 styles.** Underline, pill, APG, and accent-text with a hex fallback, among others.

The plugin-facing `ui:status-pill` is also wrong. It paints raw `rgba()`/`rgb()` palettes behind a dark/light switch (`StatusPill.tsx:20-27`), so it ignores the severity tokens and the 8 extra theme palettes. `theme-token-guard` does not scan `client-utils`, so nothing catches this.

Two planned waves depend on this:

- `retro-ux-plugin-settings-wave-2` adds a further `SettingsStatusPill` and `SettingsNotice`.
- A later wave will redesign plugin pages, dialogs and slot widgets, and needs contract rows to measure against.

This change comes first so both waves build on one recipe per pattern.

## What Changes

- Mockup: `mockups/index.html` (in this change). It shows 9 recipes and 3 in-context surfaces (settings page with rail, session card with actions menu, dialog over the dashboard), each as shipped next to the proposal, in 3 themes. `mockups/ui-plan.md` holds the probe results (proposed 0 failures; as-built 29 / 35 / 33) and the 4 decisions approved on 2026-10-18.

- **`ui-contract.md`: new and expanded component rows.** Each row cites the change that settled the pattern.
  - Status pill: severity or tint triple, glyph plus a human word, never colour alone.
  - Notice / callout anatomy: title, why, remedy rows, retry, and raw detail behind "Copy details".
  - Inline action error: shown at the control, not as a toast.
  - Tabs: APG tablist; `?tab=` in the URL for page-level tabs.
  - Menu / flyout: group headings in `--text-secondary`, a 44/32 px trigger, `More…` folding when a group has at least 2 rare items, and `menuitem` semantics.
  - Dialog, expanded: `--accent-solid` primary, aligned with the `dialog-system` delta in `add-pi-spec-driven-schema`. A confirm-impact `alertdialog` with Cancel focused. Destructive dialogs name every affected item, and risky options start unchecked.
  - Loading, empty and first-run states.
  - Row overflow: wrap first, then truncate at `basis-[6ch]`.
  - Settings rail: inactive items use `--text-secondary`, which retires the `--text-muted` debt.
- **One implementation per pattern.**
  - The shared status pill, notice and inline action error live in `client-utils`. Plugins reach them through the primitive registry: `ui:status-pill` exists already, and `ui:notice` and `ui:action-error` are new keys.
  - `ui:status-pill` keeps its public props but switches to token-sourced colours and shows a default icon per state.
- **Migration.**
  - The services and vault pills, callouts and error lines move onto the shared parts.
  - `ProviderHealthPill`, `plugin-row-parts` and `OpenSpecBoardView` pills move too, when they are a drop-in replacement. Any that are not are listed as follow-ups.
  - Data-testids, `data-state` attributes, i18n keys and visible copy stay the same.
- **Three components fixed in code** (approved 2026-10-18):
  - **Shared dialog (`ui:dialog`):** `--bg-overlay` backdrop, card-recipe panel, `text-lg` title, severity-toned icon tile, 44/36 px close button and actions, tinted danger action. The primary fill (`--accent-solid`) is the one `add-pi-spec-driven-schema` already specifies.
  - **Session actions menu:** 11 px group headings, 36/44 px items, plugin items at full contrast, disabled reason on its own readable line.
  - **Settings rail:** `--text-secondary` items, a tertiary fill plus an accent bar for the current item, 11 px `--text-secondary` group labels, and attention markers that carry an icon and a label instead of colour-only dots.
- **Guards.**
  - `scripts/theme-token-guard.mjs` also scans `packages/client-utils/src`. Its baseline may only shrink.
  - The shared pill, notice, inline error, dialog and menu files join the `message-severity-tokens` no-raw-colour file list, which catches raw palette classes and `rgba()`. The guard does not catch those.
- **Skills.**
  - `dashboard-plugin-scaffold/references/slot-taxonomy.md` adds the 13 missing slot ids.
  - `references/host-design.md` gains sections on the settings field kit, dialogs, overlay pages and slot widgets, each pointing to its contract row.
  - `frontend-mockup-loop-dashboard` gains a "plugin surface" binding and a refreshed GROUND example.
- **Coordination.**
  - `retro-ux-plugin-settings-wave-2` is amended in a separate step so its `SettingsStatusPill` and `SettingsNotice` wrap the shared parts.
  - Both this change and `add-pi-spec-driven-schema` modify the `dialog-system` requirement "Dialog action button intents", and their primary-fill text is identical. Whichever archives second rebases its copy onto the first (see design).

## Capabilities

### New Capabilities
- `shared-status-recipes`: one status pill, one notice/callout and one inline action error. Core and plugin surfaces consume them, they are token-sourced in every theme, and the guard coverage includes `client-utils`.

### Modified Capabilities
- `client-utils-status-presentation`: the status primitive sources its colours from the severity/tint tokens instead of raw palettes. The services and vault surfaces join the covered surfaces.
- `services-settings-ui`: "Accessible, theme-token styling" points at the shared pill, callout and inline error.
- `credential-vault`: vault status pills, callouts and error lines come from the shared recipes. The destructive-impact and load-state requirements are otherwise unchanged.
- `client-build-config`: the `theme-token-guard` scan roots include `packages/client-utils/src`.
- `message-severity-tokens`: the no-raw-colour file list grows to cover the shared pill, notice, inline error, dialog, menu and migrated pill files.
- `plugin-ui-primitive-registry`: adds the `ui:notice` and `ui:action-error` keys.
- `dialog-system`: the visual baseline (backdrop, panel, title), action intents (tinted danger) and contract target sizes.
- `session-actions-menu`: type, target and contrast floors for headings, items and disabled reasons.
- `settings-panel`: the rail's text contrast, current-item indicator and non-colour attention markers.

## Impact

- **Code:**
  - `packages/client-utils/src/StatusPill.tsx` and new shared notice and inline-error parts.
  - `packages/client/src/components/settings/services/services-ui.tsx`.
  - `packages/client/src/components/settings/vault/vault-ui.tsx` and `OperateRequiredCallout.tsx`.
  - `ProviderHealthPill.tsx`, `packages/plugin-row-parts.tsx` and `openspec/OpenSpecBoardView.tsx` (`BoardStatePill` only), if they are drop-in.
  - `packages/client-utils/src/Dialog.tsx`, `packages/client/src/components/session/SessionActionsPanel.tsx`, the rail block of `packages/client/src/components/settings/SettingsPanel.tsx`.
  - `packages/shared/src/dashboard-plugin/ui-primitives.ts` (2 keys) and the registration in `packages/client/src/main.tsx`.
  - `scripts/theme-token-guard.mjs` and its baseline.
- **Docs and skills:**
  - `ui-contract.md`.
  - `packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/{slot-taxonomy,host-design}.md`.
  - `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md`.
- **No change to:** REST or WebSocket protocol, settings keys, the `ui:status-pill` or `ui:dialog` prop APIs, or any existing `UI_PRIMITIVE_KEYS` entry (two keys are added).
- **Visual:** pills in non-base palettes change colour to the token values. This is intended.
- **Rollback:** revert.

## Non-goals

- Restyling plugin settings bodies. That stays in `retro-ux-plugin-settings-wave-2`.
- Redesigning plugin pages, dialogs or slot widgets. That is the later wave this change prepares for.
- Unifying the existing tab implementations, and moving other menus (folder actions, plugin menus) onto the menu recipe. This change writes their contract rows only; adopting them is follow-up work.
- Moving hand-built plugin dialogs (`CreateGoalDialog`, MCP `ServerEditor` and `ProjectSettings`, system-one `ConfirmDialog`) onto `ui:dialog`. That belongs to the plugin wave.
- Changing the `PrSegment` tone ramp, which is a recorded follow-up of `compact-session-card-header`.

## Discipline Skills

- `doubt-driven-review`: before the shared parts' location and props stand. They become a public API that plugins import, and wave 2 builds on them.
- `review-code`: before commit, because the migration touches services, vault and several core surfaces.
- No `security-hardening`: the vault and services migrations restyle only. No secret values reach the touched parts.
- No `performance-optimization`: rendering cost is unchanged.
