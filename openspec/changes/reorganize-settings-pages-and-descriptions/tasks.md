# Tasks

Order follows the design's Migration Plan: the field contract lands first, then
the wrapper threading, then the copy, then the structural moves — so the prop
migration stays separable in review.

All line references are `packages/client/src/components/settings/SettingsPanel.tsx`
unless stated otherwise.

## 1. Field-component name + description contract (D1, D4, D5)

- [x] 1.1 Add label association to `NumberField` (`:2272`), `ToggleField` (`:2287`), `SelectField` (`:2302`), `TextField` (`:2372`): generate ids with `useId()`, set `htmlFor` on the `<label>` and `id` on the control, so each control gains an accessible name.
- [x] 1.2 Add a **required** `hint: React.ReactNode` prop to all four components. Render it below the control row when non-null; wire `aria-describedby` to the hint element. `hint={null}` suppresses both the element and the attribute. Do NOT make it optional — the compiler is the gate (D1); do NOT add an allowlist file or a source-scanning test (explicitly rejected in D1).
- [x] 1.3 Add an optional `unit?: string` prop rendered as a chip **inside** the `<label>`, so the unit forms part of the accessible name (D5).
- [x] 1.4 Restructure the field root from `flex items-center justify-between` to a wrapper that keeps the control row intact and places the hint beneath it. Touches all four components' markup.
- [x] 1.5 Migrate the **8** existing hand-rolled field hints to the prop, deleting the sibling `<p>` in the **same** commit as the prop addition (`:1154/1164`, `:1169/1179`, `:1184/1189`, `:1194/1199`, `:1204/1209`, `:1240/1245`, `:1266/1276`, `:1555/1560`). Step-order regression: landing `hint={null}` everywhere first would orphan these 8 hints in their old position.
- [x] 1.6 Give the remaining **44** shared-component sites a transient `hint={null}` so the tree type-checks; §3 replaces them with real copy.
- [x] 1.7 Leave the **9** `mb-2`/`mb-3` section intros (`:1027`, `:1113`, `:1332`, `:1411`, `:1477`, `:1488`, `:1547`, `:1838`, `:2041`) as section intros — they describe a section, not a field.

## 2. Thread `hint` through the two wrapper toggles (D6)

- [x] 2.1 Give `WorktreeAutoInitToggle` (`:1735`) a `hint` prop and forward it to its inner `ToggleField`; move the description currently sitting at the outer call site (`:1268`) into it.
- [x] 2.2 Give `AutoNameSessionsToggle` (`:1767`) a `hint` prop and forward it; move its outer-site description (`:1276`, the dynamic git-source readout) into it. `hint` is `ReactNode` precisely so this stays possible.

## 3. Author the 44 missing descriptions + move units out of labels

- [x] 3.1 General — Language plus the chat-display toggles (copy drafted in `mockups/sessions-settings-reorg/index.html`).
- [x] 3.2 Server — `port`, `piPort`, `maxEventsPerSession`, `maxStringFieldSize`, `maxWsBufferBytes`.
- [x] 3.3 Server — the `tunnel.watchdog.*` fields, which stay on the Server page (D2).
- [x] 3.4 Sessions — `spawnStrategy`, `spawnRegisterTimeoutMs`, `defaultModel`.
- [x] 3.5 OpenSpec — poll interval, jitter, change detection, max concurrent spawns.
- [x] 3.6 For every label carrying a unit parenthetical, move the unit to `unit` and the range to the `hint` (e.g. `Poll Interval (seconds, 5–3600)` → label `Poll interval`, `unit="s"`, hint carrying `Range 5–3600`).
- [x] 3.7 Update the unit-bearing i18n keys in **all** dictionaries (en, zh-CN, hu) — `settings.probeInterval`, `settings.pollIntervalSeconds53600`, `settings.jitterSeconds060`, `session.maxConcurrentSessions116`, `session.askUserPromptTimeoutSeconds` — or introduce new keys and retire the old ones. Stripping the unit from the English fallback alone leaves zh-CN/hu rendering the unit twice (D5).
- [x] 3.8 Use `hint={null}` only where a description could merely restate the label — reserved for terms of art from an external spec (OAuth `Client ID`, `Client Secret`, `Issuer URL`).

