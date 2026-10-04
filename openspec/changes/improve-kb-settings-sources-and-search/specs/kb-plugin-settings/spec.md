## MODIFIED Requirements

### Requirement: Edit path fields

The panel SHALL let the user edit only the v1 path fields — `sources`, `include`, `exclude`, `dbPath` — while all other config fields round-trip unchanged. Source entry SHALL offer a kind selector (Folder, Git repo, URL), a folder picker in Folder mode, and git-specific fields in Git mode.

#### Scenario: Manage sources

- **WHEN** the user adds a source ref, removes a source, reorders a source up/down, or changes a source priority
- **THEN** the edited `sources` list reflects the change, each source carrying `kind`, `ref`, and `priority`
- **AND** a source whose `ref` equals an existing source's `ref` is not added again, and a hint explains that one ref is one index root (change the existing source's pin or subdir instead)

#### Scenario: Folder mode refuses URL-shaped input

- **WHEN** the selector is on Folder and the input starts with `<scheme>://`, `git@`, `git:`, or `npm:`
- **THEN** the source is not added and a hint directs the user to Git repo or URL mode (or states that npm sources are not added from the UI)

#### Scenario: Kind selector sets source kind

- **WHEN** the user adds a source with the kind selector on Folder, Git repo, or URL
- **THEN** the added source carries `kind` `"filesystem"`, `"git"`, or `"https"` respectively
- **AND** in Git repo mode the optional `pin`, `subdir`, and `refresh` values entered are stored on the source when non-empty

#### Scenario: Git host URL auto-selects Git mode

- **WHEN** the user types a ref matching `https://github.com/…`, `https://gitlab.com/…`, `git@…`, or `git:…` while the selector is not on Git repo
- **THEN** the selector switches to Git repo
- **AND** the added source carries `kind: "git"`

#### Scenario: Pick a folder inside the folder

- **GIVEN** the host provides the `ui:path-picker` primitive
- **WHEN** the user chooses Browse… in Folder mode and selects a directory under `cwd`
- **THEN** the source input is filled with the path relative to `cwd` using `/` separators (`.` when the selection is `cwd` itself)

#### Scenario: Pick a folder outside the folder

- **WHEN** the user selects a directory that is not `cwd` or under it
- **THEN** the source input is filled with the absolute path
- **AND** after adding, the source row shows an "outside folder" warning badge

#### Scenario: Picker primitive unavailable

- **WHEN** the host does not provide the `ui:path-picker` primitive
- **THEN** the Browse… action is not rendered and typed entry still works

#### Scenario: Manage include/exclude globs

- **WHEN** the user adds or removes an entry in the include or exclude chip list
- **THEN** the corresponding `include` or `exclude` string array is updated
- **AND** a duplicate glob is not added

#### Scenario: Edit db path

- **WHEN** the user edits the DB path field
- **THEN** `dbPath` in the editable state is updated

#### Scenario: Dirty tracking

- **WHEN** the editable state differs from the loaded config baseline
- **THEN** the panel reports unsaved changes and enables the save actions; otherwise it reports no changes and disables them

## ADDED Requirements

### Requirement: Remote source trust consent

The panel SHALL require an explicit user decision before a remote (`git` or `https`) source is trusted, and SHALL grant trust only through the guarded server endpoints for refs present in the folder's saved config.

#### Scenario: Adding a remote source opens the trust dialog

- **WHEN** the user adds a source in Git repo or URL mode
- **THEN** a trust dialog shows the kind, ref, pin, and subdir, plus a warning that fetched text becomes searchable by agents
- **AND** states that trust applies to this exact source spec in every folder on this machine
- **AND** offers "Trust & add", "Add without trusting", and "Cancel"

#### Scenario: Trust and add

- **WHEN** the user chooses "Trust & add" and then saves
- **THEN** the save request carries that source's `ref` in `trustRefs`
- **AND** after the save the source row shows a trusted badge
- **AND** when the save response lists that ref in `untrustedRefs`, the row shows the not-trusted badge and the failure message

#### Scenario: Add without trusting

- **WHEN** the user chooses "Add without trusting" and saves
- **THEN** the source is persisted without a trust grant
- **AND** its row shows a "not trusted" badge and a "Trust…" action

#### Scenario: Trust an existing saved source

- **WHEN** the user chooses "Trust…" on a saved untrusted remote source and confirms the dialog
- **THEN** the panel issues `POST /api/kb/source-trust?cwd=<cwd>` with `{ ref }`
- **AND** on success the row shows the trusted badge

#### Scenario: Cancel adds nothing

- **WHEN** the user cancels the trust dialog
- **THEN** no source is added and no trust is granted

### Requirement: Per-source status display

The panel SHALL fetch `GET /api/kb/sources?cwd=<cwd>` and show per-source status on each saved source row.

#### Scenario: Status badges

- **WHEN** source status has loaded
- **THEN** each row shows its kind, its indexed file count, and, for remote sources, trusted / not-trusted state and the last revision when known
- **AND** a saved filesystem source with `outside: true` shows an "outside folder" badge
- **AND** a source whose last reindex outcome is `error` shows the error text in its badge tooltip

#### Scenario: Refresh points

- **WHEN** the panel mounts, a save succeeds, or a reindex job transitions from running to settled
- **THEN** the panel refetches source status
- **AND** it does not poll source status on an interval

### Requirement: Test search panel

The panel SHALL provide a test search section that queries the folder's saved KB index and renders ranked hits.

#### Scenario: Submit a query

- **WHEN** the user enters a non-empty query and submits
- **THEN** the panel issues `GET /api/kb/search?cwd=<cwd>&q=<q>&limit=<n>`, plus `docType` when a lane other than "all" is selected
- **AND** renders each hit with rank, path, heading path, snippet, score, and source/lane tags, plus a summary of hit count and elapsed time

#### Scenario: Needs-reindex notice

- **WHEN** the search response carries `needsReindex: true`
- **THEN** the section shows a notice that the index must be rebuilt before searching

#### Scenario: Match markers rendered safely

- **WHEN** a hit snippet contains match markers
- **THEN** matched spans are rendered highlighted using text nodes
- **AND** no snippet content is injected as HTML

#### Scenario: Dirty form notice

- **WHEN** the editable state has unsaved changes
- **THEN** the search section shows a notice that results reflect the last saved index

#### Scenario: Empty and error results

- **WHEN** the search returns no hits
- **THEN** an empty-state message is shown
- **AND** when the request fails, its error message is shown in the search section without clearing the form

#### Scenario: Copy hit path

- **WHEN** the user activates a hit
- **THEN** the hit's path is copied to the clipboard and a transient confirmation is shown
