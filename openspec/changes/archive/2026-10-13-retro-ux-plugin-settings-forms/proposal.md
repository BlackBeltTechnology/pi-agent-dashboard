## Why

Three PRs shipped plugin settings UI without a mockup: #827 (`add-context-mode-settings-plugin`: a 335-line `ContextModeSettingsForm` plus the hermes-memory settings), #813 (`improve-gmail-settings-ux`: a 632-line `GmailSettings` with a setup wizard; the change name says "UX" but there was no mockup) and #829 (`kb-denied-folder-pin-state`: the KB folder pill's denied, missing and no-sources states). The three settings forms sit next to each other in the same Settings rail but use four field anatomies (labels at 13, 12 and 14 px; help at 11.5 px in `--text-tertiary` or in `--text-muted`; three input styles). Hermes labels are not associated with their inputs, errors are not announced, and context-mode and hermes paint errors and the unsaved state with `--accent-*` as text, which `ui-contract.md:66-69` forbids. The KB pill shows state words in an identity teal, "index failed" in `text-red-400`, and a 10 px amber stale count that is hard to read in light. This is the second of four retro UX reviews.

## What Changes

- Mockup: `mockups/plugin-settings-forms.html` (in this change), approved on 2026-10-12 with all 6 decisions. Measured on the board with the repo probes: as-built replica 274 contrast/size failures across three themes, proposed 0 (`mockups/audit.md`).
- **One settings-field contract for core and plugins (approved):** the core field family (`FieldShell`, `ToggleField`, `SelectField`, `NumberField`, `TextField`, plus a new `TextAreaField`) moves from `SettingsPanel.tsx` into `@blackbelt-technology/dashboard-plugin-runtime`, together with new `SettingsGroup` and `SettingsNotice`. Core settings and the three plugins use the one implementation; plugins import it directly like `SlotPill`, not through the primitive registry. Layout stays the core's: label row (unit inside the label) → control → hint below the control (`aria-describedby`) → error (`aria-invalid`, linked). Typography: label 12 px semibold `--text-primary`, hint 12 px `--text-secondary`, error 12 px `--severity-error-fg`; scale 11 / 12 / 14 px only. `SettingsPanel.tsx` keeps re-exporting the four existing fields. The recipe is documented in `ui-contract.md`.
- Context-mode and hermes: the status line becomes "No changes" or a severity-warning pill "N unsaved changes"; notices become severity callouts; no `--accent-*` text remains (load error, status, save error, reset/inherit links, file path, field errors).
- Hermes: associated labels; `aria-invalid` errors with strings through `t()` (en / hu / zh-CN); `role="switch"` toggles; the raw-JSON view uses the contract dialog recipe (`--bg-overlay` scrim, focus trap, Escape); an empty model list offers "Open Providers". DEFAULT badges, reset, inherit and unknown-model preservation stay.
- Gmail: numbered wizard step chips (current = `aria-current="step"`, done = check); "Add account" is the one primary button, with a text reason while disabled; account status reads "Connected" / "Re-auth needed"; per-account controls are named after the account; the flow error is a severity-error callout naming the step that fixes it.
- KB folder pill: every state word in `--text-secondary` with an icon instead of teal or tertiary; "index failed" and "⚠ N stale" as severity pills; 11 px units; card control on the secondary recipe, 44 px below `sm` / 32 px from `sm`.
- **Capsule legends 9 → 12 px semibold `--text-secondary` (approved; section-heading recipe):** `SlotPill` (every user: KB, MCP, goals, automation, team, OpenSpec and session-card placements) and `SessionSubcard`, so the flat pill on the session card keeps matching its sibling subcards. SlotPill's palette-class accent glyph map stays as-is (follow-up).
- Unchanged (preserve): save models — host Save bar for context-mode and hermes (`useSettingsDraftSource`), immediate per-action saves for Gmail; settings keys and file formats; existing i18n keys; every existing `data-testid` (`cms-*`, `hermes-*`, `gmail-*` incl. `gmail-cross-org-hint`, `folder-kb-*`).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `settings-panel`: the shared settings field components move to `dashboard-plugin-runtime`, gain an `error` prop and the contract typography, and are used by plugin sections too (MODIFIED); `SettingsGroup` and `SettingsNotice` are added.
- `session-card-subcards`: the capsule legend is 12 px semibold `--text-secondary`, and the spec is corrected to the shipped border-only panel (MODIFIED).
- `context-mode-settings`: the settings form uses the kit, a severity status pill and severity notices, and passes the probes.
- `hermes-memory-settings`: associated labels, announced errors, switch toggles, dialog recipe, recovery for no models; uses the kit.
- `gmail-plugin`: "Settings section is readable and guarded" is MODIFIED (status pill wording, no `--text-muted`, named per-account controls, one primary action with a reason); wizard step chips and a callout for flow errors are added.
- `kb-plugin-folder-section`: state words and badges use tokens and severity pills; units at 11 px; the card control follows the aligned-surface target sizes.
- `directory-card-layout`: the folder slot pill legend is 12 px semibold `--text-secondary`, matching SessionSubcard.

## Impact

- Runtime: new `packages/dashboard-plugin-runtime/src/settings-fields.tsx` (field family moved from `SettingsPanel.tsx`, plus `TextAreaField`, `SettingsGroup`, `SettingsNotice`; exported from the barrel); `SlotPill.tsx` legend.
- Client: `SettingsPanel.tsx` imports and re-exports the fields; `SessionSubcard.tsx` legend. Core settings pages change typography (label 12 px semibold primary, hint 12 px secondary).
- Plugins: `context-mode-settings-plugin/src/client/ContextModeSettingsForm.tsx`, `hermes-memory-plugin/src/client/HermesMemorySettings.tsx` (+ `settings-model.ts` strings to `t()`), `gmail-plugin/src/client/GmailSettings.tsx`, `kb-plugin/src/client/FolderKbSection.tsx`.
- Tests: fixtures `tests/e2e/fixtures/retro-ux/{context-mode,hermes,gmail,kb-pill}.ts` and `tests/e2e/retro-ux-plugin-settings-forms.spec.ts` on the shared harness. Depends on `retro-ux-identity-connectivity` task 2.1.
- Rollback: a revert. No settings key, file format or REST change.

## Non-goals

- Unifying save models; new settings keys or validation rules; OAuth flow changes.
- SlotPill's palette-class accent glyphs (follow-up).
- Bespoke inline controls in `SettingsPanel.tsx` and sibling sections (`RetrySettingsSection`, `ModelProxySection`, `ToolsSection`, `DiagnosticsSection`).

## Discipline Skills

- `review-code`: before commit — five packages change.
- `doubt-driven-review`: on the moved field components' props before they stand, because they become a public runtime API every core and plugin settings form uses.
- No `security-hardening`: Gmail OAuth and client upload are restyled only; routes, secrets and leases are untouched.