## 4. Bespoke controls — label/unit cleanup only (D3)

- [ ] 4.1 Clean up label text and unit parentheticals in place for the 12 bespoke `<input>`/`<select>`/`<textarea>` controls. Do NOT convert any of them to a shared component.
- [x] 4.2 Leave `spawnRegisterTimeoutMs` (`:1216`) a bespoke control. Its `isNaN(v) || v < 5000 || v > 120000` check blocks the write and disables Save (`:1615`); the shared `NumberField` is `parseInt(…) || 0` with no bounds, so converting it would silently delete an enforced constraint.
- [x] 4.3 Keep the `+Session` prefix where it names the dashboard's `+Session` spawn button (`+Session Strategy`, `+Session register timeout`); drop it where it is noise (D10).

## 5. Sessions page regroup

- [x] 5.1 Split the single Sessions section into: **New session defaults** / **Session list** / **Lifecycle & recovery** / **Worktrees**. Retry stays last.
- [x] 5.2 Move `defaultModel` to position 1 in a callout styled with `--severity-info-*` tokens, carrying the caveat that the default applies only to brand-new sessions and a resumed session keeps its own model.
- [x] 5.3 Do NOT touch `RetrySettingsSection` — sibling first-party sections carry their own field components and are out of scope.

## 6. Page reassignment — `dashboardName` only

- [x] 6.1 Move `dashboardName` from Sessions to **General ▸ Interface**, updating its entry in `CONFIG_FIELD_PAGE` (`:161`) from `sessions` to `general`. The symbol is `CONFIG_FIELD_PAGE`, not `PAGE_OF_KEY` — the latter does not exist.
- [x] 6.2 Do NOT move `tunnel.watchdog.*` to the Gateway page. `computeConfigPartial` (`:214`) emits `partial.tunnel` as one top-level key and `dirtyPages` (`:549`) attributes per top-level key, so the edit would light the Server chip wherever the JSX renders; and `GatewayPage` self-manages its own PUT rather than registering a draft source (D2). Filed as a follow-up.

## 7. General page restructure (D7, D8)

- [x] 7.1 Split `DisplayPrefsSection` (`:1795`) visually into three sub-sections — message elements / reasoning / tool calls — preserving the **single** `useSettingsDraftSource({ id: "display-prefs", page: "general" })` registration (D8).
- [x] 7.2 Indent `reasoningAutoCollapseMs` and `keepReasoningOpenUntilTurnEnds` beneath the reasoning toggle that gates them.
- [x] 7.3 **Delete** `DebugToolsToggle` (`:1720`) and the Developer-page "Chat Display" section that hosts it (`:1550`). `DisplayPrefsSection` already owns `debugTools` through the buffered draft source; this removes a duplicate control, not a section's only control. Do NOT merge it into the tool-calls sub-section.
- [x] 7.4 Keep the `useDebugToolsVisible` hook itself — `DEBUG_TOOL_NAMES` / `isDebugTool` have other readers (`ChatView.tsx`). Only its toggle consumer is deleted.
- [ ] 7.5 State the user-visible consequence in the change summary: anyone who used the Developer toggle now gets Save-Bar-buffered persistence instead of instant-apply.

## 8. Server + OpenSpec restructure (D9)

- [x] 8.1 Rename the Server sections to **Ports** / **Idle shutdown** / **Memory limits**.
- [x] 8.2 Indent `shutdownIdleSeconds` beneath the `autoShutdown` toggle. Presentational only — no change to the existing `disabled` logic.
- [x] 8.3 Indent the four OpenSpec polling knobs beneath the `Enable OpenSpec polling` toggle. Presentational only.

## 9. Repair existing tests broken by the restructure

