## Context

Shared method: `retro-ux-identity-connectivity` design.md (D1 two phases, D2 `page.route` fixtures, D3 `captureStates`, D4 audit rubric, D5 preserve mode). This file records only what differs.

Facts from the harvest (develop):
- Context-mode (`ContextModeSettingsForm.tsx`) and hermes (`HermesMemorySettings.tsx`) duplicate the same `inputCls` and `FieldRow` pattern and both register `useSettingsDraftSource` (`settings-draft-context.tsx`), so the host Save bar (`SettingsPanel.tsx`, `data-testid="settings-save-bar"`) owns Save/Discard.
- Gmail (`GmailSettings.tsx`) does not use the draft source; alias, level, revoke and upload persist immediately.
- Hermes labels are `<span>` without `htmlFor`; its validation strings (`settings-model.ts`) are raw English.
- The core settings field contract (`SettingsPanel.tsx`, `FieldShell` / `NumberField` / `ToggleField`) already requires a `hint` and wires `aria-describedby`, but lives inside the client package, out of reach for plugins.
- `plugin-ui-primitive-registry` reserves the registry for the shell's `IntentRenderer` and transient pickers; plugins import shared presentational components directly from `dashboard-plugin-runtime` (precedent: `SlotPill.tsx`).
- `FolderKbSection.tsx` renders through `SlotPill`; SlotPill's legend is `text-[9px]` and its accents are palette classes (`ACCENT` map).

## Decisions

### D1. Consistency is the primary audit axis
`mockups/audit.md` judges each pattern element (label, help, control, unit, error, notice, status, grouping, primary action) across the three forms, not each form alone.

### D2. One field family in `dashboard-plugin-runtime` (approved)
Move `FieldShell`, `ToggleField`, `SelectField`, `NumberField` and `TextField` from `SettingsPanel.tsx` into `packages/dashboard-plugin-runtime/src/settings-fields.tsx`, add `TextAreaField`, `SettingsGroup` and `SettingsNotice`, and export them from the runtime barrel. `SettingsPanel.tsx` imports them and re-exports the four existing fields, so `settings-field-contract.test.tsx` and other imports keep working.
- Contract (MODIFIED `settings-panel`): required `hint` (`null` = none), `htmlFor` label with the unit inside, hint below the control, optional `error` → `aria-invalid` + linked error id. The components render their own control, so the wiring is enforced by construction; `FieldShell` takes a render prop for custom controls (hermes model selector, Gmail file input) and passes `{ id, describedBy, invalid }`.
- Typography (approved anatomy): label 12 px semibold `--text-primary`, hint 12 px `--text-secondary`, error 12 px `--severity-error-fg`. This changes the core settings pages' look too; that is the point of one contract.
- *Rejected:* a separate plugin kit (two contracts that disagree on layout); registry primitive (`plugin-ui-primitive-registry` reserves the registry for `IntentRenderer` and transient pickers).

### D3. Capsule legends at 12 px, together (approved)
`SlotPill` (`text-[9px]` `--text-secondary`) and `SessionSubcard` (`text-[9px]` `--text-tertiary`, `SessionSubcard.tsx:34`) legends move to `text-[12px]` `font-semibold` `--text-secondary` — the `ui-contract.md` section-heading size, weight and colour (keeping `uppercase` as a documented capsule-legend exception), which also meets the aligned-surface rule for labels on the session card (≥ 12 px). They change together because `directory-card-layout` requires the flat pill on the session card to match its sibling subcards. The `session-card-subcards` MODIFIED delta also corrects the spec to the shipped border-only panel and `--bg-primary` legend fill (the spec still described a `color-mix` fill that `SessionSubcard.test.tsx:25` forbids).

### D4. Save models stay
The kit is presentation only. Context-mode and hermes keep the host Save bar; Gmail keeps immediate saves with its existing alias feedback.

## Risks / Trade-offs

- [Field family becomes runtime API] → the MODIFIED `settings-panel` requirement fixes the prop contract; doubt-review runs on it before folding. `SettingsPanel.tsx` re-exports keep core imports stable.
- [Every SlotPill and SessionSubcard legend changes at once] → legend size and colour are the only changes; new unit tests assert them (the existing SlotPill tests check only border, radius and hover tokens; the SessionSubcard test checks structure tokens).
- [Hermes looks up `ui:model-selector` with the strict `useUiPrimitive`] → kept: the model selector is a shell-bound wrapper (favorites, refresh), not a transient picker, and its primitive spec shows the strict hook. "Open Providers" appears when the model list is empty.
- [Status pill duplicates the host Save bar count] → accepted (approved): the pill tells the user which section holds the unsaved change; the Save bar stays the one place to save.
- [`ui-contract.md` input recipe says "persistent label above"] → the core settings layout keeps label-beside-control rows; task 3.10 records that as the settings-field exception.
- [`hermes-memory-plugin/src/client` and `kb-plugin/src/client` have no `@source` line in `packages/client/src/index.css`] → task 3.1 adds them (`client-build-config` requires one per client-bearing plugin).
- [`theme-token-guard` scans none of the hermes, context-mode, kb or runtime trees] → task 4 adds a source-scan test over the touched files.
- [KB "⚠ N stale" text] → kept verbatim inside the severity pill, because `directory-card-layout` requires an inline `⚠ N stale` marker.

- [Legend size as an ADDED `directory-card-layout` requirement] → deliberate: no existing requirement fixes the SlotPill legend size (the surface-variant requirement pins only fill/shadow and structure), so the new rule adds rather than alters. The `SessionSubcard` half is MODIFIED because its requirement does fix `text-[9px]`.

## Migration Plan

None. Rollback is a revert.
