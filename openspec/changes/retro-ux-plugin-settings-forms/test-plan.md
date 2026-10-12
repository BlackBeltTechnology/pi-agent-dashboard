# Test Plan — retro-ux-plugin-settings-forms

Stage: design   Generated: 2026-10-12

Levels: L1 = vitest (`packages/**/__tests__/*.test.ts[x]`). L3 = Playwright `tests/e2e/*.spec.ts` in the docker harness on the shared `captureStates` helper (`retro-ux-identity-connectivity`, spec `ui-state-capture`). Probe matrix = `{base,dark}`, `{base,light}`, `{nord,dark}` × 375 / 768 / 1440.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | settings-panel: fields — describedby | decision table (hint null/non-null × error yes/no) | L1 | automated | `NumberField` with hint+error, hint only, `hint={null}`+error, `hint={null}` no error | render | describedby = `hint error` / `hint` / `error` / absent; `aria-invalid="true"` only with an error; error element has `role="alert"` |
| E2 | settings-panel: fields — unit + label | EP | L1 | automated | `NumberField label="Session register timeout" unit="ms"` | render | accessible name contains the label and `ms`; unit chip inside `<label>`, 12 px; no `(ms)` text |
| E3 | settings-panel: fields — testIds | EP | L1 | automated | `NumberField testIds={{control:"cms-input-search.windowMs", state:"cms-default-badge-search.windowMs", reset:"cms-reset-search.windowMs", error:"cms-error-search.windowMs"}}` with `state="default"`, `onReset`, `error` | render | each id on its element; error has `role="alert"` |
| E4 | settings-panel: fields — state/reset | decision table (state × onReset) | L1 | automated | `state` `"default"` / `"changed"` / absent, with and without `onReset` | render; click reset | pill text "default"/"changed"/none; "Reset to default" only with `onReset`, click calls it once |
| E5 | settings-panel: fields — focus-ring + typography | EP | L1 | automated | each field kind (Toggle, Select, Number, Text, TextArea) | render | every control has class `focus-ring`; label carries the 12 px semibold primary classes; no class matches the palette regex; no `text-[Npx]` with N ∉ {11,12,14} |
| E6 | settings-panel: core compatibility | EP | L1 | automated | `import { NumberField, SelectField, TextField, ToggleField } from "../SettingsPanel.js"` | run the existing suite | `settings-field-contract.test.tsx`, `settings-heap-fields.test.tsx` and every other `settings/__tests__` file pass unchanged |
| E7 | settings-panel: runtime boundary | EP | L1 | automated | source of `packages/dashboard-plugin-runtime/src/settings-fields.tsx` | scan imports | no import path containing `packages/client`, `pi-dashboard-client-utils` or `../client` |
| E8 | settings-panel: SettingsNotice tones | EP | L1 | automated | `tone` info / warning / error / success | render | classes reference `--severity-<tone>-bg`, `-border`, `-fg`; no palette class |
| E9 | session-card-subcards: legend | EP | L1 | automated | `<SessionSubcard title="OPENSPEC">x</SessionSubcard>` | render | legend has `text-[12px]`, `font-semibold`, `uppercase`, `text-[var(--text-secondary)]`, not `text-[9px]`; panel has no `bg-[` token |
| E10 | directory-card-layout: legend | EP | L1 | automated | `SlotPill` raised and flat | render | both legends `text-[12px]` + `text-[var(--text-secondary)]`, no `text-[9px]` |
| E11 | context-mode: kit + tokens | decision table (field default/changed × valid/invalid) | L1 | automated | config with `search.windowMs` default and `search.maxResultsAfter` = 5 changed; then type `-2` | render, edit | `cms-default-badge-search.windowMs`, `cms-reset-search.maxResultsAfter` render; after `-2`: `aria-invalid`, `cms-error-search.maxResultsAfter` linked, status shows "1 unsaved change" pill with `role="status"` |
| E12 | context-mode: no accent text | EP | L1 | automated | source of `ContextModeSettingsForm.tsx` | scan | no `--accent-` inside a `text-[var(...)]` class; no palette class |
| E13 | hermes: labels + errors | EP | L1 | automated | populated config | render; type `abc` in `memoryCharLimit` | every input/select/textarea/switch has an accessible name = its label; after `abc`: `aria-invalid` + describedby includes the error; message comes from `t()` (key present in `en`, `hu`, `zh-CN`) |
| E14 | hermes: kept behaviour | decision table | L1 | automated | `llmModelOverride` unset; set to a listed model; set to `openrouter/deepseek/deepseek-v4-flash` (unlisted) | render; click inherit | DEFAULT badge when unset; inherit clears to default; unlisted value still displayed and preserved on save |
| E15 | hermes: no models | EP | L1 | automated | `GET /api/models` → `[]` | render Model override | info notice with an "Open Providers" action; no `bg-black` class anywhere |
| E16 | hermes: strict lookup | EP | L1 | automated | source of `HermesMemorySettings.tsx` | scan | `useUiPrimitive(` used for `ui:model-selector`; no `useUiPrimitiveOrNull` for it |
| E17 | gmail: status pills | decision table (status) | L1 | automated | accounts `ok`, `reauth_required` | render | `gmail-account-status` texts "Connected" / "Re-auth needed", `data-status` `ok` / `reauth_required` |
| E18 | gmail: named controls + disabled reason | decision table (configured × accounts) | L1 | automated | not configured; configured with 2 accounts | render | not configured: "Add account" disabled, describedby → visible reason; configured: controls named "Alias for <email>", "Level for <email>", "Revoke <email>"; `gmail-cross-org-hint` present |
| E19 | gmail: step chips | state | L1 | automated | not configured; upload error; `org_internal` reported | render | `aria-current="step"` on step 1 / step 5 / step 3 respectively; done steps show a check; none when all complete |
| E20 | gmail: E9 focus-ring kept | EP | L1 | automated | configured panel | query `button, select, input, summary, a` in `gmail-settings` | every element has `focus-ring` (`panel.test.tsx:361-366` passes) |
| E21 | kb: state words | decision table (state) | L1 | automated | stats → denied, pinning, missing, indexing, no-sources, not-indexed, error, stale(3), populated | render | words in `--text-secondary` with an icon; error = severity-error pill; `folder-kb-stale` text `⚠ 3 stale` in a severity-warning pill; no `text-teal-*`, `text-red-*`, `text-amber-*`, `text-cyan-*` outside SlotPill's glyph chip |
| E22 | kb: card control size | BVA (breakpoint) | L3 | automated | KB section in the card placement at 375 and 1440 | measure the control | ≥ 44 × 44 at 375; ≥ 32 × 32 at 1440; accessible name = action label |
| E23 | i18n parity | EP | L1 | automated | new/changed keys in hermes, gmail, kb, context-mode | run the plugins' i18n tests and `node scripts/i18n-parity.mjs` | every key present in `en`, `hu`, `zh-CN`; parity script exits 0 |
| E24 | all surfaces: probes | decision table (state × theme × width) | L3 | automated | every fixture state of context-mode, hermes, gmail, kb-pill | `captureStates` without `RETRO_UX_CAPTURE` | all contrast / size / focus lists empty; nothing written under `openspec/` |
| E25 | client-build-config: @source | EP | L1 | automated | `packages/client/src/index.css` | read | `@source` lines exist for `hermes-memory-plugin/src/client` and `kb-plugin/src/client` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | hermes: dialog | state-transition | L1 | automated | populated section | click "View raw JSON", Tab ×6, Shift+Tab, Escape | dialog `role="dialog"` + `aria-modal="true"` + labelled; focus never leaves the dialog while open; after Escape it is closed and "View raw JSON" has focus |
| F2 | settings-panel: SettingsGroup | state-transition | L1 | automated | `SettingsGroup title="Search"` collapsed | Tab to summary, Enter | group opens; summary has `focus-ring` and min-height ≥ 44 px |
| F3 | context-mode: save via host | state-transition | L1 | automated | change `search.maxResultsAfter` to 6 | host Save | one `PUT /api/plugins/context-mode-settings/config` with the override; status returns to "No changes" |
| F4 | visual fidelity to approved board | visual/subjective | — | manual-only | `mockups/after/**` vs the proposed column of `mockups/plugin-settings-forms.html` | human side-by-side review | [judgment: real render matches the approved design] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | context-mode: load failure | fault-injection (abort) | L1 | automated | config GET → 503 | mount | `cms-load-error` renders inside an error `SettingsNotice`; no `--accent-red` class |
| X2 | hermes: load failure | fault-injection (abort) | L1 | automated | config GET → ENOENT error body | mount | `hermes-load-error` inside an error notice |
| X3 | gmail: flow error | fault-injection (abort) | L1 | automated | oauth flow status → error `access_denied` at step 3 | wait for flow | `gmail-flow-error` with `data-step="3"` inside an error notice naming step 3 and the code |
| X4 | gmail: upload error | fault-injection (abort) | L1 | automated | upload a `web` client JSON | pick file | `gmail-upload-error` linked to the upload input by describedby; input `aria-invalid` |
| X5 | settings-panel: heap field | fault-injection (invalid input) | L1 | automated | heap ceiling below the store-coupling floor | edit | `session-heap-max-old-space-error` / `-warn` still render (`settings-heap-fields.test.tsx:142,152,161`), now with `--severity-*` classes, no palette class |

---

## Coverage summary

- Requirements covered: 11/11 (settings-panel 2, session-card-subcards 1, directory-card-layout 1, context-mode-settings 1, hermes-memory-settings 2, gmail-plugin 3, kb-plugin-folder-section 1)
- Scenarios by class: edge 25 · perf 0 · frontend 4 · error 5
- Scenarios by level: L1 31 · L2 0 · L3 2 · — 1
- Scenarios by disposition: automated 33 · manual-only 1

## New infra needed

- none beyond `retro-ux-identity-connectivity` task 2.1 (`ui-capture.ts`) and this change's fixtures (task 2.1).
