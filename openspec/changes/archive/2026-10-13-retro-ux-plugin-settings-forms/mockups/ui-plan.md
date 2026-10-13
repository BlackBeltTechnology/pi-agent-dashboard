# UI plan — retro-ux-plugin-settings-forms

Mode: **preserve** (`anti-slop-redesign`). Profile: `product-ui`. Contract: root `ui-contract.md`. Method: `retro-ux-identity-connectivity` design D1–D5.
Board: `plugin-settings-forms.html`, as-built vs proposed. `tokens.css` is GENERATED (same source as change 1); do not hand-edit it.

## Scope correction (from GROUND)

- #829 `FolderKbSection` is **not a settings form**. It is a sidebar folder **pill** built on `SlotPill` (`packages/dashboard-plugin-runtime/src/SlotPill.tsx`), so it is judged against its SlotPill siblings (MCP, goals, automation, team), not the form pattern. User decision 2026-10-12: keep it in this change as a separate surface.
- Save models differ **legitimately**. Context-mode and hermes buffer edits into the host Save bar (`useSettingsDraftSource`); Gmail persists each action immediately (alias on blur, level on change, revoke via confirm dialog, upload on pick). The shared pattern covers **presentation only**; it does not change either save model.

## Surfaces → states

| Surface | Source | States (fixture ids) |
|---|---|---|
| Context-mode | `context-mode-settings-plugin/src/client/ContextModeSettingsForm.tsx` | `loading`, `load-error`, `populated`, `not-created`, `invalid-dirty` |
| Hermes memory | `hermes-memory-plugin/src/client/HermesMemorySettings.tsx` | `loading`, `load-error`, `populated`, `invalid-dirty`, `model-unavailable`, `raw-json` (dialog) |
| Gmail | `gmail-plugin/src/client/GmailSettings.tsx` | `loading`, `load-error`, `not-configured` (wizard step 1), `configured` (ok + re-auth + testing), `upload-error`, `flow-waiting`, `flow-error`, `alias-error` |
| KB folder pill | `kb-plugin/src/client/FolderKbSection.tsx` | `populated`, `stale`, `indexing`, `no-sources`, `not-indexed`, `denied`, `missing`, `error` |

## Findings → rule → proposed decision

