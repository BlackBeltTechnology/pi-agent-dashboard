## Why

Two problems on the Settings panel, found by auditing every field call site.

**1. Only 8 of 52 shared-component fields (15%) carry a description.** The cause is mechanical, not cultural: a description today is a hand-rolled sibling element at the call site —

```tsx
<ToggleField label={…} value={…} onChange={…} />
<p className="mt-1 text-xs text-[var(--text-tertiary)]">…</p>   // optional, easy to omit
```

— so `ToggleField` / `SelectField` / `NumberField` / `TextField` (`SettingsPanel.tsx:2272–2406`) have no notion that descriptions exist. Every new setting starts undocumented and stays that way unless the author remembers. Worst pages: **General 0/17**, **OpenSpec 1/5**, **Server 3/12**. A user meeting `Max String Truncation (chars)` or `Reserve process line at idle` has to read source to learn what it does.

Worse, the label is not programmatically associated with its control either — none of the four components emit `htmlFor`/`id` (the only `htmlFor` in the whole file is the listen-interface radio group, `:2224`). So today's controls have **no accessible name and no accessible description**; the sibling `<p>` is unassociated text a screen-reader user meets after leaving the control, with no cue it belongs to it.

**2. Fields are ordered by accretion, not by concern.**
- **Sessions**: `defaultModel` — the setting that decides what every new session *is* — sits at position **12 of 13**, below a Windows-only git-path picker. The page's 13 controls interleave four unrelated concerns with no grouping.
- **General ▸ "Chat display"** and **Developer ▸ "Chat Display"** are two sections whose titles differ only in casing. Both surface `displayPrefs.debugTools` — see the duplicate-control defect below.
- `General ▸ Interface` holds exactly one field (Language) above a wall of 16 flat toggles that include a 3-field dependency chain (`reasoning → auto-collapse → keep-open`) rendered as siblings.
- `dashboardName` ("PWA Display Name") lives on **Sessions** but sets the installed web-app's home-screen label.
- Units and ranges are baked into labels (`Poll Interval (seconds, 5–3600)`, `Max String Truncation (chars)`).

**3. `debugTools` has two live controls with divergent persistence.** `DisplayPrefsSection` renders a "Debug events" toggle (`:1865`) writing through the buffered `display-prefs` draft source. `DebugToolsToggle` (`:1720`) renders a second toggle for the **same** field via the `@deprecated` `useDebugToolsVisible` hook, which PATCHes **immediately**, outside the Save Bar. Editing one does not reflect in the other until reload.

Mockup with a Before/After switch and a computed coverage badge: `mockups/sessions-settings-reorg/index.html`.

## What Changes

### Structural: descriptions and label association become a field-component concern

- Add a **required** `hint: React.ReactNode` and an optional `unit?: string` to `ToggleField`, `SelectField`, `NumberField`, `TextField`.
- Add `htmlFor`/`id` label association (via `useId()`) so the control finally has an accessible **name**, and wire `hint` as its accessible **description** via `aria-describedby`.
- `unit` renders as a chip inside the `<label>`, making it part of the accessible name.
- Migrate the 8 existing hand-rolled field hints to the prop. The 9 `mb-2`/`mb-3` **section intros** stay as section intros — they describe a section, not a field.
- Author descriptions for the remaining 44 sites; sites where a description could only restate the label pass an explicit `hint={null}`.
- Restructure the field root from `flex items-center justify-between` to a wrapper so the hint can sit below the control row.

### Sessions page

- Regroup into **New session defaults** / **Session list** / **Lifecycle & recovery** / **Worktrees** / **Retry**.
- `defaultModel` moves to **position 1** in a callout (`--severity-info-*` tokens) carrying the caveat the bridge spec already enforces: the default model applies **only to brand-new sessions**; a resumed session keeps its own.
- `dashboardName` moves to **General ▸ Interface**. It is a top-level config key with its own `CONFIG_FIELD_PAGE` entry, so the Save Bar chip follows it cleanly.

### General page