- [x] 9.1 `SettingsPanel.test.tsx:577–580` uses `getByText(…).closest("div")` then `within(row)`; the §1.4 indent wrapper changes which `div` resolves. Re-run and repair — do not assume green.
- [x] 9.2 Re-check the page-attribution assertions at `SettingsPanel.test.tsx:236–242` for the `dashboardName` move.

## 10. Automated tests — L1 (vitest + jsdom)

All rows in this section extend `packages/client/src/components/__tests__/SettingsPanel.test.tsx` — copy its harness glue (render wrapper, provider setup, fetch mocking) rather than inventing new setup. The settings directory has no `__tests__/` of its own.

- [x] 10.1 Hint renders and becomes the accessible description: a `ToggleField` with `hint="Buffered until Save"` and no `unit` · component renders · a hint element with that text renders below the control row and the control's `aria-describedby` resolves to exactly that element. See `SettingsPanel.test.tsx` (test-plan #E1).
- [x] 10.2 Null hint suppresses the description: a `ToggleField` with `hint={null}` · component renders · no hint element renders and the control carries no `aria-describedby` attribute. See `SettingsPanel.test.tsx` (test-plan #E2).
- [x] 10.3 Unit joins the accessible name: a `NumberField` with `label="Session register timeout"` and `unit="ms"` · component renders · the unit sits inside the `<label>`, the accessible name contains both the label and `ms`, and the label text contains no `(ms)` parenthetical. See `SettingsPanel.test.tsx` (test-plan #E3).
- [x] 10.4 All four components expose an accessible name: one each of `ToggleField`/`SelectField`/`NumberField`/`TextField` with `label="Probe"`, `hint={null}`, no `unit` · each renders · each control's accessible name is `Probe`, resolved via `htmlFor`/`id` rather than a placeholder or `aria-label`. See `SettingsPanel.test.tsx` (test-plan #E4).
- [x] 10.5 Generated ids do not collide: two `NumberField` instances with distinct non-null hints in one tree · both render · the controls have distinct `id`s and distinct `aria-describedby` values, each resolving to its own hint and not the sibling's. See `SettingsPanel.test.tsx` (test-plan #E5).
- [x] 10.6 ReactNode hint flattens into the description: a `NumberField` whose `hint` is JSX containing `<code>-1</code>` plus an interpolated value · component renders · the accessible description is the flattened text including the `<code>` content. See `SettingsPanel.test.tsx` (test-plan #E6).
- [x] 10.7 Omitting `hint` fails type-checking: `@ts-expect-error`-annotated call sites of all four components omitting `hint` · `tsc --noEmit` as run by `npm run quality:changed` · each omission raises a type error so the annotations are satisfied and `tsc --noEmit` exits 0, while deleting an annotation makes it exit non-zero. See `SettingsPanel.test.tsx` (test-plan #E7).
- [x] 10.8 Spawn timeout below minimum: Sessions page with `spawnRegisterTimeoutMs` at 30000 · user enters `4999` · the value is not written to the pending config, the inline error `Must be an integer between 5000 and 120000.` renders, and `[data-testid="save-btn"]` is disabled. See `SettingsPanel.test.tsx` (test-plan #E8).
- [x] 10.9 Spawn timeout at minimum: same setup · user enters `5000` · the value is written to the pending config, no inline error renders, and `save-btn` is enabled. See `SettingsPanel.test.tsx` (test-plan #E9).
- [x] 10.10 Spawn timeout at maximum: same setup · user enters `120000` · the value is written, no inline error, `save-btn` enabled. See `SettingsPanel.test.tsx` (test-plan #E10).
- [x] 10.11 Spawn timeout above maximum: same setup · user enters `120001` · not written, inline error renders, `save-btn` disabled. See `SettingsPanel.test.tsx` (test-plan #E11).
- [x] 10.12 Spawn timeout non-numeric: same setup · user enters `abc` parsing to `NaN` · not written, inline error renders, `save-btn` disabled. See `SettingsPanel.test.tsx` (test-plan #E12).
- [x] 10.13 Invalid spawn timeout is not sticky: field already invalid from the below-minimum case · user corrects the value to `30000` · the inline error disappears and `save-btn` becomes enabled again. See `SettingsPanel.test.tsx` (test-plan #E13).
- [x] 10.14 No locale renders a doubled unit: language set to `en`, `zh-CN`, then `hu` for each of `settings.probeInterval`, `settings.pollIntervalSeconds53600`, `settings.jitterSeconds060`, `session.maxConcurrentSessions116`, `session.askUserPromptTimeoutSeconds` · the owning field renders · in every locale the label text contains the unit token zero times and the unit appears exactly once, inside the `unit` chip. See `SettingsPanel.test.tsx` (test-plan #E14).
- [x] 10.15 Default model renders first: Sessions page · page renders · the `defaultModel` control precedes every other control on the page in DOM order, including the Retry section's. See `SettingsPanel.test.tsx` (test-plan #F1).
- [x] 10.16 Brand-new-only caveat is surfaced: Sessions page · the `defaultModel` callout renders · its description states the setting applies only to brand-new sessions and that a resumed session keeps its own model. See `SettingsPanel.test.tsx` (test-plan #F2).
- [x] 10.17 Callout uses severity tokens: Sessions page · the `defaultModel` callout renders · the callout element's class list references a `--severity-info-*` token rather than a raw Tailwind severity colour. See `SettingsPanel.test.tsx` (test-plan #F3).
- [x] 10.18 Sessions section order: Sessions page · page renders · section headings appear in order new-session defaults, session list, lifecycle & recovery, worktrees, retry. See `SettingsPanel.test.tsx` (test-plan #F4).
- [x] 10.19 `dashboardName` lives on General: General page then Sessions page · both render · `dashboardName` renders inside General ▸ Interface and the Sessions page renders no `dashboardName` field. See `SettingsPanel.test.tsx` (test-plan #F5).
- [x] 10.20 Watchdog stays on Server: Server page then Gateway page · both render · the `tunnel.watchdog.*` fields render on Server and the Gateway page renders none of them. See `SettingsPanel.test.tsx` (test-plan #F6).
- [x] 10.21 Idle-shutdown control is nested: Server page · page renders · the `shutdownIdleSeconds` control's nearest indent-wrapper ancestor is a descendant of the group headed by the `autoShutdown` toggle, and `autoShutdown` is not itself inside that wrapper. See `SettingsPanel.test.tsx` (test-plan #F7).
- [x] 10.22 Reasoning dependents are nested: General page · chat-display renders · `reasoningAutoCollapseMs` and `keepReasoningOpenUntilTurnEnds` sit inside the indent wrapper gated by the reasoning toggle. See `SettingsPanel.test.tsx` (test-plan #F8).
- [x] 10.23 OpenSpec knobs are nested: OpenSpec page · page renders · the four polling knobs sit inside the indent wrapper gated by the enable-polling toggle. See `SettingsPanel.test.tsx` (test-plan #F9).
- [x] 10.24 Disabled control dims its hint: Server page with `autoShutdown` off · page renders · the `shutdownIdleSeconds` hint is inside the element carrying the disabled `opacity-50` treatment. See `SettingsPanel.test.tsx` (test-plan #F10).
- [x] 10.25 One chat-display section, on General: all settings pages · panel renders · exactly one chat-display section exists, it is on General, and the Developer page renders none. See `SettingsPanel.test.tsx` (test-plan #F12).
- [x] 10.26 Split sub-sections share one draft source: General page · user edits a control in one, then two, then all three chat-display sub-sections · in every case exactly one draft source reports dirty and the Save Bar shows a single General chip, never one per sub-section. See `SettingsPanel.test.tsx` (test-plan #F13).
- [x] 10.27 Exactly one debug-events control: every settings page rendered in turn · panel renders · exactly one control for `displayPrefs.debugTools` exists across the whole panel. See `SettingsPanel.test.tsx` (test-plan #F14).
- [x] 10.28 Debug events commits through the draft source: General page with `fetch` observed · user toggles the debug-events control · no immediate `PATCH /api/preferences/display` is issued, the General page is marked dirty, and the value persists only on Save. See `SettingsPanel.test.tsx` (test-plan #F15).
- [x] 10.29 `dashboardName` lights the General chip: General page · user edits `dashboardName` · the Save Bar shows a dirty chip for General and none for Sessions. See `SettingsPanel.test.tsx` (test-plan #F17).
- [x] 10.30 Watchdog edit lights the Server chip: Server page · user edits a `tunnel.watchdog.*` field · the Save Bar shows a dirty chip for Server, confirming `partial.tunnel` is attributed by top-level key. See `SettingsPanel.test.tsx` (test-plan #F18).
- [x] 10.31 Leave guard survives the page move: General page with `dashboardName` edited and unsaved · user attempts to navigate away from the settings panel · the leave guard fires. See `SettingsPanel.test.tsx` (test-plan #F19).
- [x] 10.32 Wrapper toggles forward their hint: `WorktreeAutoInitToggle` and `AutoNameSessionsToggle` each rendered with a non-null `hint` · both render · the hint renders inside the wrapper's inner `ToggleField` wired via `aria-describedby`, with no orphaned description left at the outer call site. See `SettingsPanel.test.tsx` (test-plan #F20).
- [x] 10.33 Save failure keeps the panel dirty: `PUT /api/config` returns 500 · user edits `dashboardName` and presses Save · an error is surfaced, the panel stays dirty, and the dirty chip still reads General. See `SettingsPanel.test.tsx` (test-plan #X1).
- [x] 10.34 Stalled save cannot double-submit: `PUT /api/config` stalls beyond the click · user presses Save then presses it again · the Save control is disabled while in flight and exactly one request is issued. See `SettingsPanel.test.tsx` (test-plan #X2).
- [x] 10.35 Failed draft save does not silently drop the preference: the `display-prefs` save leg fails · user toggles debug events and presses Save · the preference stays dirty and an error is surfaced rather than reverting to a false-clean state. See `SettingsPanel.test.tsx` (test-plan #X3).

## 11. Automated tests — L3 (Playwright vs the docker harness)

Both rows follow `tests/e2e/plugin-settings-pages.spec.ts`. Read the dashboard port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.

- [x] 11.1 Debug-events persistence converges: harness dashboard at `dashboardPort`, Settings ▸ General · toggle debug events and reload without saving, then toggle, Save, and reload · after the unsaved reload the control shows the original value, and after the saved reload it shows the new value. See `tests/e2e/plugin-settings-pages.spec.ts` (test-plan #F16).
- [x] 11.2 Every shared field is named and described in a real browser: harness dashboard at `dashboardPort`, each settings page visited in turn · pages render · every control from the four shared components exposes a non-empty accessible name, and every control with a visible hint exposes a matching accessible description. See `tests/e2e/plugin-settings-pages.spec.ts` (test-plan #F23).

## 12. Manual verification (deferred post-merge)

- [ ] 12.1 Visual sweep of every settings page in dark and light at 375 / 768 / 1440: no overflow, hints legible, dependents visibly nested (test-plan: manual-only).
- [ ] 12.2 Review the 44 authored descriptions and every `hint={null}` site: each hint adds information beyond its label, and `null` appears only for terms of art from an external specification (test-plan: manual-only).
- [ ] 12.3 Confirm the change summary states the persistence-timing change for anyone who used the deleted Developer debug-events toggle (test-plan: manual-only).

## 13. Verification

- [x] 13.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` — green.
- [x] 13.2 `npx tsc --noEmit` — green, confirming no call site omits `hint`.
- [x] 13.3 `npm run quality:changed` — clean.
- [ ] 13.4 Update `packages/client/src/components/settings/AGENTS.md` purpose rows.
