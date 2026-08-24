# specs-browser Specification

## Purpose

Lets the user read the project's main specs from the dashboard: all specs concatenated into one view, a combobox for jump-to navigation by spec name, and the `useMainSpecsReader` hook that fetches and concatenates them.

## Requirements

### Requirement: Specs browser view displays all main specs concatenated
The dashboard SHALL provide a `SpecsBrowserView` component that fetches all directories from `openspec/specs/`, reads each `{specName}/spec.md` file in parallel, and displays them concatenated in the content area. Each spec SHALL be preceded by a heading containing the spec directory name and separated visually from the next spec.

#### Scenario: All specs fetched and displayed
- **WHEN** the user opens the specs browser for cwd `/project/foo` which has specs `["auth", "billing", "chat"]`
- **THEN** the view SHALL show three sections: `# auth` followed by its spec.md content, `# billing` followed by its content, `# chat` followed by its content

#### Scenario: Specs sorted alphabetically
- **WHEN** the specs directory contains `["chat", "auth", "billing"]`
- **THEN** the sections SHALL appear in order: auth, billing, chat

#### Scenario: Spec fetch failure is graceful
- **WHEN** the spec `billing/spec.md` fails to fetch but `auth/spec.md` and `chat/spec.md` succeed
- **THEN** the view SHALL display the successful specs and skip the failed one

#### Scenario: Loading state while fetching
- **WHEN** the specs browser is opened and files are being fetched
- **THEN** a loading indicator SHALL be shown

#### Scenario: Empty specs directory
- **WHEN** the specs directory has no subdirectories
- **THEN** the view SHALL show a "No specs found" message

### Requirement: Combobox lists spec names for jump-to navigation
The specs browser SHALL include a combobox (dropdown) at the top listing all spec directory names alphabetically. Selecting a spec from the combobox SHALL scroll the content to that spec's heading.

#### Scenario: Combobox populated with spec names
- **WHEN** the specs browser loads specs `["auth", "billing", "chat"]`
- **THEN** the combobox SHALL list options: auth, billing, chat

#### Scenario: Selecting a spec scrolls to its heading
- **WHEN** the user selects "billing" from the combobox
- **THEN** the view SHALL scroll to the heading element for the "billing" spec using smooth scrolling

#### Scenario: Scroll anchors use spec name as DOM id
- **WHEN** specs are rendered with headings
- **THEN** each heading element SHALL have an `id` attribute of `spec-{specName}` (e.g., `spec-billing`)

### Requirement: useMainSpecsReader hook fetches and concatenates specs
A `useMainSpecsReader(cwd)` hook SHALL fetch the `openspec/specs/` directory listing and all spec.md files in parallel. It SHALL return `{ specNames, content, isLoading, error }`.

#### Scenario: Hook returns spec names and concatenated content
- **WHEN** the hook is called with cwd `/project/foo` which has specs `["auth", "billing"]`
- **THEN** `specNames` SHALL be `["auth", "billing"]` (sorted)
- **AND** `content` SHALL contain both spec contents separated by spec-name headings

#### Scenario: Hook sets loading state during fetch
- **WHEN** the hook initiates fetching
- **THEN** `isLoading` SHALL be `true` until all fetches complete

#### Scenario: Hook handles fetch errors
- **WHEN** the directory listing fetch fails
- **THEN** `error` SHALL contain the error message and `isLoading` SHALL be `false`