- `Chat display` splits into **message elements** / **reasoning** / **tool calls**, keeping its single `display-prefs` draft-source registration.
- The reasoning dependents indent under the reasoning toggle.
- **Delete the deprecated `DebugToolsToggle` and its Developer-page section.** `DisplayPrefsSection` already owns `debugTools`; this removes a duplicate control, not a section's only control.

### Server + OpenSpec pages

- Rename Server sections → **Ports** / **Idle shutdown** / **Memory limits**; nest `shutdownIdleSeconds` under `autoShutdown`.
- Units out of labels into chips; ranges into descriptions; the four OpenSpec polling knobs indent under the enable toggle.

### Explicitly dropped from this change

- **The `tunnel.watchdog.*` move to the Gateway page.** `computeConfigPartial` (`:214–224`) emits `partial.tunnel` as one top-level key, and `dirtyPages` (`:546–556`) attributes chips per top-level key with no nested resolution. Watchdog edits would light the **Server** chip wherever the JSX renders. Attributing them to Gateway needs a different PUT payload shape (violates C1) — and `GatewayPage` self-manages its own `PUT /api/config` rather than registering a draft source, so hosting Save-Bar-driven fields there would put two save paradigms on one page. Out of scope; filed as a follow-up.

### Non-goals

- No config-schema change, no key renames, no change to any setting's effect, defaults, or persisted values.
- **Bespoke controls stay bespoke.** 12 hand-rolled `<input>`/`<select>`/`<textarea>` in `SettingsPanel.tsx` do not gain the prop — notably `spawnRegisterTimeoutMs` (`:1216`), whose range check *disables the Save button* (`:1615`); converting it to the shared `NumberField` (`parseInt(…) || 0`, no bounds) would silently delete an enforced constraint. These get label/unit cleanup only.
- **Sibling first-party sections are out of scope** — `RetrySettingsSection`, `ModelProxySection`, `ToolsSection`, `DiagnosticsSection` carry their own field components (the shared four are module-local, not exported). Follow-up.
- Plugin-contributed sections render through the `settings-section` slot and are unreachable from here.
- Toggle hit area (38×21px) unchanged — clears WCAG 2.2 AA at 24×24.

## Capabilities

### Modified Capabilities
- `settings-panel`: field-level name+description contract for the four shared components; page→section→field composition for General / Server / Sessions / OpenSpec; `dashboardName` page reassignment; removal of the duplicate `debugTools` control.

## Discipline Skills

- `review-code` — a mechanical diff across 52 call sites wants a review pass before it stands.
- `code-simplification` — the props exist to *delete* repeated markup; if the call sites grow, the abstraction is wrong.
- `doubt-driven-review` — already run; it killed the watchdog move and the `NumberField` conversion. Re-run if scope reopens.
- `security-hardening` — not triggered (no auth/untrusted-input/secrets path).

## Impact

- **Code**: `SettingsPanel.tsx` — field components (`:2272–2406`), `CONFIG_FIELD_PAGE` (`:161–172`), the General/Server/Sessions/OpenSpec/Developer JSX, `DisplayPrefsSection` (`:1795`), `DebugToolsToggle` (`:1720`, deleted), the two wrapper toggles `WorktreeAutoInitToggle` (`:1735`) / `AutoNameSessionsToggle` (`:1767`) which need `hint` threaded through.
- **Deleted**: `DebugToolsToggle`; `useDebugToolsVisible`'s toggle consumer (the hook itself stays — `DEBUG_TOOL_NAMES` has other readers).
- **i18n**: ~44 new description strings, plus **existing** unit-bearing keys whose zh-CN/hu translations embed the unit (`settings.probeInterval`, `settings.pollIntervalSeconds53600`, `settings.jitterSeconds060`, `session.maxConcurrentSessions116`, `session.askUserPromptTimeoutSeconds`) — stripping the unit from the English fallback alone would leave those locales showing the unit twice.
- **Tests**: `SettingsPanel.test.tsx` asserts page attribution (`:236–242`) and uses `getByText(…).closest("div")` + `within(row)` (`:577–580`); the indent wrappers and page moves can shift both.
- **Persistence / protocol**: unchanged.
