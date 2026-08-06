# Test Plan — reorganize-settings-pages-and-descriptions

Stage: design   Generated: 2026-08-06

Clarifications resolved before writing (HARD gate):

- **C1 — unit-bearing i18n keys** → *update the existing keys in place across en / zh-CN / hu, stripping the embedded unit from each.* Fixes the observable for **E14**: the rendered label contains the unit **zero** times in every locale; the unit appears only in the `unit` chip.
- **C2 — render-performance budget** → *none; performance is explicitly out of scope for this change.* The Performance section is intentionally empty.

Harness exemplars referenced by the rows below:

- **L1** → `packages/client/src/components/__tests__/SettingsPanel.test.tsx` (vitest + jsdom; the settings package has no `__tests__/` of its own)
- **L3** → `tests/e2e/plugin-settings-pages.spec.ts` (Playwright vs the docker harness; port from `.pi-test-harness.json` `dashboardPort`, never `:18000`)

Source anchors: `packages/client/src/components/settings/SettingsPanel.tsx` — `NumberField:2272`, `ToggleField:2287`, `SelectField:2302`, `TextField:2372`, `CONFIG_FIELD_PAGE:161`, `dirtyPages:549`, `spawnRegisterTimeoutMs:1216`, save button `data-testid="save-btn"` (`:1615`), `DebugToolsToggle:1720`, `DisplayPrefsSection:1795`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 hint→description | decision-table | L1 | automated | a `ToggleField` with `hint="Buffered until Save"`, no `unit` | component renders | a hint element containing that text renders below the control row, and the control's `aria-describedby` resolves to exactly that element |
| E2 | R1 null hint | decision-table | L1 | automated | a `ToggleField` with `hint={null}` | component renders | no hint element renders, and the control carries no `aria-describedby` attribute at all |
| E3 | R1 unit in name | decision-table | L1 | automated | a `NumberField` with `label="Session register timeout"`, `unit="ms"` | component renders | the unit text sits inside the `<label>` element; the accessible name contains both `Session register timeout` and `ms`; the label text contains no `(ms)` parenthetical |
| E4 | R1 accessible name | decision-table (4 components) | L1 | automated | one instance each of `ToggleField`, `SelectField`, `NumberField`, `TextField` with `label="Probe"`, `hint={null}`, no `unit` | each renders | each control's accessible name is `Probe`, resolved through `htmlFor`/`id` (not a placeholder or `aria-label`) |
| E5 | R1 id uniqueness | state/collision | L1 | automated | two `NumberField` instances with distinct non-null hints rendered in one tree | both render | the two controls have distinct `id`s and distinct `aria-describedby` values; each `aria-describedby` resolves to its **own** hint text, not the sibling's |
| E6 | R1 ReactNode hint | equivalence | L1 | automated | a `NumberField` whose `hint` is JSX containing `<code>-1</code>` plus an interpolated value | component renders | the accessible description is the flattened text of that node, including the `<code>` content |
| E7 | R1 required prop | negative type test | L1 | automated | a `.test-d`/`@ts-expect-error`-annotated call site of each of the four components omitting `hint` | `tsc --noEmit` (as run by `npm run quality:changed`) | the omission raises a type error at each site, so `@ts-expect-error` is satisfied and `tsc --noEmit` exits 0; deleting the annotation makes it exit non-zero |
| E8 | R2 bounds (below min) | BVA | L1 | automated | Sessions page, `spawnRegisterTimeoutMs` input, existing value 30000 | user enters `4999` | `4999` is not written to the pending config (config keeps 30000), the inline error `Must be an integer between 5000 and 120000.` renders, and `[data-testid="save-btn"]` is disabled |
| E9 | R2 bounds (min valid) | BVA | L1 | automated | same | user enters `5000` | `5000` is written to the pending config, no inline error renders, `save-btn` is enabled |
| E10 | R2 bounds (max valid) | BVA | L1 | automated | same | user enters `120000` | `120000` is written, no inline error, `save-btn` enabled |
| E11 | R2 bounds (above max) | BVA | L1 | automated | same | user enters `120001` | not written, inline error renders, `save-btn` disabled |
| E12 | R2 non-numeric | EP (invalid class) | L1 | automated | same | user enters `abc` (parses to `NaN`) | not written, inline error renders, `save-btn` disabled |
| E13 | R2 recovery | state-transition | L1 | automated | same, already in the invalid state from E8 | user corrects the value to `30000` | the inline error disappears and `save-btn` becomes enabled again (invalid state is not sticky) |
| E14 | R1 unit + i18n (C1) | decision-table (5 keys × 3 locales) | L1 | automated | language set to `en`, then `zh-CN`, then `hu`, for each of `settings.probeInterval`, `settings.pollIntervalSeconds53600`, `settings.jitterSeconds060`, `session.maxConcurrentSessions116`, `session.askUserPromptTimeoutSeconds` | the owning field renders | in every locale the label text contains the unit token **zero** times; the unit appears exactly once in the rendered field, inside the `unit` chip within the `<label>` |

