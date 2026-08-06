## ADDED Requirements

### Requirement: Shared settings field components carry an accessible name and description

The four shared settings field components in `SettingsPanel.tsx` (`ToggleField`, `SelectField`, `NumberField`, `TextField`) SHALL each:

- associate their `<label>` with their control via `htmlFor`/`id` using generated ids, so the control has an accessible name;
- accept a **required** `hint` prop of type `React.ReactNode`, render it below the control row when non-null, and reference it from the control via `aria-describedby`;
- accept an optional `unit` string, rendered inside the `<label>` element so it forms part of the accessible name.

A `hint` of `null` SHALL be permitted and SHALL suppress both the hint element and the `aria-describedby` attribute. `null` is reserved for controls whose label is a term of art from an external specification (for example OAuth `Client ID`, `Client Secret`, `Issuer URL`).

Because `hint` is required, a call site that omits it SHALL fail type-checking. No separate allowlist file or source-scanning test is used.

This requirement is scoped to those four components. Bespoke controls rendered inline in `SettingsPanel.tsx`, field components belonging to sibling sections (`RetrySettingsSection`, `ModelProxySection`, `ToolsSection`, `DiagnosticsSection`), and plugin-contributed sections are OUT of scope.

#### Scenario: Control has an accessible name from its label
- **WHEN** a `NumberField` is rendered with label `Session register timeout`
- **THEN** the control's accessible name SHALL be `Session register timeout`

#### Scenario: Unit is part of the accessible name
- **WHEN** a `NumberField` is rendered with `unit="ms"`
- **THEN** the unit SHALL appear inside the label element and form part of the control's accessible name
- **AND** the label text SHALL NOT contain a parenthetical `(ms)`

#### Scenario: Hint becomes the accessible description
- **WHEN** a `ToggleField` is rendered with a non-null `hint`
- **THEN** the hint SHALL be visible below the control row
- **AND** the control's `aria-describedby` SHALL resolve to the element containing that hint

#### Scenario: Null hint suppresses the description
- **WHEN** a field is rendered with `hint={null}`
- **THEN** no hint element SHALL render
- **AND** the control SHALL NOT carry an `aria-describedby` attribute

#### Scenario: Omitting the prop fails the build
- **WHEN** a call site of one of the four components omits the `hint` prop
- **THEN** type-checking SHALL fail

### Requirement: Bespoke settings controls keep their validation

A control rendered inline in `SettingsPanel.tsx` rather than through one of the four shared components SHALL NOT be replaced by a shared component as part of a presentation or copy change. Specifically, the `spawnRegisterTimeoutMs` control SHALL retain its bounds check that blocks out-of-range writes and disables the Save button.

#### Scenario: Out-of-range spawn timeout still blocks Save
- **WHEN** the user enters a `spawnRegisterTimeoutMs` value below 5000 or above 120000
- **THEN** the value SHALL NOT be written to the pending config
- **AND** an inline error SHALL render
- **AND** the Save control SHALL be disabled

### Requirement: Default model is the first control on the Sessions page

The Sessions page SHALL render the `defaultModel` control as the first control on the page, inside a callout styled with `--severity-info-*` tokens. The callout SHALL carry a description stating that the default model applies only to brand-new sessions and that a resumed session keeps the model it was started with.

#### Scenario: Default model renders first
- **WHEN** the Sessions page is rendered
- **THEN** the `defaultModel` control SHALL precede every other control on the page in DOM order

#### Scenario: Brand-new-only caveat is surfaced
- **WHEN** the `defaultModel` callout is rendered
- **THEN** its description SHALL state that the setting applies only to brand-new sessions

### Requirement: One control per display preference

Each `displayPrefs` field SHALL have exactly one control across the entire settings panel, committed through the `display-prefs` draft source. No settings page SHALL render a second control for a field already owned by `DisplayPrefsSection`.

#### Scenario: Debug events has a single control
- **WHEN** the settings panel is rendered across all pages
- **THEN** exactly one control for `displayPrefs.debugTools` SHALL exist

#### Scenario: Debug events commits through the draft source
- **WHEN** the user toggles the debug-events control
- **THEN** the change SHALL be buffered and SHALL mark the General page dirty
- **AND** it SHALL persist only on Save, not on toggle

## MODIFIED Requirements

### Requirement: Settings panel view
The settings panel SHALL render as a full-page view in the main content area when the route matches `/settings/:page?`. It SHALL display a fixed header (back button, title, Restart button), a navigation listing pages grouped by concern, and a content area for the active page. The header SHALL remain visible at all times regardless of scroll position. A single `SettingsPanel` instance SHALL remain mounted across page changes so unsaved edits on any page persist until Save. Persistence SHALL be driven by a dirty-gated **Save Bar** (see "Settings Save Bar"), not by a header Save button.

