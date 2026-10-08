## ADDED Requirements

### Requirement: Per-capability git history row above each spec section
The `SpecsBrowserView` SHALL render a `SpecHistoryRow` immediately above each capability's `# <specName>` heading in the concatenated content, scoped to that capability's `openspec/specs/<specName>/spec.md` file. Each row SHALL be rendered using the standalone `SpecHistoryRow` component (not the array-aggregate form of `MarkdownPreviewView`'s `history` prop).

#### Scenario: One history row per spec section
- **WHEN** the user opens the specs browser for cwd `/repo` with specs `["auth", "billing", "chat"]`
- **THEN** the view SHALL render three sections, each preceded by a `SpecHistoryRow` for `openspec/specs/<spec>/spec.md`

#### Scenario: History row precedes the heading
- **WHEN** rendering the `auth` section
- **THEN** the rendered DOM order SHALL be `<SpecHistoryRow for auth>` then `<h1 id="spec-auth">auth</h1>` then the markdown content

#### Scenario: Fetch failure for one spec's history
- **WHEN** the history fetch for `openspec/specs/billing/spec.md` fails AND the fetches for `auth` and `chat` succeed
- **THEN** the `billing` section SHALL render without a history row (suppressed) AND the `auth` and `chat` sections SHALL render their rows normally

## MODIFIED Requirements

### Requirement: useMainSpecsReader hook fetches and concatenates specs
A `useMainSpecsReader(cwd)` hook SHALL fetch the `openspec/specs/` directory listing and all spec.md files in parallel. It SHALL also fetch the git history for each spec.md file in parallel via `GET /api/file-history`. It SHALL return `{ specNames, content, histories, isLoading, error }` where `histories` is a `Record<specName, FileHistory>` mapping each capability name to its resolved history (or omitted if the history fetch failed).

#### Scenario: Hook returns spec names, content, and histories
- **WHEN** the hook is called with cwd `/project/foo` which has specs `["auth", "billing"]` and both spec.md and history fetches succeed
- **THEN** `specNames` SHALL be `["auth", "billing"]` (sorted)
- **AND** `content` SHALL contain both spec contents separated by spec-name headings
- **AND** `histories.auth` and `histories.billing` SHALL each be a populated `FileHistory`

#### Scenario: Hook sets loading state during fetch
- **WHEN** the hook initiates fetching
- **THEN** `isLoading` SHALL be `true` until all content fetches complete (history fetches MAY still be pending — they SHALL NOT block `isLoading` from clearing)

#### Scenario: Hook handles fetch errors
- **WHEN** the directory listing fetch fails
- **THEN** `error` SHALL contain the error message and `isLoading` SHALL be `false`

#### Scenario: History fetch failure for one spec
- **WHEN** the history fetch for `auth` fails but the spec content and the `billing` fetches succeed
- **THEN** `histories.auth` SHALL be omitted from the record (or set to `undefined`) AND `histories.billing` SHALL still be populated AND `error` SHALL remain unset

#### Scenario: Hook returns spec names and concatenated content
- **WHEN** the hook is called with cwd `/project/foo` which has specs `["auth", "billing"]`
- **THEN** `specNames` SHALL be `["auth", "billing"]` (sorted)
- **AND** `content` SHALL contain both spec contents separated by spec-name headings
