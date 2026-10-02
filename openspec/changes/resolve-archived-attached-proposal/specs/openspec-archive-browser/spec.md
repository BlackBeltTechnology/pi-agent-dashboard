## MODIFIED Requirements

### Requirement: Two-level navigation
The archive browser SHALL use two-level navigation: the archive list is the first level, and the artifact reader is the second level. Back from a reader opened from the list returns to the archive list, preserving scroll position and search filter. Back from the archive list returns to the session/default view. A reader opened through the archive-artifact deep-link route (`/folder/:encodedCwd/openspec/archive/:entry/:artifact`) SHALL use history-back semantics instead. That returns to the launching view; on a cold load, the url-routing back-action table applies.

#### Scenario: Back from artifact reader returns to archive list
- **WHEN** the user opens an artifact from the archive browser and clicks Back
- **THEN** the content area SHALL return to the archive browser (not the session list)
- **AND** the search filter and scroll position SHALL be preserved

#### Scenario: Back from archive browser returns to session list
- **WHEN** the user clicks the back button in the archive browser (not inside an artifact reader)
- **THEN** the content area SHALL return to the session/default view (clear `archiveBrowserCwd` state)

#### Scenario: Back from a deep-linked reader returns to the launching view
- **WHEN** the user opened an archived artifact from a session card's archive letter and clicks Back
- **THEN** the session view SHALL be restored

## ADDED Requirements

### Requirement: Archive entries show attached sessions
Each archive entry row SHALL list the sessions whose attachment resolves to that exact entry. A session qualifies only when all of these hold:
- its `attachedProposal` equals the entry name without its date prefix;
- its `cwd` equals the browsed folder, OR its `gitWorktree.mainPath` equals the browsed folder;
- `resolveAttachment` for that session returns `kind: "archived"` with this entry.

The row SHALL render at most 3 session chips (session name + status dot), then a `+N` overflow count. Activating a chip SHALL navigate (push) to that session and SHALL NOT open the artifact reader.

#### Scenario: Entry with an ended and a worktree session
- **WHEN** the browsed folder is `/repo`, entry `2026-09-30-add-auth` exists, ended session A (`cwd=/repo`) and removed-worktree session B (`gitWorktree.mainPath=/repo`) are both attached to `add-auth`, and both resolve to this entry
- **THEN** the row SHALL show chips for A and B

#### Scenario: Same name archived twice
- **WHEN** entries `2026-05-01-add-auth` and `2026-09-30-add-auth` exist and session A resolves to `2026-09-30-add-auth`
- **THEN** A's chip SHALL appear only on the `2026-09-30-add-auth` row

#### Scenario: Chip navigates to the session
- **WHEN** the user activates session A's chip
- **THEN** the client SHALL navigate to session A's route

### Requirement: Archive listing reads through the shared cache
`useArchiveListing(cwd)` SHALL read through the shared per-folder archive cache defined in `openspec-attachment-resolution`. Its return shape SHALL stay unchanged.

#### Scenario: Browser reuses card-triggered fetch
- **WHEN** session cards already fetched the `/repo` archive and the user opens the `/repo` archive browser with an unchanged active set
- **THEN** no new `/api/openspec-archive` request SHALL be made