The navigation + content layout SHALL be responsive. The wrapper element containing the nav and the content area SHALL stack vertically on narrow (mobile) viewports and arrange side-by-side on wide (desktop, `md` breakpoint and up) viewports. On mobile the navigation SHALL render as a full-width horizontal, horizontally-scrollable tab strip positioned above the content, and the content area SHALL fill the remaining space below it with a non-zero width. On desktop the navigation SHALL render as a fixed-width vertical rail to the left of the content. At no viewport width SHALL the content area collapse to zero width or be positioned outside the visible viewport.

The panel SHALL provide these pages (nav groups in brackets):
- **General** [Dashboard]: Interface language, `dashboardName`, display preferences
- **Server** [Dashboard]: `port`, `piPort`, `autoShutdown`, `shutdownIdleSeconds`, `tunnel.enabled`, `tunnel.watchdog.*`, memory limits (`memoryLimits.*`)
- **Sessions** [Dashboard]: `defaultModel`, `spawnStrategy`, reattach/ordering, `askUserPromptTimeoutSeconds`, `spawnRegisterTimeoutMs`, `gitWorktreeEnabled`, retry policy
- **Remote Servers** [Network]: known servers, network discovery
- **Gateway** [Network]: tunnel provider and mode (self-managed save)
- **Security** [Network]: `auth.providers`, `auth.allowedUsers`, `auth.bypassUrls`, `auth.bypassHosts` (Trusted Networks)
- **Providers** [Extensions]: Provider Authentication, LLM Providers, API Proxy
- **Packages** [Extensions]: installed pi packages
- **Plugins** [Extensions]: plugin activation index and per-plugin settings pages
- **OpenSpec** [Extensions]: background polling tuning
- **Developer** [Advanced]: `devBuildOnReload`, `keeperLog.capturePiOutput`, diagnostics, tools, spawn failures, canvas types

Within a page, controls SHALL be grouped into sections by concern, and a control whose effect is gated by another control on the same page SHALL be rendered indented beneath its gating control.

A config key's Save Bar page attribution is resolved from `CONFIG_FIELD_PAGE` by **top-level** key. A field SHALL NOT be rendered on a page other than the one its top-level key maps to, because the dirty-page chip would then name the wrong page.

#### Scenario: Sessions page sections
- **WHEN** the Sessions page is rendered
- **THEN** its sections SHALL be, in order: new-session defaults, session-list ordering, lifecycle and recovery, worktrees, retry

#### Scenario: PWA display name lives on General
- **WHEN** the General page is rendered
- **THEN** the `dashboardName` field SHALL appear in the Interface section
- **AND** the Sessions page SHALL NOT render a `dashboardName` field

#### Scenario: PWA display name lights the General chip
- **WHEN** the user edits `dashboardName`
- **THEN** the Save Bar SHALL show a dirty chip for **General**
- **AND** SHALL NOT show one for Sessions

#### Scenario: Watchdog stays on Server
- **WHEN** the Server page is rendered
- **THEN** the `tunnel.watchdog.*` fields SHALL appear there, because `tunnel` is a single top-level key attributed to the Server page

#### Scenario: Dependent control is indented
- **WHEN** the Server page renders `shutdownIdleSeconds`
- **THEN** it SHALL be rendered indented beneath the `autoShutdown` toggle that gates it

### Requirement: Chat display preferences are a single section on General

Chat-display preferences SHALL be rendered on the **General** page only, split into three sub-sections: message-level elements, reasoning, and tool calls, all registering a single `display-prefs` draft source. The reasoning auto-collapse and keep-open controls SHALL be indented beneath the reasoning toggle that gates them.

The Developer page SHALL NOT render a chat-display section.

#### Scenario: One chat-display section exists
- **WHEN** the settings panel is rendered
- **THEN** exactly one section governing chat-display preferences SHALL exist, and it SHALL be on the General page

#### Scenario: Split sections share one draft source
- **WHEN** any chat-display control is edited
- **THEN** exactly one draft source (`display-prefs`) SHALL report dirty
- **AND** the Save Bar SHALL show a single General chip, not one per sub-section

#### Scenario: Reasoning dependents are nested
- **WHEN** the reasoning sub-section is rendered
- **THEN** the auto-collapse and keep-open controls SHALL be indented beneath the reasoning toggle
