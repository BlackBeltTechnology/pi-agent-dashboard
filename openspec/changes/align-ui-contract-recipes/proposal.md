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

`retro-ux-plugin-settings-wave-2` (merged as #967) added token-based `SettingsStatusPill` and `SettingsNotice` to the plugin runtime kit, used by 31 plugin files. That is the obvious single home, but core still runs its own copies. A later wave will redesign plugin pages, dialogs and slot widgets, and needs contract rows to measure against.

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
  - The runtime kit (`dashboard-plugin-runtime`) is the single home (decided 2026-10-18). `SettingsStatusPill` and `SettingsNotice` are canonical. `SettingsNotice` gains remedy rows and a busy state, and a new `SettingsActionError` joins them. Core and plugins import them directly; no registry keys are added.
  - `ui:status-pill` keeps its public props and renders `SettingsStatusPill`, so it becomes token-sourced with a default icon per state.
- **Migration.**
  - The services and vault pills, callouts and error lines move onto the shared parts.
  - `ProviderHealthPill`, `plugin-row-parts` and `OpenSpecBoardView` pills move too, when they are a drop-in replacement. Any that are not are listed as follow-ups.
  - Data-testids and `data-state` attributes stay the same. Existing i18n keys stay the same; new keys are added only for the new plugin-state words, in every shipped locale. Visible copy stays the same except these intended changes:
    - the services refused-action code moves into "Copy details";
    - the provider error line's raw text and the plugin-list load-error stack move into "Copy details";
    - raw plugin states become words;
    - status glyphs become icons.
- **Three components fixed in code** (approved 2026-10-18):
  - **Shared dialog (`ui:dialog`):** `--bg-overlay` backdrop, card-recipe panel, `text-lg` title, severity-toned icon tile, 44/36 px close button and actions, tinted danger action. The `--accent-solid` primary already shipped with `add-pi-spec-driven-schema` (#966).
  - **Session actions menu:** 11 px group headings, 36/44 px items, plugin items at full contrast, disabled reason on its own readable line.
  - **Settings rail:** `--text-secondary` items, a tertiary fill plus an accent bar for the current item, 11 px `--text-secondary` group labels, and attention markers that carry an icon and a label instead of colour-only dots.
- **Guards.**
  - `scripts/theme-token-guard.mjs` also scans `packages/client-utils/src` and `packages/dashboard-plugin-runtime/src`. Pre-existing findings are baselined before any code change; after that the baseline only shrinks.
  - The kit, pill, dialog, menu and migrated files join the `message-severity-tokens` no-raw-colour file list, which catches raw palette classes and `rgba()`. The guard does not catch those.
- **Skills.**
  - `dashboard-plugin-scaffold/references/slot-taxonomy.md` adds the 13 missing slot ids.
  - `references/host-design.md` gains sections on the settings field kit, dialogs, overlay pages and slot widgets, each pointing to its contract row.
  - `frontend-mockup-loop-dashboard` gains a "plugin surface" binding and a refreshed GROUND example.
- **Coordination.** Both earlier overlaps are gone: wave 2's kit is now the canonical home, and `add-pi-spec-driven-schema` is archived. This change's `dialog-system` copy starts from the archived text.

## Capabilities

### New Capabilities
- `shared-status-recipes`: one status pill, one notice/callout and one inline action error, all from the runtime kit. Core and plugin surfaces consume them, and they are token-sourced in every theme.

### Modified Capabilities
- `client-utils-status-presentation`: the status pill sources its colours from the severity tokens; the `statusPresentation` helper keeps `--status-*`. The services, vault, provider and plugin-list pills join the covered surfaces.
- `services-settings-ui`: "Service detail page" shows a refused action as a sentence with the code behind "Copy details". "Accessible, theme-token styling" points at the shared parts.
- `credential-vault`: vault status pills, callouts and error lines come from the shared recipes. The destructive-impact and load-state requirements are otherwise unchanged.
- `client-build-config`: the `theme-token-guard` scan roots include `packages/client-utils/src` and `packages/dashboard-plugin-runtime/src`.
- `message-severity-tokens`: the no-raw-colour file list grows to cover the shared pill, notice, inline error, dialog, menu and migrated pill files.
- `dialog-system`: the visual baseline (backdrop, panel, title), action intents (tinted danger) and contract target sizes.
- `session-actions-menu`: type, target and contrast floors for headings, items and disabled reasons.
- `settings-panel`: the rail's text contrast, target size, current-item indicator and attention marker. The kit's notice extensions and the new `SettingsActionError`.

## Impact

- **Code:**
  - `packages/dashboard-plugin-runtime/src/settings-fields.tsx` (notice extensions, `SettingsActionError`) and its barrel; `packages/client-utils/src/StatusPill.tsx`.
  - `packages/client/src/components/settings/services/services-ui.tsx`.
  - `packages/client/src/components/settings/vault/vault-ui.tsx` and `OperateRequiredCallout.tsx`.
  - `ProviderHealthPill.tsx`, `components/packages/plugin-row-parts.tsx` and `openspec/OpenSpecBoardView.tsx` (`BoardStatePill` only).
  - `packages/client-utils/src/Dialog.tsx`, `packages/client/src/components/session/SessionActionsPanel.tsx`, the rail block of `packages/client/src/components/settings/SettingsPanel.tsx`.
  - `scripts/theme-token-guard.mjs` and its baseline.
- **Docs and skills:**
  - `ui-contract.md`.
  - `packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/{slot-taxonomy,host-design}.md`.
  - `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md`.
- **No change to:** REST or WebSocket protocol, settings keys, the `ui:status-pill` or `ui:dialog` prop APIs, `UI_PRIMITIVE_KEYS`, or existing runtime kit props (additions only).
- **Visual:** pills, dialogs and the rail change colour in every palette, base included. `ui:status-pill` `running` goes from green to info-blue and `warn` from yellow to the warning triple. Core pills drop to the kit's 11 px (12 px inside interactive elements). This is intended.
- **Rollback:** revert.

## Non-goals

- Restyling plugin settings bodies. That stays in `retro-ux-plugin-settings-wave-2`.
- Redesigning plugin pages, dialogs or slot widgets. That is the later wave this change prepares for.
- Unifying the existing tab implementations, and moving other menus (folder actions, plugin menus) onto the menu recipe. This change writes their contract rows only; adopting them is follow-up work.
- Moving hand-built plugin dialogs (`CreateGoalDialog`, MCP `ServerEditor` and `ProjectSettings`, system-one `ConfirmDialog`) onto `ui:dialog`. That belongs to the plugin wave. Plugin dialogs already on `ui:dialog` do pick up the new dialog look.
- Changing the `PrSegment` tone ramp, which is a recorded follow-up of `compact-session-card-header`.

## Discipline Skills

- `doubt-driven-review`: done during planning (2 reviewers, 2026-10-18). Run it again on the kit's new props (`remedies`, `SettingsActionError`) before they stand, because they become public runtime API.
- `review-code`: before commit, because the migration touches services, vault, the kit and several core surfaces.
- No `security-hardening`: the vault and services migrations restyle only. No secret values reach the touched parts.
- No `performance-optimization`: rendering cost is unchanged.