### Performance

None. **C2** resolved performance as explicitly out of scope for this change — no threshold exists in `proposal.md` or `design.md`, and inventing one would hide rather than expose the absence.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R3 defaultModel first | DOM-order | L1 | automated | Sessions page | page renders | the `defaultModel` control precedes **every** other control on the page in DOM order, including the Retry section's controls |
| F2 | R3 caveat surfaced | content | L1 | automated | Sessions page | the `defaultModel` callout renders | its description states the setting applies only to brand-new sessions and that a resumed session keeps its own model |
| F3 | R3 callout tokens | style-contract | L1 | automated | Sessions page | the `defaultModel` callout renders | the callout element's class list references a `--severity-info-*` token, not a raw Tailwind severity colour |
| F4 | R5 Sessions sections | DOM-order | L1 | automated | Sessions page | page renders | section headings appear in order: new-session defaults, session list, lifecycle & recovery, worktrees, retry |
| F5 | R5 dashboardName page | page-composition | L1 | automated | General page, then Sessions page | both render | `dashboardName` renders inside the General ▸ Interface section, and the Sessions page renders no `dashboardName` field |
| F6 | R5 watchdog stays | regression guard (D2) | L1 | automated | Server page, then Gateway page | both render | the `tunnel.watchdog.*` fields render on **Server**; the Gateway page renders none of them |
| F7 | R5 gated indent | DOM-nesting | L1 | automated | Server page | page renders | the `shutdownIdleSeconds` control's nearest indent-wrapper ancestor is a descendant of the group headed by the `autoShutdown` toggle, and `autoShutdown` itself is not inside that wrapper |
| F8 | R6 reasoning indent | DOM-nesting | L1 | automated | General page | chat-display renders | `reasoningAutoCollapseMs` and `keepReasoningOpenUntilTurnEnds` sit inside the indent wrapper gated by the reasoning toggle |
| F9 | R5 OpenSpec indent | DOM-nesting | L1 | automated | OpenSpec page | page renders | the four polling knobs sit inside the indent wrapper gated by the enable-polling toggle |
| F10 | R5 + D9 disabled hint | state-transition | L1 | automated | Server page with `autoShutdown` off | page renders | the `shutdownIdleSeconds` hint is inside the element carrying the disabled `opacity-50` treatment (the hint dims with its control rather than staying full opacity) |
| F11 | R5 visual sweep | visual/subjective | — | manual-only | every settings page, dark + light, at 375 / 768 / 1440 | a human looks | [judgment: no overflow, hints legible, dependents read as visibly nested — no automatable observable] |
| F12 | R6 single section | page-composition | L1 | automated | all settings pages | panel renders | exactly one chat-display section exists and it is on General; the Developer page renders no chat-display section |
| F13 | R6 one draft source | decision-table (1 / 2 / 3 sub-sections edited) | L1 | automated | General page | user edits a control in one, then two, then all three chat-display sub-sections | in every case exactly one draft source reports dirty and the Save Bar shows a **single** General chip, never one chip per sub-section |
| F14 | R4 single control | count invariant | L1 | automated | every settings page rendered in turn | panel renders | exactly one control for `displayPrefs.debugTools` exists across the whole panel |
| F15 | R4 + D7 buffered commit | state-transition (regression guard) | L1 | automated | General page, `fetch` observed | user toggles the debug-events control | **no** immediate `PATCH /api/preferences/display` is issued; the General page is marked dirty; the value persists only when Save is pressed |
| F16 | R4 persistence convergence | state-convergence | L3 | automated | harness dashboard at `dashboardPort`, Settings ▸ General | toggle debug events, reload **without** saving; then toggle, Save, reload | after the unsaved reload the control shows the original value; after the saved reload it shows the new value |
| F17 | R5 chip attribution | page-attribution | L1 | automated | General page | user edits `dashboardName` | the Save Bar shows a dirty chip for **General** and none for Sessions |
| F18 | R5 chip attribution (top-level key) | page-attribution | L1 | automated | Server page | user edits a `tunnel.watchdog.*` field | the Save Bar shows a dirty chip for **Server** — confirming `partial.tunnel` is attributed by top-level key, the fact that killed the Gateway move |
| F19 | R5 leave guard | state-transition | L1 | automated | General page with `dashboardName` edited and unsaved | user attempts to navigate away from the settings panel | the leave guard fires (panel-global `isDirty` still sees the relocated key) |
| F20 | R1 wrapper threading (D6) | composition | L1 | automated | `WorktreeAutoInitToggle` and `AutoNameSessionsToggle` each rendered with a non-null `hint` | both render | the hint renders inside the wrapper's inner `ToggleField` and is wired via `aria-describedby`; no orphaned description remains at the outer call site |
| F21 | R1 copy quality | reviewer judgment | — | manual-only | the 44 newly authored descriptions and every `hint={null}` site | a human reads the diff | [judgment: each hint adds information beyond the label, and `null` is used only for terms of art from an external spec — D1 rejects mechanical enforcement] |
| F22 | R4 + D7 disclosure | doc check | — | manual-only | the change summary / release note | a human reads it | [judgment: the persistence-timing change for former Developer-toggle users is stated explicitly, not smuggled] |
| F23 | R1 end-to-end a11y | ARIA snapshot | L3 | automated | harness dashboard at `dashboardPort`, each settings page visited in turn | pages render in a real browser | every control rendered by the four shared components exposes a non-empty accessible name, and every control showing a visible hint exposes a matching accessible description |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R5 save failure | fault-injection (abort) | L1 | automated | `PUT /api/config` returns 500 | user edits `dashboardName` and presses Save | an error is surfaced, the panel stays dirty, and the dirty chip still reads **General** — no false-clean state |
| X2 | R5 save stall | fault-injection (delay) | L1 | automated | `PUT /api/config` stalls beyond the click | user presses Save, then presses it again | the Save control is disabled while in flight and exactly one request is issued — no double submit |
| X3 | R4 + D7 draft save failure | fault-injection (abort) | L1 | automated | the `display-prefs` save leg fails | user toggles debug events and presses Save | the toggle does not silently revert to a false-clean state — the preference stays dirty and an error is surfaced (the buffered path must not lose a value the old instant-apply path would have written) |

---

## Coverage summary

- Requirements covered: **6/6** (R1 field contract · R2 bespoke validation · R3 defaultModel placement · R4 single display-pref control · R5 panel composition + attribution · R6 chat-display section)
- Scenarios by class: edge **14** · perf **0** (out of scope, C2) · frontend **23** · error **3**
- Scenarios by level: L1 **35** · L2 **0** · L3 **2** · manual-only **3**
- Scenarios by disposition: automated **37** · manual-only **3**

No L2 rows: this change touches no install, spawn, or multi-OS runtime path, so routing anything to `qa/tests/*.sh` would violate the rendered-UI boundary.

## New infra needed

None. L1 rows extend the existing `packages/client/src/components/__tests__/SettingsPanel.test.tsx` (vitest + jsdom, already configured in `packages/client/vitest.config.ts`); L3 rows follow `tests/e2e/plugin-settings-pages.spec.ts` against the docker harness. E7 needs only a `@ts-expect-error` block compiled by the existing `tsc --noEmit` in `npm run quality:changed`.