| # | Surface | As-built | Rule broken | Proposed |
|---|---|---|---|---|
| G1 | A B C host | four field anatomies: label 13 px primary (A, B) / 12 px muted (C) / 14 px secondary (host); help 11.5 px tertiary / 12 px muted / 12 px tertiary; input mono 12.5 px / transparent 12 px / 14 px | Nielsen #4 consistency; `ui-contract.md` type scale (11/12/14 only); field label recipe | one anatomy, the core `FieldShell` layout (approved): label row 12 px semibold `--text-primary` (`htmlFor`, unit chip inside the label) + optional key chip + state pill → control → hint 12 px `--text-secondary` below the control (`aria-describedby`) → error. The core field family moves to `dashboard-plugin-runtime` and serves core + plugins |
| G2 | B | labels are `<span>`, no `htmlFor`; inputs unnamed | WCAG 1.3.1, 4.1.2 | `<label htmlFor>` |
| G3 | A B | help text not linked to control | WCAG 1.3.1 (description) | help `id` + `aria-describedby` (as host FieldShell already does) |
| G4 | B | validation error: no `aria-invalid`, no `role`, raw English strings from `settings-model.ts` | WCAG 3.3.1, 4.1.3; i18n | `aria-invalid` + error `id` in `aria-describedby`; strings through `t()` |
| G5 | A B | error text `--accent-red`; dirty status `--accent-yellow` as text | `ui-contract.md:66-69` (never `--accent-<hue>` as text) | error `--severity-error-fg`; status = severity-warning pill "N unsaved changes — use Save below" |
| G6 | A B | notices: `color-mix(--accent-yellow 12%/40%)` hand-rolled | contract severity callout recipe | severity-info callout |
| G7 | C | labels and help in `--text-muted` (`muted` const) | WCAG 1.4.3; "`--text-muted` is decoration only" | field label / help recipe |
| G8 | C | wizard: active step only a border colour; done steps not marked | WCAG 1.4.1; Nielsen #1 | numbered step chip: current = tint-blue + `aria-current="step"`, done = success check |
| G9 | C | "Add account" is a small bordered button like Revoke; disabled without a reason | contract "exactly one visually-primary action"; Nielsen #1 | primary button + text reason when disabled |
| G10 | C | account status `ok`; level select unnamed per account; alias `aria-label` only "Alias" | Nielsen #2 (match real world); WCAG 2.5.3, 4.1.2 | "Connected" pill; per-account names "Alias for <email>", "Level for <email>", "Revoke <email>" |
| G11 | C | flow error is bare red text with a code | Nielsen #9 | severity-error callout naming the cause + the step to fix it; code kept |
| G12 | B | raw-JSON dialog scrim `bg-black/55`; title is a path | palette ban; contract dialog recipe | `--bg-overlay` scrim, dialog card recipe, short title + path subline |
| G13 | A B | "On"/"Off" checkbox text hardcoded | i18n; contract toggle = `role="switch"` (host `ToggleField`) | `role="switch"` + translated state word |
| G14 | B | "Model selector unavailable" in tertiary, no way forward | Nielsen #9 | info callout + "Open Providers" |
| G15 | A B C | sizes 13 / 12.5 / 11.5 px | type scale | 11 / 12 / 14 px only |
| K1 | KB | "no sources" / "not indexed" / "indexing…" in `text-teal-400` | palette ban; identity colour used as status | `--text-secondary` word + icon (info / spinner) |
| K2 | KB | "index failed" `text-red-400` | palette ban | severity-error pill |
| K3 | KB | "⚠ N stale" 10 px extrabold `text-amber-400` (low contrast in light) | type floor (state below 11 px); WCAG 1.4.3 | severity-warning pill keeping the `⚠ N stale` text, 11 px (chip recipe) |
| K4 | KB | units ("chunks", "412 files") 10 px tertiary | type floor | 11 px `--text-secondary` |
| K5 | KB | card reindex button 24×24, `hover:text-cyan-400` | WCAG 2.5.8 (24 px is the bare minimum); palette ban | secondary icon button, 44 px below `sm` / 32 px from `sm` (session card is an aligned action surface) |
| K6 | KB (shared) | SlotPill legend 9 px uppercase; SlotPill accent glyph palette classes (`text-cyan-400`, `bg-cyan-500/10`) | type floor; palette ban | legend → 12 px semibold `--text-secondary` (approved; section-heading recipe), together with `SessionSubcard` (approved, so they keep matching); accent glyph palette classes stay (follow-up) |

## Protected (preserve)

All `data-testid`s: `cms-*` (load-error, file-path, notice-*, raw-json, default-badge-*, reset-*, error-*, input-*), `hermes-*` (load-error, file-path, change-status, default-badge-*, reset-*, input-*, inherit-*), `gmail-*` (settings, setup-summary, wizard, step-1…6, project-id, client-upload, client-ok, upload-error, accounts, level-help, account-row, account-email, account-status + `data-status`, account-alias, alias-feedback, account-level, account-reauth, account-revoke, consent-hint, google-error, report-*, new-level, add-account, cross-org-hint, flow-error + `data-step`, flow-error-code, revoke-result), `folder-kb-*` (section + `data-state`, open-settings, count, stale, card-reindex). Settings keys and file formats. Save models (host Save bar for A/B; immediate actions for C). The `settings-draft` source ids `plugin:context-mode-settings`, `plugin:hermes-memory`. Existing i18n keys.

## Decisions taken at approval (2026-10-12)

- D2 carrier → move the core `FieldShell` family (`FieldShell`, `ToggleField`, `SelectField`, `NumberField`, `TextField`, new `TextAreaField`) into `dashboard-plugin-runtime`, plus `SettingsGroup` and `SettingsNotice`; core settings and the three plugins use one implementation. Layout = core (hint below control, unit inside label).
- K6 → SlotPill legend and `SessionSubcard` legend at 12 px semibold `--text-secondary` (first approved at 11 px; raised to 12 px in doubt-review because the session card is an aligned action surface where labels are ≥ 12 px and the section-heading recipe is 12 px).
