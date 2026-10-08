## ADDED Requirements

### Requirement: `folder-settings-section` slot
The plugin runtime SHALL provide a `folder-settings-section` slot whose claim component receives `{ pluginContext, cwd }`, where `cwd` is the folder whose settings are open. The slot id SHALL be declared in `packages/shared/src/dashboard-plugin/slot-types.ts`, its props in `slot-props.ts`, and accepted by `manifest-validator.ts`. A claim SHALL carry a `label` used as the nav entry.

#### Scenario: Claim receives the folder
- **WHEN** a plugin's `folder-settings-section` claim renders for `/folder/<encodedCwd>/settings/plugins/<pluginId>`
- **THEN** its component receives `cwd` equal to the decoded folder path and the plugin's `pluginContext`

#### Scenario: Claim without a label is rejected
- **WHEN** a manifest declares a `folder-settings-section` claim without a `label`
- **THEN** the manifest validator rejects the claim

### Requirement: Folder settings nav lists plugin sections
`DirectorySettings` SHALL show a **Plugins** nav group listing one entry per enabled plugin that claims `folder-settings-section`, in the order of their claims' labels, and SHALL omit the group entirely when no enabled plugin claims the slot. The entry SHALL route to `/folder/<encodedCwd>/settings/plugins/<pluginId>`.

#### Scenario: Group appears only with claims
- **WHEN** no enabled plugin claims `folder-settings-section`
- **THEN** the folder settings nav shows no Plugins group, and is otherwise unchanged

#### Scenario: Disabled plugin's section is hidden
- **WHEN** a plugin that claims `folder-settings-section` is disabled
- **THEN** its entry is removed from the nav and its route applies the invalid-page fallback

#### Scenario: Deep link survives reload
- **WHEN** the user hard-reloads on `/folder/<encodedCwd>/settings/plugins/voice-assistant`
- **THEN** the voice-assistant folder section renders for that folder

### Requirement: Folder sections are isolated per plugin
The host SHALL render each `folder-settings-section` claim inside the plugin slot error boundary, and SHALL NOT give a claim any folder other than the route's `cwd`.

#### Scenario: Crashing section does not break folder settings
- **WHEN** a plugin's folder section throws during render
- **THEN** the error boundary shows its fallback and the rest of folder settings keeps working
